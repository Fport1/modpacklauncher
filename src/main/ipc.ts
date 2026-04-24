import { ipcMain, BrowserWindow, app, dialog } from 'electron'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
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
  deleteScreenshot,
  getInstanceSize
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
import { searchMods, getModVersions, installModFromUrl, getModrinthCategories, getInstalledProjectIds, getInstalledProjectIcons, getProjectVersionForInstall, getProject, getProjects, getInstalledModsMeta } from './modrinth'
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

  // ── Modrinth ─────────────────────────────────────────────────────────────────

  ipcMain.handle('modrinth:search', (_e, query, mcVersion, loader, categories, environment, projectType, limit, offset, index) =>
    searchMods(query, mcVersion, loader, categories, environment, projectType, limit, offset, index)
  )
  ipcMain.handle('modrinth:get-versions', (_e, projectId: string, mcVersion: string, loader: string) =>
    getModVersions(projectId, mcVersion, loader)
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
  ipcMain.handle('modrinth:get-project-version', (_e, projectId: string, mcVersion: string, loader: string) =>
    getProjectVersionForInstall(projectId, mcVersion, loader)
  )
  ipcMain.handle('modrinth:get-installed-mods-meta', (_e, instanceId: string, mcVersion: string, loader: string, subFolder?: string, extensions?: string[]) =>
    getInstalledModsMeta(instanceId, mcVersion, loader, subFolder, extensions)
  )

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
      const url = `https://mc-heads.net/avatar/${uuid}/64`
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
      if (!skinUrl) return null

      const fetchB64 = async (url: string) => {
        const r = await axios.get<Buffer>(url, { responseType: 'arraybuffer', timeout: 10_000, headers: { 'User-Agent': 'ModpackLauncher/1.0' } })
        return `data:image/png;base64,${Buffer.from(r.data).toString('base64')}`
      }

      const [skin, cape] = await Promise.all([
        fetchB64(skinUrl),
        capeUrl ? fetchB64(capeUrl).catch(() => null) : Promise.resolve(null)
      ])
      return { skin, cape }
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

  ipcMain.handle('skins:apply', async (_e, accessToken: string, skinBase64: string, model: 'classic' | 'slim') => {
    const base64Data = skinBase64.replace(/^data:image\/png;base64,/, '')
    const skinBuffer = Buffer.from(base64Data, 'base64')
    const formData = new FormData()
    formData.append('variant', model)
    formData.append('file', new Blob([skinBuffer], { type: 'image/png' }), 'skin.png')
    const res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  })

  // Popular skin creators — used when no search query (usernames verified via NameMC)
  const POPULAR_PLAYERS = [
    // Devs de Minecraft
    'Notch', 'jeb_', 'Dinnerbone', 'Grumm',
    // Anglosajones
    'Dream', 'Technoblade', 'Ph1LzA', 'TommyInnit', 'GeorgeNotFound', 'Sapnap',
    // España
    'VEGETTA777', 'Willyrex', 'AuronPlay', 'ElRichMC', 'Mikecrack',
    'alexby11', 'roier', 'sTaXxCraft', 'LuzuVlogs', 'Crisgreen',
    'Conterstine', 'Shadoune666',
    // Latinoamérica
    'WestCOL', 'Quackity', 'killercreper_55', 'Bobicraft', 'Spreen',
    'JuanSGuarnizo', 'Farfadox', 'ElDed', 'alexelcapo',
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
