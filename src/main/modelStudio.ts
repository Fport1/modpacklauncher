import { app } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import AdmZip from 'adm-zip'
import type { StudioModelEntry, StudioProject, StudioTexture } from '../shared/types'
import { getSharedDir, getInstanceGameDir, loadInstances } from './instances'
import { openJar } from './mcTextures'

// Estudio de modelos: el editor de modelos del mod WinterTales (estilo Blockbench).
// Solo para la cuenta del dueño: quien registra el IPC pasa `isOwner` y cada llamada lo
// comprueba aquí, no solo en la interfaz.
//
// Lo que hace este lado:
//  · listar los modelos de bloque e ítem del mod y saber cuáles salen de un script de tools/;
//  · leer modelos y texturas (las del mod y las de Minecraft, del .jar de la versión del mod);
//  · guardar con copia de seguridad antes de sobrescribir y borradores automáticos;
//  · «versión editada a mano»: los archivos apuntados en tools/hand-edited.json, que los
//    scripts respetan (ver docs/estudio-modelos.md);
//  · «Probar en el juego»: un resource pack en la instancia de prueba con lo cambiado.

const DEFAULT_PROJECT = 'C:\\Users\\franc\\OneDrive\\Documentos\\WinterTales'
const MODID = 'wintertales'
/** Versión de Minecraft del mod: de su .jar salen las texturas de vanilla */
const MC_VERSION = '1.21.1'
/** pack_format de los resource packs de la 1.21.1 */
const PACK_FORMAT = 34
const TEST_PACK = 'WinterTales-estudio'

let isOwner: () => boolean = () => false
export function setStudioOwnerCheck(fn: () => boolean): void { isOwner = fn }
function guard(): void {
  if (!isOwner()) throw new Error('El estudio de modelos solo está disponible para la cuenta del dueño del launcher.')
}

// ── Configuración ───────────────────────────────────────────────────────────

const studioDir = (): string => path.join(app.getPath('userData'), 'studio')
interface Config { projectDir: string; testInstanceId?: string }
async function config(): Promise<Config> {
  const c = await fs.readJson(path.join(studioDir(), 'config.json')).catch(() => ({})) as Partial<Config>
  return { projectDir: c.projectDir || DEFAULT_PROJECT, testInstanceId: c.testInstanceId }
}
async function saveConfig(c: Config): Promise<void> {
  await fs.outputJson(path.join(studioDir(), 'config.json'), c, { spaces: 2 })
}

const assetsDir = (project: string): string => path.join(project, 'src', 'main', 'resources', 'assets', MODID)
const handEditedFile = (project: string): string => path.join(project, 'tools', 'hand-edited.json')

/** Ruta relativa al proyecto, con «/» (como la guardan los scripts y hand-edited.json). */
const relToProject = (project: string, file: string): string => path.relative(project, file).split(path.sep).join('/')

async function readHandEdited(project: string): Promise<Set<string>> {
  const list = await fs.readJson(handEditedFile(project)).catch(() => null) as { files?: string[] } | null
  return new Set(list?.files ?? [])
}

async function setHandEdited(project: string, rel: string, on: boolean): Promise<void> {
  const set = await readHandEdited(project)
  if (on) set.add(rel)
  else set.delete(rel)
  await fs.outputJson(handEditedFile(project), {
    _comentario: 'Archivos editados a mano en el Estudio de modelos del launcher. Los scripts de tools/ no los sobrescriben (tools/lib/respect-hand-edits.js). Quita una línea para que el script vuelva a generarlo.',
    files: [...set].sort(),
  }, { spaces: 2 })
}

// ── Qué archivos salen de un script ─────────────────────────────────────────

let scriptIndex: { at: number; scripts: { name: string; text: string }[] } | null = null

async function scripts(project: string): Promise<{ name: string; text: string }[]> {
  const dir = path.join(project, 'tools')
  if (scriptIndex && Date.now() - scriptIndex.at < 60_000) return scriptIndex.scripts
  const out: { name: string; text: string }[] = []
  for (const n of await fs.readdir(dir).catch(() => [] as string[])) {
    if (!/\.(c|m)?js$/.test(n)) continue
    out.push({ name: n, text: await fs.readFile(path.join(dir, n), 'utf8').catch(() => '') })
  }
  scriptIndex = { at: Date.now(), scripts: out }
  return out
}

/**
 * Scripts que parecen generar este archivo: aparece su nombre, o el nombre sin el número
 * del final (poker_table_3 → «poker_table_» en un `poker_table_${i}`).
 */
