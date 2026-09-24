import fs from 'fs-extra'
import path from 'path'
import { PassThrough, Readable, Writable } from 'stream'
import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron'
import { Client as FtpClient } from 'basic-ftp'
import SftpClient from 'ssh2-sftp-client'
import { v4 as uuidv4 } from 'uuid'
import type { FtpSite, FtpSiteInput, RemoteEntry, LocalEntry, FtpConnectionState } from '../shared/types'
import { parseHostInput } from '../shared/ftpHost'

// Cliente de transferencia de archivos, lo básico de FileZilla: pensado para
// administrar servidores de Minecraft desde el launcher.
//
// Dos protocolos porque los hostings se reparten entre ambos: FTP/FTPS en
// muchos proveedores clásicos, y SFTP en todo lo que usa el panel Pterodactyl,
// que es la mayoría del hosting moderno de Minecraft.

type Progress = (transferred: number, total: number) => void

/** Operaciones comunes a los protocolos (y a la asistencia remota). */
export interface Session {
  /** true si la conexión solo admite una operación a la vez (FTP). */
  serial: boolean
  /** Los primeros bytes de un archivo, sin bajarlo entero (para leer registros largos). */
  readHead(remote: string, maxBytes: number): Promise<Buffer>
  /** Algo barato para comprobar que la conexión sigue viva. */
  ping(): Promise<void>
  /** Avisa si la conexión se cierra sola (caída de red, reinicio del servidor…). */
  onClose(cb: () => void): void
  list(dir: string): Promise<RemoteEntry[]>
  pwd(): Promise<string>
  download(remote: string, local: string, total: number, onProgress: Progress): Promise<void>
  downloadDir(remote: string, local: string): Promise<void>
  upload(local: string, remote: string, onProgress: Progress): Promise<void>
  uploadDir(local: string, remote: string): Promise<void>
  remove(target: string, isDir: boolean): Promise<void>
  rename(from: string, to: string): Promise<void>
  mkdir(target: string): Promise<void>
  /** Archivo entero en memoria, para el editor de texto. */
  readFile(remote: string): Promise<Buffer>
  writeFile(remote: string, data: Buffer): Promise<void>
  close(): Promise<void>
}

// ── FTP / FTPS ──────────────────────────────────────────────────────────────

async function openFtp(site: FtpSite, password: string): Promise<Session> {
  const client = new FtpClient(30_000)
  await client.access({
    host: site.host,
    port: site.port,
    user: site.user,
    password,
    secure: site.protocol === 'ftps'
  })

  async function readAll(remote: string): Promise<Buffer> {
    const chunks: Buffer[] = []
    const sink = new Writable({
      write(chunk: Buffer, _enc, done) { chunks.push(chunk); done() }
    })
    await client.downloadTo(sink, remote)
    return Buffer.concat(chunks)
  }

  return {
    serial: true,
    // FTP no permite pedir solo un trozo sin romper la conexión: se baja entero
    readHead: (remote) => readAll(remote),
    ping: async () => { await client.send('NOOP') },
    onClose: () => { /* basic-ftp no avisa: se detecta con el ping periódico */ },
    async list(dir) {
      const items = await client.list(dir)
      return items
        .filter((i) => i.name !== '.' && i.name !== '..')
        .map((i) => ({
          name: i.name,
          isDir: i.isDirectory,
          size: i.size,
          modified: i.modifiedAt ? i.modifiedAt.getTime() : null
        }))
    },
    pwd: () => client.pwd(),
    async download(remote, local, total, onProgress) {
      client.trackProgress((info) => onProgress(info.bytes, total))
      try {
        await client.downloadTo(local, remote)
      } finally {
        client.trackProgress()
      }
    },
    downloadDir: async (remote, local) => { await client.downloadToDir(local, remote) },
    async upload(local, remote, onProgress) {
      const total = (await fs.stat(local)).size
      client.trackProgress((info) => onProgress(info.bytes, total))
      try {
        await client.uploadFrom(local, remote)
      } finally {
        client.trackProgress()
      }
    },
    async uploadDir(local, remote) {
      // uploadFromDir entra en la carpeta de destino y deja ahí el cwd
      const cwd = await client.pwd()
      await client.uploadFromDir(local, remote)
      await client.cd(cwd)
    },
    async remove(target, isDir) {
      if (isDir) await client.removeDir(target)
      else await client.remove(target)
    },
    rename: async (from, to) => { await client.rename(from, to) },
    async mkdir(target) {
      // basic-ftp no tiene un mkdir suelto: ensureDir crea y entra, así que
      // hay que volver luego a donde se estaba
      const cwd = await client.pwd()
      await client.ensureDir(target)
      await client.cd(cwd)
    },
    readFile: (remote) => readAll(remote),
    writeFile: async (remote, data) => { await client.uploadFrom(Readable.from(data), remote) },
    close: async () => { client.close() }
  }
}

