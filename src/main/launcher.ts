import { app, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import type { ChildProcess } from 'child_process'
import type { Instance, MinecraftAccount, OpDetail, Settings } from '../shared/types'
import { getSharedDir, getInstanceGameDir } from './instances'
import { ensureJava } from './java'
import { checkCancel, getAbortSignal } from './cancelToken'
import { TransferMeter } from './transferMeter'
import { EventEmitter } from 'events'
import { HORIZON_REPOS, horizonReleases, horizonInstalledTags, installHorizon, prepareHorizon, startHorizon } from './horizon'

const runningProcesses = new Map<string, ChildProcess>()

/** Arranque, líneas de registro y cierre de cada partida (lo usa el puente para IAs). */
export const gameEvents = new EventEmitter()

/** Si una instancia está abierta ahora mismo. */
export function isInstanceRunning(instanceId: string): boolean {
  return runningProcesses.has(instanceId)
}

/** PID del proceso del juego que abrió el launcher para esa instancia (lo comprueba el canal en vivo). */
export function getInstancePid(instanceId: string): number | undefined {
  return runningProcesses.get(instanceId)?.pid
}

function sendToWindow(window: BrowserWindow, channel: string, ...args: unknown[]): boolean {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return false
  window.webContents.send(channel, ...args)
  return true
}

// ── Registro de las partidas ────────────────────────────────────────────────
// Minecraft escribe miles de líneas al arrancar. Mandarlas una a una a la ventana hacía
// que la interfaz se redibujara miles de veces por segundo y el launcher se arrastraba
// con el juego abierto: ahora se agrupan y salen como mucho unas pocas veces por segundo.
// Además se guardan las últimas aquí, para que si la ventana se recarga no se pierdan.

const LOG_KEEP = 2000
const LOG_FLUSH_MS = 150
const gameLogBuffers = new Map<string, string[]>()
const pendingLogLines = new Map<string, string[]>()
let logFlushTimer: ReturnType<typeof setTimeout> | null = null
let logWindow: BrowserWindow | null = null

function flushGameLogs(): void {
  logFlushTimer = null
  if (logWindow) {
    for (const [id, lines] of pendingLogLines) sendToWindow(logWindow, 'game:log-batch', id, lines.slice(-LOG_KEEP))
  }
  pendingLogLines.clear()
}

function queueGameLog(window: BrowserWindow, instanceId: string, lines: string[]): void {
  if (lines.length === 0) return
  const kept = gameLogBuffers.get(instanceId) ?? []
  kept.push(...lines)
  if (kept.length > LOG_KEEP) kept.splice(0, kept.length - LOG_KEEP)
  gameLogBuffers.set(instanceId, kept)
  const pending = pendingLogLines.get(instanceId) ?? []
  pending.push(...lines)
  pendingLogLines.set(instanceId, pending)
  logWindow = window
  if (!logFlushTimer) logFlushTimer = setTimeout(flushGameLogs, LOG_FLUSH_MS)
}

/** Partidas abiertas ahora mismo con su registro, para que la ventana se ponga al día al cargar. */
export function getRunningSnapshot(): { id: string; logs: string[] }[] {
  return [...runningProcesses.keys()].map((id) => ({ id, logs: gameLogBuffers.get(id) ?? [] }))
}

/** Parte la salida en líneas completas: un trozo puede acabar a mitad de línea. */
function lineSplitter(onLines: (lines: string[]) => void): (buf: Buffer) => void {
  let rest = ''
  return (buf) => {
    const parts = (rest + buf.toString()).split(/\r?\n/)
    rest = parts.pop() ?? ''
    if (rest.length > 8192) { parts.push(rest); rest = '' }
    onLines(parts.filter(Boolean))
  }
}

/**
 * Busca ficheros de 0 bytes bajo `dir`.
 *
 * Una descarga que falla a medias puede dejar el fichero creado y vacío. La
 * revalidación de @xmcl/installer no siempre los vuelve a pedir, y Minecraft
 * arranca sin quejarse: el pack.mcmeta vanilla se lee como JSON vacío y las
 * texturas fallan con "PNG header missing", así que el juego se ve todo negro
 * sin ningún error visible.
 */
async function findEmptyFiles(dir: string): Promise<string[]> {
  const found: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await findEmptyFiles(full)))
    } else if (entry.isFile()) {
      const stat = await fs.stat(full).catch(() => null)
      if (stat?.size === 0) found.push(full)
    }
  }
  return found
}

/** Borra los assets vacíos para que installDependencies los vuelva a descargar. */
async function pruneEmptyAssets(sharedDir: string): Promise<number> {
  const empty = await findEmptyFiles(path.join(sharedDir, 'assets', 'objects'))
  await Promise.all(empty.map((file) => fs.remove(file)))
  return empty.length
}

type ResolvedVersion = Awaited<ReturnType<typeof import('@xmcl/core').Version.parse>>

/**
 * Concurrencia de descarga por intento, de más a menos agresiva.
 *
 * En conexiones que no aguantan 8 descargas en paralelo, undici corta con
 * "Connect Timeout Error" en la mayoría de assets pero deja pasar unos pocos:
 * un caso real bajó de 4267 a 4066 vacíos en una sola pasada. installDependencies
 * no reintenta, agrega los fallos y termina, así que cada intento avanzaba unos
 * cientos y el usuario tenía que pulsar Reparar una y otra vez. Reintentando con
 * menos paralelismo cada vez, la descarga acaba completándose sola.
 */
