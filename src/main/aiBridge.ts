import { app, BrowserWindow, ipcMain } from 'electron'
import http from 'http'
import crypto from 'crypto'
import fs from 'fs-extra'
import path from 'path'
import { gameEvents, getInstancePid, isInstanceRunning, killInstance } from './launcher'
import { createLiveBridge, NOT_LIVE_MESSAGE, type LiveRegistration } from './liveBridge'
import { getInstance, getInstanceGameDir, listMods, listResourcepacks, listShaderpacks, loadInstances } from './instances'
import { getInstalledModsMeta, getModVersions, installModFromUrl, searchMods } from './modrinth'
import axios from 'axios'
import { canonicalMod, ensureDocs, readDocPage, searchDocs } from './modDocs'
import { cfGet, CF_CLASS, CF_GAME_MINECRAFT, CF_LOADER } from './curseforge'
import { listWorldDatapacks, setWorldDatapackEnabled } from './worldDatapacks'
import type { AiActivity, Instance } from '../shared/types'
import { MCP_SCRIPT } from './aiMcpScript'
import { communityExperience, crashSignature, findLessons, rateLesson, shareLesson, aiLearningEnabled } from './aiCommunity'
import { editNbt, inspectFile } from './fileInspect'
import { deobfuscateText, getMappings, obfuscatedClassName } from './deobf'
import { getSharedDir } from './instances'
import { packFormats, queryRegistry, readResource, scaffoldProject, setGameRule, validatePack, worldInfo } from './gameKnowledge'
import { countEvent } from './telemetry'

// Puente local para IAs (Claude Code, Codex, Gemini, Cursor…).
//
// Todo lo que hace una IA sobre una instancia pasa por aquí, dentro del
// launcher: arrancar el juego y esperar a ver si crashea, leer registros,
// activar/desactivar/instalar/quitar mods, resource packs, shaders y datapacks,
// editar configs y anotar lo aprendido. El launcher muestra cada acción.
// Los permisos (preguntar antes de cada cambio, o no) los lleva la propia IA:
// Claude Code, Codex, Gemini… piden aprobación para cada herramienta MCP.
//
// Es un servidor HTTP solo en 127.0.0.1 con una clave aleatoria guardada en
// userData/ai-bridge.json; lo usa el servidor MCP de aiMcpScript.ts y, con
// live/*, el mod fport1-social para abrir el canal en vivo con la partida.

export const BRIDGE_FILE = (): string => path.join(app.getPath('userData'), 'ai-bridge.json')
export const MCP_SCRIPT_FILE = (): string => path.join(app.getPath('userData'), 'ai', 'modpack-mcp.cjs')

type LaunchFn = (instanceId: string) => Promise<void>
type Kind = 'mod' | 'resourcepack' | 'shader' | 'datapack'

interface RunState {
  startedAt: number
  lines: string[]
  exitCode: number | null | undefined
  exitedAt?: number
  ready?: boolean
}


const runs = new Map<string, RunState>()
const MAX_LINES = 4000
// El juego ha llegado al menú principal (o a cargar un mundo)
const READY_RE = /Sound engine started|textures\/atlas\/blocks\.png-atlas|Loaded \d+ advancements|Preparing spawn area|Joining world/i
const ERROR_RE = /\b(ERROR|FATAL|Exception|Caused by:|Mixin apply failed|NoClassDefFoundError|ClassNotFoundException|Missing or unsupported mandatory dependencies|requires .* but|Incompatible mod set)/

gameEvents.on('start', (id: string) => { runs.set(id, { startedAt: Date.now(), lines: [], exitCode: undefined }) })
gameEvents.on('log', (id: string, line: string) => {
  const r = runs.get(id)
  if (!r) return
  r.lines.push(line)
  if (r.lines.length > MAX_LINES) r.lines.splice(0, r.lines.length - MAX_LINES)
  if (!r.ready && READY_RE.test(line)) r.ready = true
})
gameEvents.on('exit', (id: string, code: number | null) => {
  const r = runs.get(id)
  if (r) { r.exitCode = code; r.exitedAt = Date.now() }
})

// ── Actividad (se ve en el launcher) ─────────────────────────────────────────

const activity: AiActivity[] = []

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

function logActivity(instanceId: string, text: string, kind: AiActivity['kind'] = 'change'): void {
  const a = { instanceId, text, at: Date.now(), kind }
  activity.push(a)
  if (activity.length > 300) activity.shift()
  if (kind === 'change') countEvent('aiActions')
  broadcast('ai:activity', a)
}

// ── Canal en vivo con la partida (mod fport1-social, ver liveBridge.ts) ─────

const live = createLiveBridge({
  clientVersion: app.getVersion(),
  activity: (id, text, kind) => logActivity(id, text, kind),
  changed: (instanceId, status) => broadcast('ai:live', { instanceId, status }),
})
// Último error al conectar con cada partida, para no repetirlo en cada reintento del mod (cada 15 s)
const liveErrors = new Map<string, string>()

gameEvents.on('exit', (id: string) => live.unregister(id))