// ── SFTP ────────────────────────────────────────────────────────────────────

async function openSftp(site: FtpSite, password: string): Promise<Session> {
  const client = new SftpClient()
  await client.connect({
    host: site.host,
    port: site.port,
    username: site.user,
    password,
    readyTimeout: 30_000,
    // Sin esto, un router que corta las conexiones inactivas la deja muerta sin que nadie se entere
    keepaliveInterval: 15_000,
    keepaliveCountMax: 4
  })

  return {
    serial: false,
    async readHead(remote, maxBytes) {
      const chunks: Buffer[] = []
      const stream = client.createReadStream(remote, { start: 0, end: Math.max(0, maxBytes - 1) })
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (c: Buffer) => chunks.push(c))
        stream.on('end', () => resolve())
        stream.on('close', () => resolve())
        stream.on('error', reject)
      })
      return Buffer.concat(chunks)
    },
    ping: async () => { await client.cwd() },
    onClose: (cb) => { client.on('close', cb); client.on('end', cb) },
    async list(dir) {
      const items = await client.list(dir)
      return items.map((i) => ({
        name: i.name,
        isDir: i.type === 'd',
        size: i.size,
        modified: i.modifyTime || null
      }))
    },
    pwd: () => client.cwd(),
    // Por streams y no con fastGet/fastPut: esos abren varias peticiones en
    // paralelo sobre el mismo fichero y el SFTP de Pterodactyl, el panel más
    // común en hosting de Minecraft, a veces las corta a medias.
    async download(remote, local, total, onProgress) {
      let transferred = 0
      const counter = new PassThrough()
      counter.on('data', (chunk: Buffer) => {
        transferred += chunk.length
        onProgress(transferred, total)
      })
      const out = fs.createWriteStream(local)
      const done = new Promise<void>((resolve, reject) => {
        out.on('finish', resolve)
        out.on('error', reject)
      })
      counter.pipe(out)
      await client.get(remote, counter)
      await done
    },
    downloadDir: async (remote, local) => { await client.downloadDir(remote, local) },
    async upload(local, remote, onProgress) {
      const total = (await fs.stat(local)).size
      let transferred = 0
      const input = fs.createReadStream(local)
      input.on('data', (chunk: Buffer | string) => {
        transferred += chunk.length
        onProgress(transferred, total)
      })
      await client.put(input, remote)
    },
    uploadDir: async (local, remote) => { await client.uploadDir(local, remote) },
    async remove(target, isDir) {
      if (isDir) await client.rmdir(target, true)
      else await client.delete(target)
    },
    rename: async (from, to) => { await client.rename(from, to) },
    mkdir: async (target) => { await client.mkdir(target, true) },
    readFile: async (remote) => (await client.get(remote)) as Buffer,
    writeFile: async (remote, data) => { await client.put(data, remote) },
    close: async () => { await client.end() }
  }
}

/**
 * Los errores de red salen como códigos de Node (ENOTFOUND, ECONNREFUSED…) o
 * como mensajes en inglés del servidor. Se traducen a qué hay que revisar.
 */
