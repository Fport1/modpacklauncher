import { contextBridge, ipcRenderer } from 'electron'
import type {
  Instance,
  MinecraftAccount,
  Settings,
  ModpackManifest,
  DownloadProgress,
  Friend
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
    getModSources: (instanceId: string) => ipcRenderer.invoke('instances:get-mod-sources', instanceId) as Promise<Record<string, { source: 'curseforge' | 'modrinth'; projectId?: number | string; fileId?: number | string }>>,
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
    listWorldFiles: (instanceId: string, relativePath?: string) => ipcRenderer.invoke('instances:list-world-files', instanceId, relativePath) as Promise<ConfigFile[]>,
    readWorldFile: (instanceId: string, relativePath: string) => ipcRenderer.invoke('instances:read-world-file', instanceId, relativePath) as Promise<string>,
    writeWorldFile: (instanceId: string, relativePath: string, content: string) => ipcRenderer.invoke('instances:write-world-file', instanceId, relativePath, content) as Promise<void>,
    copyFilesToWorld: (instanceId: string, relativePath: string, filePaths: string[]) => ipcRenderer.invoke('instances:copy-files-to-world', instanceId, relativePath, filePaths) as Promise<void>,
    toggleMod: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:toggle-mod', instanceId, filename) as Promise<string>,
    deleteMod: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-mod', instanceId, filename),
    toggleResourcepack: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:toggle-resourcepack', instanceId, filename) as Promise<string>,
    deleteResourcepack: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-resourcepack', instanceId, filename),
    toggleShaderpack: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:toggle-shaderpack', instanceId, filename) as Promise<string>,
    deleteShaderpack: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-shaderpack', instanceId, filename),
    deleteWorld: (instanceId: string, worldName: string) => ipcRenderer.invoke('instances:delete-world', instanceId, worldName),
    deleteScreenshot: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-screenshot', instanceId, filename),
    duplicate: (instanceId: string, newName: string) => ipcRenderer.invoke('instances:duplicate', instanceId, newName) as Promise<Instance>,
    onDuplicateProgress: (cb: (step: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, step: number) => cb(step)
      ipcRenderer.on('instances:duplicate-progress', handler)
      return () => ipcRenderer.removeListener('instances:duplicate-progress', handler)
    },
    pickIcon: (instanceId: string) => ipcRenderer.invoke('instances:pick-icon', instanceId) as Promise<Instance | null>,
    getIcon: (instanceId: string) => ipcRenderer.invoke('instances:get-icon', instanceId) as Promise<string | null>,
    listDefaultIcons: () => ipcRenderer.invoke('instances:list-default-icons') as Promise<Array<{ name: string; base64: string; filePath: string }>>,
    checkName: (name: string, excludeId?: string) => ipcRenderer.invoke('instances:check-name', name, excludeId) as Promise<boolean>,
    listGameDir: (instanceId: string, subPath?: string) => ipcRenderer.invoke('instances:list-game-dir', instanceId, subPath) as Promise<Array<{ name: string; relativePath: string; isDir: boolean; size?: number }>>,
    getDefaultIcon: () => ipcRenderer.invoke('instances:get-default-icon') as Promise<string | null>,
    pickIconPreview: () => ipcRenderer.invoke('instances:pick-icon-preview') as Promise<{ filePath: string; base64: string } | null>,
    applyPendingIcon: (instanceId: string, filePath: string) => ipcRenderer.invoke('instances:apply-pending-icon', instanceId, filePath) as Promise<void>,
    setIconFromUrl: (instanceId: string, url: string) => ipcRenderer.invoke('instances:set-icon-from-url', instanceId, url) as Promise<void>,
    getSize: (instanceId: string) => ipcRenderer.invoke('instances:get-size', instanceId) as Promise<string>,
    installJar: (instanceId: string, sourcePath: string) => ipcRenderer.invoke('instances:install-jar', instanceId, sourcePath) as Promise<string>,
    backupWorld: (instanceId: string, worldName: string) => ipcRenderer.invoke('instances:backup-world', instanceId, worldName) as Promise<string>,
    listBackups: (instanceId: string) => ipcRenderer.invoke('instances:list-backups', instanceId) as Promise<{ filename: string; size: number; date: number }[]>,
    deleteBackup: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-backup', instanceId, filename) as Promise<void>
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
    launchExtra: (instanceId: string) => ipcRenderer.invoke('launcher:launch-extra', instanceId) as Promise<void>,
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
    getVersions: (projectId: string, mcVersion: string, loader: string, channel?: 'all' | 'stable') =>
      ipcRenderer.invoke('modrinth:get-versions', projectId, mcVersion, loader, channel ?? 'all') as Promise<any[]>,
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
    getProjectVersion: (projectId: string, mcVersion: string, loader: string, channel?: 'all' | 'stable') =>
      ipcRenderer.invoke('modrinth:get-project-version', projectId, mcVersion, loader, channel ?? 'all') as Promise<any | null>,
    installMrpack: (instanceId: string, mrpackUrl: string) =>
      ipcRenderer.invoke('modrinth:install-mrpack', instanceId, mrpackUrl) as Promise<{ modloader?: string; modloaderVersion?: string } | undefined>,
  },

  // CurseForge
  curseforge: {
    search: (opts: { query: string; gameVersion?: string; classId: number; sortField?: number; offset?: number; modLoaderType?: number; categoryId?: number }) =>
      ipcRenderer.invoke('curseforge:search', opts) as Promise<any>,
    getMod: (modId: number) =>
      ipcRenderer.invoke('curseforge:get-mod', modId) as Promise<any>,
    getModDescription: (modId: number) =>
      ipcRenderer.invoke('curseforge:get-mod-description', modId) as Promise<any>,
    getFiles: (modId: number, gameVersion: string | undefined, modLoaderType: number | undefined) =>
      ipcRenderer.invoke('curseforge:get-files', modId, gameVersion, modLoaderType) as Promise<any>,
    getCategories: (classId: number) =>
      ipcRenderer.invoke('curseforge:get-categories', classId) as Promise<any>,
    installModpack: (instanceId: string, modId: number, fileId: number) =>
      ipcRenderer.invoke('curseforge:install-modpack', instanceId, modId, fileId) as Promise<any>,
    installMod: (instanceId: string, modId: number, fileId: number, subFolder?: string) =>
      ipcRenderer.invoke('curseforge:install-mod', instanceId, modId, fileId, subFolder) as Promise<string>,
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
    getDisplayHz: () => ipcRenderer.invoke('system:get-display-hz') as Promise<number>,
    getDisplays: () => ipcRenderer.invoke('system:get-displays') as Promise<{ id: number; label: string; bounds: { x: number; y: number; width: number; height: number }; isPrimary: boolean }[]>
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

  // Announcements
  announcements: {
    fetch: () => ipcRenderer.invoke('announcements:fetch') as Promise<{
      id: string
      type: 'update' | 'info' | 'warning' | 'event' | 'sponsor'
      title: string
      summary: string
      date: string
      imageUrl: string | null
      linkUrl: string | null
      linkLabel: string | null
    }[]>
  },

  // Admin
  admin: {
    publishAnnouncements: (announcements: {
      id: string; type: string; title: string; summary: string
      date: string; imageUrl: string | null; linkUrl: string | null; linkLabel: string | null
      active?: boolean
    }[]) => ipcRenderer.invoke('admin:publish-announcements', announcements) as Promise<void>,
    setVisibility: (id: string, active: boolean) => ipcRenderer.invoke('admin:set-visibility', id, active) as Promise<void>
  },

  // Status
  status: {
    check: () => ipcRenderer.invoke('status:check') as Promise<{ id: string; name: string; url: string; status: 'up' | 'down'; latency: number }[]>,
    checkServer: (host: string, port: number) => ipcRenderer.invoke('status:check-server', host, port) as Promise<{ online: boolean; latency: number; players?: { online: number; max: number }; version?: string }>
  },

  // Texture export
  textures: {
    saveToFolder: (files: { name: string; dataUrl: string }[]) =>
      ipcRenderer.invoke('textures:save-to-folder', files) as Promise<string | null>,
  },

  // AI crash/log analysis
  ai: {
    analyze: (content: string, type: 'crash' | 'log', configId: string) =>
      ipcRenderer.invoke('ai:analyze', content, type, configId) as Promise<string>,
  },

  // Friends
  friends: {
    list: () => ipcRenderer.invoke('friends:list') as Promise<Friend[]>,
    add: (friend: Friend) => ipcRenderer.invoke('friends:add', friend) as Promise<void>,
    remove: (uuid: string) => ipcRenderer.invoke('friends:remove', uuid) as Promise<void>,
    lookup: (username: string) => ipcRenderer.invoke('friends:lookup', username) as Promise<{ uuid: string; username: string } | null>,
  },

  // .fpack file install
  fpack: {
    onOpen: (cb: (filePath: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, p: string) => cb(p)
      ipcRenderer.on('fpack:open', handler)
      return () => ipcRenderer.removeListener('fpack:open', handler)
    },
    readManifest: (filePath: string) =>
      ipcRenderer.invoke('fpack:read-manifest', filePath) as Promise<ModpackManifest>,
    import: (filePath: string, instanceName: string) =>
      ipcRenderer.invoke('fpack:import', filePath, instanceName) as Promise<import('../shared/types').Instance>,
    onProgress: (cb: (data: { current: number; total: number; message: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, d: { current: number; total: number; message: string }) => cb(d)
      ipcRenderer.on('fpack:progress', handler)
      return () => ipcRenderer.removeListener('fpack:progress', handler)
    },
    choosePath: (instanceId: string) =>
      ipcRenderer.invoke('fpack:choose-path', instanceId) as Promise<string | null>,
    saveTo: (instanceId: string, outputPath: string, manifest?: ModpackManifest) =>
      ipcRenderer.invoke('fpack:save-to', instanceId, outputPath, manifest) as Promise<void>,
    onSaveProgress: (cb: (data: { message: string; current: number; total: number }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, d: { message: string; current: number; total: number }) => cb(d)
      ipcRenderer.on('fpack:save-progress', handler)
      return () => ipcRenderer.removeListener('fpack:save-progress', handler)
    },
    browse: () => ipcRenderer.invoke('fpack:browse') as Promise<string | null>,
  },

  // QR utilities
  qr: {
    saveImage: (dataUrl: string, suggestedName: string) =>
      ipcRenderer.invoke('qr:save-image', dataUrl, suggestedName) as Promise<string | null>,
  },

  // Deep link events from main process (modpacklauncher:// protocol)
  onDeepLink: (cb: (action: string, params: Record<string, string>) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, action: string, params: Record<string, string>) => cb(action, params)
    ipcRenderer.on('deep-link', handler)
    return () => ipcRenderer.removeListener('deep-link', handler)
  },

  // Mouse back navigation signal from main process
  onNavBack: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('nav:back', handler)
    return () => ipcRenderer.removeListener('nav:back', handler)
  },

  // Cancel current operation
  cancel: () => ipcRenderer.invoke('operation:cancel') as Promise<void>,

  // Operations panel events
  ops: {
    onUpdate: (cb: (update: Record<string, unknown>) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: Record<string, unknown>) => cb(data)
      ipcRenderer.on('ops:update', handler)
      return () => ipcRenderer.removeListener('ops:update', handler)
    }
  },

  // Launcher console logs
  console: {
    getLogs: () => ipcRenderer.invoke('console:get-logs') as Promise<{ level: string; message: string; at: number }[]>,
    onLog: (cb: (entry: { level: string; message: string; at: number }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, entry: { level: string; message: string; at: number }) => cb(entry)
      ipcRenderer.on('console:log', handler)
      return () => ipcRenderer.removeListener('console:log', handler)
    },
    onHistory: (cb: (entries: { level: string; message: string; at: number }[]) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, entries: { level: string; message: string; at: number }[]) => cb(entries)
      ipcRenderer.on('console:history', handler)
      return () => ipcRenderer.removeListener('console:history', handler)
    },
  },

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
