import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'
import type { AdvancementProgress, NbtDocument, NbtTag, TransferArea, WorldLayout, WorldPlayer } from '../shared/types'
import { nbtReadLocal, nbtWriteLocal } from './nbt'

// Jugadores de un mundo: quién es cada <uuid>.dat (nombre, premium o no) y pasar
// lo de un jugador a otro. Lo típico: un mundo de un servidor no premium que se
// juega ahora en uno premium; las UUID cambian y todos aparecen sin nada.
//
// Desde la 26.1 el mundo guarda los jugadores en players/{data,advancements,stats}
// y los datos generales en data/minecraft/; antes era playerdata/, advancements/,
// stats/ y data/. Se mira qué carpetas hay, no la versión.

export async function worldLayout(worldDir: string): Promise<WorldLayout> {
  const modern = (await fs.pathExists(path.join(worldDir, 'players'))) || (await fs.pathExists(path.join(worldDir, 'data', 'minecraft')))
  return modern
    ? { modern, playerData: 'players/data', advancements: 'players/advancements', stats: 'players/stats', scoreboard: 'data/minecraft/scoreboard.dat' }
    : { modern, playerData: 'playerdata', advancements: 'advancements', stats: 'stats', scoreboard: 'data/scoreboard.dat' }
}

const UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.dat$/i
const dashed = (u: string): string => {
  const s = u.replace(/-/g, '').toLowerCase()
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

/** La UUID que da un servidor no premium a un nombre (la misma cuenta, premium, tiene otra). */
export function offlineUuid(name: string): string {
  const h = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  h[6] = (h[6] & 0x0f) | 0x30
  h[8] = (h[8] & 0x3f) | 0x80
  return dashed(h.toString('hex'))
}

const isPremiumUuid = (u: string): boolean => dashed(u)[14] === '4'

// ── Mojang (con caché: los nombres no cambian a menudo) ─────────────────────

const byUuid = new Map<string, string | null>()
const byName = new Map<string, string | null>()

async function mojangName(uuid: string): Promise<string | null> {
  const key = uuid.replace(/-/g, '').toLowerCase()
  if (byUuid.has(key)) return byUuid.get(key)!
  let name: string | null = null
  try {
    const r = await axios.get(`https://sessionserver.mojang.com/session/minecraft/profile/${key}`, { timeout: 5000, validateStatus: () => true })
    if (r.status === 200 && typeof r.data?.name === 'string') name = r.data.name
  } catch { /* sin red */ }
  byUuid.set(key, name)
  return name
}

/** La UUID premium de un nombre, o null si no existe esa cuenta premium. */
export async function premiumUuidOf(name: string): Promise<{ uuid: string; name: string } | null> {
  const key = name.toLowerCase()
  if (byName.has(key)) { const u = byName.get(key); return u ? { uuid: u, name } : null }
  let out: { uuid: string; name: string } | null = null
  try {
    const r = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, { timeout: 5000, validateStatus: () => true })
    if (r.status === 200 && typeof r.data?.id === 'string') out = { uuid: dashed(r.data.id), name: r.data.name ?? name }
  } catch { /* sin red */ }
  byName.set(key, out?.uuid ?? null)
  return out
}

// ── Lista de jugadores ──────────────────────────────────────────────────────

async function readUsercache(worldDir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  // Instancia: <mc>/saves/<mundo> → <mc>/usercache.json. Servidor: <server>/<mundo> → <server>/usercache.json
  for (const f of [path.join(worldDir, '..', '..', 'usercache.json'), path.join(worldDir, '..', 'usercache.json')]) {
    const list = await fs.readJson(f).catch(() => null) as { uuid: string; name: string }[] | null
    if (Array.isArray(list)) for (const e of list) if (e?.uuid && e?.name) out.set(dashed(e.uuid), e.name)
  }
  return out
}