function generatorsOf(list: { name: string; text: string }[], base: string): string[] {
  const stem = base.replace(/_?\d+$/, '')
  const needles = [`'${base}'`, `"${base}"`, `\`${base}\``, `/${base}.`, `/${base}'`, `/${base}"`]
  return list.filter((s) => {
    if (needles.some((n) => s.text.includes(n))) return true
    // Nombres hechos con plantillas: `poker_table_${i}`
    return stem !== base && stem.length >= 4 && s.text.includes(`${stem}_\${`)
  }).map((s) => s.name)
}

// ── Proyecto y lista de modelos ─────────────────────────────────────────────

export async function studioProject(): Promise<StudioProject> {
  guard()
  const c = await config()
  const assets = assetsDir(c.projectDir)
  const exists = await fs.pathExists(assets)
  return { dir: c.projectDir, exists, modid: MODID, testInstanceId: c.testInstanceId ?? null }
}

export async function studioSetProject(dir: string): Promise<StudioProject> {
  guard()
  const c = await config()
  c.projectDir = dir
  scriptIndex = null
  await saveConfig(c)
  return studioProject()
}

export async function studioSetTestInstance(id: string | null): Promise<void> {
  guard()
  const c = await config()
  c.testInstanceId = id ?? undefined
  await saveConfig(c)
}

export async function studioList(): Promise<StudioModelEntry[]> {
  guard()
  const { projectDir } = await config()
  const models = path.join(assetsDir(projectDir), 'models')
  const gen = await scripts(projectDir)
  const hand = await readHandEdited(projectDir)
  const out: StudioModelEntry[] = []
  for (const kind of ['block', 'item'] as const) {
    const dir = path.join(models, kind)
    for (const n of await fs.readdir(dir).catch(() => [] as string[])) {
      if (!n.endsWith('.json')) continue
      const file = path.join(dir, n)
      const st = await fs.stat(file)
      const base = n.slice(0, -5)
      const rel = relToProject(projectDir, file)
      // Un modelo que solo hereda de otro (sin cubos propios) se marca para filtrarlo
      let elements = 0, parent: string | undefined
      try {
        const j = await fs.readJson(file) as { elements?: unknown[]; parent?: string }
        elements = Array.isArray(j.elements) ? j.elements.length : 0
        parent = j.parent
      } catch { /* JSON roto: se abre igual y el editor lo dirá */ }
      out.push({ id: `${kind}/${base}`, kind, name: base, file: rel, size: st.size, mtime: st.mtimeMs, elements, parent, generatedBy: generatorsOf(gen, base), handEdited: hand.has(rel) })
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

// ── Leer ────────────────────────────────────────────────────────────────────

const modelFile = (project: string, id: string): string => {
  if (!/^(block|item)\/[a-z0-9_./-]+$/.test(id) || id.includes('..')) throw new Error(`Modelo no válido: ${id}`)
  return path.join(assetsDir(project), 'models', ...`${id}.json`.split('/'))
}

export async function studioReadModel(id: string): Promise<string> {
  guard()
  const { projectDir } = await config()
  return fs.readFile(modelFile(projectDir, id), 'utf8')
}

/** Modelo de otro namespace (padres como minecraft:block/cube_all), del .jar del juego. */
export async function studioReadVanillaModel(ref: string): Promise<string | null> {
  guard()
  const [ns, p] = ref.includes(':') ? ref.split(':') : ['minecraft', ref]
  if (ns === MODID) {
    const { projectDir } = await config()
    return fs.readFile(path.join(assetsDir(projectDir), 'models', ...`${p}.json`.split('/')), 'utf8').catch(() => null)
  }
  const zip = await gameJar()
  const e = zip?.getEntry(`assets/${ns}/models/${p}.json`)
  return e ? e.getData().toString('utf8') : null
}

let jar: AdmZip | null = null
async function gameJar(): Promise<AdmZip | null> {
  if (jar) return jar
  const own = path.join(getSharedDir(), 'versions', MC_VERSION, `${MC_VERSION}.jar`)
  jar = (await fs.pathExists(own)) ? new AdmZip(own) : await openJar()
  return jar
}

function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const textureFile = (project: string, p: string): string => {
  if (!/^[a-z0-9_./-]+$/.test(p) || p.includes('..')) throw new Error(`Textura no válida: ${p}`)
  return path.join(assetsDir(project), 'textures', ...`${p}.png`.split('/'))
}

/** Una textura por su referencia ("wintertales:block/casino_felt", "minecraft:block/stone"). */
export async function studioReadTexture(ref: string): Promise<StudioTexture | null> {
  guard()
  const [ns, p] = ref.includes(':') ? ref.split(':') : ['minecraft', ref]
  let buf: Buffer | null = null
  let editable = false
  let file: string | undefined
  if (ns === MODID) {
    const { projectDir } = await config()
    const f = textureFile(projectDir, p)
    buf = await fs.readFile(f).catch(() => null)
    editable = true
    file = relToProject(projectDir, f)
  } else {
    const zip = await gameJar()
    buf = zip?.getEntry(`assets/${ns}/textures/${p}.png`)?.getData() ?? null
  }
  if (!buf) return null
  const { w, h } = pngSize(buf)
  return { ref: `${ns}:${p}`, dataUrl: `data:image/png;base64,${buf.toString('base64')}`, w, h, editable, file }
}

/** Texturas del mod (para elegir una al pintar o cambiar la de una cara). */
export async function studioListTextures(): Promise<string[]> {
  guard()
  const { projectDir } = await config()
  const root = path.join(assetsDir(projectDir), 'textures')
  const out: string[] = []
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) await walk(path.join(dir, e.name), `${rel}${e.name}/`)
      else if (e.name.endsWith('.png')) out.push(`${MODID}:${rel}${e.name.slice(0, -4)}`)
    }
  }
  await walk(root, '')
  return out.sort()
}

