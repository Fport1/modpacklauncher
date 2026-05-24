import { ipcMain, BrowserWindow, app, dialog } from 'electron'
import os from 'os'
import path from 'path'
import fs from 'fs'
import FormData from 'form-data'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import type { Instance, MinecraftAccount, Settings, ModpackManifest, Friend } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'
import JsonStore from './store'
import { loginMicrosoft, loginOffline, isTokenExpired, refreshMicrosoftToken } from './auth'
import { checkJavaStatus, ensureJava } from './java'
import { checkForUpdates, openDownloadPage, downloadAndInstall } from './updater'
import { exportModpack, getPublishedModpacks, savePublishedModpack, deletePublishedModpack } from './modpacks'
import type { ExportParams } from './modpacks'
import type { PublishedModpack } from '../shared/types'
import type { UpdateManifest } from './updater'
import {
  loadInstances,
  createInstance,
  updateInstance,
  deleteInstance,
  duplicateInstance,
  pickInstanceIcon,
  getInstanceIconBase64,
  getDefaultIconBase64,
  listDefaultIcons,
  checkInstanceNameExists,
  listGameDirEntries,
  pickIconPreview,
  applyPendingIcon,
  setInstanceIconFromUrl,
  openInstanceFolder,
  listMods,
  listWorlds,
  listResourcepacks,
  openModsFolder,
  openSavesFolder,
  openResourcepacksFolder,
  listShaderpacks,
  openShaderpacks,
  listScreenshots,
  openScreenshotsFolder,
  listCrashReports,
  readCrashReport,
  readLatestLog,
  openLogsFolder,
  openCrashReportsFolder,
  listConfigFiles,
  openConfigFolder,
  readConfigFile,
  writeConfigFile,
  listWorldFiles,
  readWorldFile,
  writeWorldFile,
  copyFilesToWorld,
  readOptionsFile,
  writeOptionsFile,
  toggleMod,
  deleteMod,
  toggleResourcepack,
  deleteResourcepack,
  toggleShaderpack,
  deleteShaderpack,
  deleteWorld,
  deleteScreenshot,
  getInstanceSize,
  getInstanceGameDir
} from './instances'
import {
  launchInstance,
  killInstance,
  installMinecraftVersion,
  installModloader,
  getAvailableVersions,
  getForgeVersions,
  getFabricVersions,
  getQuiltVersions,
  getNeoForgeVersions
} from './launcher'
import { fetchManifest, installModpack, updateModpack, compareVersions, installMrpackFiles } from './modpacks'
import { searchMods, getModVersions, installModFromUrl, getModrinthCategories, getInstalledProjectIds, getInstalledProjectIcons, getProjectVersionForInstall, getProject, getProjects, getInstalledModsMeta } from './modrinth'
import { requestCancel, resetCancel, CancelError } from './cancelToken'
import { analyzeWithAI } from './ai'
import { getFriends, addFriend, removeFriend } from './friends'
import { getLogBuffer } from './logger'

interface AccountsStore {
  accounts: MinecraftAccount[]
  activeId?: string
}

const settingsStore = new JsonStore<Settings>('settings', DEFAULT_SETTINGS)
const accountsStore = new JsonStore<AccountsStore>('accounts', { accounts: [] })

export function getSettings(): Settings {
  return settingsStore.getAll()
}
let currentMainWindow: BrowserWindow | null = null
let ipcHandlersRegistered = false

function sendToWindow(window: BrowserWindow | null | undefined, channel: string, ...args: unknown[]): boolean {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false
  window.webContents.send(channel, ...args)
  return true
}