function explainConnectError(e: unknown, site: FtpSite): string {
  const err = e as { code?: string; message?: string; level?: string }
  const msg = err.message ?? ''
  const code = err.code ?? ''
  if (code === 'ENOTFOUND' || /ENOTFOUND|getaddrinfo/.test(msg)) {
    return `No se encuentra el servidor "${site.host}". Revisa la dirección.`
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) {
    return `${site.host} rechazó la conexión en el puerto ${site.port}. Comprueba el puerto y el protocolo ` +
      `(en paneles Pterodactyl, SFTP suele ir en el 2022).`
  }
  if (code === 'ETIMEDOUT' || /timed? ?out/i.test(msg)) {
    return `${site.host} no responde en el puerto ${site.port}. Puede ser el puerto, el protocolo o un cortafuegos.`
  }
  if (err.level === 'client-authentication' || /authentication|auth fail|530|login/i.test(msg)) {
    return 'Usuario o contraseña incorrectos.'
  }
  if (/handshake|protocol|SSH/i.test(msg) && site.protocol !== 'sftp') {
    return 'El servidor habla SFTP, no FTP. Cambia el protocolo a SFTP.'
  }
  return msg || 'No se pudo conectar'
}

// ── Sesión activa ───────────────────────────────────────────────────────────

let session: Session | null = null
let sessionSite: FtpSite | null = null
/** Nombre que se enseña de la conexión (el sitio, o "Asistencia: …"). */
let sessionLabel = ''
let sessionKind: 'site' | 'assist' = 'site'
/** Carpeta en la que arrancó la conexión: la raíz del servidor de Minecraft. */
let sessionRoot = '/'
/** Última carpeta listada, para que otra ventana abra donde se estaba. */
let sessionCwd = '/'
/** Para poder reconectar solo si la conexión se cae. Solo en memoria. */
let sessionPassword = ''
let reconnecting: Promise<boolean> | null = null
let lostReason: string | null = null

/**
 * Cola de operaciones.
 *
 * Una conexión FTP solo puede hacer una cosa a la vez: si la interfaz pide
 * listar una carpeta mientras sube un fichero, basic-ftp rechaza la segunda
 * con "Client is closed" o mezcla las respuestas. En FTP todo pasa por aquí en
 * orden; SFTP sí admite varias a la vez y va directo, que es mucho más rápido.
 */
let queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

function requireSession(): Session {
  if (!session) throw new Error(lostReason ? `Se perdió la conexión: ${lostReason}` : 'No hay ninguna conexión abierta')
  return session
}

export function ftpState(): FtpConnectionState {
  return {
    connected: session !== null,
    siteId: sessionSite?.id ?? null,
    label: sessionLabel,
    kind: sessionKind,
    root: sessionRoot,
    cwd: sessionCwd,
    lost: !session && lostReason !== null,
    reason: lostReason ?? undefined,
    reconnecting: reconnecting !== null
  }
}

/** A todas las ventanas: el panel del servidor puede estar en otra. */
function broadcastState(): void {
  const state = ftpState()
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('ftp:connection', state)
  }
}

function isConnectionError(e: unknown): boolean {
  const err = e as { code?: string; message?: string }
  const text = `${err.code ?? ''} ${err.message ?? ''}`
  return /ECONNRESET|EPIPE|ETIMEDOUT|ECONNABORTED|ENOTCONN|No SFTP connection|not connected|Client is closed|Socket closed|connection (lost|closed)|ERR_NOT_CONNECTED|No response from server/i.test(text)
}

async function openSite(site: FtpSite, password: string): Promise<Session> {
  // Sitios guardados antes de aceptar direcciones pegadas pueden tener
  // "sftp://servidor:2022" en el campo de servidor: se separa aquí también.
  const parsed = parseHostInput(site.host)
  const target: FtpSite = {
    ...site,
    host: parsed.host,
    port: parsed.port ?? site.port,
    protocol: parsed.protocol ?? site.protocol,
    user: site.user || parsed.user || ''
  }
  try {
    return target.protocol === 'sftp' ? await openSftp(target, password) : await openFtp(target, password)
  } catch (e) {
    throw new Error(explainConnectError(e, target))
  }
}

/** Deja `opened` como la sesión activa y vigila si se cae. */
function adopt(opened: Session): void {
  session = opened
  lostReason = null
  opened.onClose(() => {
    // Solo cuenta si sigue siendo la sesión activa: al desconectar a propósito ya no lo es
    if (session === opened) reconnect('el servidor cerró la conexión')
  })
}

/**
 * Intenta recuperar la conexión en silencio. Si no puede, lo dice en todas las
 * ventanas para que se vea el aviso con el botón de reconectar.
 */
