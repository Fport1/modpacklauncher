import fs from 'fs-extra'
import path from 'path'
import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { RemoteEntry, TransferJobState } from '../shared/types'
import { ftpCloseExtra, ftpExtraSession, ftpRun, type Session } from './ftp'

// Subidas, descargas y borrados del panel de servidores, archivo a archivo.
//
// Antes una carpeta se subía de golpe con la función de la librería: no se veía qué
// archivo iba, el porcentaje se quedaba en 0 y en FTP bloqueaba todo lo demás (también
// Recargar) hasta acabar. Ahora:
//   · las carpetas se recorren enteras primero (con sus subcarpetas) y se sabe el total en bytes;
//   · se abren varias conexiones más al servidor y se transfieren varios archivos a la vez,
//     dejando la principal libre para navegar;
//   · se ve qué archivos van ahora, cuáles siguen, la velocidad y los errores, y se puede cancelar.

/** Conexiones extra por transferencia. Muchos hostings limitan las conexiones por usuario. */
const WORKERS = 4

interface FileTask { rel: string; local: string; remote: string; size: number }

interface Job {
  id: string
  kind: 'up' | 'down' | 'delete'
  label: string
  /** Carpeta donde acaba (para refrescar el cuadro que la esté mirando) */
  dest: string
  files: FileTask[]
  /** Carpetas a crear (subir/bajar) o a borrar al final (borrar, de la más honda a la menos) */
  dirs: string[]
  next: number
  done: number
  bytes: number
  doneBytes: number
  active: Map<string, { size: number; transferred: number }>
  failed: { name: string; error: string }[]
  status: TransferJobState['status']
  cancelled: boolean
  startedAt: number
  finishedAt?: number
  /** Para la velocidad: bytes de hace un rato */
  samples: { t: number; b: number }[]
  /** Mientras se recorren las carpetas, lo que se lleva visto */
  scanning?: string
}

const jobs: Job[] = []
let running: Promise<void> | null = null
let lastSend = 0
let sendTimer: ReturnType<typeof setTimeout> | null = null
type Listener = (job: TransferJobState) => void
const finishedListeners = new Set<Listener>()

function view(j: Job): TransferJobState {
  const now = Date.now()
  const old = j.samples.find((s) => now - s.t <= 5000) ?? j.samples[0]
  const speed = old && now > old.t ? ((j.doneBytes - old.b) / (now - old.t)) * 1000 : 0
  return {
    id: j.id, kind: j.kind, label: j.label, dest: j.dest, status: j.status,
    files: j.files.length, filesDone: j.done, bytes: j.bytes, bytesDone: j.doneBytes,
    speed: j.status === 'running' ? Math.max(0, speed) : 0,
    active: [...j.active].map(([rel, a]) => ({ name: rel, size: a.size, transferred: a.transferred })),
    next: j.files.slice(j.next, j.next + 6).map((f) => f.rel),
    pending: Math.max(0, j.files.length - j.next),
    failed: j.failed.slice(-30),
    scanning: j.scanning,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  }
}

function broadcast(force = false): void {
  const send = (): void => {
    sendTimer = null
    lastSend = Date.now()
    const all = jobs.slice(-20).map(view)
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('ftp:transfers', all)
    }
  }
  if (force) { if (sendTimer) clearTimeout(sendTimer); send(); return }
  if (sendTimer) return
  sendTimer = setTimeout(send, Math.max(0, 250 - (Date.now() - lastSend)))
}

export function transferJobs(): TransferJobState[] {
  return jobs.slice(-20).map(view)
}

export function onTransferFinished(cb: Listener): () => void {
  finishedListeners.add(cb)
  return () => { finishedListeners.delete(cb) }
}

export function cancelTransfer(id: string): void {
  const j = jobs.find((x) => x.id === id)
  if (j && (j.status === 'running' || j.status === 'queued')) { j.cancelled = true; broadcast(true) }
}

/** Quita de la lista las que ya acabaron. */
export function clearFinishedTransfers(): void {
  for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].status !== 'running' && jobs[i].status !== 'queued') jobs.splice(i, 1)
  broadcast(true)
}

const rjoin = (a: string, b: string): string => path.posix.join(a, b)

// ── Recorrer lo que hay que transferir ──────────────────────────────────────

