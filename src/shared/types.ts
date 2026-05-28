export type Modloader = 'vanilla' | 'forge' | 'fabric' | 'quilt' | 'neoforge'
export type AccountType = 'microsoft' | 'offline'

export interface MinecraftAccount {
  id: string
  username: string
  uuid: string
  accessToken: string
  type: AccountType
  refreshToken?: string
  expiresAt?: number
}

export interface Instance {
  id: string
  name: string
  dirName?: string
  minecraft: string
  modloader: Modloader
  modloaderVersion?: string
  description?: string
  icon?: string
  lastPlayed?: number
  playtime?: number
  createdAt: number
  modpackUrl?: string
  modpackVersion?: string
  modpackKey?: string
  javaPath?: string
  maxMemory?: number
  minMemory?: number
  width?: number
  height?: number
  jvmArgs?: string
  displayId?: number
  group?: string
  groupColor?: string
}

export interface PackFile {
  path: string
  url: string
  sha256?: string
  side?: 'client' | 'server' | 'both'
}

export interface ModpackManifest {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  thumbnail?: string
  minecraft: string
  modloader: Modloader
  modloaderVersion?: string
  filesZip?: string
  files?: PackFile[]
  // Legacy format support
  mods?: ModEntry[]
  configs?: ConfigEntry[]
  changelog?: string
}

export interface ModEntry {
  name: string
  filename: string
  url: string
  sha256?: string
  required?: boolean
  side?: 'client' | 'server' | 'both'
}

export interface ConfigEntry {
  path: string
  url: string
  sha256?: string
}

export interface Friend {
  id: string
  username: string
  uuid: string
  addedAt: number
}

export interface AIConfig {
  id: string
  label: string
  provider: 'claude' | 'openai' | 'gemini' | 'grok' | 'ollama'
  model: string
  apiKey?: string
  ollamaUrl?: string
}

export interface Settings {
  javaPath: string
  maxMemory: number
  minMemory: number
  closeOnLaunch: boolean
  activeAccountId?: string
  azureClientId: string
  checkUpdatesOnStart: boolean
  updateManifestUrl: string
  githubToken?: string
  modInstallChannel: 'all' | 'stable'
  closeToTray: boolean
  launchAtStartup: boolean
  aiConfigs: AIConfig[]
  aiDefaultId?: string
  language: 'es' | 'en'
  showConsole: boolean
}

export interface DownloadProgress {
  type: 'download' | 'extract' | 'install'
  current: number
  total: number
  message: string
  unit?: 'bytes' | 'items'
  done?: boolean
  error?: string
}

export interface PublishedModpack {
  id: string
  name: string
  version: string
  minecraft: string
  modloader: string
  url: string
  publishedAt: number
  accessKey?: string
}

export interface ModpackSubscription {
  url: string
  instanceId: string
  lastChecked?: number
  latestVersion?: string
}

declare const __APP_VERSION__: string
export const APP_VERSION: string = __APP_VERSION__

export const DEFAULT_SETTINGS: Settings = {
  javaPath: '',
  maxMemory: 4096,
  minMemory: 512,
  closeOnLaunch: false,
  azureClientId: '',
  checkUpdatesOnStart: true,
  updateManifestUrl: 'https://raw.githubusercontent.com/Fport1/modpacklauncher-updates/main/update.json',
  modInstallChannel: 'all',
  closeToTray: true,
  launchAtStartup: false,
  aiConfigs: [],
  language: 'es',
  showConsole: false,
}

export const OFFLINE_USERNAME_REGEX = /^[a-zA-Z0-9\-_!.]{1,32}$/

export type OperationType =
  | 'install-modpack' | 'update-modpack' | 'install-mrpack' | 'install-curseforge'
  | 'export-modpack' | 'import-fpack' | 'save-fpack'
  | 'install-minecraft' | 'install-java' | 'install-vlc'
  | 'duplicate-instance' | 'download-update'

export interface Operation {
  id: string
  name: string
  type: OperationType
  status: 'running' | 'done' | 'error'
  message?: string
  current?: number
  total?: number
  error?: string
  startedAt: number
}