const sub = (doc: NbtDocument, key: string): Record<string, NbtTag> | null => {
  const t = (doc.root.value as Record<string, NbtTag | undefined>)[key]
  return t?.type === 'compound' ? t.value as Record<string, NbtTag> : null
}

export async function listWorldPlayers(worldDir: string, accounts: { uuid: string; username: string }[]): Promise<WorldPlayer[]> {
  const layout = await worldLayout(worldDir)
  const dir = path.join(worldDir, layout.playerData)
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => UUID_RE.test(f))
  const cache = await readUsercache(worldDir)
  const players: WorldPlayer[] = []
  for (const f of files) {
    const uuid = dashed(UUID_RE.exec(f)![1])
    const stat = await fs.stat(path.join(dir, f))
    const p: WorldPlayer = {
      uuid, premium: isPremiumUuid(uuid), file: path.join(dir, f), modified: stat.mtimeMs,
      hasAdvancements: await fs.pathExists(path.join(worldDir, layout.advancements, `${uuid}.json`)),
      hasStats: await fs.pathExists(path.join(worldDir, layout.stats, `${uuid}.json`)),
    }
    const acc = accounts.find((a) => dashed(a.uuid) === uuid)
    if (cache.has(uuid)) { p.name = cache.get(uuid); p.nameFrom = 'usercache' }
    else if (acc) { p.name = acc.username; p.nameFrom = 'launcher' }
    players.push(p)
  }
  // Paper/Spigot guardan el último nombre con el que entró: con Rust se leen todos a la vez
  const unnamed = players.filter((p) => !p.name)
  let bukkit: (string | null)[] | null = null
  const { nativeAvailable, nativeCall } = await import('./native')
  if (unnamed.length && nativeAvailable()) {
    bukkit = await nativeCall<(string | null)[]>('player-names', { files: unnamed.map((p) => p.file) }).catch(() => null)
  }
  for (let i = 0; i < unnamed.length; i++) {
    const p = unnamed[i]
    let last: string | null = bukkit ? bukkit[i] : null
    if (!bukkit) {
      const doc = await nbtReadLocal(p.file).catch(() => null)
      const t = doc && sub(doc, 'bukkit')?.lastKnownName
      last = t?.type === 'string' ? t.value : null
    }
    if (last) { p.name = last; p.nameFrom = 'bukkit' }
  }
  // Los no premium sin nombre: probar con todos los nombres que conocemos
  const known = new Set<string>([...cache.values(), ...accounts.map((a) => a.username), ...players.map((p) => p.name).filter((n): n is string => !!n)])
  for (const p of players) {
    if (p.name || p.premium) continue
    for (const n of known) if (offlineUuid(n) === p.uuid) { p.name = n; p.nameFrom = 'offline-match'; break }
  }
  // Los premium sin nombre: preguntar a Mojang (de 4 en 4)
  const missing = players.filter((p) => !p.name && p.premium)
  for (let i = 0; i < missing.length; i += 4) {
    await Promise.all(missing.slice(i, i + 4).map(async (p) => {
      const n = await mojangName(p.uuid)
      if (n) { p.name = n; p.nameFrom = 'mojang' }
    }))
  }
  // Y con los nombres premium recién conocidos, otra vuelta a los no premium
  const more = new Set(players.map((p) => p.name).filter((n): n is string => !!n))
  for (const p of players) {
    if (p.name || p.premium) continue
    for (const n of more) if (offlineUuid(n) === p.uuid) { p.name = n; p.nameFrom = 'offline-match'; break }
  }
  return players.sort((a, b) => b.modified - a.modified)
}

// ── Logros (json) ───────────────────────────────────────────────────────────

export async function readAdvancements(worldDir: string, uuid: string): Promise<AdvancementProgress> {
  const layout = await worldLayout(worldDir)
  return (await fs.readJson(path.join(worldDir, layout.advancements, `${dashed(uuid)}.json`)).catch(() => ({}))) as AdvancementProgress
}