async function walkLocal(dir: string, rel: string, remote: string, job: Job): Promise<void> {
  job.dirs.push(remote)
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (job.cancelled) return
    if (e.isSymbolicLink()) continue
    const local = path.join(dir, e.name)
    const r = `${rel}/${e.name}`
    if (e.isDirectory()) await walkLocal(local, r, rjoin(remote, e.name), job)
    else if (e.isFile()) {
      const size = (await fs.stat(local)).size
      job.files.push({ rel: r, local, remote: rjoin(remote, e.name), size })
      job.bytes += size
    }
  }
  job.scanning = `${job.files.length} archivos…`
  broadcast()
}

async function walkRemote(dir: string, rel: string, local: string, job: Job, dirsOut: string[]): Promise<void> {
  dirsOut.push(job.kind === 'delete' ? dir : local)
  const list = await ftpRun((s) => s.list(dir))
  for (const e of list) {
    if (job.cancelled) return
    const remote = rjoin(dir, e.name)
    const r = `${rel}/${e.name}`
    if (e.isDir) await walkRemote(remote, r, path.join(local, e.name), job, dirsOut)
    else {
      job.files.push({ rel: r, local: path.join(local, e.name), remote, size: e.size })
      job.bytes += e.size
    }
  }
  job.scanning = `${job.files.length} archivos…`
  broadcast()
}

// ── Ejecutar ────────────────────────────────────────────────────────────────

async function doFile(s: Session, job: Job, f: FileTask): Promise<void> {
  const a = { size: f.size, transferred: 0 }
  job.active.set(f.rel, a)
  const progress = (t: number): void => {
    job.doneBytes += Math.max(0, t - a.transferred)
    a.transferred = t
    broadcast()
  }
  try {
    if (job.kind === 'up') await s.upload(f.local, f.remote, (t) => progress(t))
    else if (job.kind === 'down') {
      await fs.ensureDir(path.dirname(f.local))
      await s.download(f.remote, f.local, f.size, (t) => progress(t))
    } else await s.remove(f.remote, false)
    // Lo que no avisó del todo (archivos vacíos, borrados) cuenta entero
    progress(f.size)
    job.done++
  } finally {
    job.active.delete(f.rel)
  }
}

const isConnErr = (e: unknown): boolean => /ECONNRESET|EPIPE|ETIMEDOUT|not connected|Client is closed|No SFTP|closed/i.test(String((e as Error)?.message ?? e))

/** Un trabajador con su propia conexión (o, si no se pudo abrir, la principal). */
async function worker(job: Job, own: Session | null): Promise<void> {
  let s = own
  while (!job.cancelled && job.next < job.files.length) {
    const f = job.files[job.next++]
    try {
      if (s) await doFile(s, job, f)
      else await ftpRun((main) => doFile(main, job, f))
    } catch (e) {
      // La conexión extra se cayó: se abre otra y se repite una vez
      if (s && isConnErr(e)) {
        await ftpCloseExtra(s)
        s = await ftpExtraSession().catch(() => null)
        try {
          if (s) await doFile(s, job, f)
          else await ftpRun((main) => doFile(main, job, f))
          continue
        } catch (e2) { e = e2 }
      }
      job.failed.push({ name: f.rel, error: String((e as Error)?.message ?? e) })
      broadcast()
    }
  }
  if (s) await ftpCloseExtra(s)
}