function reconnect(reason: string): Promise<boolean> {
  if (reconnecting) return reconnecting
  const old = session
  session = null
  if (!sessionSite) {
    // Asistencia remota: no se puede reabrir desde aquí, la tiene que volver a abrir el amigo
    lostReason = reason
    if (old) old.close().catch(() => {})
    broadcastState()
    return Promise.resolve(false)
  }
  const site = sessionSite
  reconnecting = (async () => {
    broadcastState()
    if (old) await old.close().catch(() => {})
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt))
        if (sessionSite !== site) return false // desconectado o cambiado mientras tanto
        adopt(await openSite(site, sessionPassword))
        return true
      } catch { /* siguiente intento */ }
    }
    lostReason = reason
    return false
  })()
  return reconnecting.finally(() => { reconnecting = null; broadcastState() })
}

/**
 * Ejecuta una operación sobre la sesión. Si falla porque la conexión se había
 * caído, reconecta y la repite una vez: el usuario ni se entera.
 */
function run<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const guarded = async (): Promise<T> => {
    if (!session && reconnecting) await reconnecting
    try {
      return await fn(requireSession())
    } catch (e) {
      if (!isConnectionError(e) || !session) throw e
      if (await reconnect('se cortó la conexión')) return fn(requireSession())
      throw new Error('Se perdió la conexión con el servidor.')
    }
  }
  return session?.serial ? enqueue(guarded) : guarded()
}

// FTP no avisa cuando se cae: un NOOP cada poco lo descubre, y de paso evita
// que el servidor cierre la conexión por inactividad.
setInterval(() => {
  const current = session
  if (!current || !current.serial || reconnecting) return
  enqueue(() => current.ping()).catch(() => { if (session === current) reconnect('el servidor dejó de responder') })
}, 25_000)

export async function ftpConnect(siteId: string, typedPassword?: string): Promise<{ cwd: string }> {
  const site = (await readSites()).find((s) => s.id === siteId)
  if (!site) throw new Error('Sitio no encontrado')

  const password = typedPassword ?? decryptPassword(site.password) ?? ''
  await ftpDisconnect()

  const opened = await openSite(site, password)
  sessionSite = site
  sessionLabel = site.name || site.host
  sessionKind = 'site'
  sessionPassword = password

  // Arrancar en la carpeta configurada si existe; si no, donde deje el servidor
  let cwd = await opened.pwd()
  if (site.remoteDir) {
    try {
      await opened.list(site.remoteDir)
      cwd = site.remoteDir
    } catch { /* la carpeta ya no existe: se queda en la de inicio */ }
  }
  sessionRoot = cwd
  sessionCwd = cwd
  adopt(opened)
  broadcastState()
  return { cwd }
}

/** Sesión que no es un sitio guardado (la asistencia remota). */
export async function ftpAdoptSession(opened: Session, label: string, root: string): Promise<void> {
  await ftpDisconnect()
  sessionSite = null
  sessionLabel = label
  sessionKind = 'assist'
  sessionPassword = ''
  sessionRoot = root
  sessionCwd = root
  adopt(opened)
  broadcastState()
}

export async function ftpReconnect(): Promise<boolean> {
  if (!sessionSite) return false
  lostReason = null
  return reconnect('no se pudo volver a conectar')
}

export async function ftpDisconnect(): Promise<void> {
  const current = session
  session = null
  sessionSite = null
  sessionLabel = ''
  sessionPassword = ''
  lostReason = null
  if (current) await current.close().catch(() => {})
  broadcastState()
}

export function ftpList(dir: string): Promise<RemoteEntry[]> {
  return run(async (s) => {
    const entries = await s.list(dir)
    sessionCwd = dir
    return entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  })
}

export function ftpDownload(
  remote: string, localDir: string, entry: RemoteEntry, onProgress: Progress
): Promise<string> {
  return run(async (s) => {
    const target = path.join(localDir, entry.name)
    if (entry.isDir) {
      await fs.ensureDir(target)
      await s.downloadDir(remote, target)
    } else {
      await s.download(remote, target, entry.size, onProgress)
    }
    return target
  })
}

export function ftpUpload(localPath: string, remoteDir: string, onProgress: Progress): Promise<string> {
  return run(async (s) => {
    const name = path.basename(localPath)
    const target = path.posix.join(remoteDir, name)
    const stat = await fs.stat(localPath)
    if (stat.isDirectory()) await s.uploadDir(localPath, target)
    else await s.upload(localPath, target, onProgress)
    return target
  })
}

