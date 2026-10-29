import { app, safeStorage } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { pipeline } from 'stream/promises'
import type { Instance, InstanceProtection, ModpackProtection } from '../shared/types'
import { getInstanceGameDir, loadInstances, updateInstance } from './instances'

// ── Modpacks protegidos ─────────────────────────────────────────────────────
//
// Un modpack con reglas del creador (caducidad, cuenta obligatoria, qué se puede tocar)
// guarda sus mods y su configuración CIFRADOS en una bóveda que está en la carpeta del
// launcher, no en la de la instancia. Solo se descifran mientras se juega y se vuelven a
// cifrar al cerrar el juego, así que copiar la carpeta de la instancia (o los mods) a otro
// launcher no sirve de nada.
//
// La llave de la bóveda va en un registro aparte, cifrado con el sistema (DPAPI en Windows,
// el llavero en macOS): si se borra o se copia a otro equipo, la instancia ya no arranca.
//
// Nada de esto es infalible (lo que se ejecuta en tu equipo se puede acabar sacando), pero
// pone muy difícil sacar el contenido o saltarse las reglas.

/** Carpetas que van a la bóveda */
const SEALED_DIRS = ['mods', 'config']

interface VaultEntry {
  /** Ruta relativa a la carpeta del juego, con «/» */
  rel: string
  /** Nombre del archivo cifrado en la bóveda */
  blob: string
  size: number
}

interface LockRecord {
  instanceId: string
  /** Llave AES-256 de la bóveda (base64) */
  key: string
  protection: ModpackProtection
  boundAccount?: { uuid: string; name: string }
  /** La hora fiable más alta que se ha visto: atrasar el reloj del equipo no la baja */
  lastTrustedTime: number
  /** true mientras los archivos están descifrados (jugando, actualizando…) */
  unsealed: boolean
  index: VaultEntry[]
  /** Mods que vienen con el modpack (rutas «mods/…»): nunca se pueden quitar */
  packMods: string[]
}

const locksDir = (): string => path.join(app.getPath('userData'), 'locks')
const vaultDir = (id: string): string => path.join(app.getPath('userData'), 'vaults', id)
const lockFile = (id: string): string => path.join(locksDir(), `${crypto.createHash('sha256').update(id).digest('hex').slice(0, 24)}.bin`)

// ── Registro de la llave ────────────────────────────────────────────────────

/** Llave de respaldo si el sistema no ofrece cifrado (Linux sin llavero): atada a este equipo. */
function fallbackKey(): Buffer {
  return crypto.createHash('sha256').update(`fport1-lock|${os.hostname()}|${os.userInfo().username}|${app.getPath('userData')}`).digest()
}

function encryptRecord(json: string): Buffer {
  if (safeStorage.isEncryptionAvailable()) return Buffer.concat([Buffer.from('S1'), safeStorage.encryptString(json)])
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', fallbackKey(), iv)
  const data = Buffer.concat([c.update(json, 'utf8'), c.final()])
  return Buffer.concat([Buffer.from('F1'), iv, c.getAuthTag(), data])
}

function decryptRecord(buf: Buffer): string {
  const tag = buf.subarray(0, 2).toString()
  if (tag === 'S1') return safeStorage.decryptString(buf.subarray(2))
  const iv = buf.subarray(2, 14)
  const authTag = buf.subarray(14, 30)
  const d = crypto.createDecipheriv('aes-256-gcm', fallbackKey(), iv)
  d.setAuthTag(authTag)
  return Buffer.concat([d.update(buf.subarray(30)), d.final()]).toString('utf8')
}

async function readLock(instanceId: string): Promise<LockRecord | null> {
  try {
    return JSON.parse(decryptRecord(await fs.readFile(lockFile(instanceId)))) as LockRecord
  } catch {
    return null
  }
}

async function writeLock(rec: LockRecord): Promise<void> {
  await fs.ensureDir(locksDir())
  await fs.writeFile(lockFile(rec.instanceId), encryptRecord(JSON.stringify(rec)))
}

/** Si la instancia está protegida por su creador. */
export async function isProtected(instanceId: string): Promise<boolean> {
  return fs.pathExists(lockFile(instanceId))
}

function publicView(rec: LockRecord): InstanceProtection {
  return { ...rec.protection, ...(rec.boundAccount ? { boundAccount: rec.boundAccount } : {}) }
}

// ── Hora fiable ─────────────────────────────────────────────────────────────

let timeOffset: { at: number; offset: number } | null = null

/**
 * Hora que no se puede trucar cambiando el reloj del equipo: la de un servidor de internet
 * (cabecera Date), y sin red la más alta entre el reloj y la última hora fiable conocida.
 */