const ASSET_CONCURRENCY_STEPS = [8, 4, 2, 1]

/**
 * Tope de rondas de descarga de assets.
 *
 * Cuatro no bastaban en una máquina donde cada pasada recuperaba entre 150 y
 * 200 assets de 4267: avanzaba de verdad (4267 → 4066 → 3949 → 3780), pero se
 * rendía mucho antes de terminar y había que pulsar Reparar una y otra vez.
 *
 * En una máquina sana esto no cambia nada: la primera ronda termina sin errores
 * y se sale. Solo entran más rondas cuando ya está fallando, y se corta en
 * cuanto una ronda no recupera nada.
 */
const MAX_ASSET_ROUNDS = 40


/** Devuelve los sub-errores de un AggregateError, o null si no lo es. */
function aggregateErrors(e: unknown): unknown[] | null {
  const isAggregate = e instanceof AggregateError || (e && typeof e === 'object' && 'errors' in e)
  if (!isAggregate) return null
  return (e as { errors: unknown[] }).errors ?? []
}

/**
 * Vuelca al log el detalle de los primeros fallos.
 *
 * El chip del panel trunca el mensaje justo donde empieza lo util: undici pone
 * las direcciones que intento en "Connect Timeout Error (attempted addresses:
 * ...)", y sin eso no se puede distinguir un bloqueo de red de un timeout corto.
 */
function logDownloadFailures(errors: unknown[], note?: (msg: string) => void): void {
  for (const err of errors.slice(0, 3)) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error(`[assets] ${msg}`)
  }
  if (errors.length > 3) console.error(`[assets] ...y ${errors.length - 3} fallos más`)
  note?.(`${errors.length} asset(s) fallaron. Detalle en la Consola del Launcher.`)
}

/**
 * Tiempo sin recibir ni un byte tras el cual una ronda de descarga se da por colgada.
 * Antes una conexión que se quedaba a medias dejaba la barra en 33% para siempre.
 */
const DEPS_STALL_MS = 60_000
/** Rondas colgadas seguidas tras las que se deja de insistir. */
const MAX_STALLED_ROUNDS = 3

/** Cuenta los ficheros que faltan o no tienen el tamaño esperado (sin calcular hashes). */
async function countMismatched(items: { file: string; size?: number }[]): Promise<number> {
  let bad = 0
  for (let i = 0; i < items.length; i += 200) {
    const res = await Promise.all(items.slice(i, i + 200).map(async (it) => {
      const st = await fs.stat(it.file).catch(() => null)
      return !st || (it.size ? st.size !== it.size : st.size === 0)
    }))
    bad += res.filter(Boolean).length
  }
  return bad
}

/**
 * Comprobación rápida de assets y librerías mirando solo si existen y su tamaño.
 *
 * La verificación completa calcula el hash de miles de ficheros (≈600 MB en versiones
 * modernas) y tarda bastante: hacerla en cada arranque es lo que dejaba «Verificando
 * assets y librerías» un buen rato en instancias que ya lo tenían todo. Si el tamaño de
 * todo cuadra se arranca directamente; Reparar sigue haciendo la verificación completa.
 *
 * Devuelve null si ni siquiera está el índice de assets (instalación nueva).
 */
async function quickDependencyCheck(
  v: ResolvedVersion,
  sharedDir: string
): Promise<{ missingAssets: number; missingLibraries: number } | null> {
  const indexes = path.join(sharedDir, 'assets', 'indexes')
  const candidates = [v.assetIndex?.sha1, v.assetIndex?.id, v.assets].filter((x): x is string => !!x)
  let objects: Record<string, { hash: string; size: number }> | null = null
  for (const id of candidates) {
    try { objects = (await fs.readJson(path.join(indexes, `${id}.json`))).objects ?? null } catch { /* siguiente */ }
    if (objects) break
  }
  if (!objects) return null

  const assetItems = Object.values(objects).map((o) => ({
    file: path.join(sharedDir, 'assets', 'objects', o.hash.slice(0, 2), o.hash),
    size: o.size
  }))
  const libItems = v.libraries
    .filter((l) => l.download?.path)
    // Fabric/Quilt no dicen el tamaño de sus librerías (viene como -1): entonces basta con que exista
    .map((l) => ({ file: path.join(sharedDir, 'libraries', l.download.path), size: l.download.size > 0 ? l.download.size : undefined }))

  return {
    missingAssets: await countMismatched(assetItems),
    missingLibraries: await countMismatched(libItems)
  }
}

interface DepsReporter {
  /** Hechos sueltos que merece la pena dejar escritos (van también a la consola). */
  note?: (msg: string) => void
  /** Progreso continuo: fracción 0..1 (o null si aún no se sabe el total) y detalle. */
  progress?: (msg: string, fraction: number | null, detail?: OpDetail) => void
}

/**
 * Instala assets y librerías con reintentos y progreso real (bytes, velocidad, tiempo
 * restante). Entre intentos borra los ficheros que quedaron a 0 bytes, que es lo que
 * deja una descarga cortada a medias, y baja el número de descargas a la vez.
 *
 * Un fallo en una librería net.minecraft aborta de inmediato: sin ella el juego
 * no arranca y reintentar no aporta nada.
 */
