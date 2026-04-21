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
  createdAt: number
  modpackUrl?: string
  modpackVersion?: string
  javaPath?: string
  maxMemory?: number
  minMemory?: number
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

export interface ModpackSubscription {
  url: string
  instanceId: string
  lastChecked?: number
  latestVersion?: string
}

export const APP_VERSION = '0.9.9'

export const DEFAULT_SETTINGS: Settings = {
  javaPath: '',
  maxMemory: 4096,
  minMemory: 512,
  closeOnLaunch: false,
  azureClientId: 'ec5344fa-9f20-4722-8301-4e094d1e0749',
  checkUpdatesOnStart: true,
  updateManifestUrl: 'https://raw.githubusercontent.com/Fport1/modpacklauncher-updates/main/update.json'
}

export const OFFLINE_USERNAME_REGEX = /^[a-zA-Z0-9\-_!.]{1,32}$/