// ── Guardar ─────────────────────────────────────────────────────────────────

/** Antes de sobrescribir nada del mod: copia en userData/studio/backups/<fecha>/<ruta>. */
async function backup(project: string, file: string): Promise<string | null> {
  if (!(await fs.pathExists(file))) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = path.join(studioDir(), 'backups', stamp, relToProject(project, file))
  await fs.copy(file, dest)
  return dest
}

async function writeSafe(file: string, data: string | Buffer): Promise<void> {
  await fs.ensureDir(path.dirname(file))
  const tmp = `${file}.estudio-tmp`
  await fs.writeFile(tmp, data)
  await fs.move(tmp, file, { overwrite: true })
}

export async function studioSaveModel(id: string, json: string, opts: { handEdited?: boolean } = {}): Promise<{ backup: string | null }> {
  guard()
  JSON.parse(json) // que lo que se guarda se pueda leer
  const { projectDir } = await config()
  const file = modelFile(projectDir, id)
  const b = await backup(projectDir, file)
  await writeSafe(file, json)
  if (opts.handEdited !== undefined) await setHandEdited(projectDir, relToProject(projectDir, file), opts.handEdited)
  return { backup: b }
}

export async function studioSaveTexture(ref: string, pngBase64: string, opts: { handEdited?: boolean } = {}): Promise<{ backup: string | null }> {
  guard()
  const [ns, p] = ref.includes(':') ? ref.split(':') : ['minecraft', ref]
  if (ns !== MODID) throw new Error('Las texturas de Minecraft no se pueden sobrescribir: guarda una copia en el mod.')
  const buf = Buffer.from(pngBase64, 'base64')
  if (buf.subarray(1, 4).toString() !== 'PNG') throw new Error('No es un PNG.')
  const { projectDir } = await config()
  const file = textureFile(projectDir, p)
  const b = await backup(projectDir, file)
  await writeSafe(file, buf)
  if (opts.handEdited !== undefined) await setHandEdited(projectDir, relToProject(projectDir, file), opts.handEdited)
  return { backup: b }
}

// ── Borradores (autoguardado) ───────────────────────────────────────────────

const draftFile = (id: string): string => path.join(studioDir(), 'drafts', `${crypto.createHash('sha1').update(id).digest('hex').slice(0, 16)}.json`)

export async function studioDraftGet(id: string): Promise<{ savedAt: number; data: unknown } | null> {
  guard()
  return fs.readJson(draftFile(id)).catch(() => null)
}
export async function studioDraftSet(id: string, data: unknown): Promise<void> {
  guard()
  await fs.outputJson(draftFile(id), { id, savedAt: Date.now(), data })
}
export async function studioDraftClear(id: string): Promise<void> {
  guard()
  await fs.remove(draftFile(id)).catch(() => {})
}

// ── Capas de las texturas y miniaturas ─────────────────────────────────────