function liveRegistration(body: any): LiveRegistration {
  return { port: Number(body.port), token: String(body.token ?? ''), side: body.side, mc: body.mc, loader: body.loader, modVersion: body.modVersion, protocol: body.protocol, pid: body.pid != null ? Number(body.pid) : undefined }
}

// ── Utilidades ──────────────────────────────────────────────────────────────

async function latestCrash(gameDir: string, since = 0): Promise<{ file: string; text: string } | null> {
  const dirs = [path.join(gameDir, 'crash-reports'), gameDir]
  let best: { file: string; mtime: number } | null = null
  for (const dir of dirs) {
    const names = await fs.readdir(dir).catch(() => [] as string[])
    for (const n of names) {
      if (dir === gameDir ? !/^hs_err_pid\d+\.log$/.test(n) : !n.endsWith('.txt')) continue
      const st = await fs.stat(path.join(dir, n)).catch(() => null)
      if (st && st.mtimeMs >= since && (!best || st.mtimeMs > best.mtime)) best = { file: path.join(dir, n), mtime: st.mtimeMs }
    }
  }
  if (!best) return null
  const text = await fs.readFile(best.file, 'utf8').catch(() => '')
  return { file: path.relative(gameDir, best.file).replace(/\\/g, '/'), text: text.slice(0, 12_000) }
}

function summarizeRun(r: RunState | undefined): Record<string, unknown> {
  if (!r) return { state: 'never-started' }
  return {
    state: r.exitCode === undefined ? (r.ready ? 'running' : 'starting') : r.exitCode === 0 ? 'exited' : 'crashed',
    exitCode: r.exitCode ?? null,
    secondsRunning: Math.round(((r.exitedAt ?? Date.now()) - r.startedAt) / 1000),
    reachedMenu: !!r.ready,
    errorLines: r.lines.filter((l) => ERROR_RE.test(l)).slice(-60),
    logTail: r.lines.slice(-120),
  }
}

async function waitForOutcome(instanceId: string, since: number, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const r = runs.get(instanceId)
    if (r && r.startedAt >= since && (r.exitCode !== undefined || r.ready)) {
      // Tras llegar al menú se espera un poco más: muchos crashes llegan justo después
      if (r.ready && r.exitCode === undefined) await new Promise((res) => setTimeout(res, 8000))
      return
    }
    await new Promise((res) => setTimeout(res, 1000))
  }
}

const KIND_NAME: Record<Kind, string> = { mod: 'mod', resourcepack: 'resource pack', shader: 'shader', datapack: 'datapack' }

function parseKind(v: unknown): Kind {
  const s = String(v ?? 'mod')
  if (s === 'resourcepack' || s === 'shader' || s === 'datapack') return s
  return 'mod'
}

/** Carpeta del tipo de contenido dentro de la carpeta del juego. */
function kindDir(gameDir: string, kind: Kind, world?: string): string {
  if (kind === 'datapack') {
    if (!world) throw new Error('Los datapacks son de un mundo: indica «mundo» (usa listar_contenido tipo=datapack sin mundo para ver los mundos)')
    return path.join(gameDir, 'saves', path.basename(world), 'datapacks')
  }
  return path.join(gameDir, kind === 'mod' ? 'mods' : kind === 'resourcepack' ? 'resourcepacks' : 'shaderpacks')
}

function inside(base: string, rel: string): string {
  const full = path.resolve(base, rel)
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('Ruta fuera de la carpeta del juego')
  return full
}

/** Ruta de lectura: dentro de la carpeta del juego o, con «shared:», en los archivos compartidos (jars de versiones, librerías, assets). */
function readablePath(gameDir: string, rel: string): string {
  if (rel.startsWith('shared:')) return inside(getSharedDir(), rel.slice(7).replace(/^[\\/]+/, ''))
  if (path.isAbsolute(rel)) {
    const full = path.resolve(rel)
    for (const base of [gameDir, getSharedDir()]) if (full === base || full.startsWith(base + path.sep)) return full
    throw new Error('Solo se leen archivos de la instancia o de «shared:» (versiones, librerías). Para otros usa tus propias herramientas.')
  }
  return inside(gameDir, rel)
}

/** Añade al crash el texto con nombres reales si la versión está ofuscada. */
async function withDeobf(mc: string, crash: { file: string; text: string } | null): Promise<unknown> {
  if (!crash) return crash
  try {
    const d = await deobfuscateText(mc, crash.text)
    return d.ofuscada && d.cambios ? { ...crash, textoConNombresReales: d.texto } : crash
  } catch { return crash }
}

/** Loader que entiende Modrinth para cada tipo. */
function mrLoader(inst: Instance, kind: Kind): string {
  if (kind === 'mod') return inst.modloader === 'vanilla' ? '' : inst.modloader
  if (kind === 'datapack') return 'datapack'
  return ''
}

const CF_CLASS_OF: Record<Kind, number> = { mod: CF_CLASS.mod, resourcepack: CF_CLASS.resourcepack, shader: CF_CLASS.shader, datapack: CF_CLASS.datapack }