export async function trustedNow(rec?: LockRecord | null): Promise<number> {
  if (!timeOffset || Date.now() - timeOffset.at > 10 * 60_000) {
    try {
      const axios = (await import('axios')).default
      const res = await axios.head('https://api.github.com', { timeout: 4000, validateStatus: () => true })
      const server = Date.parse(String(res.headers['date'] ?? ''))
      if (Number.isFinite(server)) timeOffset = { at: Date.now(), offset: server - Date.now() }
    } catch { /* sin red: se usa lo último que se sabía */ }
  }
  const now = Date.now() + (timeOffset?.offset ?? 0)
  return Math.max(now, rec?.lastTrustedTime ?? 0)
}

// ── Cifrado de archivos (por streams: los mods no pasan por memoria) ────────

async function encryptFile(src: string, dst: string, key: Buffer): Promise<void> {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  await fs.ensureDir(path.dirname(dst))
  const tmp = `${dst}.tmp`
  // Formato: [iv 12][datos cifrados][etiqueta 16]
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmp)
    const input = fs.createReadStream(src)
    out.on('error', reject)
    input.on('error', reject)
    cipher.on('error', reject)
    out.on('finish', resolve)
    out.write(iv)
    cipher.on('end', () => out.end(cipher.getAuthTag()))
    input.pipe(cipher).pipe(out, { end: false })
  })
  await fs.move(tmp, dst, { overwrite: true })
}

async function decryptFile(src: string, dst: string, key: Buffer): Promise<void> {
  const size = (await fs.stat(src)).size
  // Lo mínimo es iv + etiqueta (28 bytes): un archivo vacío cifrado
  if (size < 28) throw new Error('Archivo de la bóveda dañado')
  const fd = await fs.open(src, 'r')
  const head = Buffer.alloc(12)
  const tail = Buffer.alloc(16)
  try {
    await fs.read(fd, head, 0, 12, 0)
    await fs.read(fd, tail, 0, 16, size - 16)
  } finally { await fs.close(fd) }
  const d = crypto.createDecipheriv('aes-256-gcm', key, head)
  d.setAuthTag(tail)
  await fs.ensureDir(path.dirname(dst))
  const tmp = `${dst}.part`
  if (size === 28) {
    d.final()
    await fs.writeFile(tmp, Buffer.alloc(0))
  } else {
    await pipeline(fs.createReadStream(src, { start: 12, end: size - 17 }), d, fs.createWriteStream(tmp))
  }
  await fs.move(tmp, dst, { overwrite: true })
}

/** Descifra el files.zip de un modpack protegido (cifrado entero con la llave del manifiesto). */
export async function decryptPackZip(src: string, dst: string, cipher: { key: string; iv: string; tag: string }): Promise<void> {
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(cipher.key, 'base64'), Buffer.from(cipher.iv, 'base64'))
  d.setAuthTag(Buffer.from(cipher.tag, 'base64'))
  await pipeline(fs.createReadStream(src), d, fs.createWriteStream(dst))
}