async function installDependenciesWithRetry(
  resolvedVersion: ResolvedVersion,
  sharedDir: string,
  report: DepsReporter = {},
  opts: { full?: boolean } = {}
): Promise<void> {
  const { note, progress } = report

  if (!opts.full) {
    progress?.('Comprobando assets y librerías...', null, { phase: 'Comprobación rápida' })
    const quick = await quickDependencyCheck(resolvedVersion, sharedDir)
    if (quick && quick.missingAssets === 0 && quick.missingLibraries === 0) {
      note?.('Assets y librerías ya instalados, no hace falta descargar nada.')
      progress?.('Assets y librerías listos', 1)
      return
    }
    note?.(quick
      ? `Faltan ${quick.missingAssets} assets y ${quick.missingLibraries} librerías: se descargan.`
      : 'Primera vez con esta versión: se descargan los assets y librerías.')
  }

  const { installDependenciesTask } = await import('@xmcl/installer')
  let lastError: unknown
  let previousFailures = Infinity
  let rounds = 0
  let stalledRounds = 0

  for (let round = 0; round < MAX_ASSET_ROUNDS; round++) {
    rounds = round + 1
    checkCancel()
    const concurrency =
      ASSET_CONCURRENCY_STEPS[Math.min(round, ASSET_CONCURRENCY_STEPS.length - 1)]
    const pruned = await pruneEmptyAssets(sharedDir)
    if (pruned > 0) note?.(`${pruned} asset(s) vacíos, se vuelven a descargar...`)
    if (round > 0) note?.(`Ronda ${rounds}: ${concurrency} descarga(s) a la vez.`)

    const task = installDependenciesTask(resolvedVersion, {
      assetsDownloadConcurrency: concurrency,
      librariesDownloadConcurrency: concurrency,
      skipRevalidate: false
    })
    const meter = new TransferMeter()
    let lastBytes = -1
    let lastMoveAt = Date.now()
    const roundStart = Date.now()
    let verifyShare = 0
    let stalled = false
    const signal = getAbortSignal()
    const onAbort = (): void => { task.cancel().catch(() => {}) }
    signal?.addEventListener('abort', onAbort)
    const tick = setInterval(() => {
      const bytes = task.progress
      const total = task.total
      if (bytes !== lastBytes) { lastBytes = bytes; lastMoveAt = Date.now() }
      const speed = meter.sample(bytes)
      const idle = Math.round((Date.now() - lastMoveAt) / 1000)
      // Mientras comprueba los archivos que ya hay (hash de cada uno) los bytes no se mueven:
      // con el disco «frío» puede tardar un rato y no es un atasco. El vigilante solo cuenta
      // cuando ya han empezado a llegar datos.
      const verifying = bytes === 0
      const elapsed = Math.round((Date.now() - roundStart) / 1000)
      // La verificación no dice cuánto le falta: la barra avanza poco a poco (hasta un 60%
      // de este tramo) para que se vea que sigue; las descargas llenan el resto.
      if (verifying) verifyShare = 0.6 * (1 - Math.exp(-elapsed / 20))
      const fraction = verifying
        ? verifyShare
        : verifyShare + (1 - verifyShare) * (total > 0 ? Math.min(1, bytes / total) : 0)
      progress?.(
        verifying
          ? `Verificando los archivos que ya tienes... (${elapsed} s)`
          : idle >= 10
            ? `Sin recibir datos desde hace ${idle} s...`
            : `Descargando assets y librerías${round > 0 ? ` (ronda ${rounds})` : ''}...`,
        fraction,
        verifying
          ? { phase: 'Verificación de archivos' }
          : { phase: 'Assets y librerías', bytes, totalBytes: total || undefined, speed, eta: TransferMeter.eta(bytes, total, speed) }
      )
      if (!verifying && Date.now() - lastMoveAt > DEPS_STALL_MS && !stalled) {
        stalled = true
        task.cancel().catch(() => {})
      }
    }, 500)

    try {
      await task.startAndWait()
      note?.(`Assets y librerías listos (${((Date.now() - roundStart) / 1000).toFixed(1)} s).`)
      lastError = undefined
      break
    } catch (e) {
      checkCancel()
      if (stalled) {
        stalledRounds++
        lastError = e
        note?.(`La descarga lleva ${DEPS_STALL_MS / 1000} s sin recibir datos: se reintenta con menos descargas a la vez.`)
        if (stalledRounds >= MAX_STALLED_ROUNDS) {
          throw new Error(
            `La descarga de assets y librerías se quedó parada ${MAX_STALLED_ROUNDS} veces seguidas. ` +
              'Suele ser la conexión, un antivirus o un firewall bloqueando resources.download.minecraft.net.'
          )
        }
        continue
      }
      stalledRounds = 0
      const errors = aggregateErrors(e)
      if (!errors) throw e

      const hasCritical = errors.some((err) => {
        const msg = String(err instanceof Error ? err.message : err)
        return msg.includes('net.minecraft') || msg.includes('net/minecraft')
      })
      if (hasCritical) throw e

      lastError = e
      logDownloadFailures(errors, note)

      // Si una ronda no recupera nada, insistir no lleva a ningún sitio: se
      // corta aquí en vez de agotar las 40 haciendo perder el tiempo.
      if (errors.length >= previousFailures) {
        note?.('La descarga no avanza, se deja de reintentar.')
        break
      }
      previousFailures = errors.length
      note?.(`Ronda ${rounds}: quedan ${errors.length} por descargar, reintentando...`)
    } finally {
      clearInterval(tick)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  // Da igual si el último intento "terminó bien": lo que decide es que no queden
  // ficheros vacíos, porque son los que dejan el juego en negro.
  const stillEmpty = await findEmptyFiles(path.join(sharedDir, 'assets', 'objects'))
  if (stillEmpty.length > 0) {
    const detail = aggregateErrors(lastError)?.length
      ? ` Último error: ${String((aggregateErrors(lastError)![0] as Error)?.message ?? '')}`.slice(0, 200)
      : ''
    throw new Error(
      `${stillEmpty.length} assets no se pudieron descargar tras ${rounds} rondas. ` +
        `El juego se vería en negro.${detail}`
    )
  }
}

/** Si hay alguna instancia de Minecraft abierta ahora mismo. */
export function hasRunningInstances(): boolean {
  return runningProcesses.size > 0
}

export function killInstance(instanceId: string): void {
  const proc = runningProcesses.get(instanceId)
  if (proc) {
    proc.kill()
    runningProcesses.delete(instanceId)
  }
}

export async function installMinecraftVersion(
  version: string,
  onProgress?: (current: number, total: number, msg: string) => void
): Promise<void> {
  const sharedDir = getSharedDir()
  const versionJson = path.join(sharedDir, 'versions', version, `${version}.json`)
  const versionJar  = path.join(sharedDir, 'versions', version, `${version}.jar`)

  if (await fs.pathExists(versionJson) && await fs.pathExists(versionJar)) {
    onProgress?.(1, 1, 'Versión ya instalada')
    return
  }

  onProgress?.(0, 3, 'Obteniendo lista de versiones...')

  const { getVersionList, install } = await import('@xmcl/installer')
  const list = await getVersionList()
  const versionInfo = list.versions.find((v) => v.id === version)
  if (!versionInfo) throw new Error(`Versión de Minecraft ${version} no encontrada`)

  checkCancel()
  onProgress?.(1, 3, `Descargando Minecraft ${version}...`)
  await install(versionInfo, sharedDir)

  onProgress?.(3, 3, `Minecraft ${version} instalado!`)
}

export async function installModloader(
  instance: Instance,
  onProgress?: (current: number, total: number, msg: string) => void,
  javaPath?: string
): Promise<void> {
  const sharedDir = getSharedDir()

  if (instance.modloader === 'forge' && instance.modloaderVersion) {
    onProgress?.(0, 2, 'Instalando Forge...')
    const { installForge } = await import('@xmcl/installer')
    await installForge({ mcversion: instance.minecraft, version: instance.modloaderVersion }, sharedDir)
    onProgress?.(2, 2, 'Forge instalado!')
  } else if (instance.modloader === 'fabric' && instance.modloaderVersion) {
    onProgress?.(0, 2, 'Instalando Fabric...')
    const versionId = `fabric-loader-${instance.modloaderVersion}-${instance.minecraft}`
    const destJson  = path.join(sharedDir, 'versions', versionId, `${versionId}.json`)
    // Try @xmcl/installer first; some newer MC versions cause it to fail silently or use a different id
    try {
      const { installFabric } = await import('@xmcl/installer')
      await installFabric({ minecraftVersion: instance.minecraft, version: instance.modloaderVersion, minecraft: sharedDir })
    } catch { /* fall through to direct download */ }
    // Fallback: download profile JSON directly from Fabric meta API if the file still doesn't exist
    if (!(await fs.pathExists(destJson))) {
      const axios = (await import('axios')).default
      const { data } = await axios.get(
        `https://meta.fabricmc.net/v2/versions/loader/${instance.minecraft}/${instance.modloaderVersion}/profile/json`,
        { timeout: 20_000 }
      )
      // Ensure id matches our expected versionId so Version.parse can resolve it
      data.id = versionId
      await fs.ensureDir(path.dirname(destJson))
      await fs.writeJson(destJson, data, { spaces: 2 })
    }
    onProgress?.(2, 2, 'Fabric instalado!')
  } else if (instance.modloader === 'quilt' && instance.modloaderVersion) {
    onProgress?.(0, 2, 'Instalando Quilt...')
    const qVersionId = `quilt-loader-${instance.modloaderVersion}-${instance.minecraft}`
    const qDestJson  = path.join(sharedDir, 'versions', qVersionId, `${qVersionId}.json`)
    try {
      const { installQuiltVersion } = await import('@xmcl/installer')
      await installQuiltVersion({ minecraftVersion: instance.minecraft, version: instance.modloaderVersion, minecraft: sharedDir })
    } catch { /* fall through to direct download */ }
    if (!(await fs.pathExists(qDestJson))) {
      const axios = (await import('axios')).default
      const { data } = await axios.get(
        `https://meta.quiltmc.org/v3/versions/loader/${instance.minecraft}/${instance.modloaderVersion}/profile/json`,
        { timeout: 20_000 }
      )
      data.id = qVersionId
      await fs.ensureDir(path.dirname(qDestJson))
      await fs.writeJson(qDestJson, data, { spaces: 2 })
    }
    onProgress?.(2, 2, 'Quilt instalado!')
  } else if (instance.modloader === 'neoforge' && instance.modloaderVersion) {
    onProgress?.(0, 2, 'Instalando NeoForge...')
    const { installNeoForged } = await import('@xmcl/installer')
    await installNeoForged('neoforge', instance.modloaderVersion, sharedDir, javaPath ? { java: javaPath } : {})
    onProgress?.(2, 2, 'NeoForge instalado!')
  }
}

export async function launchInstance(
  instance: Instance,
  account: MinecraftAccount,
  settings: Settings,
  mainWindow: BrowserWindow,
  onProgress?: (current: number, total: number, msg: string, detail?: OpDetail) => void,
  onExit?: (sessionMs: number) => void,
  options?: { suppressEvents?: boolean }
): Promise<void> {
  // La barra va de 0 a 100 y solo avanza: cada fase tiene su tramo y el 100 llega cuando
  // el juego ya está abierto, no al lanzar el proceso. Antes saltaba por pasos (33%… y de
  // golpe se abría) sin decir nada mientras tanto.
  //   0-2 preparar · 2-20 Minecraft · 20-30 Java · 30-38 loader · 38-80 assets y librerías
  //   80-85 lanzar · 85-100 el juego cargando hasta el menú principal
  let shown = 0
  const report = (pct: number, msg: string, detail?: OpDetail): void => {
    shown = Math.max(shown, Math.min(100, pct))
    onProgress?.(Math.round(shown * 10) / 10, 100, msg, detail)
  }
  report(1, 'Preparando lanzamiento...')

  const sharedDir = getSharedDir()
  if (!options?.suppressEvents) {
    // Partida nueva: el registro empieza de cero (también en la ventana)
    gameLogBuffers.set(instance.id, [])
    pendingLogLines.delete(instance.id)
    sendToWindow(mainWindow, 'game:log-reset', instance.id)
  }
  // Cada paso queda escrito con su hora en la consola del juego y en la del launcher:
  // si algo se atasca, se ve exactamente en qué punto.
  const startedAt = Date.now()
  const note = (msg: string): void => {
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`[Arranque ${instance.name}] +${secs}s ${msg}`)
    if (!options?.suppressEvents) queueGameLog(mainWindow, instance.id, [`[Launcher +${secs}s] ${msg}`])
  }

  // 1. Ensure Minecraft version JSON + jar are installed
  const versionJson = path.join(sharedDir, 'versions', instance.minecraft, `${instance.minecraft}.json`)
  const versionJar  = path.join(sharedDir, 'versions', instance.minecraft, `${instance.minecraft}.jar`)
  if (!(await fs.pathExists(versionJson)) || !(await fs.pathExists(versionJar))) {
    note(`Minecraft ${instance.minecraft} no está instalado: se descarga.`)
    await installMinecraftVersion(instance.minecraft, (c, t, msg) => report(2 + 18 * (c / Math.max(t, 1)), msg, { phase: 'Minecraft' }))
  } else {
    note(`Minecraft ${instance.minecraft} ya instalado.`)
  }

  checkCancel()

  // 2. Resolve Java early — NeoForge post-processors need it during install
  report(20, 'Verificando Java...', { phase: 'Java' })
  let javaPath = instance.javaPath || settings.javaPath
  if (javaPath && path.isAbsolute(javaPath) && !(await fs.pathExists(javaPath))) {
    note(`El Java configurado ya no existe (${javaPath}): se busca otro.`)
    javaPath = ''
  }
  if (!javaPath) {
    javaPath = await ensureJava(instance.minecraft, (current, total, msg) => {
      report(20 + (total > 0 ? Math.min(1, current / total) : 0) * 10, msg, { phase: 'Java' })
    })
  }
  if (!javaPath) throw new Error('No se pudo encontrar ni instalar Java. Configúralo manualmente en Ajustes.')
  note(`Java: ${javaPath}`)
  report(30, 'Java listo', { phase: 'Java' })

  checkCancel()

  // 3. Ensure modloader is installed (passes javaPath for NeoForge post-processors)
  if (instance.modloader !== 'vanilla' && instance.modloaderVersion) {
    const loaderVersionId = resolveVersionId(instance)
    const loaderJson = path.join(sharedDir, 'versions', loaderVersionId, `${loaderVersionId}.json`)
    if (!(await fs.pathExists(loaderJson))) {
      note(`Instalando ${instance.modloader} ${instance.modloaderVersion}...`)
      report(31, `Instalando ${instance.modloader}...`, { phase: instance.modloader })
      await installModloader(instance, (c, t, msg) => report(31 + 7 * (c / Math.max(t, 1)), msg, { phase: instance.modloader }), javaPath)
    }
  }
  report(38, 'Comprobando assets y librerías...')

  checkCancel()

  // 4. Assets y librerías: comprobación rápida y, si falta algo, descarga con progreso real.
  const { Version } = await import('@xmcl/core')
  const versionId = resolveVersionId(instance)
  const resolvedVersion = await Version.parse(sharedDir, versionId)

  await installDependenciesWithRetry(resolvedVersion, sharedDir, {
    note,
    progress: (msg, fraction, detail) => report(38 + 42 * (fraction ?? 0), msg, detail)
  })

  checkCancel()

  // 5. Prepare instance game directory
  report(81, 'Preparando directorios...')
  const gameDir = await getInstanceGameDir(instance.id)
  await fs.ensureDir(path.join(gameDir, 'mods'))

  // 6. Launch
  report(83, 'Lanzando el juego...', { phase: 'Abriendo Minecraft' })
  note('Lanzando el juego...')
  const { launch } = await import('@xmcl/core')

  // Parse extra JVM args per instance
  const extraJVMArgs = instance.jvmArgs?.trim()
    ? instance.jvmArgs.split('\n').flatMap(l => l.trim().split(/\s+/)).filter(Boolean)
    : []
  // Canal en vivo (mod fport1-social): dónde está el puente para IAs y qué instancia es.
  // Es el mismo ai-bridge.json que escribe aiBridge.ts. Sin el mod no hace nada.
  extraJVMArgs.push(
    `-Dfport1.bridge=${path.join(app.getPath('userData'), 'ai-bridge.json')}`,
    `-Dfport1.instance=${instance.id}`
  )

  // Resolve target display position for multi-monitor support
  const extraMCArgs: string[] = []
  if (instance.displayId !== undefined && instance.displayId > 0) {
    const { screen } = await import('electron')
    const display = screen.getAllDisplays().find(d => d.id === instance.displayId)
    if (display) {
      extraMCArgs.push('--x', String(display.bounds.x), '--y', String(display.bounds.y))
    }
  }

  const launchOpts: Record<string, unknown> = {
    gamePath: gameDir,
    resourcePath: sharedDir,
    javaPath,
    version: versionId,
    gameProfile: { id: account.uuid, name: account.username },
    accessToken: account.accessToken,
    userType: account.type === 'microsoft' ? 'mojang' : 'legacy',
    maxMemory: instance.maxMemory ?? settings.maxMemory,
    minMemory: instance.minMemory ?? settings.minMemory,
    launcherName: 'ModpackLauncher',
    launcherBrand: 'ModpackLauncher',
    extraExecOption: { stdio: ['ignore', 'pipe', 'pipe'] },
    ...(extraJVMArgs.length > 0 ? { extraJVMArgs } : {}),
    ...(extraMCArgs.length > 0 ? { extraMCArgs } : {})
  }
  if (instance.width && instance.height) {
    launchOpts.width = instance.width
    launchOpts.height = instance.height
  }
  const proc = instance.kind === 'horizon'
    ? await launchHorizonGame(instance, account, sharedDir, javaPath, gameDir, report, note)
    : await launch(launchOpts as unknown as Parameters<typeof launch>[0])

  const extra = options?.suppressEvents === true
  if (!extra) {
    runningProcesses.set(instance.id, proc)
    if (settings.closeOnLaunch && !mainWindow.isDestroyed()) mainWindow.minimize()
  }

  const sessionStart = Date.now()
  const onLines = (lines: string[]): void => {
    if (!extra) queueGameLog(mainWindow, instance.id, lines)
    for (const line of lines) gameEvents.emit('log', instance.id, line)
  }
  if (!extra) sendToWindow(mainWindow, 'game:started', instance.id)
  gameEvents.emit('start', instance.id)

  proc.stdout?.on('data', lineSplitter(onLines))
  proc.stderr?.on('data', lineSplitter(onLines))
  proc.on('exit', (code) => {
    gameEvents.emit('exit', instance.id, code)
    if (!extra) {
      runningProcesses.delete(instance.id)
      flushGameLogs()
      sendToWindow(mainWindow, 'game:exit', instance.id, code)
      if (settings.closeOnLaunch && !mainWindow.isDestroyed()) mainWindow.restore()
    }
    onExit?.(Date.now() - sessionStart)
  })

  if (extra) return
  if (instance.kind === 'horizon') {
    // Horizon abre en segundos y no escribe las líneas de Minecraft que se esperan abajo
    await new Promise((r) => setTimeout(r, 3000))
    if (proc.exitCode !== null && proc.exitCode !== 0) throw new Error(`Horizon se cerró al arrancar (código ${proc.exitCode}). Mira la consola de la instancia.`)
    report(100, '¡Horizon abierto!')
    return
  }
  report(85, 'Abriendo Minecraft...', { phase: 'Cargando el juego' })
  note('Proceso del juego en marcha; esperando a que cargue.')
  await waitUntilLoaded(instance.id, proc, (pct, msg) => report(pct, msg, { phase: 'Cargando el juego' }))
  note('El juego terminó de cargar.')
}

/** Líneas que el juego escribe cuando ya está en el menú principal (vanilla, Fabric, Forge…). */
const GAME_READY = /Sound engine started|OpenAL initialized|Created: \d+x\d+x\d+ minecraft:textures\/atlas\/(blocks|gui)|Narrator library (successfully loaded|for .* successfully loaded)/i
/** Si no aparece ninguna, se da por abierto pasado este tiempo. */
const GAME_READY_TIMEOUT_MS = 4 * 60_000

/**
 * Espera a que el juego llegue al menú principal leyendo su registro, y mientras tanto
 * va subiendo la barra de 85 a 99 según avanza (cada línea es un paso más de la carga).
 * Si el juego se cierra antes, con error, se avisa en vez de decir «abierto».
 */
function waitUntilLoaded(
  instanceId: string,
  proc: ChildProcess,
  report: (pct: number, msg: string) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let lines = 0
    let mods: number | null = null
    let settled = false
    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      gameEvents.off('log', onLog)
      proc.off('exit', onExit)
      if (err) reject(err)
      else resolve()
    }
    const onLog = (id: string, line: string): void => {
      if (id !== instanceId) return
      lines++
      const m = line.match(/Loading (\d+) mods/i)
      if (m) mods = Number(m[1])
      if (GAME_READY.test(line)) {
        report(100, '¡Minecraft abierto!')
        finish()
        return
      }
      // Sube rápido al principio y cada vez más despacio, sin llegar nunca al 100 por sí sola
      const pct = 85 + 14 * (1 - Math.exp(-lines / 350))
      report(pct, mods ? `Cargando ${mods} mods...` : 'Cargando Minecraft...')
    }
    const onExit = (code: number | null): void => {
      if (code === 0) { report(100, 'Minecraft se cerró'); finish(); return }
      finish(new Error(`Minecraft se cerró mientras arrancaba (código ${code ?? '?'}). Mira la consola de la instancia para ver el motivo.`))
    }
    const timer = setTimeout(() => { report(100, 'Minecraft abierto'); finish() }, GAME_READY_TIMEOUT_MS)
    gameEvents.on('log', onLog)
    proc.once('exit', onExit)
    // Cancelar aquí solo deja de esperar: el juego ya está abierto y sigue
    getAbortSignal()?.addEventListener('abort', () => finish(), { once: true })
  })
}

