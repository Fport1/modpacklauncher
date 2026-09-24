import fs from 'fs-extra'
import path from 'path'
import { ipcMain, type WebContents } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { AssistInstanceInfo, RemoteEntry, ServerInfo } from '../shared/types'
import { getInstance, getInstanceGameDir } from './instances'
import { trySafeJoin } from './paths'
import { ftpAdoptSession, type Session } from './ftp'
import { setKnownServerInfo } from './serverContent'

// Asistencia remota: un amigo comparte una instancia y tú la manejas desde
// Servidores como si fuera un servidor más.
//
// La conexión en sí (WebRTC, con Firebase solo para encontrarse) vive en la
// ventana de cada uno. Aquí están los dos extremos que tocan disco:
//
// - Anfitrión (el amigo): ejecuta lo que llega, SIEMPRE dentro de la carpeta
//   de la instancia compartida. Nada fuera de ella, nada de ejecutar programas.
// - Ayudante (tú): una Session igual que la de FTP/SFTP cuyas operaciones se
//   mandan por la conexión, así que todo lo de Servidores (editores, mods,
//   NBT, subir y bajar) funciona sin cambios.

// ── Anfitrión ───────────────────────────────────────────────────────────────

let hostRoot: string | null = null

/** Tamaño máximo de un archivo que se manda de una vez por la conexión. */
const MAX_TRANSFER = 256 * 1024 * 1024

export async function assistHostStart(instanceId: string): Promise<AssistInstanceInfo> {
  const instance = await getInstance(instanceId)
  if (!instance) throw new Error('Instancia no encontrada')
  const root = await getInstanceGameDir(instanceId)
  await fs.ensureDir(root)
  hostRoot = await fs.realpath(root)
  return { instanceName: instance.name, minecraft: instance.minecraft, loader: instance.modloader }
}

export function assistHostStop(): void {
  hostRoot = null
}

/**
 * Ruta virtual del ayudante ("/mods/x.jar") → ruta real dentro de la
 * instancia. Rechaza "..", rutas absolutas y enlaces que apunten fuera.
 */
async function resolveHost(virtualPath: string): Promise<string> {
  if (!hostRoot) throw new Error('No hay ninguna sesión de ayuda activa')
  const rel = String(virtualPath).replace(/^\/+/, '')
  const target = trySafeJoin(hostRoot, rel)
  if (!target) throw new Error('Ruta fuera de la instancia compartida')
  // Si ya existe, lo que cuenta es a dónde apunta de verdad (enlaces simbólicos)
  const real = await fs.realpath(target).catch(() => null)
  if (real) {
    const relative = path.relative(hostRoot, real)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Ruta fuera de la instancia compartida')
  }
  return target
}

type HostArgs = { path?: string; to?: string; isDir?: boolean; data?: Uint8Array; max?: number }

export async function assistHostOp(op: string, args: HostArgs): Promise<unknown> {
  switch (op) {
    case 'ping':
      if (!hostRoot) throw new Error('No hay ninguna sesión de ayuda activa')
      return true
    case 'list': {
      const dir = await resolveHost(args.path ?? '/')
      const names = await fs.readdir(dir)
      const out: RemoteEntry[] = []
      for (const name of names) {
        try {
          const st = await fs.stat(path.join(dir, name))
          out.push({ name, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, modified: st.mtimeMs })
        } catch { /* desapareció mientras tanto */ }
      }
      return out
    }
    case 'read': {
      const file = await resolveHost(args.path ?? '')
      const st = await fs.stat(file)
      if (st.isDirectory()) throw new Error('Es una carpeta')
      if (args.max) {
        const fd = await fs.open(file, 'r')
        try {
          const buf = Buffer.alloc(Math.min(args.max, st.size))
          await fs.read(fd, buf, 0, buf.length, 0)
          return new Uint8Array(buf)
        } finally { await fs.close(fd) }
      }
      if (st.size > MAX_TRANSFER) throw new Error('El archivo es demasiado grande para mandarlo por la asistencia (más de 256 MB)')
      return new Uint8Array(await fs.readFile(file))
    }
    case 'write': {
      const file = await resolveHost(args.path ?? '')
      if (!args.data) throw new Error('Faltan los datos')
      await fs.ensureDir(path.dirname(file))
      const tmp = `${file}.tmp-assist`
      await fs.writeFile(tmp, Buffer.from(args.data))
      await fs.move(tmp, file, { overwrite: true })
      return true
    }
    case 'mkdir':
      await fs.ensureDir(await resolveHost(args.path ?? ''))
      return true
    case 'rename': {
      const from = await resolveHost(args.path ?? '')
      const to = await resolveHost(args.to ?? '')
      if (from === hostRoot) throw new Error('No se puede renombrar la carpeta de la instancia')
      await fs.move(from, to, { overwrite: false })
      return true
    }
    case 'remove': {
      const target = await resolveHost(args.path ?? '')
      if (target === hostRoot) throw new Error('No se puede borrar la carpeta de la instancia')
      await fs.remove(target)
      return true
    }
    default:
      throw new Error(`Operación desconocida: ${op}`)
  }
}