async function installFromSource(inst: Instance, kind: Kind, source: string, project: string, versionId: string | undefined, world?: string): Promise<{ filename: string; version: string; folder: string }> {
  const gameDir = await getInstanceGameDir(inst.id)
  const folder = path.relative(gameDir, kindDir(gameDir, kind, world)).replace(/\\/g, '/')
  if (source === 'curseforge') {
    const modId = Number(project)
    const params = new URLSearchParams({ pageSize: '50', gameVersion: inst.minecraft })
    if (kind === 'mod' && CF_LOADER[inst.modloader]) params.set('modLoaderType', String(CF_LOADER[inst.modloader]))
    const files = (await cfGet<{ data: any[] }>(`/v1/mods/${modId}/files?${params}`)).data
    const f = versionId ? files.find((x) => String(x.id) === versionId) : files.find((x) => x.releaseType === 1) ?? files[0]
    if (!f) throw new Error(`No hay versión en CurseForge para ${inst.minecraft}${kind === 'mod' ? ` ${inst.modloader}` : ''}`)
    const url = (await cfGet<{ data: string }>(`/v1/mods/${modId}/files/${f.id}/download-url`).catch(() => ({ data: '' }))).data
    if (!url) throw new Error('El autor no permite descargarlo fuera de CurseForge')
    await installModFromUrl(inst.id, url, f.fileName, folder)
    return { filename: f.fileName, version: f.displayName, folder }
  }
  const vs = await getModVersions(project, inst.minecraft, mrLoader(inst, kind))
  const v = versionId ? vs.find((x) => x.id === versionId || x.version_number === versionId) : vs.find((x) => x.version_type === 'release') ?? vs[0]
  if (!v) throw new Error(`No hay versión de «${project}» en Modrinth para ${inst.minecraft}${kind === 'mod' ? ` ${inst.modloader}` : ''}`)
  const file = v.files.find((f) => f.primary) ?? v.files[0]
  await installModFromUrl(inst.id, file.url, file.filename, folder)
  return { filename: file.filename, version: v.version_number, folder }
}

async function listContent(inst: Instance, kind: Kind, world?: string): Promise<Record<string, unknown>> {
  const gameDir = await getInstanceGameDir(inst.id)
  if (kind === 'datapack') {
    if (!world) return { worlds: await fs.readdir(path.join(gameDir, 'saves')).catch(() => [] as string[]) }
    return { world, datapacks: (await listWorldDatapacks(inst.id, world)).map(({ iconBase64: _i, ...d }) => d) }
  }
  if (kind === 'resourcepack') {
    const opts = await fs.readFile(path.join(gameDir, 'options.txt'), 'utf8').catch(() => '')
    const active = opts.match(/^resourcePacks:(.*)$/m)?.[1] ?? '[]'
    return { items: (await listResourcepacks(inst.id)).map((r) => ({ filename: r.filename, enabled: r.enabled })), activeInOptions: active, note: 'Además de estar en la carpeta, el pack tiene que estar en resourcePacks de options.txt (o activarse en el juego) para usarse.' }
  }
  if (kind === 'shader') {
    const iris = await fs.readFile(path.join(gameDir, 'config', 'iris.properties'), 'utf8').catch(() => '')
    return { items: (await listShaderpacks(inst.id)).map((r) => ({ filename: r.filename, enabled: r.enabled })), selected: iris.match(/^shaderPack=(.*)$/m)?.[1] ?? null }
  }
  const [mods, meta] = await Promise.all([listMods(inst.id), getInstalledModsMeta(inst.id, inst.minecraft, inst.modloader).catch(() => ({} as Record<string, any>))])
  return {
    minecraft: inst.minecraft, loader: inst.modloader,
    items: mods.map((m) => {
      const x = (meta as Record<string, any>)[m.filename] ?? {}
      return {
        filename: m.filename, enabled: m.enabled, name: x.title || m.meta?.name, modIds: m.meta?.modIds ?? [], requires: m.meta?.requires ?? [],
        source: x.source ?? 'archivo', project: x.source === 'curseforge' ? x.cfModId : x.source === 'fport1' ? x.f1ProjectId : x.projectId,
        hasUpdate: !!x.hasUpdate, clientSide: x.clientSide, serverSide: x.serverSide,
      }
    }),
  }
}

// ── Servidor ────────────────────────────────────────────────────────────────