/**
 * Horizon: Minecraft 26.3, Java y los assets ya los ha puesto el arranque normal; aquí se baja
 * la versión de Horizon (la elegida o la más nueva), se prepara una vez y se arranca.
 */
async function launchHorizonGame(
  instance: Instance, account: MinecraftAccount, sharedDir: string, javaPath: string, gameDir: string,
  report: (pct: number, msg: string, detail?: OpDetail) => void, note: (msg: string) => void
): Promise<ChildProcess> {
  const phase = { phase: 'Horizon' }
  let tag = instance.horizonTag
  try {
    const releases = await horizonReleases()
    const rel = (tag ? releases.find((r) => r.tag === tag) : releases[0]) ?? releases[0]
    tag = rel.tag
    note(`Horizon ${rel.tag} (de ${rel.repo})`)
    await installHorizon(rel, (f, msg) => report(81 + f, msg, phase))
  } catch (e) {
    // Sin conexión: la versión que ya esté bajada
    const installed = await horizonInstalledTags()
    tag = (tag && installed.includes(tag) ? tag : installed[0])
    if (!tag) throw e
    note(`No se pudo comprobar si hay versión nueva de Horizon (${(e as Error).message}); se usa ${tag}`)
  }
  checkCancel()
  try {
    await prepareHorizon(tag, sharedDir, javaPath, (f, msg) => report(82 + 2 * f, msg, phase), (line) => note(line))
  } catch (e) {
    // Si nuestra versión no se deja preparar, que no se quede sin jugar: la oficial más nueva
    const official = HORIZON_REPOS[HORIZON_REPOS.length - 1]
    const rel = (await horizonReleases([official]).catch(() => []))[0]
    if (!rel || rel.tag === tag) throw e
    const why = (e as Error).message.split(/\r?\n/)[0]
    note(`No se pudo preparar Horizon ${tag} (${why}); se usa la oficial ${rel.tag}`)
    await installHorizon(rel, (f, msg) => report(81 + f, msg, phase))
    tag = rel.tag
    await prepareHorizon(tag, sharedDir, javaPath, (f, msg) => report(82 + 2 * f, msg, phase), (line) => note(line))
  }
  checkCancel()
  report(84, 'Abriendo Horizon...', phase)
  return startHorizon(tag, gameDir, account, { width: instance.width, height: instance.height })
}

