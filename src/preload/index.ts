import { contextBridge, ipcRenderer } from 'electron'
import type {
  Instance,
  MinecraftAccount,
  Settings,
  ModpackManifest,
  DownloadProgress
} from '../shared/types'
import type { ModFile, ModMeta, WorldFolder, ScreenshotFile, CrashReport } from '../main/instances'
export type { ModFile, ModMeta }

const api = {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximized: (cb: (maximized: boolean) => void) => {
      ipcRenderer.on('window:maximized', (_e, v) => cb(v))
    }
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
    readOptions: (instanceId: string) => ipcRenderer.invoke('instances:read-options', instanceId) as Promise<string>,
    writeOptions: (instanceId: string, content: string) => ipcRenderer.invoke('instances:write-options', instanceId, content),
    toggleMod: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:toggle-mod', instanceId, filename) as Promise<string>,
    deleteMod: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-mod', instanceId, filename),
    toggleResourcepack: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:toggle-resourcepack', instanceId, filename) as Promise<string>,
    deleteResourcepack: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-resourcepack', instanceId, filename),
    toggleShaderpack: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:toggle-shaderpack', instanceId, filename) as Promise<string>,
    deleteShaderpack: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-shaderpack', instanceId, filename),
    deleteWorld: (instanceId: string, worldName: string) => ipcRenderer.invoke('instances:delete-world', instanceId, worldName),
    deleteScreenshot: (instanceId: string, filename: string) => ipcRenderer.invoke('instances:delete-screenshot', instanceId, filename)
  },

  // Clipboard
  clipboard: {
    writeImagePath: (filePath: string) => ipcRenderer.invoke('clipboard:write-image-path', filePath),
    writeText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text)
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
    fetch: (url: string) => ipcRenderer.invoke('modpacks:fetch', url) as Promise<ModpackManifest>,
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
      categories: { mods: boolean; config: boolean; resourcepacks: boolean; shaderpacks: boolean; scripts: boolean; options: boolean }
    }) => ipcRenderer.invoke('modpacks:export', params) as Promise<string>,
    onExportProgress: (cb: (p: { message: string; current: number; total: number }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, p: { message: string; current: number; total: number }) => cb(p)
      ipcRenderer.on('modpacks:export-progress', handler)
      return () => ipcRenderer.removeListener('modpacks:export-progress', handler)
    }
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