/** Cifra el files.zip al exportar un modpack protegido. */
export function encryptPackZip(buf: Buffer): { data: Buffer; cipher: { key: string; iv: string; tag: string } } {
  const key = crypto.randomBytes(32)
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([c.update(buf), c.final()])
  return { data, cipher: { key: key.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64') } }
}

async function walk(dir: string, base: string, out: string[] = []): Promise<string[]> {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walk(full, base, out)
    else if (e.isFile()) out.push(path.relative(base, full).replace(/\\/g, '/'))
  }
  return out
}

// ── Sellar y abrir la bóveda ────────────────────────────────────────────────

/** Cifra mods y config en la bóveda y los quita de la carpeta del juego. */
async function seal(rec: LockRecord): Promise<void> {
  const gameDir = await getInstanceGameDir(rec.instanceId)
  const key = Buffer.from(rec.key, 'base64')
  const vault = vaultDir(rec.instanceId)
  const byRel = new Map(rec.index.map((e) => [e.rel, e]))
  const packMods = new Set(rec.packMods)
  const next: VaultEntry[] = []
  for (const dir of SEALED_DIRS) {
    for (const rel of await walk(path.join(gameDir, dir), gameDir)) {
      // Mods propios: con permiso se quedan sin cifrar (son del jugador); sin permiso fuera
      if (dir === 'mods' && !packMods.has(rel)) {
        if (!rec.protection.allow.mods) await fs.remove(path.join(gameDir, rel)).catch(() => {})
        continue
      }
      const entry = byRel.get(rel) ?? { rel, blob: crypto.randomBytes(16).toString('hex'), size: 0 }
      const full = path.join(gameDir, rel)
      entry.size = (await fs.stat(full)).size
      await encryptFile(full, path.join(vault, `${entry.blob}.bin`), key)
      await fs.remove(full)
      next.push(entry)
    }
  }
  // Lo que ya no existe (configs borradas por el juego) sale de la bóveda
  const keep = new Set(next.map((e) => e.blob))
  for (const e of rec.index) if (!keep.has(e.blob)) await fs.remove(path.join(vault, `${e.blob}.bin`)).catch(() => {})
  rec.index = next
  rec.unsealed = false
  await writeLock(rec)
}

/** Descifra mods y config para jugar (o actualizar). */
async function unseal(rec: LockRecord): Promise<void> {
  if (rec.unsealed) return
  const gameDir = await getInstanceGameDir(rec.instanceId)
  const key = Buffer.from(rec.key, 'base64')
  if (!rec.protection.allow.mods) {
    // Lo que alguien haya metido a mano en mods/ no entra en la partida
    await fs.emptyDir(path.join(gameDir, 'mods')).catch(() => {})
  }
  for (const e of rec.index) {
    const blob = path.join(vaultDir(rec.instanceId), `${e.blob}.bin`)
    if (!(await fs.pathExists(blob))) throw new Error('A la bóveda de este modpack protegido le faltan archivos: reinstálalo.')
    await decryptFile(blob, path.join(gameDir, e.rel), key)
  }
  rec.unsealed = true
  await writeLock(rec)
}

// ── Instalaciones ya hechas ─────────────────────────────────────────────────
//
// Cada modpack protegido que se instala deja aquí su rastro (con qué cuenta y en qué
// instancia), y el rastro se queda aunque la instancia se borre o caduque. Así no se puede
// tener dos copias, ni borrarlo y reinstalarlo con otra cuenta, ni volver a instalarlo
// después de caducar.

interface PackClaim {
  instanceId: string
  account?: { uuid: string; name: string }
  at: number
}

const claimsFile = (): string => path.join(locksDir(), 'claims.bin')

async function readClaims(): Promise<Record<string, PackClaim>> {
  try {
    return JSON.parse(decryptRecord(await fs.readFile(claimsFile()))) as Record<string, PackClaim>
  } catch {
    return {}
  }
}

async function recordClaim(packId: string, claim: PackClaim): Promise<void> {
  const claims = await readClaims()
  // La cuenta de la primera instalación manda: no se cambia al reinstalar
  claims[packId] = { ...claim, ...(claims[packId]?.account ? { account: claims[packId].account } : {}) }
  await fs.ensureDir(locksDir())
  await fs.writeFile(claimsFile(), encryptRecord(JSON.stringify(claims)))
}

/**
 * Antes de instalar un modpack protegido: si ya caducó, si ya está instalado en otra
 * instancia o si se instaló antes con otra cuenta. Devuelve el motivo, o null si se puede.
 */
export async function checkProtectedInstall(
  manifest: { id: string; protection?: ModpackProtection },
  account?: { uuid: string; name: string },
  instanceId?: string
): Promise<string | null> {
  const p = manifest.protection
  if (!p) return null
  const now = await trustedNow()
  if (p.expiresAt && now >= p.expiresAt) return `Este modpack caducó el ${new Date(p.expiresAt).toLocaleString('es')} y ya no se puede instalar.`
  const claim = (await readClaims())[manifest.id]
  if (!claim) return null
  if (claim.instanceId !== instanceId && (await isProtected(claim.instanceId))) {
    const inst = (await loadInstances()).find((i) => i.id === claim.instanceId)
    if (inst) return `Ya tienes este modpack instalado en «${inst.name}». Un modpack protegido solo se puede instalar una vez.`
  }
  const accountRequired = p.account && (!p.account.until || now < p.account.until)
  if (accountRequired && claim.account && account && claim.account.uuid !== account.uuid) {
    return `Este modpack ya se instaló con la cuenta «${claim.account.name}» y solo se puede volver a instalar con ella.`
  }
  return null
}

/** Instancias protegidas que solo se pueden jugar con esta cuenta (para avisar antes de quitarla). */
export async function instancesBoundTo(uuid: string): Promise<string[]> {
  const names: string[] = []
  for (const inst of await loadInstances()) {
    const rec = await readLock(inst.id)
    if (rec?.boundAccount?.uuid === uuid) names.push(inst.name)
  }
  return names
}

/**
 * Deja la instancia protegida al instalar un modpack con reglas: crea la llave, ata la
 * cuenta si hace falta y mete mods y config en la bóveda.
 */
export async function protectInstance(
  instanceId: string,
  protection: ModpackProtection,
  account?: { uuid: string; name: string },
  packId?: string
): Promise<void> {
  if (await isProtected(instanceId)) return
  if (packId) {
    const problem = await checkProtectedInstall({ id: packId, protection }, account, instanceId)
    if (problem) throw new Error(problem)
    await recordClaim(packId, { instanceId, ...(protection.account && account ? { account } : {}), at: Date.now() })
  }
  const gameDir = await getInstanceGameDir(instanceId)
  const rec: LockRecord = {
    instanceId,
    key: crypto.randomBytes(32).toString('base64'),
    protection,
    ...(protection.account && account ? { boundAccount: account } : {}),
    lastTrustedTime: await trustedNow(),
    unsealed: true,
    index: [],
    packMods: await walk(path.join(gameDir, 'mods'), gameDir),
  }
  await writeLock(rec)
  await seal(rec)
  await syncPublicInfo(rec)
  console.log(`[Protección] Instancia ${instanceId} protegida (${rec.index.length} archivos en la bóveda)`)
}

/** Copia las reglas (sin la llave) a la ficha de la instancia, para enseñarlas. */
async function syncPublicInfo(rec: LockRecord): Promise<void> {
  const inst = (await loadInstances()).find((i) => i.id === rec.instanceId)
  if (inst) await updateInstance({ ...inst, protection: publicView(rec) })
}

/**
 * Abre la bóveda para una operación (jugar, actualizar, reparar) y la vuelve a cerrar al
 * acabar. En instancias sin protección no hace nada.
 */
export async function withUnsealed<T>(instanceId: string, fn: () => Promise<T>, opts: { packModsFromGameDir?: boolean } = {}): Promise<T> {
  const rec = await readLock(instanceId)
  if (!rec) return fn()
  await unseal(rec)
  try {
    return await fn()
  } finally {
    const fresh = (await readLock(instanceId)) ?? rec
    if (opts.packModsFromGameDir) {
      // Tras actualizar: los mods del modpack son los que hay ahora
      const gameDir = await getInstanceGameDir(instanceId)
      fresh.packMods = await walk(path.join(gameDir, 'mods'), gameDir)
    }
    await seal(fresh).catch((e) => console.error('[Protección] No se pudo volver a cifrar la bóveda:', e))
  }
}

/** Abre la bóveda para jugar; la cierra `resealAfterGame` cuando el juego termina. */
export async function unsealForGame(instanceId: string): Promise<void> {
  const rec = await readLock(instanceId)
  if (rec) await unseal(rec)
}

export async function resealAfterGame(instanceId: string): Promise<void> {
  const rec = await readLock(instanceId)
  if (rec?.unsealed) await seal(rec).catch((e) => console.error('[Protección] No se pudo volver a cifrar la bóveda:', e))
}

/** Al arrancar el launcher: si quedó algo descifrado (se cerró con el juego abierto), se cifra. */
export async function resealLeftovers(isRunning: (id: string) => boolean): Promise<void> {
  for (const inst of await loadInstances()) {
    if (isRunning(inst.id)) continue
    const rec = await readLock(inst.id)
    if (rec?.unsealed) await seal(rec).catch(() => {})
  }
}

/** Mods de la bóveda, para enseñarlos en Detalles mientras está cerrada. */
export async function sealedMods(instanceId: string): Promise<{ filename: string; size: number }[] | null> {
  const rec = await readLock(instanceId)
  if (!rec || rec.unsealed) return null
  return rec.index.filter((e) => e.rel.startsWith('mods/')).map((e) => ({ filename: e.rel.slice(5), size: e.size }))
}

/** Una versión nueva del modpack puede traer reglas nuevas (otra caducidad…); la cuenta atada se mantiene. */
export async function updateProtectionRules(instanceId: string, protection: ModpackProtection | undefined): Promise<void> {
  const rec = await readLock(instanceId)
  if (!rec || !protection) return
  rec.protection = protection
  if (!protection.account) delete rec.boundAccount
  await writeLock(rec)
  await syncPublicInfo(rec)
}

/** Al borrar la instancia, su llave y su bóveda se van con ella. */
export async function removeProtection(instanceId: string): Promise<void> {
  await fs.remove(lockFile(instanceId)).catch(() => {})
  await fs.remove(vaultDir(instanceId)).catch(() => {})
}

// ── Reglas ──────────────────────────────────────────────────────────────────

export type GuardAction = 'duplicate' | 'export' | 'transfer' | 'files' | 'options' | 'packs' | 'mods' | 'core'

const ACTION_TEXT: Record<GuardAction, string> = {
  duplicate: 'duplicar esta instancia',
  export: 'exportarla ni guardarla como .fpack',
  transfer: 'pasar contenido desde o hacia ella',
  files: 'abrir sus carpetas ni editar la configuración de los mods',
  options: 'cambiar los ajustes del juego',
  packs: 'cambiar resource packs ni shaders',
  mods: 'añadir ni quitar mods',
  core: 'cambiar su versión ni su modloader',
}

/** Lanza un error claro si el creador del modpack no permite eso. */
export async function guard(instanceId: string, action: GuardAction, filename?: string): Promise<void> {
  const rec = await readLock(instanceId)
  if (!rec) return
  const a = rec.protection.allow
  const allowed =
    action === 'options' ? a.options
      : action === 'packs' ? a.packs
      : action === 'files' ? a.files
      : action === 'mods' ? a.mods && !(filename && rec.packMods.includes(`mods/${filename.replace(/\.disabled$/, '')}`))
      : false
  if (!allowed) throw new Error(`El creador de este modpack lo protegió: no se puede ${ACTION_TEXT[action]}.`)
}

/** Lo que un cambio de ficha no puede tocar en una instancia protegida. */
export async function keepProtectedFields(next: Instance): Promise<Instance> {
  const rec = await readLock(next.id)
  if (!rec) return next
  const current = (await loadInstances()).find((i) => i.id === next.id)
  if (!current) return next
  return {
    ...next,
    minecraft: current.minecraft,
    modloader: current.modloader,
    modloaderVersion: current.modloaderVersion,
    versionTrack: current.versionTrack,
    modpackUrl: current.modpackUrl,
    modpackKey: current.modpackKey,
    protection: publicView(rec),
  }
}

/**
 * Antes de jugar: caducidad y cuenta. Devuelve un error con el motivo, o null si puede.
 * Si ya caducó, lo dice (el vigilante la borra).
 */
export async function checkLaunch(instance: Instance, account: { uuid: string; username: string }): Promise<string | null> {
  const rec = await readLock(instance.id)
  if (!rec) {
    if (instance.protection) return 'A este modpack protegido le falta su llave en este equipo: reinstálalo.'
    return null
  }
  const now = await trustedNow(rec)
  if (now > rec.lastTrustedTime + 60_000) { rec.lastTrustedTime = now; await writeLock(rec).catch(() => {}) }
  const p = rec.protection
  if (p.expiresAt && now >= p.expiresAt) return `Este modpack caducó el ${new Date(p.expiresAt).toLocaleString('es')}.`
  if (p.account && rec.boundAccount && (!p.account.until || now < p.account.until) && rec.boundAccount.uuid !== account.uuid) {
    return `Este modpack solo se puede jugar con la cuenta «${rec.boundAccount.name}»${p.account.until ? ` hasta el ${new Date(p.account.until).toLocaleString('es')}` : ''}. Cámbiala en Ajustes.`
  }
  return null
}

// ── Caducidad ───────────────────────────────────────────────────────────────

interface WatchDeps {
  isRunning: (id: string) => boolean
  kill: (id: string) => void
  deleteInstance: (id: string) => Promise<void>
  notify: (event: 'expiring' | 'expired', info: { id: string; name: string; expiresAt: number }) => void
}

const warned = new Set<string>()

/** Revisa cada minuto los modpacks que caducan: avisa 10 minutos antes y los borra al llegar la hora. */
export function startExpiryWatch(deps: WatchDeps): void {
  const tick = async (): Promise<void> => {
    for (const inst of await loadInstances().catch(() => [] as Instance[])) {
      const rec = await readLock(inst.id)
      const expiresAt = rec?.protection.expiresAt
      if (!rec || !expiresAt) continue
      const now = await trustedNow(rec)
      if (now >= expiresAt) {
        console.log(`[Protección] ${inst.name} caducó: se elimina`)
        if (deps.isRunning(inst.id)) {
          deps.kill(inst.id)
          await new Promise((r) => setTimeout(r, 3000))
        }
        await removeProtection(inst.id)
        await deps.deleteInstance(inst.id).catch((e) => console.error('[Protección] No se pudo borrar la instancia caducada:', e))
        deps.notify('expired', { id: inst.id, name: inst.name, expiresAt })
      } else if (expiresAt - now <= 10 * 60_000 && !warned.has(inst.id)) {
        warned.add(inst.id)
        deps.notify('expiring', { id: inst.id, name: inst.name, expiresAt })
      }
    }
  }
  setTimeout(() => { void tick() }, 15_000)
  setInterval(() => { void tick() }, 60_000)
}