function resolveVersionId(instance: Instance): string {
  if (instance.modloader === 'vanilla' || !instance.modloaderVersion) return instance.minecraft
  if (instance.modloader === 'forge') return `${instance.minecraft}-forge-${instance.modloaderVersion}`
  if (instance.modloader === 'fabric') return `fabric-loader-${instance.modloaderVersion}-${instance.minecraft}`
  if (instance.modloader === 'quilt') return `quilt-loader-${instance.modloaderVersion}-${instance.minecraft}`
  if (instance.modloader === 'neoforge') return `neoforge-${instance.modloaderVersion}`
  return instance.minecraft
}

export async function repairInstance(
  instance: Instance,
  settings: Settings,
  onProgress?: (current: number, total: number, msg: string, detail?: OpDetail) => void
): Promise<void> {
  const sharedDir = getSharedDir()
  const hasModpack = !!(instance.modpackUrl)
  const STEPS = hasModpack ? 5 : 4

  // 1. Ensure Java
  onProgress?.(0, STEPS, 'Verificando Java...')
  let javaPath = instance.javaPath || settings.javaPath
  if (javaPath && path.isAbsolute(javaPath) && !(await fs.pathExists(javaPath))) javaPath = ''
  if (!javaPath) {
    javaPath = await ensureJava(instance.minecraft, (c, t, msg) => onProgress?.(0, STEPS, msg))
  }
  if (!javaPath) throw new Error('No se pudo encontrar ni instalar Java.')

  // 2. Force-reinstall Minecraft version files
  onProgress?.(1, STEPS, `Reinstalando Minecraft ${instance.minecraft}...`)
  const versionJson = path.join(sharedDir, 'versions', instance.minecraft, `${instance.minecraft}.json`)
  const versionJar  = path.join(sharedDir, 'versions', instance.minecraft, `${instance.minecraft}.jar`)
  await fs.remove(versionJson).catch(() => {})
  await fs.remove(versionJar).catch(() => {})
  await installMinecraftVersion(instance.minecraft, (c, t, msg) => onProgress?.(1, STEPS, msg))

  // 3. Force-reinstall modloader
  if (instance.modloader !== 'vanilla' && instance.modloaderVersion) {
    onProgress?.(2, STEPS, `Reinstalando ${instance.modloader} ${instance.modloaderVersion}...`)
    const loaderVersionId = resolveVersionId(instance)
    await fs.remove(path.join(sharedDir, 'versions', loaderVersionId)).catch(() => {})
    await installModloader(instance, (c, t, msg) => onProgress?.(2, STEPS, msg), javaPath)
  }

  // 4. Re-verify all assets and libraries
  onProgress?.(3, STEPS, 'Verificando assets y librerías...')
  const { Version } = await import('@xmcl/core')
  const versionId = resolveVersionId(instance)
  const resolvedVersion = await Version.parse(sharedDir, versionId)
  // Reparar hace siempre la verificación completa (hash de cada fichero)
  await installDependenciesWithRetry(resolvedVersion, sharedDir, {
    note: (msg) => console.log(`[Reparar ${instance.name}] ${msg}`),
    progress: (msg, fraction, detail) => onProgress?.(3 + (fraction ?? 0) * 0.99, STEPS, msg, detail)
  }, { full: true })

  // 5. Re-verify modpack files (re-downloads corrupt or missing ones)
  if (hasModpack) {
    onProgress?.(4, STEPS, 'Verificando archivos del modpack...')
    const { fetchManifest, installModpack } = await import('./modpacks')
    const manifest = await fetchManifest(instance.modpackUrl!, instance.modpackKey)
    await installModpack(instance.id, manifest, (c, t, msg, detail) => onProgress?.(4 + (t > 0 ? c / t : 0) * 0.99, STEPS, msg, detail))
  }
}