async function writeJsonSafe(file: string, data: unknown): Promise<void> {
  await fs.ensureDir(path.dirname(file))
  if (await fs.pathExists(file)) await fs.copy(file, `${file}.bak`, { overwrite: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2))
  await fs.move(tmp, file, { overwrite: true })
}

export async function writeAdvancements(worldDir: string, uuid: string, data: AdvancementProgress): Promise<void> {
  const layout = await worldLayout(worldDir)
  await writeJsonSafe(path.join(worldDir, layout.advancements, `${dashed(uuid)}.json`), data)
}

// ── Transferir ──────────────────────────────────────────────────────────────

const NBT_AREAS: Partial<Record<TransferArea, string[]>> = {
  inventory: ['Inventory', 'equipment', 'SelectedItemSlot'],
  enderchest: ['EnderItems'],
  xp: ['XpLevel', 'XpP', 'XpTotal', 'Score', 'XpSeed'],
  position: ['Pos', 'Rotation', 'Dimension', 'respawn', 'SpawnX', 'SpawnY', 'SpawnZ', 'SpawnDimension', 'SpawnAngle', 'SpawnForced'],
}

/** La UUID como la guarda el jugador: cuatro enteros con signo. */
function uuidTag(uuid: string): NbtTag {
  const hexs = uuid.replace(/-/g, '')
  return { type: 'intArray', value: [0, 8, 16, 24].map((i) => parseInt(hexs.slice(i, i + 8), 16) | 0) }
}

const stringListOf = (t: NbtTag | undefined): string[] => (t?.type === 'list' && t.value.type === 'string' ? t.value.value as string[] : [])

function mergeAdvancements(target: AdvancementProgress, source: AdvancementProgress, recipes: boolean, normal: boolean): AdvancementProgress {
  const out: AdvancementProgress = { ...target }
  for (const [id, v] of Object.entries(source)) {
    if (id === 'DataVersion') { out.DataVersion = Math.max(Number(target.DataVersion ?? 0), Number(v)); continue }
    if (typeof v !== 'object') continue
    const isRecipe = id.startsWith('minecraft:recipes/')
    if ((isRecipe && !recipes) || (!isRecipe && !normal)) continue
    const cur = typeof out[id] === 'object' ? out[id] as { criteria: Record<string, string>; done: boolean } : null
    out[id] = { criteria: { ...v.criteria, ...(cur?.criteria ?? {}) }, done: !!(cur?.done || v.done) }
  }
  return out
}

function sumStats(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const t = (target.stats ?? {}) as Record<string, Record<string, number>>
  const s = (source.stats ?? {}) as Record<string, Record<string, number>>
  const stats: Record<string, Record<string, number>> = structuredClone(t)
  for (const [cat, vals] of Object.entries(s)) {
    stats[cat] ??= {}
    for (const [k, n] of Object.entries(vals)) stats[cat][k] = (stats[cat][k] ?? 0) + n
  }
  return { ...target, stats, DataVersion: Math.max(Number(target.DataVersion ?? 0), Number(source.DataVersion ?? 0)) }
}

export interface TransferResult {
  /** Carpeta con la copia de lo que había antes */
  backup: string
  /** El jugador de destino no existía: se creó copiando al de origen entero */
  created: boolean
  done: TransferArea[]
}

/**
 * Pasa a `to` lo de `from` (que no se toca). Con `areas` vacío, todo. Antes de escribir
 * nada se copia lo que tenía el destino a <mundo>/fport1-backups/.
 */