export function startAiBridge(launch: LaunchFn): void {
  const token = crypto.randomBytes(24).toString('hex')
  // Se reescribe en cada arranque para que las instancias usen siempre la versión del launcher instalado
  fs.outputFile(MCP_SCRIPT_FILE(), MCP_SCRIPT).catch(() => {})

  ipcMain.handle('ai:activity', (_e, instanceId?: string) => activity.filter((a) => !instanceId || a.instanceId === instanceId).slice(-100))
  ipcMain.handle('ai:live', () => live.list())
  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Clave incorrecta' })
    let body: any = {}
    try {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    } catch { return send(400, { error: 'JSON inválido' }) }

    let instId = ''
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts[0] === 'status') {
        const list = await loadInstances()
        return send(200, { launcher: app.getVersion(), instances: list.map((i) => ({ id: i.id, name: i.name, minecraft: i.minecraft, loader: i.modloader, running: isInstanceRunning(i.id) })) })
      }
      if (parts[0] !== 'instance' || !parts[1]) return send(404, { error: 'Ruta desconocida' })
      const inst = await getInstance(decodeURIComponent(parts[1]))
      if (!inst) return send(404, { error: 'Instancia no encontrada' })
      instId = inst.id
      const gameDir = await getInstanceGameDir(inst.id)
      const action = parts.slice(2).join('/')
      const kind = parseKind(body.kind)
      const world = body.world ? String(body.world) : undefined

      switch (action) {
        case 'launch': {
          if (isInstanceRunning(inst.id)) return send(409, { error: 'La instancia ya está abierta', ...summarizeRun(runs.get(inst.id)) })
          const t0 = Date.now()
          logActivity(inst.id, 'Abriendo el juego para probar', 'info')
          try { await launch(inst.id) } catch (e) {
            const raw = e instanceof Error ? e.message : String(e)
            const msg = /No account selected/i.test(raw) ? 'No hay ninguna cuenta de Minecraft en el launcher: pide al usuario que inicie sesión y vuelve a intentarlo' : raw
            logActivity(inst.id, `No se pudo abrir: ${msg}`, 'error')
            return send(200, { state: 'launch-failed', error: msg })
          }
          await waitForOutcome(inst.id, t0, Math.min(Number(body.waitSeconds ?? 240), 600) * 1000)
          const r = runs.get(inst.id)
          const out = summarizeRun(r && r.startedAt >= t0 ? r : undefined)
          if (r && r.exitCode !== undefined && r.exitCode !== 0) {
            const crash = await latestCrash(gameDir, t0)
            out.crashReport = await withDeobf(inst.minecraft, crash)
            // Lo que ya les funcionó a otros con este mismo crash (o con estos mods)
            if (crash?.text) {
              const s = crashSignature(crash.text)
              out.crashSignature = { hash: s.hash, mods: s.mods }
              const known = await findLessons(inst, { sig: s.hash, mods: s.mods })
              if (known.length) out.knownFixes = known
            }
          }
          logActivity(inst.id, out.state === 'running' ? 'El juego llegó al menú' : out.state === 'crashed' ? `El juego crasheó (código ${out.exitCode})` : `Estado del juego: ${out.state}`, out.state === 'crashed' ? 'error' : 'info')
          return send(200, out)
        }
        case 'stop':
          killInstance(inst.id)
          logActivity(inst.id, 'Juego cerrado')
          return send(200, { ok: true })
        case 'state':
          return send(200, { running: isInstanceRunning(inst.id), ...summarizeRun(runs.get(inst.id)) })
        case 'log': {
          const n = Math.min(Number(body.lines ?? 300), 3000)
          const text = await fs.readFile(path.join(gameDir, 'logs', 'latest.log'), 'utf8').catch(() => '')
          const lines = text.split(/\r?\n/)
          const filter = body.filter ? new RegExp(String(body.filter), 'i') : null
          return send(200, { lines: (filter ? lines.filter((l) => filter.test(l)) : lines).slice(-n) })
        }
        case 'crashes': {
          const names = (await fs.readdir(path.join(gameDir, 'crash-reports')).catch(() => [] as string[])).filter((n) => n.endsWith('.txt')).sort().reverse()
          return send(200, { reports: names.slice(0, 30), latest: await withDeobf(inst.minecraft, await latestCrash(gameDir)) })
        }
        case 'content':
          return send(200, await listContent(inst, kind, world))
        case 'toggle': {
          if (kind === 'datapack') {
            if (isInstanceRunning(inst.id)) return send(409, { error: 'Con el juego abierto usa /datapack enable|disable dentro del juego; al guardar el mundo se perdería el cambio' })
            // «mipack.zip» → «file/mipack.zip»; los integrados (vanilla, bundle…) van tal cual
            const f = String(body.filename)
            const id = f.includes('/') || !(await fs.pathExists(path.join(kindDir(gameDir, kind, world), f))) ? f : `file/${f}`
            await setWorldDatapackEnabled(inst.id, String(world), id, body.enabled !== false)
            logActivity(inst.id, `Datapack ${id} ${body.enabled !== false ? 'activado' : 'desactivado'} en ${world}`)
            return send(200, { ok: true })
          }
          const dir = kindDir(gameDir, kind)
          const base = String(body.filename).replace(/\.disabled$/, '')
          const cur = (await fs.pathExists(path.join(dir, base))) ? base : (await fs.pathExists(path.join(dir, `${base}.disabled`))) ? `${base}.disabled` : null
          if (!cur) return send(404, { error: `${KIND_NAME[kind]} no encontrado` })
          const want = body.enabled !== false
          const next = want ? base : `${base}.disabled`
          if (cur !== next) await fs.rename(path.join(dir, cur), path.join(dir, next))
          logActivity(inst.id, `${want ? 'Activado' : 'Desactivado'} ${base}`)
          return send(200, { filename: next, enabled: want })
        }
        case 'remove': {
          // No se borra: va a la papelera de la instancia para poder deshacerlo
          const src = path.join(kindDir(gameDir, kind, world), path.basename(String(body.filename)))
          if (!(await fs.pathExists(src))) return send(404, { error: `${KIND_NAME[kind]} no encontrado` })
          const dest = path.join(gameDir, '.ai', 'papelera', kind, path.basename(src))
          await fs.ensureDir(path.dirname(dest))
          await fs.move(src, dest, { overwrite: true })
          logActivity(inst.id, `Quitado ${path.basename(src)} (se puede restaurar)`)
          return send(200, { ok: true, restoreWith: { kind, filename: path.basename(src), world } })
        }
        case 'restore': {
          const src = path.join(gameDir, '.ai', 'papelera', kind, path.basename(String(body.filename)))
          if (!(await fs.pathExists(src))) return send(404, { error: 'No está en la papelera' })
          await fs.move(src, path.join(kindDir(gameDir, kind, world), path.basename(src)), { overwrite: true })
          logActivity(inst.id, `Restaurado ${path.basename(src)}`)
          return send(200, { ok: true })
        }
        case 'install': {
          const r = await installFromSource(inst, kind, String(body.source ?? 'modrinth'), String(body.project), body.version ? String(body.version) : undefined, world)
          // Si sustituye a otro archivo (cambio de versión), el viejo va a la papelera
          if (body.replaceFilename && body.replaceFilename !== r.filename) {
            const old = path.join(kindDir(gameDir, kind, world), path.basename(String(body.replaceFilename)))
            if (await fs.pathExists(old)) {
              await fs.ensureDir(path.join(gameDir, '.ai', 'papelera', kind))
              await fs.move(old, path.join(gameDir, '.ai', 'papelera', kind, path.basename(old)), { overwrite: true })
            }
          }
          logActivity(inst.id, `Instalado ${r.filename}${body.replaceFilename ? ` (sustituye a ${body.replaceFilename})` : ''}`)
          return send(200, r)
        }
        case 'install-file': {
          // El jar de un mod en desarrollo, o un pack de un proyecto
          const src = String(body.path)
          if (!(await fs.pathExists(src))) return send(404, { error: 'No existe ese archivo' })
          const dest = path.join(kindDir(gameDir, kind, world), path.basename(src))
          await fs.ensureDir(path.dirname(dest))
          await fs.copy(src, dest, { overwrite: true })
          logActivity(inst.id, `Copiado ${path.basename(src)} a ${path.relative(gameDir, path.dirname(dest))}`)
          return send(200, { ok: true, dest: path.relative(gameDir, dest).replace(/\\/g, '/') })
        }
        case 'link': {
          // Enlaza la carpeta de un proyecto (datapack, resource pack o shader) a la instancia:
          // se edita en el proyecto y el juego lo ve al recargar (/reload, F3+T, R en shaders)
          if (kind === 'mod') return send(400, { error: 'Un mod en desarrollo no se enlaza: compílalo y usa copiar_archivo con el .jar' })
          const projectDir = String(body.projectDir)
          const marker = kind === 'shader' ? 'shaders' : 'pack.mcmeta'
          if (!(await fs.pathExists(path.join(projectDir, marker)))) return send(400, { error: `Esa carpeta no tiene ${marker}` })
          const dest = path.join(kindDir(gameDir, kind, world), String(body.name ?? path.basename(projectDir)))
          await fs.ensureDir(path.dirname(dest))
          if (await fs.pathExists(dest)) return send(409, { error: 'Ya hay algo con ese nombre; quítalo o usa otro nombre' })
          await fs.symlink(projectDir, dest, 'junction')
          logActivity(inst.id, `Enlazado el proyecto ${path.basename(projectDir)} (${KIND_NAME[kind]})`)
          return send(200, { ok: true, dest: path.relative(gameDir, dest).replace(/\\/g, '/'), reload: kind === 'datapack' ? '/reload' : kind === 'resourcepack' ? 'F3+T' : 'tecla R (Iris) o recargar shaders' })
        }
        case 'search': {
          const q = String(body.query ?? '')
          if (body.source === 'curseforge') {
            const params = new URLSearchParams({ gameId: String(CF_GAME_MINECRAFT), classId: String(CF_CLASS_OF[kind]), searchFilter: q, pageSize: '10', sortField: '2', sortOrder: 'desc', gameVersion: inst.minecraft })
            if (kind === 'mod' && CF_LOADER[inst.modloader]) params.set('modLoaderType', String(CF_LOADER[inst.modloader]))
            const r = await cfGet<{ data: any[] }>(`/v1/mods/search?${params}`)
            return send(200, { results: r.data.map((m) => ({ source: 'curseforge', project: String(m.id), name: m.name, summary: m.summary, downloads: m.downloadCount })) })
          }
          const r = await searchMods(q, inst.minecraft, mrLoader(inst, kind), [], '', kind, 10, 0, 'relevance')
          return send(200, { results: r.hits.map((h: any) => ({ source: 'modrinth', project: h.slug ?? h.project_id, name: h.title, summary: h.description, downloads: h.downloads })) })
        }
        case 'versions': {
          if (body.source === 'curseforge') {
            const r = await cfGet<{ data: any[] }>(`/v1/mods/${Number(body.project)}/files?pageSize=30&gameVersion=${encodeURIComponent(inst.minecraft)}`)
            return send(200, { versions: r.data.map((f) => ({ id: String(f.id), name: f.displayName, file: f.fileName, date: f.fileDate, gameVersions: f.gameVersions })) })
          }
          const vs = await getModVersions(String(body.project), inst.minecraft, mrLoader(inst, kind))
          return send(200, { versions: vs.slice(0, 30).map((v) => ({ id: v.id, name: v.version_number, type: v.version_type, date: v.date_published, loaders: v.loaders, gameVersions: v.game_versions })) })
        }
        case 'files': {
          // Archivos editables: config/, options.txt, defaultconfigs/, serverconfig de un mundo…
          const rel = String(body.path ?? 'config')
          const dir = inside(gameDir, rel)
          const names = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
          return send(200, { path: rel, entries: names.slice(0, 500).map((d) => (d.isDirectory() ? `${d.name}/` : d.name)) })
        }
        case 'files/read': {
          const file = readablePath(gameDir, String(body.path))
          const chunk = body.chunk && typeof body.chunk === 'object' ? { x: Number(body.chunk.x), z: Number(body.chunk.z) } : undefined
          return send(200, await inspectFile(file, { entrada: body.entry ? String(body.entry) : undefined, filtro: body.filter ? String(body.filter) : undefined, chunk, mc: inst.minecraft, crudo: !!body.raw }))
        }
        case 'files/nbt': {
          const rel = String(body.path)
          if (isInstanceRunning(inst.id) && /(level\.dat|playerdata|players[\\/]data|\.dat$)/.test(rel)) return send(409, { error: 'Cierra el juego antes: al guardar, Minecraft sobrescribiría el cambio' })
          const r = await editNbt(inside(gameDir, rel), String(body.nbtPath), String(body.value))
          logActivity(inst.id, `NBT ${rel}: ${body.nbtPath} = ${r.despues}`)
          return send(200, { ok: true, ...r, copia: rel + '.ia-bak' })
        }
        case 'deobf': {
          const text = body.text ? String(body.text) : body.path ? await fs.readFile(readablePath(gameDir, String(body.path)), 'utf8') : ''
          const d = await deobfuscateText(String(body.version ?? inst.minecraft), text)
          return send(200, d.ofuscada ? { cambios: d.cambios, texto: d.texto.slice(0, 60_000) } : { ofuscada: false, nota: `Minecraft ${body.version ?? inst.minecraft} no está ofuscado: los nombres ya son los reales.` })
        }
        case 'class': {
          // Una clase del juego (por su nombre real, aunque el jar esté ofuscado) o de un mod
          const cname = String(body.name).replace(/\//g, '.').replace(/\.class$/, '')
          const mc = inst.minecraft
          const jar = path.join(getSharedDir(), 'versions', mc, `${mc}.jar`)
          const obf = await obfuscatedClassName(mc, cname).catch(() => null)
          const tryIn = async (zipPath: string, entry: string): Promise<unknown | null> => {
            try { return await inspectFile(zipPath, { entrada: entry, mc }) } catch { return null }
          }
          if (obf) { const r = await tryIn(jar, obf.replace(/\./g, '/') + '.class'); if (r) return send(200, r) }
          const direct = await tryIn(jar, cname.replace(/\./g, '/') + '.class')
          if (direct) return send(200, direct)
          for (const m of (await listMods(inst.id)).filter((x) => x.filename.endsWith('.jar'))) {
            const r = await tryIn(path.join(gameDir, 'mods', m.filename), cname.replace(/\./g, '/') + '.class')
            if (r) return send(200, { mod: m.filename, ...(r as object) })
          }
          const mp = await getMappings(mc).catch(() => null)
          const hints = mp?.obfuscated ? [...mp.cls.values()].filter((n) => n.toLowerCase().endsWith('.' + cname.split('.').pop()!.toLowerCase())).slice(0, 10) : []
          return send(404, { error: 'No encontré esa clase en el juego ni en los mods', parecidas: hints.length ? hints : undefined })
        }
        case 'files/write': {
          const rel = String(body.path)
          if (/^(mods|saves\/[^/]+\/(region|playerdata|level\.dat))/.test(rel.replace(/\\/g, '/'))) return send(400, { error: 'Ese archivo no se edita como texto' })
          const file = inside(gameDir, rel)
          // Copia de seguridad antes de cambiar nada
          if (await fs.pathExists(file)) {
            const bak = path.join(gameDir, '.ai', 'copias', `${new Date().toISOString().replace(/[:.]/g, '-')}_${rel.replace(/[\\/]/g, '__')}`)
            await fs.ensureDir(path.dirname(bak))
            await fs.copy(file, bak)
          }
          await fs.outputFile(file, String(body.text ?? ''))
          logActivity(inst.id, `Editado ${rel}${isInstanceRunning(inst.id) ? ' (el juego está abierto: puede que no lo lea hasta reiniciar)' : ''}`)
          return send(200, { ok: true, backup: true })
        }
        case 'lessons': {
          const text = await fs.readFile(path.join(gameDir, '.ai', 'lecciones.md'), 'utf8').catch(() => '')
          // Además de lo aprendido aquí, lo que otros jugadores aprendieron con estos mods
          const modIds = (await listMods(inst.id).catch(() => [])).flatMap((m) => m.meta?.modIds ?? [])
          const community = await findLessons(inst, { mods: modIds, kind: body.kind ? String(body.kind) : undefined, tema: body.topic ? String(body.topic) : undefined })
          return send(200, { local: text, community, communityEnabled: aiLearningEnabled() })
        }
        case 'lessons/rate': {
          await rateLesson(String(body.id), !!body.worked)
          return send(200, { ok: true })
        }
        case 'lessons/add': {
          const file = path.join(gameDir, '.ai', 'lecciones.md')
          const entry = `\n## ${new Date().toISOString().slice(0, 10)} · ${body.kind ? `[${body.kind}] ` : ''}${String(body.title ?? 'Lección').slice(0, 120)}\n- Síntoma: ${body.symptom ?? '—'}\n- Causa: ${body.cause ?? '—'}\n- Arreglo: ${body.fix ?? '—'}\n${body.mods ? `- Implicados: ${body.mods}\n` : ''}`
          if (!(await fs.pathExists(file))) await fs.outputFile(file, '# Lecciones aprendidas\n\nLo que la IA ha ido descubriendo al arreglar crashes y problemas de este modpack. Se lee antes de diagnosticar.\n')
          await fs.appendFile(file, entry)
          // Se comparte anónimamente (saneado) si el usuario lo permite en Ajustes › Privacidad
          const shared = await shareLesson(inst, { kind: body.kind ? String(body.kind) : undefined, title: String(body.title ?? ''), symptom: String(body.symptom ?? ''), cause: String(body.cause ?? ''), fix: String(body.fix ?? ''), mods: body.mods ? String(body.mods) : undefined })
          if (shared) countEvent('aiLessonsShared')
          logActivity(inst.id, `Aprendido: ${String(body.title ?? '').slice(0, 80)}`, 'info')
          return send(200, { ok: true, sharedWithCommunity: !!shared })
        }
        // ── Conocimiento del juego para construir ──
        case 'registry':
          return send(200, await queryRegistry(inst, { tipo: body.type, buscar: body.search, namespace: body.namespace, mundo: world, limite: body.limit }))
        case 'resource':
          return send(200, await readResource(inst, { tipo: body.type, id: body.id, ruta: body.path, mundo: world, extraer: !!body.extract }))
        case 'world': {
          if (!world) return send(200, { mundos: await fs.readdir(path.join(gameDir, 'saves')).catch(() => []) })
          return send(200, await worldInfo(inst, world))
        }
        case 'world/rule': {
          if (isInstanceRunning(inst.id)) return send(409, { error: 'Con el juego abierto usa /gamerule dentro del juego; al guardar el mundo se perdería el cambio' })
          const rk = await setGameRule(inst, String(world), String(body.rule), String(body.value))
          logActivity(inst.id, `Regla ${rk} = ${body.value} en ${world}`)
          return send(200, { ok: true, regla: rk })
        }
        case 'world/copy': {
          // Copia de un mundo para experimentar sin miedo (worldgen, mobs, mecánicas…)
          const src = path.join(gameDir, 'saves', path.basename(String(world)))
          const name = String(body.name ?? `${path.basename(String(world))} (prueba IA)`).replace(/[<>:"/\\|?*]/g, '_')
          const dest = path.join(gameDir, 'saves', name)
          if (!(await fs.pathExists(src))) return send(404, { error: 'Ese mundo no existe' })
          if (await fs.pathExists(dest)) return send(409, { error: 'Ya hay un mundo con ese nombre' })
          await fs.copy(src, dest, { filter: (f) => !f.endsWith('session.lock') })
          logActivity(inst.id, `Copia del mundo ${world} → ${name}${isInstanceRunning(inst.id) ? ' (con el juego abierto: puede no estar al día)' : ''}`)
          return send(200, { ok: true, mundo: name })
        }
        case 'project/create': {
          const fmt = await packFormats(inst.minecraft)
          const r = await scaffoldProject(inst, fmt, { tipo: String(body.kind ?? 'datapack'), nombre: String(body.name), carpeta: String(body.folder ?? path.join(gameDir, '.ai', 'proyectos')), namespace: body.namespace ? String(body.namespace) : undefined, descripcion: body.description ? String(body.description) : undefined })
          logActivity(inst.id, `Proyecto creado: ${body.name} (${body.kind ?? 'datapack'})`)
          return send(200, r)
        }
        case 'project/validate':
          return send(200, await validatePack(inst, await packFormats(inst.minecraft), String(body.path), world))
        case 'docs': {
          // Documentación a fondo de un mod: wiki oficial, sitio de docs, README y lo que trae el jar
          const q = String(body.mod ?? '').toLowerCase().trim()
          if (!q) return send(400, { error: 'Indica el mod (id, nombre o archivo)' })
          const mods = await listMods(inst.id).catch(() => [])
          const meta = await getInstalledModsMeta(inst.id, inst.minecraft, inst.modloader).catch(() => ({} as Record<string, any>))
          const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
          const m = mods.find((x) => (x.meta?.modIds ?? []).some((id) => id.toLowerCase() === q))
            ?? mods.find((x) => norm((meta as Record<string, any>)[x.filename]?.title ?? x.meta?.name ?? '') === norm(q))
            ?? mods.find((x) => norm(x.filename).includes(norm(q)))
          const info = m ? (meta as Record<string, any>)[m.filename] ?? {} : {}
          const modId = canonicalMod(m?.meta?.modIds?.[0] ?? q)
          let links: { wiki?: string; source?: string } | undefined
          let pageBody: string | undefined
          const slug = info.projectId ?? (m ? undefined : q)
          if (slug) {
            try {
              const { data: p } = await axios.get(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}`, { headers: { 'User-Agent': 'ModpackLauncher (contact@fport1.dev)' }, timeout: 15_000 })
              links = { wiki: p.wiki_url ?? undefined, source: p.source_url ?? undefined }
              pageBody = p.body
            } catch { /* no está en Modrinth */ }
          }
          const idx = await ensureDocs(modId, { jar: m && m.filename.endsWith('.jar') ? path.join(gameDir, 'mods', m.filename) : undefined, links, body: pageBody, refresh: !!body.refresh })
          if (body.search) return send(200, { mod: modId, resultados: await searchDocs(modId, String(body.search)) })
          if (body.page) {
            const text = await readDocPage(modId, String(body.page))
            return send(text ? 200 : 404, text ? { mod: modId, contenido: text.slice(0, 60_000), recortado: text.length > 60_000 } : { error: 'No hay esa página', paginas: idx.pages.map((p) => p.title) })
          }
          return send(200, { mod: modId, instalado: !!m, paginas: idx.pages.map((p) => ({ titulo: p.title, origen: p.source })), notas: idx.notes.length ? idx.notes : undefined,
            siguiente: 'Pide una página con pagina="título" o busca con buscar="texto".' })
        }
        case 'community':
          return send(200, await communityExperience(inst, body.mod ? String(body.mod) : undefined))
        // ── Canal en vivo: el mod de la partida se registra y las IAs llaman a través del launcher ──
        case 'live/register': {
          // Solo la partida que abrió el launcher para esta instancia
          if (!isInstanceRunning(inst.id)) return send(409, { error: 'Esta instancia no está abierta desde el launcher' })
          const pid = getInstancePid(inst.id)
          if (pid && body.pid != null && Number(body.pid) !== pid) return send(403, { error: 'Ese proceso no es el juego que abrió el launcher para esta instancia' })
          const reg = liveRegistration(body)
          if (!reg.token || !(reg.port > 0)) return send(400, { error: 'Faltan port y token' })
          // Se responde ya y se conecta después: el mod espera la respuesta como mucho 10 s
          // y, si la conexión falla, su próximo latido recibe 404 y vuelve a registrarse.
          live.register(inst.id, reg).then(() => liveErrors.delete(inst.id), (e) => {
            const msg = e instanceof Error ? e.message : String(e)
            if (liveErrors.get(inst.id) !== msg) logActivity(inst.id, msg, 'error')
            liveErrors.set(inst.id, msg)
          })
          return send(200, { ok: true })
        }
        case 'live/heartbeat':
          return live.heartbeat(inst.id, { port: body.port, token: body.token }) ?send(200, { ok: true }) : send(404, { error: 'Sin registrar' })
        case 'live/unregister':
          live.unregister(inst.id)
          liveErrors.delete(inst.id)
          return send(200, { ok: true })
        case 'live/call': {
          // Lo usa el servidor MCP: las IAs nunca hablan directamente con el juego
          const method = String(body.method ?? '')
          if (!method) return send(400, { error: 'Falta method' })
          if (!live.status(inst.id)) return send(409, { error: NOT_LIVE_MESSAGE, code: -32000 })
          const params = body.params && typeof body.params === 'object' ? body.params : {}
          const r = await live.call(inst.id, method, params)
          if ('error' in r) return send(200, { error: r.error.message, code: r.error.code, motivo: r.error.hint, data: r.error.data })
          return send(200, { result: r.result })
        }
        default:
          return send(404, { error: `Acción desconocida: ${action}` })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (instId) logActivity(instId, `Error: ${msg}`, 'error')
      return send(500, { error: msg })
    }
  })

  server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    if (addr && typeof addr === 'object') {
      fs.outputJsonSync(BRIDGE_FILE(), { port: addr.port, token, pid: process.pid, version: app.getVersion() })
    }
  })
  app.on('before-quit', () => { fs.removeSync(BRIDGE_FILE()); live.closeAll(); server.close() })
}