let latestCache: { at: number; release: string; snapshot: string } | null = null

/** Última release y última snapshot de Minecraft (se recuerdan 10 minutos). */
export async function getLatestVersions(): Promise<{ release: string; snapshot: string }> {
  if (latestCache && Date.now() - latestCache.at < 10 * 60_000) return latestCache
  const axios = (await import('axios')).default
  const { data } = await axios.get(
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    { timeout: 10_000, headers: { 'User-Agent': 'ModpackLauncher/1.0' } }
  )
  latestCache = { at: Date.now(), release: data.latest.release, snapshot: data.latest.snapshot }
  return latestCache
}

/**
 * Si la instancia sigue «la última versión», la pone al día antes de jugar. Con Forge o
 * NeoForge no se hace: su versión depende de la de Minecraft y se rompería.
 * Devuelve true si cambió algo. Sin internet se juega con la que había.
 */
export async function applyVersionTrack(instance: Instance): Promise<boolean> {
  if (!instance.versionTrack || instance.modloader === 'forge' || instance.modloader === 'neoforge') return false
  try {
    const latest = await getLatestVersions()
    const target = latest[instance.versionTrack]
    if (!target || target === instance.minecraft) return false
    console.log(`[Versiones] ${instance.name}: ${instance.minecraft} → ${target} (sigue la última ${instance.versionTrack === 'snapshot' ? 'snapshot' : 'versión'})`)
    instance.minecraft = target
    return true
  } catch {
    return false
  }
}