async function runJob(job: Job, sources: { path: string; isDir: boolean; size: number; name: string }[]): Promise<void> {
  job.status = 'running'
  job.startedAt = Date.now()
  broadcast(true)
  try {
    // 1. Qué hay que mover (las carpetas, enteras)
    job.scanning = 'Mirando qué hay…'
    broadcast(true)
    for (const src of sources) {
      if (job.cancelled) break
      if (job.kind === 'up') {
        if (src.isDir) await walkLocal(src.path, src.name, rjoin(job.dest, src.name), job)
        else { job.files.push({ rel: src.name, local: src.path, remote: rjoin(job.dest, src.name), size: src.size }); job.bytes += src.size }
      } else if (job.kind === 'down') {
        if (src.isDir) await walkRemote(src.path, src.name, path.join(job.dest, src.name), job, job.dirs)
        else { job.files.push({ rel: src.name, local: path.join(job.dest, src.name), remote: src.path, size: src.size }); job.bytes += src.size }
      } else {
        if (src.isDir) await walkRemote(src.path, src.name, '', job, job.dirs)
        else { job.files.push({ rel: src.name, local: '', remote: src.path, size: 0 }) }
      }
    }
    job.scanning = undefined
    // 2. Las carpetas de destino primero (de la menos honda a la más)
    if (job.kind === 'up') {
      for (const d of [...new Set(job.dirs)].sort((a, b) => a.split('/').length - b.split('/').length)) {
        if (job.cancelled) break
        await ftpRun((s) => s.mkdir(d)).catch(() => { /* ya existía */ })
      }
    } else if (job.kind === 'down') {
      for (const d of job.dirs) await fs.ensureDir(d)
    }
    broadcast(true)
    // 3. Los archivos, varios a la vez
    if (!job.cancelled && job.files.length) {
      const extra: (Session | null)[] = []
      for (let i = 0; i < Math.min(WORKERS, job.files.length); i++) {
        const s = await ftpExtraSession().catch((e) => { console.warn('[Servidores] Conexión extra no disponible:', (e as Error).message); return null })
        if (!s && i > 0) break // el servidor no deja más: con las que haya
        extra.push(s)
      }
      await Promise.all(extra.map((s) => worker(job, s)))
    }
    // 4. Borrar: las carpetas, ya vacías, de la más honda a la menos
    if (job.kind === 'delete' && !job.cancelled) {
      for (const d of [...job.dirs].sort((a, b) => b.split('/').length - a.split('/').length)) {
        try { await ftpRun((s) => (s.removeEmptyDir ? s.removeEmptyDir(d) : s.remove(d, true))) }
        catch (e) { job.failed.push({ name: d, error: String((e as Error)?.message ?? e) }) }
      }
    }
    job.status = job.cancelled ? 'cancelled' : job.failed.length ? 'error' : 'done'
  } catch (e) {
    job.failed.push({ name: job.label, error: String((e as Error)?.message ?? e) })
    job.status = 'error'
  } finally {
    job.finishedAt = Date.now()
    job.scanning = undefined
    broadcast(true)
    const v = view(job)
    for (const l of finishedListeners) l(v)
  }
}

/**
 * Pone en cola una transferencia y devuelve su id enseguida (la cola va de una en una;
 * dentro de cada una, varios archivos a la vez).
 * up: sources = rutas locales, dest = carpeta del servidor. down: sources = entradas del
 * servidor, dest = carpeta local. delete: sources = entradas del servidor.
 */
export async function startTransfer(
  kind: Job['kind'],
  sources: { path: string; isDir?: boolean; size?: number }[],
  dest: string
): Promise<string> {
  const resolved: { path: string; isDir: boolean; size: number; name: string }[] = []
  for (const s of sources) {
    if (kind === 'up') {
      const st = await fs.stat(s.path)
      resolved.push({ path: s.path, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, name: path.basename(s.path) })
    } else {
      resolved.push({ path: s.path, isDir: !!s.isDir, size: s.size ?? 0, name: path.posix.basename(s.path) })
    }
  }
  const verb = kind === 'up' ? 'Subir' : kind === 'down' ? 'Descargar' : 'Borrar'
  const job: Job = {
    id: uuidv4(), kind, dest, files: [], dirs: [], next: 0, done: 0, bytes: 0, doneBytes: 0,
    label: `${verb} ${resolved.length === 1 ? resolved[0].name : `${resolved.length} elementos`}`,
    active: new Map(), failed: [], status: 'queued', cancelled: false, startedAt: Date.now(), samples: [],
  }
  jobs.push(job)
  broadcast(true)
  const prev = running ?? Promise.resolve()
  running = prev.then(() => (job.cancelled ? undefined : runJob(job, resolved))).then(() => {
    if (job.status === 'queued') { job.status = 'cancelled'; broadcast(true) }
  })
  return job.id
}

// Velocidad: una muestra por segundo de cada transferencia en marcha
setInterval(() => {
  const now = Date.now()
  for (const j of jobs) {
    if (j.status !== 'running') continue
    j.samples.push({ t: now, b: j.doneBytes })
    if (j.samples.length > 10) j.samples.shift()
  }
}, 1000)

export type { RemoteEntry }