export async function transferPlayer(worldDir: string, from: string, to: string, areas: TransferArea[], toName?: string): Promise<TransferResult> {
  from = dashed(from); to = dashed(to)
  if (from === to) throw new Error('El origen y el destino son el mismo jugador.')
  const L = await worldLayout(worldDir)
  const all = areas.length === 0
  const want = (a: TransferArea): boolean => all || areas.includes(a)
  const files = {
    fromDat: path.join(worldDir, L.playerData, `${from}.dat`), toDat: path.join(worldDir, L.playerData, `${to}.dat`),
    fromAdv: path.join(worldDir, L.advancements, `${from}.json`), toAdv: path.join(worldDir, L.advancements, `${to}.json`),
    fromStats: path.join(worldDir, L.stats, `${from}.json`), toStats: path.join(worldDir, L.stats, `${to}.json`),
  }
  if (!(await fs.pathExists(files.fromDat))) throw new Error('No se encuentran los datos del jugador de origen.')

  const backup = path.join(worldDir, 'fport1-backups', `transferencia-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await fs.ensureDir(backup)
  for (const f of [files.toDat, files.toAdv, files.toStats]) {
    if (await fs.pathExists(f)) await fs.copy(f, path.join(backup, path.relative(worldDir, f)))
  }
  await fs.writeJson(path.join(backup, 'transferencia.json'), { from, to, toName, areas: all ? 'todo' : areas, at: new Date().toISOString() }, { spaces: 2 })

  const src = await nbtReadLocal(files.fromDat)
  const created = !(await fs.pathExists(files.toDat))
  let dst: NbtDocument
  const done: TransferArea[] = []
  if (all || created) {
    // Copia entera con la UUID del destino
    dst = structuredClone(src)
    const root = dst.root.value as Record<string, NbtTag>
    root.UUID = uuidTag(to)
    const bukkit = root.bukkit?.type === 'compound' ? root.bukkit.value as Record<string, NbtTag> : null
    if (bukkit?.lastKnownName && toName) bukkit.lastKnownName = { type: 'string', value: toName }
    done.push('inventory', 'enderchest', 'xp', 'position')
    if (want('recipes')) done.push('recipes')
  } else {
    dst = await nbtReadLocal(files.toDat)
    const s = src.root.value as Record<string, NbtTag | undefined>
    const d = dst.root.value as Record<string, NbtTag | undefined>
    for (const [area, keys] of Object.entries(NBT_AREAS) as [TransferArea, string[]][]) {
      if (!want(area)) continue
      for (const k of keys) {
        if (s[k]) d[k] = structuredClone(s[k])
        else if (area === 'inventory' || area === 'enderchest') delete d[k]
      }
      done.push(area)
    }
    if (want('recipes')) {
      // Recetas aprendidas: se suman las de los dos
      const sb = s.recipeBook?.type === 'compound' ? s.recipeBook.value as Record<string, NbtTag> : null
      if (sb) {
        if (d.recipeBook?.type !== 'compound') d.recipeBook = structuredClone(s.recipeBook)
        else {
          const db = d.recipeBook.value as Record<string, NbtTag>
          for (const k of ['recipes', 'toBeDisplayed']) {
            const merged = [...new Set([...stringListOf(db[k]), ...stringListOf(sb[k])])]
            db[k] = { type: 'list', value: { type: merged.length ? 'string' : 'end', value: merged } }
          }
        }
      }
      done.push('recipes')
    }
  }
  await nbtWriteLocal(files.toDat, dst)

  if (want('advancements') || want('recipes')) {
    const sAdv = (await fs.readJson(files.fromAdv).catch(() => null)) as AdvancementProgress | null
    if (sAdv) {
      const tAdv = (await fs.readJson(files.toAdv).catch(() => ({}))) as AdvancementProgress
      await writeJsonSafe(files.toAdv, mergeAdvancements(tAdv, sAdv, want('recipes'), want('advancements')))
      if (want('advancements')) done.push('advancements')
    }
  }
  if (want('stats')) {
    const sSt = (await fs.readJson(files.fromStats).catch(() => null)) as Record<string, unknown> | null
    if (sSt) {
      const tSt = (await fs.readJson(files.toStats).catch(() => ({}))) as Record<string, unknown>
      await writeJsonSafe(files.toStats, sumStats(tSt, sSt))
      done.push('stats')
    }
  }
  return { backup, created, done: [...new Set(done)] }
}

// ── Mundos de un servidor remoto (FTP/SFTP) ─────────────────────────────────
//
// Se baja lo necesario a una copia temporal, se trabaja con las mismas funciones de arriba
// y se sube solo lo que cambia. Antes de sobrescribir nada, lo que había en el servidor se
// guarda en <mundo>/fport1-backups/ del propio servidor.

const rjoin = (a: string, b: string): string => `${a.replace(/\/+$/, '')}/${b}`
const rparent = (p: string): string => p.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/'

async function ftpApi(): Promise<typeof import('./ftp')> {
  return import('./ftp')
}

export async function remoteWorldLayout(world: string): Promise<WorldLayout> {
  const { ftpList } = await ftpApi()
  const names = (await ftpList(world).catch(() => [])).filter((e) => e.isDir).map((e) => e.name)
  let modern = names.includes('players')
  if (!modern && names.includes('data')) modern = (await ftpList(rjoin(world, 'data')).catch(() => [])).some((e) => e.isDir && e.name === 'minecraft')
  return modern
    ? { modern, playerData: 'players/data', advancements: 'players/advancements', stats: 'players/stats', scoreboard: 'data/minecraft/scoreboard.dat' }
    : { modern, playerData: 'playerdata', advancements: 'advancements', stats: 'stats', scoreboard: 'data/scoreboard.dat' }
}

/** Carpeta temporal que imita al mundo remoto (con su usercache.json al lado, como en el servidor). */
async function mirrorBase(world: string): Promise<{ base: string; local: string }> {
  const { app } = await import('electron')
  const base = path.join(app.getPath('userData'), 'cache', 'remote-worlds', crypto.createHash('sha1').update(world).digest('hex').slice(0, 16))
  await fs.emptyDir(base)
  const local = path.join(base, 'world')
  await fs.ensureDir(local)
  return { base, local }
}

/** Baja archivos remotos (los que existan) a la copia local. */
async function fetchInto(world: string, local: string, rels: string[]): Promise<void> {
  const { ftpReadBytes } = await ftpApi()
  for (let i = 0; i < rels.length; i += 4) {
    await Promise.all(rels.slice(i, i + 4).map(async (rel) => {
      const data = await ftpReadBytes(rjoin(world, rel)).catch(() => null)
      if (data) await fs.outputFile(path.join(local, ...rel.split('/')), data)
    }))
  }
}

export async function listRemoteWorldPlayers(world: string, accounts: { uuid: string; username: string }[]): Promise<WorldPlayer[]> {
  const { ftpList, ftpReadBytes } = await ftpApi()
  const L = await remoteWorldLayout(world)
  const { base, local } = await mirrorBase(world)
  if (L.modern) await fs.ensureDir(path.join(local, 'players'))
  const list = (dir: string): Promise<{ name: string; modified: number | null }[]> => ftpList(rjoin(world, dir)).catch(() => [])
  const dats = (await list(L.playerData)).filter((e) => UUID_RE.test(e.name))
  const adv = new Set((await list(L.advancements)).map((e) => e.name))
  const stats = new Set((await list(L.stats)).map((e) => e.name))
  await fetchInto(world, local, dats.map((e) => `${L.playerData}/${e.name}`))
  const cache = await ftpReadBytes(rjoin(rparent(world), 'usercache.json')).catch(() => null)
  if (cache) await fs.writeFile(path.join(base, 'usercache.json'), cache)
  const players = await listWorldPlayers(local, accounts)
  for (const p of players) {
    const remoteEntry = dats.find((e) => e.name.toLowerCase() === `${p.uuid}.dat`)
    p.file = rjoin(world, `${L.playerData}/${remoteEntry?.name ?? `${p.uuid}.dat`}`)
    p.hasAdvancements = adv.has(`${p.uuid}.json`)
    p.hasStats = stats.has(`${p.uuid}.json`)
    if (remoteEntry?.modified) p.modified = remoteEntry.modified
  }
  return players.sort((a, b) => b.modified - a.modified)
}

export async function readRemoteAdvancements(world: string, uuid: string): Promise<AdvancementProgress> {
  const { ftpReadBytes } = await ftpApi()
  const L = await remoteWorldLayout(world)
  const data = await ftpReadBytes(rjoin(world, `${L.advancements}/${dashed(uuid)}.json`)).catch(() => null)
  return data ? JSON.parse(data.toString('utf8')) as AdvancementProgress : {}
}

/** Sube un archivo; si ya existía, deja antes el de ahora como <archivo>.bak (lo mismo que en local). */
async function remoteWriteWithBak(remote: string, data: Buffer): Promise<void> {
  const { ftpReadBytes, ftpWriteBytes } = await ftpApi()
  const before = await ftpReadBytes(remote).catch(() => null)
  if (before) await ftpWriteBytes(`${remote}.bak`, before)
  await remoteEnsureDir(rparent(remote))
  await ftpWriteBytes(remote, data)
}

async function remoteEnsureDir(dir: string): Promise<void> {
  const { ftpList, ftpMkdir } = await ftpApi()
  const parent = rparent(dir)
  if (parent !== dir && parent !== '/') {
    const siblings = await ftpList(parent).catch(() => null)
    if (siblings && siblings.some((e) => e.isDir && e.name === path.posix.basename(dir))) return
    if (!siblings) await remoteEnsureDir(parent)
  }
  await ftpMkdir(dir).catch(() => {})
}

export async function writeRemoteAdvancements(world: string, uuid: string, data: AdvancementProgress): Promise<void> {
  const L = await remoteWorldLayout(world)
  await remoteWriteWithBak(rjoin(world, `${L.advancements}/${dashed(uuid)}.json`), Buffer.from(JSON.stringify(data, null, 2)))
}

/** La transferencia en un servidor: se baja lo de los dos jugadores, se pasa aquí y se sube lo del destino. */
export async function transferRemotePlayer(world: string, from: string, to: string, areas: TransferArea[], toName?: string): Promise<TransferResult> {
  from = dashed(from); to = dashed(to)
  const L = await remoteWorldLayout(world)
  const { local } = await mirrorBase(world)
  if (L.modern) await fs.ensureDir(path.join(local, 'players'))
  const rels = [L.playerData, L.advancements, L.stats].flatMap((d) => [from, to].map((u) => `${d}/${u}.${d === L.playerData ? 'dat' : 'json'}`))
  await fetchInto(world, local, rels)
  const res = await transferPlayer(local, from, to, areas, toName)
  // La copia de lo que tenía el destino, también en el servidor
  const backupRel = path.relative(local, res.backup).split(path.sep).join('/')
  const { ftpWriteBytes } = await ftpApi()
  const walk = async (dir: string): Promise<string[]> => {
    const out: string[] = []
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      if (d.isDirectory()) out.push(...await walk(path.join(dir, d.name)))
      else out.push(path.join(dir, d.name))
    }
    return out
  }
  for (const f of await walk(res.backup)) {
    const rel = path.relative(local, f).split(path.sep).join('/')
    await remoteEnsureDir(rparent(rjoin(world, rel)))
    await ftpWriteBytes(rjoin(world, rel), await fs.readFile(f))
  }
  // Lo nuevo del destino
  for (const rel of [`${L.playerData}/${to}.dat`, `${L.advancements}/${to}.json`, `${L.stats}/${to}.json`]) {
    const f = path.join(local, ...rel.split('/'))
    if (await fs.pathExists(f)) {
      await remoteEnsureDir(rparent(rjoin(world, rel)))
      await ftpWriteBytes(rjoin(world, rel), await fs.readFile(f))
    }
  }
  return { ...res, backup: rjoin(world, backupRel) }
}