export async function getAvailableVersions(): Promise<
  Array<{ id: string; type: string; releaseTime: string }>
> {
  const axios = (await import('axios')).default
  const { data } = await axios.get(
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    { timeout: 10_000, headers: { 'User-Agent': 'ModpackLauncher/1.0' } }
  )
  return (data.versions as Array<{ id: string; type: string; releaseTime: string }>)
    .filter(v => v.type === 'release' || v.type === 'snapshot')
}

export async function getForgeVersions(minecraft: string): Promise<string[]> {
  const axios = (await import('axios')).default
  try {
    const { data } = await axios.get<string>(
      'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
      { timeout: 10_000, responseType: 'text', headers: { 'User-Agent': 'ModpackLauncher/1.0' } }
    )
    const prefix = `${minecraft}-`
    const versions: string[] = []
    const regex = /<version>([^<]+)<\/version>/g
    let match
    while ((match = regex.exec(data)) !== null) {
      const v = match[1]
      if (!v.startsWith(prefix)) continue
      let forgeVer = v.slice(prefix.length)
      // Old format: 1.7.10-10.13.4.1614-1.7.10 → strip trailing -minecraft suffix
      if (forgeVer.endsWith(`-${minecraft}`)) forgeVer = forgeVer.slice(0, forgeVer.length - minecraft.length - 1)
      versions.push(forgeVer)
    }
    return versions.reverse()
  } catch {
    return []
  }
}

export async function getFabricVersions(): Promise<Array<{ version: string; stable: boolean }>> {
  const { getFabricLoaders } = await import('@xmcl/installer')
  const loaders = await getFabricLoaders()
  return loaders.map((v) => ({ version: v.version, stable: v.stable }))
}

export async function getQuiltVersions(): Promise<string[]> {
  const { getQuiltLoaders } = await import('@xmcl/installer')
  const loaders = await getQuiltLoaders()
  return loaders.map((v: { version: string }) => v.version)
}

export async function getNeoForgeVersions(minecraft: string): Promise<string[]> {
  const axios = (await import('axios')).default
  const { data } = await axios.get<{ versions: string[] }>(
    'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge',
    { timeout: 10_000 }
  )
  const parts = minecraft.split('.')
  const prefix = `${parts[1] ?? '0'}.${parts[2] ?? '0'}.`
  return (data.versions ?? [])
    .filter((v) => v.startsWith(prefix))
    .reverse()
}
