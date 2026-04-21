import { BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import type { ChildProcess } from 'child_process'
import type { Instance, MinecraftAccount, Settings } from '../shared/types'
import { getSharedDir, getInstanceGameDir } from './instances'
import { ensureJava } from './java'
import { checkCancel } from './cancelToken'

const runningProcesses = new Map<string, ChildProcess>()

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
    const { installFabric } = await import('@xmcl/installer')
    await installFabric({ minecraftVersion: instance.minecraft, version: instance.modloaderVersion, minecraft: sharedDir })
    onProgress?.(2, 2, 'Fabric instalado!')
  } else if (instance.modloader === 'quilt' && instance.modloaderVersion) {
    onProgress?.(0, 2, 'Instalando Quilt...')
    const { installQuiltVersion } = await import('@xmcl/installer')
    await installQuiltVersion({ minecraftVersion: instance.minecraft, version: instance.modloaderVersion, minecraft: sharedDir })
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
  onProgress?: (current: number, total: number, msg: string) => void
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
      mainWindow.webContents.send('game:log', instance.id,
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

  const proc = await launch({
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
    extraExecOption: { stdio: ['ignore', 'pipe', 'pipe'] }
  })

  runningProcesses.set(instance.id, proc)
  if (settings.closeOnLaunch) mainWindow.minimize()

  // Stream game output to renderer
  const sendLog = (line: string) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('game:log', instance.id, line)
  }
  mainWindow.webContents.send('game:started', instance.id)

  proc.stdout?.on('data', (buf) =>
    buf.toString().split('\n').filter(Boolean).forEach(sendLog)
  )
  proc.stderr?.on('data', (buf) =>
    buf.toString().split('\n').filter(Boolean).forEach(sendLog)
  )
  proc.on('exit', (code) => {
    runningProcesses.delete(instance.id)
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('game:exit', instance.id, code)
    if (settings.closeOnLaunch) mainWindow.restore()
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
  const { getVersionList } = await import('@xmcl/installer')
  const list = await getVersionList()
  return list.versions
    .filter((v) => v.type === 'release' || v.type === 'snapshot')
    .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }))
}

export async function getForgeVersions(minecraft: string): Promise<string[]> {
  const { getForgeVersionList } = await import('@xmcl/installer')
  const list = await getForgeVersionList()
  const versions = list[minecraft]
  if (!Array.isArray(versions)) return []
  return versions.map((v: { version: string }) => v.version)
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