// ── Ayudante ────────────────────────────────────────────────────────────────

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

let helperContents: WebContents | null = null
const pending = new Map<string, Pending>()
let closeListeners: Array<() => void> = []

ipcMain.on('assist:reply', (_e, reply: { id: string; ok: boolean; result?: unknown; error?: string }) => {
  const p = pending.get(reply.id)
  if (!p) return
  pending.delete(reply.id)
  clearTimeout(p.timer)
  if (reply.ok) p.resolve(reply.result)
  else p.reject(new Error(reply.error ?? 'Error en el equipo de tu amigo'))
})

function call<T>(op: string, args: HostArgs = {}, timeoutMs = 60_000): Promise<T> {
  const wc = helperContents
  if (!wc || wc.isDestroyed()) return Promise.reject(new Error('connection closed: la asistencia se cerró'))
  const id = uuidv4()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Tu amigo no responde (Timeout)'))
    }, timeoutMs)
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
    wc.send('assist:call', { id, op, args })
  })
}

/** Lo que la vista de mods necesita saber de la instancia del amigo. */
function infoFor(info: AssistInstanceInfo): (root: string) => ServerInfo {
  const loaderLabel = info.loader === 'vanilla' ? 'Vanilla' : info.loader.charAt(0).toUpperCase() + info.loader.slice(1)
  return () => ({
    kind: info.loader === 'vanilla' ? 'vanilla' : 'mods',
    loader: info.loader,
    label: `${info.instanceName} · ${loaderLabel} · MC ${info.minecraft}`,
    minecraft: info.minecraft,
    mods: info.loader === 'vanilla' ? null : { loaders: info.loader, folder: '/mods' },
    plugins: null,
    evidence: ['Datos de la instancia de tu amigo']
  })
}

function makeSession(): Session {
  const readAll = async (remote: string): Promise<Buffer> => Buffer.from(await call<Uint8Array>('read', { path: remote }, 10 * 60_000))
  const writeAll = async (remote: string, data: Buffer): Promise<void> => { await call('write', { path: remote, data: new Uint8Array(data) }, 10 * 60_000) }
  const listAll = (dir: string): Promise<RemoteEntry[]> => call<RemoteEntry[]>('list', { path: dir })

  const session: Session = {
    serial: false,
    readHead: async (remote, max) => Buffer.from(await call<Uint8Array>('read', { path: remote, max })),
    ping: async () => { await call('ping', {}, 15_000) },
    onClose: (cb) => { closeListeners.push(cb) },
    list: listAll,
    pwd: async () => '/',
    async download(remote, local, total, onProgress) {
      const data = await readAll(remote)
      await fs.writeFile(local, data)
      onProgress(data.length, total || data.length)
    },
    async downloadDir(remote, local) {
      await fs.ensureDir(local)
      for (const e of await listAll(remote)) {
        const from = path.posix.join(remote, e.name)
        const to = path.join(local, e.name)
        if (e.isDir) await session.downloadDir(from, to)
        else await fs.writeFile(to, await readAll(from))
      }
    },
    async upload(local, remote, onProgress) {
      const data = await fs.readFile(local)
      await writeAll(remote, data)
      onProgress(data.length, data.length)
    },
    async uploadDir(local, remote) {
      await call('mkdir', { path: remote })
      for (const name of await fs.readdir(local)) {
        const from = path.join(local, name)
        const to = path.posix.join(remote, name)
        if ((await fs.stat(from)).isDirectory()) await session.uploadDir(from, to)
        else await writeAll(to, await fs.readFile(from))
      }
    },
    remove: async (target, isDir) => { await call('remove', { path: target, isDir }) },
    rename: async (from, to) => { await call('rename', { path: from, to }) },
    mkdir: async (target) => { await call('mkdir', { path: target }) },
    readFile: readAll,
    writeFile: writeAll,
    close: async () => {
      const wc = helperContents
      helperContents = null
      if (wc && !wc.isDestroyed()) wc.send('assist:hangup')
    }
  }
  return session
}

/** La ventana del ayudante ya tiene la conexión abierta: se presenta como sesión de Servidores. */
export async function assistHelperStart(wc: WebContents, info: AssistInstanceInfo, hostName: string): Promise<void> {
  helperContents = wc
  closeListeners = []
  setKnownServerInfo(infoFor(info))
  await ftpAdoptSession(makeSession(), `${hostName} · ${info.instanceName}`, '/')
}

/** La conexión se cortó (el amigo cerró, se fue la red…). */
export function assistHelperClosed(): void {
  helperContents = null
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('connection closed')) }
  pending.clear()
  const listeners = closeListeners
  closeListeners = []
  for (const cb of listeners) cb()
}
