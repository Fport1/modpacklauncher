import { contextBridge, ipcRenderer } from 'electron'
import type {
  Instance,
  MinecraftAccount,
  Settings,
  ModpackManifest,
  DownloadProgress
} from '../shared/types'
import type { ModFile, ModMeta, WorldFolder, ScreenshotFile, CrashReport, ConfigFile } from '../main/instances'
export type { ModFile, ModMeta }

const api = {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximized: (cb: (maximized: boolean) => void) => {
      ipcRenderer.on('window:maximized', (_e, v) => cb(v))
    },
    onRequestClose: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('app:request-close', handler)
      return () => ipcRenderer.removeListener('app:request-close', handler)
    },
    confirmClose: () => ipcRenderer.send('app:confirm-close'),
  },

  // Auth
  auth: {
    loginMicrosoft: () => ipcRenderer.invoke('auth:login-microsoft') as Promise<MinecraftAccount>,
    loginOffline: (username: string) =>
      ipcRenderer.invoke('auth:login-offline', username) as Promise<MinecraftAccount>,
    logout: (accountId: string) => ipcRenderer.invoke('auth:logout', accountId),
    getAccounts: () =>
      ipcRenderer.invoke('auth:get-accounts') as Promise<{
        accounts: MinecraftAccount[]
        activeId?: string
      }>,
    setActive: (accountId: string) => ipcRenderer.invoke('auth:set-active', accountId),
    refresh: (account: MinecraftAccount) =>
      ipcRenderer.invoke('auth:refresh', account) as Promise<MinecraftAccount>
  },

  // Instances
  instances: {
    list: () => ipcRenderer.invoke('instances:list') as Promise<Instance[]>,
    create: (data: Omit<Instance, 'id' | 'createdAt'>) =>
      ipcRenderer.invoke('instances:create', data) as Promise<Instance>,
    update: (instance: Instance) => ipcRenderer.invoke('instances:update', instance),
    delete: (instanceId: string) => ipcRenderer.invoke('instances:delete', instanceId),
    openFolder: (instanceId: string) => ipcRenderer.invoke('instances:open-folder', instanceId),
    listMods: (instanceId: string) => ipcRenderer.invoke('instances:list-mods', instanceId) as Promise<ModFile[]>,
    listWorlds: (instanceId: string) => ipcRenderer.invoke('instances:list-worlds', instanceId) as Promise<WorldFolder[]>,
    listResourcepacks: (instanceId: string) => ipcRenderer.invoke('instances:list-resourcepacks', instanceId) as Promise<ModFile[]>,
    openModsFolder: (instanceId: string) => ipcRenderer.invoke('instances:open-mods-folder', instanceId),
    openSavesFolder: (instanceId: string) => ipcRenderer.invoke('instances:open-saves-folder', instanceId),
    openResourcepacksFolder: (instanceId: string) => ipcRenderer.invoke('instances:open-resourcepacks-folder', instanceId),
    listShaderpacks: (instanceId: string) => ipcRenderer.invoke('instances:list-shaderpacks', instanceId) as Promise<ModFile[]>,
    openShaderpacks: (instanceId: string) => ipcRenderer.invoke('instances:open-shaderpacks-folder', instanceId),
    listScreenshots: (instanceId: string) => ipcRenderer.invoke('instances:list-screenshots', instanceId) as Promise<ScreenshotFile[]>,
    openScreenshots: (instanceId: string) => ipcRenderer.invoke('instances:open-screenshots-folder', instanceId),
    listCrashReports: (instanceId: string) => ipcRenderer.invoke('instances:list-crash-reports', instanceId) as Promise<CrashReport[]>,
    readCrashReport: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:read-crash-report', instanceId, filename) as Promise<string>,
    readLatestLog: (instanceId: string) => ipcRenderer.invoke('instances:read-latest-log', instanceId) as Promise<string>,
    openLogsFolder: (instanceId: string) => ipcRenderer.invoke('instances:open-logs-folder', instanceId),
    openCrashReportsFolder: (instanceId: string) => ipcRenderer.invoke('instances:open-crash-reports-folder', instanceId),
    listConfig: (instanceId: string, subPath?: string) => ipcRenderer.invoke('instances:list-config', instanceId, subPath) as Promise<ConfigFile[]>,
    openConfigFolder: (instanceId: string) => ipcRenderer.invoke('instances:open-config-folder', instanceId),
    readConfigFile: (instanceId: string, filePath: string) => ipcRenderer.invoke('instances:read-config-file', instanceId, filePath) as Promise<string>,
    writeConfigFile: (instanceId: string, filePath: string, content: string) => ipcRenderer.invoke('instances:write-config-file', instanceId, filePath, content) as Promise<void>,
    readOptions: (instanceId: string) => ipcRenderer.invoke('instances:read-options', instanceId) as Promise<string>,
    writeOptions: (instanceId: string, content: string) => ipcRenderer.invoke('instances:write-options', instanceId, content),
    toggleMod: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:toggle-mod', instanceId, filename) as Promise<string>,
    deleteMod: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-mod', instanceId, filename),
    toggleResourcepack: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:toggle-resourcepack', instanceId, filename) as Promise<string>,
    deleteResourcepack: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-resourcepack', instanceId, filename),
    toggleShaderpack: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:toggle-shaderpack', instanceId, filename) as Promise<string>,
    deleteShaderpack: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-shaderpack', instanceId, filename),
    deleteWorld: (instanceId: string, worldName: string) => ipcRenderer.invoke('instances:delete-world', instanceId, worldName),
    deleteScreenshot: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-screenshot', instanceId, filename),
    duplicate: (instanceId: string, newName: string) => ipcRenderer.invoke('instances:duplicate', instanceId, newName) as Promise<Instance>,
    pickIcon: (instanceId: string) => ipcRenderer.invoke('instances:pick-icon', instanceId) as Promise<Instance | null>,
    getIcon: (instanceId: string) => ipcRenderer.invoke('instances:get-icon', instanceId) as Promise<string | null>,
    listDefaultIcons: () => ipcRenderer.invoke('instances:list-default-icons') as Promise<Array<{ name: string; base64: string; filePath: string }>>,
    checkName: (name: string, excludeId?: string) => ipcRenderer.invoke('instances:check-name', name, excludeId) as Promise<boolean>,
    listGameDir: (instanceId: string, subPath?: string) => ipcRenderer.invoke('instances:list-game-dir', instanceId, subPath) as Promise<Array<{ name: string; relativePath: string; isDir: boolean; size?: number }>>,
    getDefaultIcon: () => ipcRenderer.invoke('instances:get-default-icon') as Promise<string | null>,
    pickIconPreview: () => ipcRenderer.invoke('instances:pick-icon-preview') as Promise<{ filePath: string; base64: string } | null>,
    applyPendingIcon: (instanceId: string, filePath: string) => ipcRenderer.invoke('instances:apply-pending-icon', instanceId, filePath) as Promise<void>,
    setIconFromUrl: (instanceId: string, url: string) => ipcRenderer.invoke('instances:set-icon-from-url', instanceId, url) as Promise<void>,
    getSize: (instanceId: string) => ipcRenderer.invoke('instances:get-size', instanceId) as Promise<string>
  },

  // Clipboard
  clipboard: {
    writeImagePath: (filePath: string) => ipcRenderer.invoke('clipboard:write-image-path', filePath),
    writeText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text)
  },

  // Shell
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url)
  },

  // Launcher
  launcher: {
    launch: (instanceId: string) => ipcRenderer.invoke('launcher:launch', instanceId),
    kill: (instanceId: string) => ipcRenderer.invoke('launcher:kill', instanceId),
    installVersion: (version: string, modloader?: string, modloaderVersion?: string) =>
      ipcRenderer.invoke('launcher:install-version', version, modloader, modloaderVersion),
    getMcVersions: () =>
      ipcRenderer.invoke('launcher:get-mc-versions') as Promise<
        Array<{ id: string; type: string; releaseTime: string }>
      >,
    getForgeVersions: (minecraft: string) =>
      ipcRenderer.invoke('launcher:get-forge-versions', minecraft) as Promise<string[]>,
    getFabricVersions: () =>
      ipcRenderer.invoke('launcher:get-fabric-versions') as Promise<Array<{ version: string; stable: boolean }>>,
    getQuiltVersions: () =>
      ipcRenderer.invoke('launcher:get-quilt-versions') as Promise<string[]>,
    getNeoForgeVersions: (minecraft: string) =>
      ipcRenderer.invoke('launcher:get-neoforge-versions', minecraft) as Promise<string[]>
  },

  // Modpacks
  modpacks: {
    fetch: (url: string, key?: string) => ipcRenderer.invoke('modpacks:fetch', url, key) as Promise<ModpackManifest>,
    install: (instanceId: string, manifest: ModpackManifest) =>
      ipcRenderer.invoke('modpacks:install', instanceId, manifest),
    update: (instanceId: string, manifestUrl: string) =>
      ipcRenderer.invoke('modpacks:update', instanceId, manifestUrl) as Promise<{
        upToDate: boolean
        manifest: ModpackManifest
        added?: string[]
        removed?: string[]
        updated?: string[]
      }>,
    checkUpdate: (instanceId: string, manifestUrl: string) =>
      ipcRenderer.invoke('modpacks:check-update', instanceId, manifestUrl) as Promise<{
        hasUpdate: boolean
        manifest: ModpackManifest
        currentVersion?: string
      }>,
    export: (params: {
      instanceId: string; name: string; version: string; description: string
      changelog: string; repoName: string; githubToken: string
      minecraft: string; modloader: string; modloaderVersion?: string
      selectedPaths: string[]; accessKey?: string
    }) => ipcRenderer.invoke('modpacks:export', params) as Promise<string>,
    onExportProgress: (cb: (p: { message: string; current: number; total: number }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, p: { message: string; current: number; total: number }) => cb(p)
      ipcRenderer.on('modpacks:export-progress', handler)
      return () => ipcRenderer.removeListener('modpacks:export-progress', handler)
    },
    getPublished: () => ipcRenderer.invoke('modpacks:get-published'),
    deletePublished: (id: string) => ipcRenderer.invoke('modpacks:delete-published', id)
  },

  // Modrinth
  modrinth: {
    search: (query: string, mcVersion: string, loader: string, categories: string[], environment: string, projectType?: string, limit?: number, offset?: number, index?: string) =>
      ipcRenderer.invoke('modrinth:search', query, mcVersion, loader, categories, environment, projectType ?? 'mod', limit ?? 20, offset ?? 0, index ?? 'relevance') as Promise<any>,
    getVersions: (projectId: string, mcVersion: string, loader: string) =>
      ipcRenderer.invoke('modrinth:get-versions', projectId, mcVersion, loader) as Promise<any[]>,
    installMod: (instanceId: string, fileUrl: string, filename: string, subFolder?: string) =>
      ipcRenderer.invoke('modrinth:install-mod', instanceId, fileUrl, filename, subFolder) as Promise<void>,
    getCategories: (projectType?: string) =>
      ipcRenderer.invoke('modrinth:get-categories', projectType) as Promise<any[]>,
    getInstalledIds: (instanceId: string, subFolder?: string, extensions?: string[]) =>
      ipcRenderer.invoke('modrinth:get-installed-ids', instanceId, subFolder, extensions) as Promise<string[]>,
    getInstalledIcons: (instanceId: string, subFolder?: string, extensions?: string[]) =>
      ipcRenderer.invoke('modrinth:get-installed-icons', instanceId, subFolder, extensions) as Promise<Record<string, string | null>>,
    getInstalledModsMeta: (instanceId: string, mcVersion: string, loader: string, subFolder?: string, extensions?: string[]) =>
      ipcRenderer.invoke('modrinth:get-installed-mods-meta', instanceId, mcVersion, loader, subFolder, extensions) as Promise<Record<string, { iconUrl?: string | null; clientSide?: string; serverSide?: string; projectId?: string; installedVersionId?: string; hasUpdate?: boolean }>>,
    getProject: (projectId: string) =>
      ipcRenderer.invoke('modrinth:get-project', projectId) as Promise<any>,
    getProjects: (projectIds: string[]) =>
      ipcRenderer.invoke('modrinth:get-projects', projectIds) as Promise<any[]>,
    getProjectVersion: (projectId: string, mcVersion: string, loader: string) =>
      ipcRenderer.invoke('modrinth:get-project-version', projectId, mcVersion, loader) as Promise<any | null>,
    installMrpack: (instanceId: string, mrpackUrl: string) =>
      ipcRenderer.invoke('modrinth:install-mrpack', instanceId, mrpackUrl) as Promise<void>,
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
    set: (data: Partial<Settings>) => ipcRenderer.invoke('settings:set', data)
  },

  // Progress events
  onProgress: (cb: (progress: DownloadProgress) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: DownloadProgress) => cb(data)
    ipcRenderer.on('progress', handler)
    return () => ipcRenderer.removeListener('progress', handler)
  },

  // Java
  java: {
    check: (mcVersion: string) =>
      ipcRenderer.invoke('java:check', mcVersion) as Promise<{
        found: boolean
        path?: string
        version?: number
        required: number
        managed: boolean
      }>,
    ensure: (mcVersion: string) => ipcRenderer.invoke('java:ensure', mcVersion) as Promise<string>
  },

  // System
  system: {
    getRam: () => ipcRenderer.invoke('system:get-ram') as Promise<number>,
    getDisplayHz: () => ipcRenderer.invoke('system:get-display-hz') as Promise<number>
  },

  // App updater
  updater: {
    check: () =>
      ipcRenderer.invoke('updater:check') as Promise<{
        hasUpdate: boolean
        currentVersion: string
        manifest?: {
          version: string
          releaseNotes?: string
          date?: string
          files: { win32?: string; darwin?: string; linux?: string }
        }
      }>,
    openDownload: (manifest: {
      version: string
      files: { win32?: string; darwin?: string; linux?: string }
    }) => ipcRenderer.invoke('updater:open-download', manifest),
    downloadAndInstall: (manifest: {
      version: string
      files: { win32?: string; darwin?: string; linux?: string }
    }) => ipcRenderer.invoke('updater:download-and-install', manifest) as Promise<void>,
    onDownloadProgress: (cb: (pct: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, pct: number) => cb(pct)
      ipcRenderer.on('updater:download-progress', handler)
      return () => ipcRenderer.removeListener('updater:download-progress', handler)
    }
  },

  // Player skin
  skin: {
    getHead: (uuid: string) => ipcRenderer.invoke('skin:get-head', uuid) as Promise<string | null>,
    getTexture: (uuid: string) => ipcRenderer.invoke('skin:get-texture', uuid) as Promise<{ skin: string; cape: string | null; model: 'classic' | 'slim' } | null>,
    getProfileCapes: (accessToken: string) => ipcRenderer.invoke('skin:get-profile-capes', accessToken) as Promise<{ id: string; state: string; url: string; alias: string; texture: string | null }[]>,
    equipCape: (accessToken: string, capeId: string) => ipcRenderer.invoke('skin:equip-cape', accessToken, capeId) as Promise<void>,
    removeCape: (accessToken: string) => ipcRenderer.invoke('skin:remove-cape', accessToken) as Promise<void>,
  },

  // Skin library + browser
  skins: {
    listLibrary: () => ipcRenderer.invoke('skins:list-library') as Promise<{ id: string; name: string; model: 'classic' | 'slim'; data: string; addedAt: string }[]>,
    saveToLibrary: (entry: { name: string; model: 'classic' | 'slim'; data: string }) => ipcRenderer.invoke('skins:save-to-library', entry) as Promise<{ id: string; name: string; model: 'classic' | 'slim'; data: string; addedAt: string }>,
    updateLibrary: (entry: { id: string; name: string; model: 'classic' | 'slim'; data?: string }) => ipcRenderer.invoke('skins:update-library', entry) as Promise<{ id: string; name: string; model: 'classic' | 'slim'; data: string; addedAt: string }>,
    deleteFromLibrary: (id: string) => ipcRenderer.invoke('skins:delete-from-library', id) as Promise<void>,
    pickFile: () => ipcRenderer.invoke('skins:pick-file') as Promise<string | null>,
    apply: (accountId: string, skinBase64: string, model: 'classic' | 'slim') => ipcRenderer.invoke('skins:apply', accountId, skinBase64, model) as Promise<void>,
    searchSkindex: (query: string, page: number) => ipcRenderer.invoke('skins:search-skindex', query, page) as Promise<{ id: string; name: string; renderUrl: string }[]>,
    fetchSkinPng: (skinId: string, renderUrl?: string) => ipcRenderer.invoke('skins:fetch-skin-png', skinId, renderUrl) as Promise<string>,
    getDefaults: () => ipcRenderer.invoke('skins:get-defaults') as Promise<{ name: string; model: 'classic' | 'slim'; data: string }[]>
  },

  // Status
  status: {
    check: () => ipcRenderer.invoke('status:check') as Promise<{ id: string; name: string; url: string; status: 'up' | 'down'; latency: number }[]>
  },

  // Mouse back navigation signal from main process
  onNavBack: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('nav:back', handler)
    return () => ipcRenderer.removeListener('nav:back', handler)
  },

  // Cancel current operation
  cancel: () => ipcRenderer.invoke('operation:cancel') as Promise<void>,

  // Game process events
  onGameStarted: (cb: (instanceId: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, id: string) => cb(id)
    ipcRenderer.on('game:started', handler)
    return () => ipcRenderer.removeListener('game:started', handler)
  },
  onGameLog: (cb: (instanceId: string, line: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, id: string, line: string) => cb(id, line)
    ipcRenderer.on('game:log', handler)
    return () => ipcRenderer.removeListener('game:log', handler)
  },
  onGameExit: (cb: (instanceId: string, code: number | null) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, id: string, code: number | null) => cb(id, code)
    ipcRenderer.on('game:exit', handler)
    return () => ipcRenderer.removeListener('game:exit', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
