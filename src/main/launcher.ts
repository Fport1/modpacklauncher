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

  if (await fs.pathExists(versionJson)) {
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
  onProgress?: (current: number, total: number, msg: string) => void
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
    await installNeoForged('neoforge', instance.modloaderVersion, sharedDir, {})
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
  if (!(await fs.pathExists(versionJson))) {
    await installMinecraftVersion(instance.minecraft, onProgress)
  }

  checkCancel()

  // 2. Ensure modloader is installed
  if (instance.modloader !== 'vanilla' && instance.modloaderVersion) {
    const loaderVersionId = resolveVersionId(instance)
    const loaderJson = path.join(sharedDir, 'versions', loaderVersionId, `${loaderVersionId}.json`)
    if (!(await fs.pathExists(loaderJson))) {
      await installModloader(instance, onProgress)
    }
  }

  checkCancel()

  // 3. Always verify + download assets & libraries (idempotent — skips valid files)
  const { Version } = await import('@xmcl/core')
  const { installDependencies } = await import('@xmcl/installer')
  const versionId = resolveVersionId(instance)
  const resolvedVersion = await Version.parse(sharedDir, versionId)

  let elapsed = 0
  const timer = setInterval(() => {
    elapsed += 3
    onProgress?.(2, 6, `Descargando assets y librerías... (${elapsed}s)`)
  }, 3000)
  onProgress?.(2, 6, 'Verificando assets y librerías...')

  try {
    await installDependencies(resolvedVersion, {
      assetsDownloadConcurrency: 8,
      skipRevalidate: false
    })
  } catch (e) {
    checkCancel()
    // Some assets failed — warn and proceed; Minecraft will report specific issues
    if (e instanceof AggregateError || (e && typeof e === 'object' && 'errors' in e)) {
      sendToWindow(mainWindow, 'game:log', instance.id,
        '[Launcher] Algunos assets fallaron al descargar. El juego puede funcionar igualmente.'
      )
    } else {
      clearInterval(timer)
      throw e
    }
  } finally {
    clearInterval(timer)
  }

  checkCancel()

  // 4. Ensure Java is available (auto-install if needed)
  onProgress?.(4, 6, 'Verificando Java...')
  let javaPath = instance.javaPath || settings.javaPath
  if (!javaPath) {
    javaPath = await ensureJava(instance.minecraft, (current, total, msg) => {
      onProgress?.(4, 6, msg)
    })
  }
  if (!javaPath) throw new Error('No se pudo encontrar ni instalar Java. Configúralo manualmente en Ajustes.')

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
  const proc = await launch(launchOpts as Parameters<typeof launch>[0])

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