function sendDone(mainWindow: BrowserWindow | null | undefined, msg = 'Cancelado') {
  sendToWindow(mainWindow, 'progress', { current: 0, total: 0, message: msg, type: 'install', done: true })
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  currentMainWindow = mainWindow
  if (ipcHandlersRegistered) return
  ipcHandlersRegistered = true

  const getMainWindow = () => {
    if (!currentMainWindow || currentMainWindow.isDestroyed()) {
      throw new Error('Main window is not available')
    }
    return currentMainWindow
  }

  const sendProgress = (current: number, total: number, message: string, type: 'install' | 'download') => {
    sendToWindow(currentMainWindow, 'progress', { current, total, message, type })
  }

  // ── Cancel ──────────────────────────────────────────────────────────────────

  ipcMain.handle('operation:cancel', () => requestCancel())

  // ── Accounts ────────────────────────────────────────────────────────────────

  ipcMain.handle('auth:login-microsoft', async () => {
    const settings = settingsStore.getAll()
    const account = await loginMicrosoft(getMainWindow(), settings.azureClientId)
    addAccount(account)
    return account
  })

  ipcMain.handle('auth:login-offline', (_e, username: string) => {
    const account = loginOffline(username)
    addAccount(account)
    return account
  })

  ipcMain.handle('auth:logout', (_e, accountId: string) => {
    const { accounts } = accountsStore.getAll()
    accountsStore.set(
      'accounts',
      accounts.filter((a) => a.id !== accountId)
    )
    const active = accountsStore.get('activeId')
    if (active === accountId) accountsStore.set('activeId', undefined)
  })

  ipcMain.handle('auth:get-accounts', () => accountsStore.getAll())

  ipcMain.handle('auth:set-active', (_e, accountId: string) => {
    accountsStore.set('activeId', accountId)
  })

  ipcMain.handle('auth:refresh', async (_e, account: MinecraftAccount) => {
    const settings = settingsStore.getAll()
    const refreshed = await refreshMicrosoftToken(account, settings.azureClientId)
    refreshed.id = account.id  // preserve original ID so updateAccount finds the record
    updateAccount(refreshed)
    return refreshed
  })

  // ── Instances ────────────────────────────────────────────────────────────────

  ipcMain.handle('instances:list', () => loadInstances())

  ipcMain.handle('instances:create', (_e, data: Omit<Instance, 'id' | 'createdAt'>) =>
    createInstance(data)
  )

  ipcMain.handle('instances:update', (_e, instance: Instance) => updateInstance(instance))

  ipcMain.handle('instances:delete', (_e, instanceId: string) => deleteInstance(instanceId))

  ipcMain.handle('instances:open-folder', (_e, instanceId: string) =>
    openInstanceFolder(instanceId)
  )

  ipcMain.handle('instances:list-mods', (_e, instanceId: string) => listMods(instanceId))
  ipcMain.handle('instances:list-worlds', (_e, instanceId: string) => listWorlds(instanceId))
  ipcMain.handle('instances:list-resourcepacks', (_e, instanceId: string) => listResourcepacks(instanceId))
  ipcMain.handle('instances:open-mods-folder', (_e, instanceId: string) => openModsFolder(instanceId))
  ipcMain.handle('instances:open-saves-folder', (_e, instanceId: string) => openSavesFolder(instanceId))
  ipcMain.handle('instances:open-resourcepacks-folder', (_e, instanceId: string) => openResourcepacksFolder(instanceId))
  ipcMain.handle('instances:list-shaderpacks', (_e, instanceId: string) => listShaderpacks(instanceId))
  ipcMain.handle('instances:open-shaderpacks-folder', (_e, instanceId: string) => openShaderpacks(instanceId))
  ipcMain.handle('instances:list-screenshots', (_e, instanceId: string) => listScreenshots(instanceId))
  ipcMain.handle('instances:open-screenshots-folder', (_e, instanceId: string) => openScreenshotsFolder(instanceId))
  ipcMain.handle('instances:list-crash-reports', (_e, instanceId: string) => listCrashReports(instanceId))
  ipcMain.handle('instances:read-crash-report', (_e, instanceId: string, filename: string) => readCrashReport(instanceId, filename))
  ipcMain.handle('instances:read-latest-log', (_e, instanceId: string) => readLatestLog(instanceId))
  ipcMain.handle('instances:open-logs-folder', (_e, instanceId: string) => openLogsFolder(instanceId))
  ipcMain.handle('instances:open-crash-reports-folder', (_e, instanceId: string) => openCrashReportsFolder(instanceId))
  ipcMain.handle('instances:list-config', (_e, instanceId: string, subPath?: string) => listConfigFiles(instanceId, subPath))
  ipcMain.handle('instances:open-config-folder', (_e, instanceId: string) => openConfigFolder(instanceId))
  ipcMain.handle('instances:read-config-file', (_e, instanceId: string, filePath: string) => readConfigFile(instanceId, filePath))
  ipcMain.handle('instances:write-config-file', (_e, instanceId: string, filePath: string, content: string) => writeConfigFile(instanceId, filePath, content))
  ipcMain.handle('instances:read-options', (_e, instanceId: string) => readOptionsFile(instanceId))
  ipcMain.handle('instances:write-options', (_e, instanceId: string, content: string) => writeOptionsFile(instanceId, content))
  ipcMain.handle('instances:list-world-files', (_e, instanceId: string, relativePath?: string) => listWorldFiles(instanceId, relativePath))
  ipcMain.handle('instances:read-world-file', (_e, instanceId: string, relativePath: string) => readWorldFile(instanceId, relativePath))
  ipcMain.handle('instances:write-world-file', (_e, instanceId: string, relativePath: string, content: string) => writeWorldFile(instanceId, relativePath, content))
  ipcMain.handle('instances:copy-files-to-world', (_e, instanceId: string, relativePath: string, filePaths: string[]) => copyFilesToWorld(instanceId, relativePath, filePaths))
  ipcMain.handle('instances:toggle-mod', (_e, instanceId: string, filename: string) => toggleMod(instanceId, filename))
  ipcMain.handle('instances:delete-mod', (_e, instanceId: string, filename: string) => deleteMod(instanceId, filename))
  ipcMain.handle('instances:toggle-resourcepack', (_e, instanceId: string, filename: string) => toggleResourcepack(instanceId, filename))
  ipcMain.handle('instances:delete-resourcepack', (_e, instanceId: string, filename: string) => deleteResourcepack(instanceId, filename))
  ipcMain.handle('instances:toggle-shaderpack', (_e, instanceId: string, filename: string) => toggleShaderpack(instanceId, filename))
  ipcMain.handle('instances:delete-shaderpack', (_e, instanceId: string, filename: string) => deleteShaderpack(instanceId, filename))
  ipcMain.handle('instances:delete-world', (_e, instanceId: string, worldName: string) => deleteWorld(instanceId, worldName))
  ipcMain.handle('instances:delete-screenshot', (_e, instanceId: string, filename: string) => deleteScreenshot(instanceId, filename))
  ipcMain.handle('instances:duplicate', (e, instanceId: string, newName: string) => duplicateInstance(instanceId, newName, (step) => e.sender.send('instances:duplicate-progress', step)))
  ipcMain.handle('instances:pick-icon', (_e, instanceId: string) => pickInstanceIcon(instanceId, getMainWindow()))
  ipcMain.handle('instances:get-icon', (_e, instanceId: string) => getInstanceIconBase64(instanceId))
  ipcMain.handle('instances:list-default-icons', () => listDefaultIcons())
  ipcMain.handle('instances:check-name', (_e, name: string, excludeId?: string) => checkInstanceNameExists(name, excludeId))
  ipcMain.handle('instances:list-game-dir', (_e, instanceId: string, subPath?: string) => listGameDirEntries(instanceId, subPath))
  ipcMain.handle('instances:get-default-icon', () => getDefaultIconBase64())
  ipcMain.handle('instances:pick-icon-preview', () => pickIconPreview(getMainWindow()))
  ipcMain.handle('instances:apply-pending-icon', (_e, instanceId: string, filePath: string) => applyPendingIcon(instanceId, filePath))
  ipcMain.handle('instances:set-icon-from-url', (_e, instanceId: string, url: string) => setInstanceIconFromUrl(instanceId, url))

  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    const { shell } = await import('electron')
    await shell.openExternal(url)
  })

  ipcMain.handle('clipboard:write-image-path', async (_e, filePath: string) => {
    const { clipboard, nativeImage } = await import('electron')
    const img = nativeImage.createFromPath(filePath)
    clipboard.writeImage(img)
  })
  ipcMain.handle('clipboard:write-text', async (_e, text: string) => {
    const { clipboard } = await import('electron')
    clipboard.writeText(text)
  })

  // ── Launcher ────────────────────────────────────────────────────────────────

  ipcMain.handle('launcher:launch', async (_e, instanceId: string) => {
    resetCancel()

    const instances = await loadInstances()
    const instance = instances.find((i) => i.id === instanceId)
    if (!instance) throw new Error('Instance not found')

    const { accounts, activeId } = accountsStore.getAll()
    let account = accounts.find((a) => a.id === activeId) ?? accounts[0]
    if (!account) throw new Error('No account selected')

    const settings = settingsStore.getAll()

    if (isTokenExpired(account) && account.type === 'microsoft') {
      account = await refreshMicrosoftToken(account, settings.azureClientId)
      updateAccount(account)
    }

    try {
      await launchInstance(
        instance, account, settings, getMainWindow(),
        (current, total, message) => {
          sendProgress(current, total, message, 'install')
        },
        async (sessionMs) => {
          instance.playtime = (instance.playtime ?? 0) + sessionMs
          await updateInstance(instance)
        }
      )

      instance.lastPlayed = Date.now()
      await updateInstance(instance)
      sendDone(currentMainWindow, 'Minecraft iniciado!')
    } catch (e) {
      if (e instanceof CancelError) {
        sendDone(currentMainWindow)
        return
      }
      // AggregateError from @xmcl/installer = asset download failures (timeouts/corrupt files)
      if (e instanceof AggregateError || (e && typeof e === 'object' && 'errors' in e)) {
        throw new Error(
          'Error al descargar archivos de Minecraft. Revisa tu conexión a internet.\n' +
          'Si el error persiste, borra la carpeta: AppData\\Roaming\\modpack-launcher\\shared\\assets\\objects'
        )
      }
      throw e
    }
  })

  ipcMain.handle(
    'launcher:install-version',
    async (_e, version: string, modloader?: string, modloaderVersion?: string) => {
      resetCancel()
      try {
        await installMinecraftVersion(version, (current, total, message) => {
          sendProgress(current, total, message, 'install')
        })

        if (modloader && modloader !== 'vanilla') {
          const fake = {
            modloader: modloader as Instance['modloader'],
            modloaderVersion,
            minecraft: version
          } as Instance
          await installModloader(fake, (current, total, message) => {
            sendProgress(current, total, message, 'install')
          })
        }
      } catch (e) {
        if (e instanceof CancelError) { sendDone(currentMainWindow); return }
        sendDone(currentMainWindow, 'Error al instalar')
        throw e
      }
      sendDone(currentMainWindow, '¡Versión instalada!')
    }
  )

  ipcMain.handle('launcher:launch-extra', async (_e, instanceId: string) => {
    const instances = await loadInstances()
    const instance = instances.find((i) => i.id === instanceId)
    if (!instance) throw new Error('Instance not found')

    const { accounts, activeId } = accountsStore.getAll()
    let account = accounts.find((a) => a.id === activeId) ?? accounts[0]
    if (!account) throw new Error('No account selected')

    const settings = settingsStore.getAll()
    if (isTokenExpired(account) && account.type === 'microsoft') {
      account = await refreshMicrosoftToken(account, settings.azureClientId)
      updateAccount(account)
    }

    await launchInstance(instance, account, settings, getMainWindow(), undefined, undefined, { suppressEvents: true })
  })

  ipcMain.handle('launcher:kill', (_e, instanceId: string) => killInstance(instanceId))
  ipcMain.handle('launcher:get-mc-versions', () => getAvailableVersions())
  ipcMain.handle('launcher:get-forge-versions', (_e, mc: string) => getForgeVersions(mc))
  ipcMain.handle('launcher:get-fabric-versions', () => getFabricVersions())
  ipcMain.handle('launcher:get-quilt-versions', () => getQuiltVersions())
  ipcMain.handle('launcher:get-neoforge-versions', (_e, mc: string) => getNeoForgeVersions(mc))

  // ── Modpacks ────────────────────────────────────────────────────────────────

  ipcMain.handle('modpacks:fetch', (_e, url: string, key?: string) => fetchManifest(url, key))

  ipcMain.handle('modpacks:install', async (_e, instanceId: string, manifest: ModpackManifest) => {
    resetCancel()
    try {
      await installModpack(instanceId, manifest, (current, total, message) => {
        sendProgress(current, total, message, 'download')
      })
      sendDone(currentMainWindow, '¡Modpack instalado!')
    } catch (e) {
      if (e instanceof CancelError) { sendDone(currentMainWindow); return }
      throw e
    }
  })

  ipcMain.handle('modpacks:update', async (_e, instanceId: string, manifestUrl: string) => {
    const instances = await loadInstances()
    const instance = instances.find((i) => i.id === instanceId)
    if (!instance) throw new Error('Instance not found')

    const manifest = await fetchManifest(manifestUrl, instance.modpackKey)

    if (
      instance.modpackVersion &&
      compareVersions(manifest.version, instance.modpackVersion) <= 0
    ) {
      return { upToDate: true, manifest }
    }

    resetCancel()
    try {
      const result = await updateModpack(instanceId, manifest, (current, total, message) => {
        sendProgress(current, total, message, 'download')
      })

      instance.modpackVersion = manifest.version
      await updateInstance(instance)
      sendDone(currentMainWindow, '¡Actualización completada!')
      return { upToDate: false, manifest, ...result }
    } catch (e) {
      if (e instanceof CancelError) { sendDone(currentMainWindow); return { upToDate: false, manifest } }
      throw e
    }
  })

  ipcMain.handle('modpacks:export', async (e, params: ExportParams) => {
    const url = await exportModpack(params, (message, current, total) => {
      e.sender.send('modpacks:export-progress', { message, current, total })
    })
    await savePublishedModpack({
      id: `${params.repoName}-${params.version}-${Date.now()}`,
      name: params.name,
      version: params.version,
      minecraft: params.minecraft,
      modloader: params.modloader,
      url,
      publishedAt: Date.now(),
      accessKey: params.accessKey || undefined
    })
    return url
  })

  // ── Modrinth ─────────────────────────────────────────────────────────────────

  ipcMain.handle('modrinth:search', (_e, query, mcVersion, loader, categories, environment, projectType, limit, offset, index) =>
    searchMods(query, mcVersion, loader, categories, environment, projectType, limit, offset, index)
  )
  ipcMain.handle('modrinth:get-versions', (_e, projectId: string, mcVersion: string, loader: string, channel: 'all' | 'stable' = 'all') =>
    getModVersions(projectId, mcVersion, loader, channel)
  )
  ipcMain.handle('modrinth:install-mod', (_e, instanceId: string, fileUrl: string, filename: string, subFolder?: string) =>
    installModFromUrl(instanceId, fileUrl, filename, subFolder)
  )
  ipcMain.handle('modrinth:get-categories', (_e, projectType?: string) => getModrinthCategories(projectType ?? 'mod'))
  ipcMain.handle('modrinth:get-installed-ids', (_e, instanceId: string, subFolder?: string, extensions?: string[]) =>
    getInstalledProjectIds(instanceId, subFolder, extensions)
  )
  ipcMain.handle('modrinth:get-installed-icons', (_e, instanceId: string, subFolder?: string, extensions?: string[]) =>
    getInstalledProjectIcons(instanceId, subFolder, extensions)
  )
  ipcMain.handle('modrinth:get-project', (_e, projectId: string) => getProject(projectId))
  ipcMain.handle('modrinth:get-projects', (_e, projectIds: string[]) => getProjects(projectIds))
  ipcMain.handle('instances:get-size', (_e, instanceId: string) => getInstanceSize(instanceId))
  ipcMain.handle('modrinth:get-project-version', (_e, projectId: string, mcVersion: string, loader: string, channel: 'all' | 'stable' = 'all') =>
    getProjectVersionForInstall(projectId, mcVersion, loader, channel)
  )
  ipcMain.handle('modrinth:get-installed-mods-meta', (_e, instanceId: string, mcVersion: string, loader: string, subFolder?: string, extensions?: string[]) =>
    getInstalledModsMeta(instanceId, mcVersion, loader, subFolder, extensions)
  )

  ipcMain.handle('modrinth:install-mrpack', async (_e, instanceId: string, mrpackUrl: string) => {
    resetCancel()
    try {
      const meta = await installMrpackFiles(instanceId, mrpackUrl, (current, total, message) => {
        sendProgress(current, total, message, 'download')
      })
      sendDone(currentMainWindow, '¡Modpack instalado!')
      return meta
    } catch (e) {
      if (e instanceof CancelError) { sendDone(currentMainWindow); return }
      throw e
    }
  })

  ipcMain.handle('modpacks:get-published', () => getPublishedModpacks())
  ipcMain.handle('modpacks:delete-published', (_e, id: string) => deletePublishedModpack(id))

  ipcMain.handle('modpacks:check-update', async (_e, instanceId: string, manifestUrl: string) => {
    const instances = await loadInstances()
    const instance = instances.find((i) => i.id === instanceId)
    const manifest = await fetchManifest(manifestUrl, instance?.modpackKey)
    if (!instance) return { hasUpdate: false, manifest }

    const hasUpdate =
      !instance.modpackVersion ||
      compareVersions(manifest.version, instance.modpackVersion) > 0

    return { hasUpdate, manifest, currentVersion: instance.modpackVersion }
  })

  // ── Settings ────────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', () => settingsStore.getAll())

  ipcMain.handle('settings:set', (_e, data: Partial<Settings>) => {
    settingsStore.setAll(data)
    if (typeof data.launchAtStartup === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: data.launchAtStartup })
    }
  })

  // ── AI analysis ─────────────────────────────────────────────────────────────

  ipcMain.handle('ai:analyze', async (_e, content: string, type: 'crash' | 'log', configId: string) => {
    const s = settingsStore.getAll()
    const config = (s.aiConfigs ?? []).find(c => c.id === configId)
    if (!config) throw new Error('Configuración de IA no encontrada. Configúrala en Ajustes.')
    return analyzeWithAI(content, type, config)
  })

  // ── Java ────────────────────────────────────────────────────────────────────

  ipcMain.handle('java:check', (_e, mcVersion: string) => checkJavaStatus(mcVersion))

  ipcMain.handle('java:ensure', async (_e, mcVersion: string) => {
    resetCancel()
    try {
      return await ensureJava(mcVersion, (current, total, msg) => {
        sendProgress(current, total, msg, 'install')
      })
    } catch (e) {
      if (e instanceof CancelError) { sendDone(currentMainWindow); return null }
      throw e
    }
  })

  // ── Player skin ─────────────────────────────────────────────────────────────

  ipcMain.handle('skin:get-head', async (_e, uuid: string) => {
    const axios = (await import('axios')).default
    const { nativeImage } = await import('electron')
    const uuidClean = uuid.replace(/-/g, '')

    // Try Mojang session server first — authoritative, always up-to-date skin
    try {
      const profileRes = await axios.get(
        `https://sessionserver.mojang.com/session/minecraft/profile/${uuidClean}`,
        { timeout: 6_000 }
      )
      const props = profileRes.data?.properties as Array<{ name: string; value: string }> | undefined
      const texturesProp = props?.find(p => p.name === 'textures')
      if (texturesProp) {
        const textures = JSON.parse(Buffer.from(texturesProp.value, 'base64').toString())
        const skinUrl: string | undefined = textures.textures?.SKIN?.url
        if (skinUrl) {
          const skinRes = await axios.get<Buffer>(skinUrl, { responseType: 'arraybuffer', timeout: 6_000 })
          const img = nativeImage.createFromBuffer(Buffer.from(skinRes.data))
          const { width } = img.getSize()
          const scale = width / 64  // standard skin is 64 wide
          // Face base layer: x=8, y=8, w=8, h=8 (scaled)
          // Return raw 8×8 face — CSS image-rendering:pixelated handles upscaling without blur
          const face = img.crop({ x: Math.round(8 * scale), y: Math.round(8 * scale), width: Math.round(8 * scale), height: Math.round(8 * scale) })
          return face.toDataURL()
        }
      }
    } catch { /* fall through to CDN fallbacks */ }

    // CDN fallbacks
    const cdnUrls = [
      `https://crafatar.com/avatars/${uuidClean}?size=64&overlay`,
      `https://mc-heads.net/avatar/${uuidClean}/64`,
      `https://minotar.net/avatar/${uuidClean}/64`,
    ]
    for (const url of cdnUrls) {
      try {
        const res = await axios.get<Buffer>(url, {
          responseType: 'arraybuffer',
          timeout: 6_000,
          headers: { 'User-Agent': 'ModpackLauncher/1.0' }
        })
        if (res.status === 200 && res.data?.byteLength > 100) {
          return `data:image/png;base64,${Buffer.from(res.data).toString('base64')}`
        }
      } catch { /* try next */ }
    }
    return null
  })

  ipcMain.handle('skin:get-profile-capes', async (_e, accessToken: string) => {
    try {
      const axios = (await import('axios')).default
      const res = await axios.get('https://api.minecraftservices.com/minecraft/profile', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'ModpackLauncher/1.0' },
        timeout: 10_000
      })
      const capes = (res.data.capes ?? []) as { id: string; state: string; url: string; alias: string }[]
      const results = await Promise.all(capes.map(async cape => {
        try {
          const img = await axios.get<Buffer>(cape.url, { responseType: 'arraybuffer', timeout: 8_000 })
          return { ...cape, texture: `data:image/png;base64,${Buffer.from(img.data).toString('base64')}` }
        } catch { return { ...cape, texture: null } }
      }))
      return results
    } catch { return [] }
  })

  ipcMain.handle('skin:equip-cape', async (_e, accessToken: string, capeId: string) => {
    const axios = (await import('axios')).default
    await axios.put(
      'https://api.minecraftservices.com/minecraft/profile/capes/active',
      { capeId },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'ModpackLauncher/1.0' }, timeout: 10_000 }
    )
  })

  ipcMain.handle('skin:remove-cape', async (_e, accessToken: string) => {
    const axios = (await import('axios')).default
    await axios.delete(
      'https://api.minecraftservices.com/minecraft/profile/capes/active',
      { headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'ModpackLauncher/1.0' }, timeout: 10_000 }
    )
  })

  ipcMain.handle('skin:get-texture', async (_e, uuid: string) => {
    try {
      const axios = (await import('axios')).default
      const profile = await axios.get(
        `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`,
        { timeout: 10_000, headers: { 'User-Agent': 'ModpackLauncher/1.0' } }
      )
      const prop = (profile.data.properties as { name: string; value: string }[])
        .find(p => p.name === 'textures')
      if (!prop) return null
      const textures = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf-8'))
      const skinUrl = textures?.textures?.SKIN?.url
      const capeUrl = textures?.textures?.CAPE?.url ?? null
      const model = textures?.textures?.SKIN?.metadata?.model === 'slim' ? 'slim' : 'classic'
      if (!skinUrl) return null

      const fetchB64 = async (url: string) => {
        const r = await axios.get<Buffer>(url, { responseType: 'arraybuffer', timeout: 10_000, headers: { 'User-Agent': 'ModpackLauncher/1.0' } })
        return `data:image/png;base64,${Buffer.from(r.data).toString('base64')}`
      }

      const [skin, cape] = await Promise.all([
        fetchB64(skinUrl),
        capeUrl ? fetchB64(capeUrl).catch(() => null) : Promise.resolve(null)
      ])
      return { skin, cape, model }
    } catch {
      return null
    }
  })

  // ── Skin library + browser ──────────────────────────────────────────────────

  const skinLibraryPath = () => path.join(app.getPath('userData'), 'skins-library.json')
  function readLibrary(): any[] {
    try { return JSON.parse(fs.readFileSync(skinLibraryPath(), 'utf-8')) } catch { return [] }
  }

  ipcMain.handle('skins:list-library', () => readLibrary())

  ipcMain.handle('skins:save-to-library', (_e, entry: { name: string; model: 'classic' | 'slim'; data: string }) => {
    const lib = readLibrary()
    const newEntry = { id: uuidv4(), name: entry.name, model: entry.model, data: entry.data, addedAt: new Date().toISOString() }
    lib.push(newEntry)
    fs.writeFileSync(skinLibraryPath(), JSON.stringify(lib, null, 2))
    return newEntry
  })

  ipcMain.handle('skins:update-library', (_e, entry: { id: string; name: string; model: 'classic' | 'slim'; data?: string }) => {
    const lib = readLibrary()
    const index = lib.findIndex((e: any) => e.id === entry.id)
    if (index === -1) throw new Error('Skin not found')
    const updated = {
      ...lib[index],
      name: entry.name,
      model: entry.model,
      ...(entry.data ? { data: entry.data } : {})
    }
    lib[index] = updated
    fs.writeFileSync(skinLibraryPath(), JSON.stringify(lib, null, 2))
    return updated
  })

  ipcMain.handle('skins:delete-from-library', (_e, id: string) => {
    const lib = readLibrary().filter((e: any) => e.id !== id)
    fs.writeFileSync(skinLibraryPath(), JSON.stringify(lib, null, 2))
  })

  ipcMain.handle('skins:pick-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Seleccionar skin PNG',
      filters: [{ name: 'PNG', extensions: ['png'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return null
    const data = fs.readFileSync(filePaths[0])
    return `data:image/png;base64,${data.toString('base64')}`
  })

  ipcMain.handle('skins:apply', async (_e, accountId: string, skinBase64: string, model: 'classic' | 'slim') => {
    const { accounts } = accountsStore.getAll()
    let account = accounts.find(a => a.id === accountId)
    if (!account || account.type !== 'microsoft') throw new Error('Cuenta Microsoft no encontrada')

    if (isTokenExpired(account)) {
      const settings = settingsStore.getAll()
      account = await refreshMicrosoftToken(account, settings.azureClientId)
      updateAccount(account)
    }

    const base64Data = skinBase64.replace(/^data:image\/png;base64,/, '')
    const skinBuffer = Buffer.from(base64Data, 'base64')
    const form = new FormData()
    form.append('variant', model)
    form.append('file', skinBuffer, { filename: 'skin.png', contentType: 'image/png' })
    await axios.post('https://api.minecraftservices.com/minecraft/profile/skins', form, {
      headers: { Authorization: `Bearer ${account.accessToken}`, ...form.getHeaders() }
    })
  })

  // Popular skin creators — used when no search query (usernames verified via NameMC)
  const POPULAR_PLAYERS = [
    // Devs de Minecraft
    'Notch', 'jeb_', 'Dinnerbone', 'Grumm',
    // Anglosajones
    'Dream', 'Technoblade', 'Ph1LzA', 'TommyInnit', 'GeorgeNotFound', 'Sapnap',
    // España
    'VegettaGaymer', 'Willyrex', 'SrAuronPlay', 'ElRichMC', 'Mikecrack',
    'alexby11', 'iRoier', 'sTaXxCraft', 'LuzuVlogs', 'Crisgreen',
    'Conterstine', 'Shadoune777', 'elrubius', 'iLuh',
    // Latinoamérica
    'WestCOL', 'Quackity', 'KillerCreeper_55', 'Bobicraft', 'Spreen',
    'ElJuaniquilador', 'Farfadox', 'dedreviil', 'EvilAFM',
    // Siempre último
    'Devora60',
  ]

  const MINECRAFT_DEFAULT_SKINS = [
    { name: 'Steve',   model: 'classic' as const, file: 'steve'   },
    { name: 'Alex',    model: 'slim'    as const, file: 'alex'    },
    { name: 'Ari',     model: 'slim'    as const, file: 'ari'     },
    { name: 'Efe',     model: 'classic' as const, file: 'efe'     },
    { name: 'Kai',     model: 'slim'    as const, file: 'kai'     },
    { name: 'Makena',  model: 'slim'    as const, file: 'makena'  },
    { name: 'Noor',    model: 'slim'    as const, file: 'noor'    },
    { name: 'Sunny',   model: 'classic' as const, file: 'sunny'   },
    { name: 'Zuri',    model: 'classic' as const, file: 'zuri'    },
  ]

  ipcMain.handle('skins:get-defaults', async () => {
    const axios = (await import('axios')).default
    const results = await Promise.allSettled(MINECRAFT_DEFAULT_SKINS.map(async skin => {
      const res = await axios.get<Buffer>(
        `https://assets.mojang.com/SkinTemplates/${skin.file}.png`,
        { responseType: 'arraybuffer', timeout: 10_000, headers: { 'User-Agent': 'ModpackLauncher/1.0' } }
      )
      return { ...skin, data: `data:image/png;base64,${Buffer.from(res.data).toString('base64')}` }
    }))
    return results.filter(r => r.status === 'fulfilled').map((r: any) => r.value)
  })

  ipcMain.handle('skins:search-skindex', async (_e, query: string) => {
    const axios = (await import('axios')).default

    const fetchPlayer = async (name: string) => {
      const profRes = await axios.get(
        `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
        { timeout: 8_000, headers: { 'User-Agent': 'ModpackLauncher/1.0' } }
      )
      const { id: uuid, name: realName } = profRes.data
      const fullRes = await axios.get(
        `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`,
        { timeout: 8_000, headers: { 'User-Agent': 'ModpackLauncher/1.0' } }
      )
      const prop = (fullRes.data.properties as any[]).find((p: any) => p.name === 'textures')
      const textures = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf-8'))
      const skinUrl = textures.textures?.SKIN?.url
      if (!skinUrl) throw new Error('no skin')
      const [imgRes, avatarRes] = await Promise.all([
        axios.get<Buffer>(skinUrl, {
          responseType: 'arraybuffer', timeout: 8_000,
          headers: { 'User-Agent': 'ModpackLauncher/1.0' }
        }),
        axios.get<Buffer>(`https://crafatar.com/avatars/${uuid}?size=96&overlay`, {
          responseType: 'arraybuffer', timeout: 8_000,
          headers: { 'User-Agent': 'ModpackLauncher/1.0' }
        }).catch(() => null)
      ])
      return {
        id: uuid,
        name: realName as string,
        renderUrl: avatarRes ? `data:image/png;base64,${Buffer.from(avatarRes.data).toString('base64')}` : '',
        textureData: `data:image/png;base64,${Buffer.from(imgRes.data).toString('base64')}`
      }
    }

    if (query.trim()) {
      const result = await fetchPlayer(query.trim())
      return [result]
    }

    // Popular players (best-effort, ignore individual failures)
    const results = await Promise.allSettled(POPULAR_PLAYERS.map(fetchPlayer))
    const skins = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value)
    if (skins.length === 0) throw new Error('No se pudieron cargar los jugadores populares')
    return skins
  })

  ipcMain.handle('skins:fetch-skin-png', async (_e, skinId: string, renderUrl?: string) => {
    const axios = (await import('axios')).default
    // Try Nova Skin texture first
    const urls = [
      `https://minecraft.novaskin.me/skin/texture/${skinId}`,
      renderUrl,
      `https://www.minecraftskins.com/skin/download/${skinId}/`,
    ].filter(Boolean) as string[]
    for (const url of urls) {
      try {
        const res = await axios.get<Buffer>(url, {
          responseType: 'arraybuffer', timeout: 10_000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        })
        if (res.data.byteLength > 100)
          return `data:image/png;base64,${Buffer.from(res.data).toString('base64')}`
      } catch { /* try next */ }
    }
    throw new Error('No se pudo descargar la skin')
  })

  // ── Announcements ───────────────────────────────────────────────────────────

  const ANNOUNCEMENTS_URL = 'https://raw.githubusercontent.com/Fport1/modpacklauncher/main/announcements.json'
  let announcementsCache: { data: any; fetchedAt: number } | null = null
  const visibilityPath = path.join(app.getPath('userData'), 'announcement-visibility.json')

  function readVisibility(): Record<string, boolean> {
    try { return JSON.parse(fs.readFileSync(visibilityPath, 'utf-8')) } catch { return {} }
  }

  ipcMain.handle('announcements:fetch', async () => {
    if (announcementsCache && Date.now() - announcementsCache.fetchedAt < 30 * 60 * 1000) {
      return applyVisibility(announcementsCache.data)
    }
    try {
      const axios = (await import('axios')).default
      const res = await axios.get(ANNOUNCEMENTS_URL, { timeout: 8_000, headers: { 'User-Agent': 'ModpackLauncher/1.0' } })
      announcementsCache = { data: res.data.announcements ?? [], fetchedAt: Date.now() }
      return applyVisibility(announcementsCache.data)
    } catch {
      return applyVisibility(announcementsCache?.data ?? [])
    }
  })

  function applyVisibility(data: any[]): any[] {
    const overrides = readVisibility()
    return data.map(a => Object.prototype.hasOwnProperty.call(overrides, a.id) ? { ...a, active: overrides[a.id] } : a)
  }

  ipcMain.handle('admin:set-visibility', (_e, id: string, active: boolean) => {
    const overrides = readVisibility()
    overrides[id] = active
    fs.writeFileSync(visibilityPath, JSON.stringify(overrides, null, 2))
    announcementsCache = null
  })

  ipcMain.handle('admin:publish-announcements', async (_e, announcements: any[]) => {
    const settings = settingsStore.getAll()
    const token = settings.githubToken
    if (!token) throw new Error('No hay token de GitHub configurado en Ajustes')
    const axiosLib = (await import('axios')).default
    const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'ModpackLauncher/1.0', Accept: 'application/vnd.github+json' }
    const apiUrl = 'https://api.github.com/repos/Fport1/modpacklauncher/contents/announcements.json'
    const getRes = await axiosLib.get(apiUrl, { headers })
    const sha: string = getRes.data.sha
    const content = Buffer.from(JSON.stringify({ announcements }, null, 2) + '\n').toString('base64')
    await axiosLib.put(apiUrl, { message: 'chore: update announcements', content, sha }, { headers })
    // Sync local visibility overrides with published active flags
    const overrides = readVisibility()
    announcements.forEach(a => { overrides[a.id] = a.active !== false })
    fs.writeFileSync(visibilityPath, JSON.stringify(overrides, null, 2))
    announcementsCache = null
  })

  // ── Status ──────────────────────────────────────────────────────────────────

  ipcMain.handle('status:check', async () => {
    const axios = (await import('axios')).default
    const checks = [
      { id: 'minecraft.net',    name: 'Minecraft.net',           url: 'https://minecraft.net' },
      { id: 'xbox',             name: 'Autenticación Xbox Live', url: 'https://account.xbox.com/' },
      { id: 'api',              name: 'API de Mojang',           url: 'https://api.mojang.com/' },
      { id: 'session',          name: 'Sesiones de juego',       url: 'https://sessionserver.mojang.com/' },
      { id: 'textures',         name: 'Texturas y Skins',        url: 'https://textures.minecraft.net/' },
      { id: 'libraries',        name: 'Librerías del juego',     url: 'https://libraries.minecraft.net/' },
      { id: 'launchermeta',     name: 'Metadatos de versiones',  url: 'https://launchermeta.mojang.com/' },
    ]
    const results = await Promise.allSettled(checks.map(async (check) => {
      const start = Date.now()
      try {
        await axios.get(check.url, {
          timeout: 8_000,
          headers: { 'User-Agent': 'ModpackLauncher/1.0' },
          validateStatus: () => true,
        })
        return { ...check, status: 'up' as const, latency: Date.now() - start }
      } catch {
        return { ...check, status: 'down' as const, latency: Date.now() - start }
      }
    }))
    return results.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { ...checks[i], status: 'down' as const, latency: 0 }
    )
  })

  ipcMain.handle('status:check-server', async (_e, host: string, port: number) => {
    const net = await import('net')
    // Try DNS SRV lookup first (_minecraft._tcp.host) so hostnames like hypixel.net work
    let resolvedHost = host
    let resolvedPort = port
    try {
      const dns = await import('dns/promises')
      const records = await dns.resolveSrv(`_minecraft._tcp.${host}`)
      if (records.length > 0) {
        resolvedHost = records[0].name
        resolvedPort = records[0].port
      }
    } catch { /* no SRV record — use host:port as-is */ }

    return new Promise<{ online: boolean; latency: number; players?: { online: number; max: number }; version?: string }>((resolve) => {
      const start = Date.now()
      const socket = new net.Socket()
      socket.setTimeout(5000)
      socket.connect(resolvedPort, resolvedHost, () => {
        const latency = Date.now() - start
        // Send MC handshake + status request to get player counts
        const host_buf = Buffer.from(host, 'utf8')
        const handshake = Buffer.alloc(host_buf.length + 9)
        let off = 0
        handshake[off++] = host_buf.length + 7  // packet length approx
        handshake[off++] = 0x00                 // packet id: handshake
        handshake[off++] = 0x6e                 // protocol version (varint, 110=1.9)
        handshake[off++] = host_buf.length
        host_buf.copy(handshake, off); off += host_buf.length
        handshake.writeUInt16BE(port, off); off += 2
        handshake[off++] = 0x01                 // next state: status
        const statusReq = Buffer.from([0x01, 0x00])
        const chunks: Buffer[] = []
        socket.write(Buffer.concat([handshake.slice(0, off), statusReq]))
        socket.on('data', chunk => { chunks.push(chunk) })
        socket.on('end', () => {
          socket.destroy()
          try {
            const raw = Buffer.concat(chunks).toString('utf8')
            const jsonStart = raw.indexOf('{')
            if (jsonStart !== -1) {
              const parsed = JSON.parse(raw.slice(jsonStart, raw.lastIndexOf('}') + 1))
              resolve({ online: true, latency, players: parsed?.players, version: parsed?.version?.name })
              return
            }
          } catch { /* fall through */ }
          resolve({ online: true, latency })
        })
        setTimeout(() => { socket.destroy(); resolve({ online: true, latency }) }, 1500)
      })
      socket.on('timeout', () => { socket.destroy(); resolve({ online: false, latency: 0 }) })
      socket.on('error', () => { socket.destroy(); resolve({ online: false, latency: 0 }) })
    })
  })

  // ── System ──────────────────────────────────────────────────────────────────

  ipcMain.handle('system:get-ram', () => Math.floor(os.totalmem() / 1024 / 1024))

  ipcMain.handle('system:get-display-hz', async () => {
    const { screen } = await import('electron')
    return screen.getPrimaryDisplay().displayFrequency
  })

  ipcMain.handle('system:get-displays', async () => {
    const { screen } = await import('electron')
    return screen.getAllDisplays().map(d => ({
      id: d.id,
      label: d.label || `Pantalla ${d.id}`,
      bounds: d.bounds,
      isPrimary: d.id === screen.getPrimaryDisplay().id
    }))
  })

  ipcMain.handle('instances:install-jar', async (_e, instanceId: string, sourcePath: string) => {
    const gameDir = await getInstanceGameDir(instanceId)
    const modsDir = path.join(gameDir, 'mods')
    await fs.promises.mkdir(modsDir, { recursive: true })
    const filename = path.basename(sourcePath)
    const dest = path.join(modsDir, filename)
    await fs.promises.copyFile(sourcePath, dest)
    return filename
  })

  ipcMain.handle('instances:backup-world', async (_e, instanceId: string, worldName: string) => {
    const AdmZip = (await import('adm-zip')).default
    const gameDir = await getInstanceGameDir(instanceId)
    const worldDir = path.join(gameDir, 'saves', worldName)
    const backupsDir = path.join(gameDir, 'backups')
    await fs.promises.mkdir(backupsDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `${worldName}_${timestamp}.zip`
    const dest = path.join(backupsDir, filename)
    const zip = new AdmZip()
    zip.addLocalFolder(worldDir, worldName)
    await new Promise<void>((resolve, reject) =>
      zip.writeZipPromise(dest).then(() => resolve()).catch(reject)
    )
    return filename
  })

  ipcMain.handle('instances:list-backups', async (_e, instanceId: string) => {
    const gameDir = await getInstanceGameDir(instanceId)
    const backupsDir = path.join(gameDir, 'backups')
    try {
      const entries = await fs.promises.readdir(backupsDir, { withFileTypes: true })
      const files = entries
        .filter(e => e.isFile() && e.name.endsWith('.zip'))
        .map(e => {
          const stat = fs.statSync(path.join(backupsDir, e.name))
          return { filename: e.name, size: stat.size, date: stat.mtimeMs }
        })
        .sort((a, b) => b.date - a.date)
      return files
    } catch { return [] }
  })

  ipcMain.handle('instances:delete-backup', async (_e, instanceId: string, filename: string) => {
    const gameDir = await getInstanceGameDir(instanceId)
    const target = path.join(gameDir, 'backups', path.basename(filename))
    await fs.promises.unlink(target)
  })

  // ── Mod source tracking ─────────────────────────────────────────────────────

  function normFilename(fn: string) {
    return fn.endsWith('.disabled') ? fn.slice(0, -'.disabled'.length) : fn
  }

  async function readModSources(gameDir: string): Promise<Record<string, { source: 'curseforge' | 'modrinth'; projectId?: number | string; fileId?: number | string }>> {
    try { return JSON.parse(await fs.promises.readFile(path.join(gameDir, 'mod-sources.json'), 'utf-8')) } catch { return {} }
  }

  async function writeModSource(gameDir: string, filename: string, info: { source: 'curseforge' | 'modrinth'; projectId?: number | string; fileId?: number | string }) {
    const filePath = path.join(gameDir, 'mod-sources.json')
    const sources = await readModSources(gameDir)
    sources[normFilename(filename)] = info
    await fs.promises.writeFile(filePath, JSON.stringify(sources, null, 2))
  }

  // ── CurseForge ──────────────────────────────────────────────────────────────

  const CF_API_KEY = '$2a$10$lH3wV/Q8E/bCpE7.jyIeWObw2LhbSypU8klDDAXvLsuikkHHJyAx.'

  async function cfFetch(apiPath: string) {
    const res = await axios.get(`https://api.curseforge.com${apiPath}`, {
      headers: {
        'x-api-key': CF_API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'ModpackLauncher/1.5 (contact@fport1.dev)'
      }
    })
    return res.data
  }

  ipcMain.handle('curseforge:search', async (_e, { query, gameVersion, classId, sortField, offset, modLoaderType, categoryId }: {
    query: string; gameVersion?: string; classId: number; sortField?: number; offset?: number; modLoaderType?: number; categoryId?: number
  }) => {
    const params = new URLSearchParams({
      gameId: '432',
      searchFilter: query,
      classId: String(classId),
      pageSize: '20',
      index: String(offset ?? 0),
      sortField: String(sortField ?? 6),
      sortOrder: 'desc',
    })
    if (gameVersion) params.set('gameVersion', gameVersion)
    if (modLoaderType !== undefined) params.set('modLoaderType', String(modLoaderType))
    if (categoryId !== undefined) params.set('categoryId', String(categoryId))
    return cfFetch(`/v1/mods/search?${params}`)
  })

  ipcMain.handle('curseforge:get-mod', async (_e, modId: number) =>
    cfFetch(`/v1/mods/${modId}`)
  )

  ipcMain.handle('curseforge:get-mod-description', async (_e, modId: number) =>
    cfFetch(`/v1/mods/${modId}/description`)
  )

  ipcMain.handle('curseforge:get-files', async (_e, modId: number, gameVersion: string | undefined, modLoaderType: number | undefined) => {
    const params = new URLSearchParams({ pageSize: '20' })
    if (gameVersion) params.set('gameVersion', gameVersion)
    if (modLoaderType !== undefined) params.set('modLoaderType', String(modLoaderType))
    return cfFetch(`/v1/mods/${modId}/files?${params}`)
  })

  ipcMain.handle('curseforge:get-categories', async (_e, classId: number) =>
    cfFetch(`/v1/categories?gameId=432&classId=${classId}`)
  )

  ipcMain.handle('curseforge:install-modpack', async (e, instanceId: string, modId: number, fileId: number) => {
    resetCancel()
    const tmpDir = path.join(os.tmpdir(), `cf-modpack-${Date.now()}`)
    try {
      const urlData = await cfFetch(`/v1/mods/${modId}/files/${fileId}/download-url`)
      const downloadUrl: string = urlData.data
      await fs.promises.mkdir(tmpDir, { recursive: true })
      const zipPath = path.join(tmpDir, 'modpack.zip')

      sendProgress(0, 1, 'Descargando modpack de CurseForge...', 'download')
      const zipRes = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        onDownloadProgress: (p) => {
          if (p.total) e.sender.send('progress', { type: 'download', current: p.loaded, total: p.total, message: 'Descargando modpack...' })
        }
      })
      await fs.promises.writeFile(zipPath, Buffer.from(zipRes.data as ArrayBuffer))

      sendProgress(0, 1, 'Extrayendo modpack...', 'download')
      const AdmZip = (await import('adm-zip')).default
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(tmpDir, true)

      const manifest = JSON.parse(await fs.promises.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8'))

      const gameDir = await getInstanceGameDir(instanceId)
      const modsDir = path.join(gameDir, 'mods')
      await fs.promises.mkdir(modsDir, { recursive: true })
      const requiredFiles = ((manifest.files ?? []) as { projectID: number; fileID: number; required: boolean }[]).filter(f => f.required)
      let done = 0
      for (const file of requiredFiles) {
        try {
          const urlRes = await cfFetch(`/v1/mods/${file.projectID}/files/${file.fileID}/download-url`)
          const modUrl: string = urlRes.data
          if (!modUrl) { done++; continue }
          const filename = decodeURIComponent(modUrl.split('/').pop() ?? `${file.projectID}.jar`)
          const modData = await axios.get(modUrl, { responseType: 'arraybuffer' })
          await fs.promises.writeFile(path.join(modsDir, filename), Buffer.from(modData.data as ArrayBuffer))
        } catch { /* skip failed mods */ }
        done++
        sendProgress(done, requiredFiles.length, `Instalando mods... (${done}/${requiredFiles.length})`, 'download')
      }

      const overridesDir = path.join(tmpDir, 'overrides')
      try {
        await fs.promises.cp(overridesDir, gameDir, { recursive: true, force: true })
      } catch { /* no overrides */ }

      await fs.promises.rm(tmpDir, { recursive: true, force: true })
      sendDone(currentMainWindow, '¡Modpack de CurseForge instalado!')
      return manifest
    } catch (ex) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      if (ex instanceof CancelError) { sendDone(currentMainWindow); return }
      throw ex
    }
  })

  ipcMain.handle('curseforge:install-mod', async (_e, instanceId: string, modId: number, fileId: number, subFolder?: string) => {
    const urlData = await cfFetch(`/v1/mods/${modId}/files/${fileId}/download-url`)
    const modUrl: string = urlData.data
    const filename = decodeURIComponent(modUrl.split('/').pop() ?? `${modId}.jar`)
    const gameDir = await getInstanceGameDir(instanceId)
    const destDir = path.join(gameDir, subFolder ?? 'mods')
    await fs.promises.mkdir(destDir, { recursive: true })
    const data = await axios.get(modUrl, { responseType: 'arraybuffer' })
    await fs.promises.writeFile(path.join(destDir, filename), Buffer.from(data.data as ArrayBuffer))
    await writeModSource(gameDir, filename, { source: 'curseforge', projectId: modId, fileId })
    return filename
  })

  ipcMain.handle('instances:get-mod-sources', async (_e, instanceId: string) => {
    const gameDir = await getInstanceGameDir(instanceId)
    return readModSources(gameDir)
  })

  // ── App updates ─────────────────────────────────────────────────────────────

  ipcMain.handle('updater:check', async () => {
    const settings = settingsStore.getAll()
    return checkForUpdates(settings.updateManifestUrl)
  })

  ipcMain.handle('updater:open-download', (_e, manifest: UpdateManifest) => {
    openDownloadPage(manifest)
  })

  ipcMain.handle('updater:download-and-install', async (e, manifest: UpdateManifest) => {
    await downloadAndInstall(manifest, (pct) => {
      e.sender.send('updater:download-progress', pct)
    })
  })

  ipcMain.handle('textures:save-to-folder', async (_e, files: { name: string; dataUrl: string }[]) => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Seleccionar carpeta de destino' })
    if (result.canceled || !result.filePaths.length) return null
    const folder = result.filePaths[0]
    for (const file of files) {
      const base64 = file.dataUrl.replace(/^data:image\/\w+;base64,/, '')
      await fs.promises.writeFile(path.join(folder, file.name), Buffer.from(base64, 'base64'))
    }
    return folder
  })

  // ── Friends ──────────────────────────────────────────────────────────────────

  ipcMain.handle('friends:list', () => getFriends())

  ipcMain.handle('friends:add', (_e, friend: Friend) => addFriend(friend))

  ipcMain.handle('friends:remove', (_e, uuid: string) => removeFriend(uuid))

  ipcMain.handle('friends:lookup', async (_e, username: string) => {
    const axiosLib = (await import('axios')).default
    try {
      const res = await axiosLib.get(
        `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username.trim())}`,
        { timeout: 8_000, headers: { 'User-Agent': 'ModpackLauncher/1.0' } }
      )
      return { uuid: res.data.id as string, username: res.data.name as string }
    } catch {
      return null
    }
  })

  // ── Console / Dev logs ────────────────────────────────────────────────────

  ipcMain.handle('console:get-logs', () => getLogBuffer())
}

function addAccount(account: MinecraftAccount): void {
  const { accounts } = accountsStore.getAll()
  const filtered = accounts.filter((a) => a.uuid !== account.uuid)
  accountsStore.set('accounts', [...filtered, account])
  accountsStore.set('activeId', account.id)
}

function updateAccount(account: MinecraftAccount): void {
  const { accounts } = accountsStore.getAll()
  accountsStore.set(
    'accounts',
    accounts.map((a) => (a.id === account.id ? account : a))
  )
}
