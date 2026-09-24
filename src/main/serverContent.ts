import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'
import { app } from 'electron'
import type { RemoteEntry, ServerInfo, ServerJarMeta, ServerOverride } from '../shared/types'
import { ftpList, ftpMkdir, ftpReadBytes, ftpReadHead, ftpState, ftpWriteBytes } from './ftp'
import { detectServer, serverInfoFor } from './serverDetect'
import { identifyByHashes } from './modrinth'

// Mods y plugins de un servidor remoto: qué software es, qué hay instalado y
// cómo añadir más desde Modrinth.
//
// A diferencia de una instancia, aquí no hay disco local donde leer los .jar.
// Para saber qué es cada uno hay que bajarlo y calcular su sha1, así que los
// hashes se guardan por sitio y solo se recalculan si el archivo cambia.

interface SiteData {
  override?: ServerOverride
  /** `${ruta remota}|${tamaño}` → sha1 */
  hashes: Record<string, string>
}

const HEADERS = { 'User-Agent': 'ModpackLauncher/1.0.1 (franciscomanuelportoperez@gmail.com)' }
/** Un mod no suele pasar de unas decenas de MB; por encima no merece la pena bajarlo solo para identificarlo. */
const MAX_IDENTIFY_BYTES = 64 * 1024 * 1024

function dataFile(): string {
  return path.join(app.getPath('userData'), 'ftp-servers.json')
}

async function readAll(): Promise<Record<string, SiteData>> {
  return fs.readJson(dataFile()).catch(() => ({}))
}

// Escrituras en fila: identificar e instalar a la vez no deben pisarse el archivo
let writing: Promise<unknown> = Promise.resolve()
function updateSite(siteId: string, fn: (data: SiteData) => void): Promise<void> {
  const run = writing.then(async () => {
    const all = await readAll()
    const data = all[siteId] ?? { hashes: {} }
    data.hashes ??= {}
    fn(data)
    all[siteId] = data
    await fs.writeJson(dataFile(), all, { spaces: 2 })
  })
  writing = run.catch(() => {})
  return run
}

/** Clave con la que se guardan los datos de la conexión actual (sitio guardado o asistencia). */
function currentSite(): string {
  const { connected, siteId, kind, label } = ftpState()
  if (!connected) throw new Error('No hay ninguna conexión abierta')
  return siteId ?? `${kind}:${label}`
}

/**
 * Lo detectado se recuerda mientras dure la conexión: abrir la carpeta de mods
 * no debe volver a leer registros y carpetas cada vez.
 */
const detected = new Map<string, ServerInfo>()
/** Para la asistencia: la instancia del amigo ya dice qué es, no hace falta adivinar. */
let knownInfo: ((root: string) => ServerInfo | null) | null = null
export function setKnownServerInfo(fn: ((root: string) => ServerInfo | null) | null): void {
  knownInfo = fn
  detected.clear()
}

/** Varias tareas a la vez, como mucho `limit` en marcha. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  })
  await Promise.all(workers)
}

const remoteJoin = (dir: string, name: string): string => path.posix.join(dir, name)
const hashKey = (remote: string, size: number): string => `${remote}|${size}`
const isJar = (name: string): boolean => /\.jar(\.disabled)?$/i.test(name)

// ── Tipo de servidor ────────────────────────────────────────────────────────

export async function serverDetect(root: string, force = false): Promise<ServerInfo> {
  const siteId = currentSite()
  const key = `${siteId}|${root}`
  if (!force && detected.has(key)) return detected.get(key)!
  const override = (await readAll())[siteId]?.override
  let info: ServerInfo
  if (override) info = serverInfoFor(override.loader, override.minecraft, root)
  else info = (ftpState().kind === 'assist' ? knownInfo?.(root) : null) ?? await detectServer(root, ftpList, (f) => ftpReadHead(f, 256 * 1024))
  detected.set(key, info)
  return info
}

export async function serverSetOverride(override: ServerOverride | null): Promise<void> {
  const siteId = currentSite()
  await updateSite(siteId, (d) => {
    if (override) d.override = override
    else delete d.override
  })
  detected.clear()
}

// ── Contenido instalado ─────────────────────────────────────────────────────

export async function serverListJars(folder: string): Promise<RemoteEntry[]> {
  const entries = await ftpList(folder).catch(() => [] as RemoteEntry[])
  return entries.filter((e) => !e.isDir && isJar(e.name))
}

/**
 * Qué es cada .jar de la carpeta según Modrinth. Los que no están en Modrinth
 * (o los que pesan demasiado) simplemente no aparecen en el resultado.
 */
