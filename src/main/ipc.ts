import { ipcMain, BrowserWindow } from 'electron'
import os from 'os'
import type { Instance, MinecraftAccount, Settings, ModpackManifest } from '../shared/types'
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
  readOptionsFile,
  writeOptionsFile,
  toggleMod,
  deleteMod,
  toggleResourcepack,
  deleteResourcepack,
  toggleShaderpack,
  deleteShaderpack,
  deleteWorld,
  deleteScreenshot
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
import { fetchManifest, installModpack, updateModpack, compareVersions } from './modpacks'
import { requestCancel, resetCancel, CancelError } from './cancelToken'

interface AccountsStore {
  accounts: MinecraftAccount[]
  activeId?: string
}

const settingsStore = new JsonStore<Settings>('settings', DEFAULT_SETTINGS)
const accountsStore = new JsonStore<AccountsStore>('accounts', { accounts: [] })

function sendDone(mainWindow: BrowserWindow, msg = 'Cancelado') {
  mainWindow.webContents.send('progress', { current: 0, total: 0, message: msg, type: 'install', done: true })
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // ── Cancel ──────────────────────────────────────────────────────────────────

  ipcMain.handle('operation:cancel', () => requestCancel())

  // ── Accounts ────────────────────────────────────────────────────────────────

  ipcMain.handle('auth:login-microsoft', async () => {
    const settings = settingsStore.getAll()
    const account = await loginMicrosoft(mainWindow, settings.azureClientId)
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
  ipcMain.handle('instances:read-options', (_e, instanceId: string) => readOptionsFile(instanceId))
  ipcMain.handle('instances:write-options', (_e, instanceId: string, content: string) => writeOptionsFile(instanceId, content))
  ipcMain.handle('instances:toggle-mod', (_e, instanceId: string, filename: string) => toggleMod(instanceId, filename))
  ipcMain.handle('instances:delete-mod', (_e, instanceId: string, filename: string) => deleteMod(instanceId, filename))
  ipcMain.handle('instances:toggle-resourcepack', (_e, instanceId: string, filename: string) => toggleResourcepack(instanceId, filename))
  ipcMain.handle('instances:delete-resourcepack', (_e, instanceId: string, filename: string) => deleteResourcepack(instanceId, filename))
  ipcMain.handle('instances:toggle-shaderpack', (_e, instanceId: string, filename: string) => toggleShaderpack(instanceId, filename))
  ipcMain.handle('instances:delete-shaderpack', (_e, instanceId: string, filename: string) => deleteShaderpack(instanceId, filename))
  ipcMain.handle('instances:delete-world', (_e, instanceId: string, worldName: string) => deleteWorld(instanceId, worldName))
  ipcMain.handle('instances:delete-screenshot', (_e, instanceId: string, filename: string) => deleteScreenshot(instanceId, filename))
  ipcMain.handle('instances:duplicate', (_e, instanceId: string, newName: string) => duplicateInstance(instanceId, newName))
  ipcMain.handle('instances:pick-icon', (_e, instanceId: string) => pickInstanceIcon(instanceId, mainWindow))
  ipcMain.handle('instances:get-icon', (_e, instanceId: string) => getInstanceIconBase64(instanceId))
  ipcMain.handle('instances:list-default-icons', () => listDefaultIcons())
  ipcMain.handle('instances:check-name', (_e, name: string, excludeId?: string) => checkInstanceNameExists(name, excludeId))
  ipcMain.handle('instances:list-game-dir', (_e, instanceId: string, subPath?: string) => listGameDirEntries(instanceId, subPath))
  ipcMain.handle('instances:get-default-icon', () => getDefaultIconBase64())
  ipcMain.handle('instances:pick-icon-preview', () => pickIconPreview(mainWindow))
  ipcMain.handle('instances:apply-pending-icon', (_e, instanceId: string, filePath: string) => applyPendingIcon(instanceId, filePath))

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
        instance, account, settings, mainWindow,
        (current, total, message) => {
          mainWindow.webContents.send('progress', { current, total, message, type: 'install' })
        },
        async (sessionMs) => {
          instance.playtime = (instance.playtime ?? 0) + sessionMs
          await updateInstance(instance)
        }
      )

      instance.lastPlayed = Date.now()
      await updateInstance(instance)
      sendDone(mainWindow, 'Minecraft iniciado!')
    } catch (e) {
      if (e instanceof CancelError) {
        sendDone(mainWindow)
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
          mainWindow.webContents.send('progress', { current, total, message, type: 'install' })
        })

        if (modloader && modloader !== 'vanilla') {
          const fake = {
            modloader: modloader as Instance['modloader'],
            modloaderVersion,
            minecraft: version
          } as Instance
          await installModloader(fake, (current, total, message) => {
            mainWindow.webContents.send('progress', { current, total, message, type: 'install' })
          })
        }
      } catch (e) {
        if (e instanceof CancelError) { sendDone(mainWindow); return }
        throw e
      }
    }
  )

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
        mainWindow.webContents.send('progress', { current, total, message, type: 'download' })
      })
      sendDone(mainWindow, '¡Modpack instalado!')
    } catch (e) {
      if (e instanceof CancelError) { sendDone(mainWindow); return }
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
        mainWindow.webContents.send('progress', { current, total, message, type: 'download' })
      })

      instance.modpackVersion = manifest.version
      await updateInstance(instance)
      sendDone(mainWindow, '¡Actualización completada!')
      return { upToDate: false, manifest, ...result }
    } catch (e) {
      if (e instanceof CancelError) { sendDone(mainWindow); return { upToDate: false, manifest } }
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
  })

  // ── Java ────────────────────────────────────────────────────────────────────

  ipcMain.handle('java:check', (_e, mcVersion: string) => checkJavaStatus(mcVersion))

  ipcMain.handle('java:ensure', async (_e, mcVersion: string) => {
    resetCancel()
    try {
      return await ensureJava(mcVersion, (current, total, msg) => {
        mainWindow.webContents.send('progress', { current, total, message: msg, type: 'install' })
      })
    } catch (e) {
      if (e instanceof CancelError) { sendDone(mainWindow); return null }
      throw e
    }
  })

  // ── Player skin ─────────────────────────────────────────────────────────────

  ipcMain.handle('skin:get-head', async (_e, uuid: string) => {
    try {
      const axios = (await import('axios')).default
      const url = `https://crafatar.com/renders/head/${uuid}?size=64&overlay=true`
      const res = await axios.get<Buffer>(url, {
        responseType: 'arraybuffer',
        timeout: 8_000,
        headers: { 'User-Agent': 'ModpackLauncher/1.0' }
      })
      return `data:image/png;base64,${Buffer.from(res.data).toString('base64')}`
    } catch {
      return null
    }
  })

  // ── System ──────────────────────────────────────────────────────────────────

  ipcMain.handle('system:get-ram', () => Math.floor(os.totalmem() / 1024 / 1024))

  ipcMain.handle('system:get-display-hz', async () => {
    const { screen } = await import('electron')
    return screen.getPrimaryDisplay().displayFrequency
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