export const ftpRemove = (target: string, isDir: boolean): Promise<void> =>
  run((s) => s.remove(target, isDir))

export const ftpRename = (from: string, to: string): Promise<void> =>
  run((s) => s.rename(from, to))

export const ftpMkdir = (target: string): Promise<void> =>
  run((s) => s.mkdir(target))

export const ftpReadHead = (remote: string, maxBytes: number): Promise<Buffer> =>
  run((s) => s.readHead(remote, maxBytes))

// ── Edición de texto ────────────────────────────────────────────────────────

/** Por encima de esto el editor iría lento y seguramente no es un archivo de configuración. */
const MAX_TEXT_BYTES = 5 * 1024 * 1024

/**
 * Un byte nulo en los primeros KB es la señal clásica de binario. Abrir un
 * .jar o un .dat como texto y guardarlo lo destrozaría, así que se rechaza.
 */
function asText(data: Buffer): string {
  if (data.length > MAX_TEXT_BYTES) throw new Error('El archivo es demasiado grande para editarlo aquí (más de 5 MB).')
  if (data.subarray(0, 8000).includes(0)) throw new Error('No es un archivo de texto.')
  return data.toString('utf8')
}

export const ftpReadText = (remote: string): Promise<string> =>
  run(async (s) => asText(await s.readFile(remote)))

export const ftpWriteText = (remote: string, content: string): Promise<void> =>
  run((s) => s.writeFile(remote, Buffer.from(content, 'utf8')))

/** Archivo binario entero (NBT, imágenes, jars para identificarlos). */
export const ftpReadBytes = (remote: string): Promise<Buffer> =>
  run((s) => s.readFile(remote))

export const ftpWriteBytes = (remote: string, data: Buffer): Promise<void> =>
  run((s) => s.writeFile(remote, data))

// ── Imágenes ────────────────────────────────────────────────────────────────

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml'
}
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/** Como data URL, que la ventana puede enseñar sin tener acceso al disco ni a la conexión. */
function asImageDataUrl(name: string, data: Buffer): string {
  const mime = IMAGE_MIME[path.extname(name).slice(1).toLowerCase()]
  if (!mime) throw new Error('No es una imagen que se pueda mostrar.')
  if (data.length > MAX_IMAGE_BYTES) throw new Error('La imagen es demasiado grande para abrirla aquí (más de 25 MB).')
  return `data:${mime};base64,${data.toString('base64')}`
}

export const ftpReadImage = (remote: string): Promise<string> =>
  run(async (s) => asImageDataUrl(remote, await s.readFile(remote)))

export async function localReadImage(file: string): Promise<string> {
  const { size } = await fs.stat(file)
  if (size > MAX_IMAGE_BYTES) throw new Error('La imagen es demasiado grande para abrirla aquí (más de 25 MB).')
  return asImageDataUrl(file, await fs.readFile(file))
}

export async function localReadText(file: string): Promise<string> {
  return asText(await fs.readFile(file))
}

export async function localWriteText(file: string, content: string): Promise<void> {
  // A un temporal y renombrar: si algo falla a mitad, el original sigue entero
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.move(tmp, file, { overwrite: true })
}

// ── Operaciones locales ─────────────────────────────────────────────────────

export async function localMkdir(dir: string): Promise<void> {
  if (await fs.pathExists(dir)) throw new Error('Ya existe una carpeta o archivo con ese nombre.')
  await fs.mkdir(dir)
}

export async function localRename(from: string, to: string): Promise<void> {
  if (await fs.pathExists(to)) throw new Error('Ya existe una carpeta o archivo con ese nombre.')
  await fs.rename(from, to)
}

/** A la papelera y no borrado directo: en el equipo del usuario, que se pueda deshacer. */
export async function localTrash(target: string): Promise<void> {
  await shell.trashItem(target)
}

export function localReveal(target: string): void {
  shell.showItemInFolder(target)
}

export async function pickLocalDir(window: BrowserWindow | null, defaultPath: string): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Elegir carpeta',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  }
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] ?? null
}

/**
 * Carpeta del launcher donde van las descargas de servidores, para que
 * siempre haya un sitio conocido y no acaben mezcladas con las instancias.
 */