export async function serverIdentifyJars(
  folder: string, minecraft: string, loaders: string,
  onProgress: (done: number, total: number) => void
): Promise<Record<string, ServerJarMeta>> {
  const siteId = currentSite()
  const entries = await serverListJars(folder)
  const cached = (await readAll())[siteId]?.hashes ?? {}

  const hashes: Record<string, string> = {}
  const fresh: Record<string, string> = {}
  const pending = entries.filter((e) => !cached[hashKey(remoteJoin(folder, e.name), e.size)] && e.size <= MAX_IDENTIFY_BYTES)

  for (const e of entries) {
    const key = hashKey(remoteJoin(folder, e.name), e.size)
    if (cached[key]) hashes[e.name] = cached[key]
  }

  let done = 0
  onProgress(done, pending.length)
  // En SFTP se leen varios a la vez; en FTP la cola los pone en fila igualmente,
  // pero cada uno en su turno, así que navegar por carpetas no se queda esperando
  await pool(pending, 6, async (e) => {
    try {
      const data = await ftpReadBytes(remoteJoin(folder, e.name))
      const sha1 = crypto.createHash('sha1').update(data).digest('hex')
      hashes[e.name] = sha1
      fresh[hashKey(remoteJoin(folder, e.name), e.size)] = sha1
    } catch { /* ilegible: se queda sin identificar */ }
    onProgress(++done, pending.length)
  })

  // Guardar lo nuevo y olvidar lo que ya no está en esta carpeta
  const present = new Set(entries.map((e) => hashKey(remoteJoin(folder, e.name), e.size)))
  const prefix = folder.replace(/\/+$/, '') + '/'
  await updateSite(siteId, (d) => {
    for (const key of Object.keys(d.hashes)) {
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/') && !present.has(key)) delete d.hashes[key]
    }
    Object.assign(d.hashes, fresh)
  })

  const byHash = await identifyByHashes([...new Set(Object.values(hashes))], minecraft, loaders).catch(() => ({} as Record<string, ServerJarMeta>))
  const result: Record<string, ServerJarMeta> = {}
  for (const [name, sha1] of Object.entries(hashes)) {
    if (byHash[sha1]) result[name] = byHash[sha1]
  }
  return result
}

// ── Instalar ────────────────────────────────────────────────────────────────

/**
 * Descarga un archivo de Modrinth y lo sube al servidor.
 *
 * Se baja entero a memoria y se comprueba el sha1 antes de subir nada: un jar
 * cortado en el servidor hace que no arranque, y el error que da Minecraft no
 * dice que el problema sea ese archivo.
 */
export async function serverInstallFromUrl(
  url: string, filename: string, folder: string, sha1: string | undefined,
  onProgress: (transferred: number, total: number) => void
): Promise<string> {
  if (!filename || /[\\/]/.test(filename) || filename === '..' || filename === '.') {
    throw new Error('Nombre de archivo no válido')
  }
  const siteId = currentSite()

  const res = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 120_000,
    headers: HEADERS,
    onDownloadProgress: (p) => onProgress(p.loaded, p.total ?? 0)
  })
  const data = Buffer.from(res.data)
  const actual = crypto.createHash('sha1').update(data).digest('hex')
  if (sha1 && actual !== sha1.toLowerCase()) {
    throw new Error(`La descarga de ${filename} llegó dañada. Vuelve a intentarlo.`)
  }

  const target = remoteJoin(folder, filename)
  // Si la carpeta no existe (un servidor recién creado sin mods/), se crea
  const parent = path.posix.dirname(target)
  const siblings = await ftpList(path.posix.dirname(parent)).catch(() => [] as RemoteEntry[])
  if (!siblings.some((e) => e.isDir && e.name === path.posix.basename(parent))) {
    await ftpMkdir(parent)
  }

  await ftpWriteBytes(target, data)
  await updateSite(siteId, (d) => { d.hashes[hashKey(target, data.length)] = actual })
  return target
}
