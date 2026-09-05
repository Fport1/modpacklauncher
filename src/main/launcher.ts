import { BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import type { ChildProcess } from 'child_process'
import type { Instance, MinecraftAccount, Settings } from '../shared/types'
import { getSharedDir, getInstanceGameDir } from './instances'
import { ensureJava } from './java'
import { checkCancel } from './cancelToken'

const runningProcesses = new Map<string, ChildProcess>()

function sendToWindow(window: BrowserWindow, channel: string, ...args: unknown[]): boolean {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return false
  window.webContents.send(channel, ...args)
  return true
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
 * installDependencies con reintentos. Entre intentos borra los ficheros que
 * quedaron a 0 bytes, que es lo que deja una descarga cortada a medias.
 *
 * Un fallo en una librería net.minecraft aborta de inmediato: sin ella el juego
 * no arranca y reintentar no aporta nada.
 */
async function installDependenciesWithRetry(
  resolvedVersion: ResolvedVersion,
  sharedDir: string,
  note?: (msg: string) => void
): Promise<void> {
  const { installDependencies } = await import('@xmcl/installer')
  let lastError: unknown
  let previousFailures = Infinity
  let rounds = 0

  for (let round = 0; round < MAX_ASSET_ROUNDS; round++) {
    rounds = round + 1
    checkCancel()
    const concurrency =
      ASSET_CONCURRENCY_STEPS[Math.min(round, ASSET_CONCURRENCY_STEPS.length - 1)]
    const pruned = await pruneEmptyAssets(sharedDir)
    if (pruned > 0) note?.(`${pruned} asset(s) vacíos, se vuelven a descargar...`)

    try {
      await installDependencies(resolvedVersion, {
        assetsDownloadConcurrency: concurrency,
        skipRevalidate: false
      })
      lastError = undefined
      break
    } catch (e) {
      checkCancel()
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
  onProgress?: (current: number, total: number, msg: string) => void,
  onExit?: (sessionMs: number) => void,
  options?: { suppressEvents?: boolean }
): Promise<void> {
  onProgress?.(0, 6, 'Preparando lanzamiento...')

  const sharedDir = getSharedDir()

  // 1. Ensure Minecraft version JSON + jar are installed
  const versionJson = path.join(sharedDir, 'versions', instance.minecraft, `${instance.minecraft}.json`)
  const versionJar  = path.join(sharedDir, 'versions', instance.minecraft, `${instance.minecraft}.jar`)
  if (!(await fs.pathExists(versionJson)) || !(await fs.pathExists(versionJar))) {
    await installMinecraftVersion(instance.minecraft, onProgress)
  }

  checkCancel()

  // 2. Resolve Java early — NeoForge post-processors need it during install
  onProgress?.(1, 6, 'Verificando Java...')
  let javaPath = instance.javaPath || settings.javaPath
  if (javaPath && path.isAbsolute(javaPath) && !(await fs.pathExists(javaPath))) {
    javaPath = ''
  }
  if (!javaPath) {
    javaPath = await ensureJava(instance.minecraft, (current, total, msg) => {
      onProgress?.(1, 6, msg)
    })
  }
  if (!javaPath) throw new Error('No se pudo encontrar ni instalar Java. Configúralo manualmente en Ajustes.')

  checkCancel()

  // 3. Ensure modloader is installed (passes javaPath for NeoForge post-processors)
  if (instance.modloader !== 'vanilla' && instance.modloaderVersion) {
    const loaderVersionId = resolveVersionId(instance)
    const loaderJson = path.join(sharedDir, 'versions', loaderVersionId, `${loaderVersionId}.json`)
    if (!(await fs.pathExists(loaderJson))) {
      await installModloader(instance, onProgress, javaPath)
    }
  }

  checkCancel()

  // 4. Always verify + download assets & libraries (idempotent — skips valid files)
  const { Version } = await import('@xmcl/core')
  const versionId = resolveVersionId(instance)
  const resolvedVersion = await Version.parse(sharedDir, versionId)

  let elapsed = 0
  const timer = setInterval(() => {
    elapsed += 3
    onProgress?.(2, 6, `Descargando assets y librerías... (${elapsed}s)`)
  }, 3000)
  onProgress?.(2, 6, 'Verificando assets y librerías...')

  try {
    await installDependenciesWithRetry(resolvedVersion, sharedDir, (msg) => {
      sendToWindow(mainWindow, 'game:log', instance.id, `[Launcher] ${msg}`)
      onProgress?.(2, 6, msg)
    })
  } finally {
    clearInterval(timer)
  }

  checkCancel()

  // Java already resolved in step 2 — javaPath is guaranteed non-empty here
  onProgress?.(4, 6, 'Java listo.')

  checkCancel()

  // 5. Prepare instance game directory
  onProgress?.(5, 6, 'Preparando directorios...')
  const gameDir = await getInstanceGameDir(instance.id)
  await fs.ensureDir(path.join(gameDir, 'mods'))

  // 6. Launch
  onProgress?.(6, 6, 'Lanzando juego...')
  const { launch } = await import('@xmcl/core')

  // Parse extra JVM args per instance
  const extraJVMArgs = instance.jvmArgs?.trim()
    ? instance.jvmArgs.split('\n').flatMap(l => l.trim().split(/\s+/)).filter(Boolean)
    : []

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
  const proc = await launch(launchOpts as unknown as Parameters<typeof launch>[0])

  const extra = options?.suppressEvents === true
  if (!extra) {
    runningProcesses.set(instance.id, proc)
    if (settings.closeOnLaunch && !mainWindow.isDestroyed()) mainWindow.minimize()
  }

  const sessionStart = Date.now()
  const sendLog = (line: string) => {
    if (!extra) sendToWindow(mainWindow, 'game:log', instance.id, line)
  }
  if (!extra) sendToWindow(mainWindow, 'game:started', instance.id)

  proc.stdout?.on('data', (buf) =>
    buf.toString().split('\n').filter(Boolean).forEach(sendLog)
  )
  proc.stderr?.on('data', (buf) =>
    buf.toString().split('\n').filter(Boolean).forEach(sendLog)
  )
  proc.on('exit', (code) => {
    if (!extra) {
      runningProcesses.delete(instance.id)
      sendToWindow(mainWindow, 'game:exit', instance.id, code)
      if (settings.closeOnLaunch && !mainWindow.isDestroyed()) mainWindow.restore()
    }
    onExit?.(Date.now() - sessionStart)
  })
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
  onProgress?: (current: number, total: number, msg: string) => void
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
  await installDependenciesWithRetry(resolvedVersion, sharedDir, (msg) =>
    onProgress?.(3, STEPS, msg)
  )

  // 5. Re-verify modpack files (re-downloads corrupt or missing ones)
  if (hasModpack) {
    onProgress?.(4, STEPS, 'Verificando archivos del modpack...')
    const { fetchManifest, installModpack } = await import('./modpacks')
    const manifest = await fetchManifest(instance.modpackUrl!, instance.modpackKey)
    await installModpack(instance.id, manifest, (c, t, msg) => onProgress?.(4, STEPS, msg))
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