export async function serverDownloadsDir(): Promise<string> {
  const dir = path.join(app.getPath('userData'), 'Descargas de servidores')
  await fs.ensureDir(dir)
  return dir
}

// ── Sitios guardados ────────────────────────────────────────────────────────

function sitesFile(): string {
  return path.join(app.getPath('userData'), 'ftp-sites.json')
}

async function readSites(): Promise<FtpSite[]> {
  const sites: FtpSite[] = await fs.readJson(sitesFile()).catch(() => [])

  // Sitios guardados con la dirección pegada entera ("sftp://host:2022"):
  // se separan una vez y se reescribe el archivo, para que la lista muestre
  // el servidor limpio y no haga falta volver a editarlos.
  let changed = false
  const clean = sites.map((site) => {
    const p = parseHostInput(site.host)
    if (p.host === site.host) return site
    changed = true
    return {
      ...site,
      host: p.host,
      port: p.port ?? site.port,
      protocol: p.protocol ?? site.protocol,
      user: site.user || p.user || '',
      remoteDir: site.remoteDir || p.path
    }
  })
  if (changed) await writeSites(clean)
  return clean
}

async function writeSites(sites: FtpSite[]): Promise<void> {
  const target = sitesFile()
  await fs.writeJson(`${target}.tmp`, sites, { spaces: 2 })
  await fs.move(`${target}.tmp`, target, { overwrite: true })
}

/**
 * La contraseña se guarda cifrada con el llavero del sistema. Si el sistema no
 * ofrece cifrado, no se guarda: se pedirá al conectar, antes que dejarla en
 * claro en un JSON.
 */
function encryptPassword(plain: string): string | undefined {
  if (!plain || !safeStorage.isEncryptionAvailable()) return undefined
  return safeStorage.encryptString(plain).toString('base64')
}

function decryptPassword(stored?: string): string | undefined {
  if (!stored || !safeStorage.isEncryptionAvailable()) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return undefined
  }
}

/**
 * Lista de sitios para la interfaz. Nunca incluye contraseñas: solo si hay una
 * guardada, para saber si hace falta pedirla.
 */
export async function listSites(): Promise<Array<Omit<FtpSite, 'password'> & { hasPassword: boolean }>> {
  return (await readSites()).map(({ password, ...rest }) => ({ ...rest, hasPassword: !!password }))
}

export async function saveSite(input: FtpSiteInput): Promise<string> {
  const sites = await readSites()
  const existing = input.id ? sites.find((s) => s.id === input.id) : undefined

  // Lo que venga pegado dentro del servidor (protocolo, puerto, usuario,
  // carpeta) manda sobre los campos sueltos: es lo que el usuario copió
  // de su hosting a propósito.
  const parsed = parseHostInput(input.host)
  const protocol = parsed.protocol ?? input.protocol
  const site: FtpSite = {
    id: existing?.id ?? uuidv4(),
    name: input.name.trim() || parsed.host,
    protocol,
    host: parsed.host,
    port: parsed.port ?? (input.port || (protocol === 'sftp' ? 22 : 21)),
    user: input.user.trim() || parsed.user || '',
    remoteDir: input.remoteDir?.trim() || parsed.path || undefined,
    // Contraseña vacía al editar = conservar la que había
    password: input.password ? encryptPassword(input.password) : existing?.password
  }

  const next = existing ? sites.map((s) => (s.id === site.id ? site : s)) : [...sites, site]
  await writeSites(next)
  return site.id
}

export async function deleteSite(id: string): Promise<void> {
  if (sessionSite?.id === id) await ftpDisconnect()
  await writeSites((await readSites()).filter((s) => s.id !== id))
}

// ── Lado local ──────────────────────────────────────────────────────────────

export async function localList(dir: string): Promise<LocalEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const out: LocalEntry[] = []
  for (const e of entries) {
    if (e.isSymbolicLink()) continue
    const stat = await fs.stat(path.join(dir, e.name)).catch(() => null)
    if (!stat) continue
    out.push({ name: e.name, isDir: e.isDirectory(), size: stat.size, modified: stat.mtimeMs })
  }
  return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
}

export function localParent(dir: string): string {
  return path.dirname(dir)
}

export function localJoin(dir: string, name: string): string {
  return path.join(dir, name)
}