const keyOf = (s: string): string => crypto.createHash('sha1').update(s).digest('hex')
export async function studioLayersGet(ref: string): Promise<unknown> {
  guard()
  return fs.readJson(path.join(studioDir(), 'layers', `${keyOf(ref)}.json`)).catch(() => null)
}
export async function studioLayersSet(ref: string, data: unknown): Promise<void> {
  guard()
  const f = path.join(studioDir(), 'layers', `${keyOf(ref)}.json`)
  if (data === null) await fs.remove(f).catch(() => {})
  else await fs.outputJson(f, data)
}
/** Miniatura de un modelo (PNG en data URL), guardada por modelo y fecha del archivo. */
export async function studioThumbGet(id: string, stamp: string): Promise<string | null> {
  guard()
  const f = path.join(studioDir(), 'thumbs', `${keyOf(id + stamp)}.png`)
  const b = await fs.readFile(f).catch(() => null)
  return b ? `data:image/png;base64,${b.toString('base64')}` : null
}
export async function studioThumbSet(id: string, stamp: string, dataUrl: string): Promise<void> {
  guard()
  const f = path.join(studioDir(), 'thumbs', `${keyOf(id + stamp)}.png`)
  await fs.outputFile(f, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
}

// ── Probar en el juego ──────────────────────────────────────────────────────

/** Instancia donde probar: la elegida, o la primera con WinterTales en sus mods. */
async function testInstance(): Promise<{ id: string; name: string; gameDir: string } | null> {
  const c = await config()
  const list = await loadInstances()
  const chosen = c.testInstanceId ? list.find((i) => i.id === c.testInstanceId) : undefined
  for (const inst of chosen ? [chosen] : list) {
    const gameDir = await getInstanceGameDir(inst.id)
    if (chosen) return { id: inst.id, name: inst.name, gameDir }
    const mods = await fs.readdir(path.join(gameDir, 'mods')).catch(() => [] as string[])
    if (mods.some((m) => /wintertales/i.test(m))) return { id: inst.id, name: inst.name, gameDir }
  }
  return null
}

/**
 * Copia los modelos y texturas indicados (ids de modelo y referencias de textura del mod) a un
 * resource pack en la instancia de prueba y lo deja activado: en el juego basta con F3+T.
 */
export async function studioTestInGame(models: string[], textures: string[]): Promise<{ instance: string; pack: string; files: number }> {
  guard()
  const inst = await testInstance()
  if (!inst) throw new Error('No hay ninguna instancia con WinterTales en sus mods. Elige la instancia de prueba en el estudio.')
  const { projectDir } = await config()
  const pack = path.join(inst.gameDir, 'resourcepacks', TEST_PACK)
  await fs.outputJson(path.join(pack, 'pack.mcmeta'), { pack: { pack_format: PACK_FORMAT, description: 'Cambios del Estudio de modelos (sin recompilar)' } }, { spaces: 2 })
  let files = 0
  for (const id of models) {
    const src = modelFile(projectDir, id)
    if (!(await fs.pathExists(src))) continue
    await fs.copy(src, path.join(pack, 'assets', MODID, 'models', ...`${id}.json`.split('/')))
    files++
  }
  for (const ref of textures) {
    const [ns, p] = ref.split(':')
    if (ns !== MODID) continue
    const src = textureFile(projectDir, p)
    if (!(await fs.pathExists(src))) continue
    await fs.copy(src, path.join(pack, 'assets', MODID, 'textures', ...`${p}.png`.split('/')))
    files++
  }
  // Activado (encima de todo) en options.txt
  const opts = path.join(inst.gameDir, 'options.txt')
  const text = await fs.readFile(opts, 'utf8').catch(() => '')
  const entry = `"file/${TEST_PACK}"`
  const line = text.split(/\r?\n/).find((l) => l.startsWith('resourcePacks:'))
  if (!line) await fs.writeFile(opts, `${text}${text.endsWith('\n') || !text ? '' : '\n'}resourcePacks:["vanilla","fabric",${entry}]\n`)
  else if (!line.includes(entry)) {
    const list = line.slice('resourcePacks:'.length).trim().replace(/^\[|\]$/g, '')
    const next = `resourcePacks:[${list ? `${list},` : ''}${entry}]`
    await fs.writeFile(opts, text.replace(line, next))
  }
  return { instance: inst.name, pack, files }
}

/** Qué scripts generan cada textura del mod ("wintertales:block/casino_felt" → ["make-spawn-props.js"]). */
export async function studioGeneratedBy(refs: string[]): Promise<Record<string, { scripts: string[]; handEdited: boolean }>> {
  guard()
  const { projectDir } = await config()
  const gen = await scripts(projectDir)
  const hand = await readHandEdited(projectDir)
  const out: Record<string, { scripts: string[]; handEdited: boolean }> = {}
  for (const ref of refs) {
    const [ns, p] = ref.includes(':') ? ref.split(':') : ['minecraft', ref]
    if (ns !== MODID) continue
    out[ref] = { scripts: generatorsOf(gen, path.posix.basename(p)), handEdited: hand.has(relToProject(projectDir, textureFile(projectDir, p))) }
  }
  return out
}
