import { app } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import { spawn, type ChildProcess } from 'child_process'

// El programa auxiliar en Rust (native/): hashes, zips, NBT, tamaños de carpetas y limpiar
// mundos, en varios hilos y fuera de este proceso. Se arranca la primera vez que hace falta
// y se queda esperando trabajos (una línea de JSON por petición y por respuesta).
//
// Nunca es imprescindible: si no está (sistema sin binario, antivirus…) o falla, cada
// llamada lanza un error y quien la usa hace lo mismo en JavaScript como siempre. Después de
// varios fallos seguidos se deja de intentar hasta reiniciar el launcher.

const EXE = process.platform === 'win32' ? 'fport1-native.exe' : 'fport1-native'

function binaryPath(): string {
  // Para pruebas y desarrollo: FPORT1_NATIVE con la ruta del binario
  if (process.env.FPORT1_NATIVE) return process.env.FPORT1_NATIVE
  return app.isPackaged
    ? path.join(process.resourcesPath, 'native', EXE)
    : path.join(app.getAppPath(), 'native', 'target', 'release', EXE)
}

export interface NativeProgress { done: number; total: number; msg: string }

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  onProgress?: (p: NativeProgress) => void
}

let proc: ChildProcess | null = null
let nextId = 1
const pending = new Map<number, Pending>()
let failures = 0
let disabled = false

function start(): ChildProcess | null {
  if (proc) return proc
  if (disabled) return null
  const bin = binaryPath()
  if (!fs.existsSync(bin)) { disabled = true; console.warn(`[native] No está ${bin}: todo en JavaScript`); return null }
  const p = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let buf = ''
  p.stdout!.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      let msg: { id: number; ok?: boolean; result?: unknown; error?: string; progress?: NativeProgress }
      try { msg = JSON.parse(line) } catch { continue }
      const job = pending.get(msg.id)
      if (!job) continue
      if (msg.progress) { job.onProgress?.(msg.progress); continue }
      pending.delete(msg.id)
      if (msg.ok) { failures = 0; job.resolve(msg.result) }
      else job.reject(new Error(msg.error ?? 'error del programa auxiliar'))
    }
  })
  p.stderr!.on('data', (d: Buffer) => console.warn('[native]', d.toString().trim()))
  const died = (why: string): void => {
    if (proc !== p) return
    proc = null
    for (const job of pending.values()) job.reject(new Error(`el programa auxiliar se cerró (${why})`))
    pending.clear()
    if (++failures >= 3) { disabled = true; console.warn('[native] Demasiados fallos: se sigue en JavaScript') }
  }
  p.on('exit', (code) => died(`código ${code}`))
  p.on('error', (e) => died(e.message))
  // Que no impida cerrar el launcher
  p.unref()
  ;(p.stdout as unknown as { unref?: () => void }).unref?.()
  proc = p
  return p
}

/** Si el programa auxiliar se puede usar (no lo arranca si ya se dio por perdido). */
export function nativeAvailable(): boolean {
  return !disabled && fs.existsSync(binaryPath())
}

export function nativeCall<T>(cmd: string, args: Record<string, unknown>, onProgress?: (p: NativeProgress) => void): Promise<T> {
  const p = start()
  if (!p || !p.stdin) return Promise.reject(new Error('programa auxiliar no disponible'))
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
    p.stdin!.write(`${JSON.stringify({ id, cmd, args })}\n`, (err) => {
      if (err) { pending.delete(id); reject(err) }
    })
  })
}

/** Lo intenta con Rust y, si no se puede, con la versión de JavaScript. */
export async function withFallback<T>(label: string, fast: () => Promise<T>, slow: () => Promise<T>): Promise<T> {
  if (!nativeAvailable()) return slow()
  try {
    return await fast()
  } catch (e) {
    console.warn(`[native] ${label} con Rust falló (${(e as Error).message}); se hace en JavaScript`)
    return slow()
  }
}

export function stopNative(): void {
  proc?.kill()
  proc = null
}

// ── Atajos con tipos ────────────────────────────────────────────────────────

export interface HashResult { exists: boolean; size: number; hash: string | null }

export const nativeHash = (files: { path: string; algo?: 'sha1' | 'sha256' }[], onProgress?: (p: NativeProgress) => void): Promise<HashResult[]> =>
  nativeCall('hash', { files }, onProgress)

export const nativeZipExtract = (
  zip: string, dest: string, opts: { stripPrefix?: string; keepExisting?: string[] } = {}, onProgress?: (p: NativeProgress) => void
): Promise<{ written: number; skipped: number; unsafe: number }> =>
  nativeCall('zip-extract', { zip, dest, strip_prefix: opts.stripPrefix, keep_existing: opts.keepExisting ?? [] }, onProgress)

export const nativeZipCreate = (
  out: string,
  input: { files?: { src: string; name: string }[]; dirs?: { dir: string; prefix?: string }[]; store?: string[]; level?: number; exclude?: string[] },
  onProgress?: (p: NativeProgress) => void
): Promise<{ files: number; bytes: number; size: number }> =>
  nativeCall('zip-create', { out, files: input.files ?? [], dirs: input.dirs ?? [], store: input.store ?? [], level: input.level, exclude: input.exclude ?? [] }, onProgress)

export async function nativeJarsRead(items: { jar: string; names?: string[] }[], names: string[]): Promise<Map<string, Map<string, Buffer>>> {
  const res = await nativeCall<{ jar: string; entries?: Record<string, string>; error?: string }[]>('jars-read', { jars: items.map((i) => ({ jar: i.jar, names: i.names ?? [] })), names })
  const out = new Map<string, Map<string, Buffer>>()
  for (const r of res) {
    const m = new Map<string, Buffer>()
    for (const [k, v] of Object.entries(r.entries ?? {})) m.set(k, Buffer.from(v, 'base64'))
    out.set(r.jar, m)
  }
  return out
}

export const nativeWalk = (root: string, name: string, hidden: string[], onProgress?: (p: NativeProgress) => void): Promise<{ tree: unknown; bytes: number; files: number }> =>
  nativeCall('walk', { root, name, hidden }, onProgress)

export interface PruneDim { dim: string; regions: number; chunks: number; remove: number; unknown: number; bytesBefore: number; bytesAfter: number }
export const nativeWorldPrune = (world: string, minInhabited: number, dryRun: boolean, onProgress?: (p: NativeProgress) => void): Promise<{ dryRun: boolean; dims: PruneDim[] }> =>
  nativeCall('world-prune', { world, minInhabited, dryRun }, onProgress)
