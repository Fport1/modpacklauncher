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
  // fpack linking — if set, import fetches a fresh manifest from this URL
  sourceUrl?: string
  sourceKey?: string
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
  checkUpdatesOnStart: boolean
  updateManifestUrl: string
  githubToken?: string
  modInstallChannel: 'all' | 'stable'
  launchAtStartup: boolean
  aiConfigs: AIConfig[]
  aiDefaultId?: string
  language: 'es' | 'en'
  showConsole: boolean
  /** Herramientas de desarrollo de Chromium (enseñan, entre otras cosas, el tamaño de la ventana al cambiarlo). */
  devTools: boolean
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

// ── Instance file listings (shared between main and preload/renderer) ──────

export interface ModMeta {
  name?: string
  author?: string
  iconBase64?: string
}

export interface ModFile {
  filename: string
  size: number
  enabled: boolean
  date: number
  meta?: ModMeta
}

export interface WorldFolder {
  name: string
  lastPlayed?: number
  iconBase64?: string
  size?: number
}

export interface ScreenshotFile {
  filename: string
  filePath: string
  date: number
  size: number
}

export interface ConfigFile {
  name: string
  size: number
  date: number
  isDir: boolean
}

export interface CrashReport {
  filename: string
  date: number
}

export interface GameDirEntry {
  name: string
  relativePath: string
  isDir: boolean
  size?: number
}

// ── Asset browsing (vanilla jars + resource packs) ─────────────────────────

export interface AssetSource {
  id: string
  label: string
  kind: 'jar' | 'zip' | 'folder'
  /** For packs: name of the instance that contains it */
  instanceName?: string
}

export interface AssetEntry {
  name: string
  isDir: boolean
  size?: number
}

declare const __APP_VERSION__: string
export const APP_VERSION: string = __APP_VERSION__

export const DEFAULT_SETTINGS: Settings = {
  javaPath: '',
  maxMemory: 4096,
  minMemory: 512,
  closeOnLaunch: false,
  checkUpdatesOnStart: true,
  updateManifestUrl: 'https://raw.githubusercontent.com/Fport1/modpacklauncher-updates/main/update.json',
  modInstallChannel: 'all',
  launchAtStartup: false,
  aiConfigs: [],
  language: 'es',
  showConsole: false,
  devTools: false,
}

export const OFFLINE_USERNAME_REGEX = /^[a-zA-Z0-9\-_!.]{1,32}$/

export type OperationType =
  | 'install-modpack' | 'update-modpack' | 'install-mrpack' | 'install-curseforge'
  | 'export-modpack' | 'import-fpack' | 'save-fpack'
  | 'install-minecraft' | 'install-java' | 'install-vlc'
  | 'duplicate-instance' | 'download-update' | 'delete-instance'
  | 'ftp-upload' | 'ftp-download'

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

// ── Almacenamiento ───────────────────────────────────────────────────────────

export interface StorageChild {
  name: string
  /** Ruta relativa a la carpeta del launcher. */
  rel: string
  bytes: number
  isDir: boolean
  childCount: number
}

export interface StorageScanProgress {
  bytes: number
  files: number
  /** Último fichero medido, para dar señal de vida durante el escaneo. */
  current: string
  done: boolean
}

export interface DiskInfo {
  total: number
  free: number
  used: number
  /** Lo que ocupa el launcher. */
  launcher: number
  /** El resto de lo ocupado: sistema, otras apps y archivos del usuario. */
  others: number
}

// ── Transferencia de archivos (FTP / SFTP) ───────────────────────────────────

export type FtpProtocol = 'ftp' | 'ftps' | 'sftp'

export interface FtpSite {
  id: string
  name: string
  protocol: FtpProtocol
  host: string
  port: number
  user: string
  /** Cifrada con el llavero del sistema, en base64. Nunca sale del proceso principal. */
  password?: string
  /** Carpeta remota en la que empezar al conectar. */
  remoteDir?: string
}

/** Lo que manda la interfaz al guardar un sitio: la contraseña va en claro, una sola vez. */
export interface FtpSiteInput {
  id?: string
  name: string
  protocol: FtpProtocol
  host: string
  port: number
  user: string
  password?: string
  remoteDir?: string
}

export interface FtpSiteSummary extends Omit<FtpSite, 'password'> {
  hasPassword: boolean
}

export interface RemoteEntry {
  name: string
  isDir: boolean
  size: number
  modified: number | null
}

export interface LocalEntry {
  name: string
  isDir: boolean
  size: number
  modified: number
}

/** Estado de la conexión del gestor de servidores, igual en todas las ventanas. */
export interface FtpConnectionState {
  connected: boolean
  siteId: string | null
  label: string
  /** 'assist' = la instancia de un amigo por asistencia remota. */
  kind: 'site' | 'assist'
  root: string
  cwd: string
  /** Se cayó y no se pudo recuperar sola. */
  lost: boolean
  reason?: string
  reconnecting: boolean
}

/** Lo que el amigo comparte de su instancia al pedir ayuda. */
export interface AssistInstanceInfo {
  instanceName: string
  minecraft: string
  loader: string
}

/** Dónde van los mods o los plugins de un servidor y qué loaders de Modrinth acepta. */
export interface ServerContentSlot {
  /** Separados por comas: un Paper acepta "paper,spigot,bukkit". */
  loaders: string
  folder: string
}

export interface ServerInfo {
  kind: 'mods' | 'plugins' | 'hybrid' | 'proxy' | 'vanilla' | 'unknown'
  /** fabric, forge, neoforge, quilt, paper, purpur, folia, spigot, bukkit, velocity… */
  loader: string
  label: string
  minecraft: string
  mods: ServerContentSlot | null
  plugins: ServerContentSlot | null
  /** Qué archivos llevaron a la conclusión, para enseñarlo y que se pueda corregir. */
  evidence: string[]
  /** true si el usuario lo fijó a mano en lugar de detectarlo. */
  manual?: boolean
}

/** Corrección manual de la detección, guardada por sitio. */
export interface ServerOverride {
  loader: string
  minecraft: string
}

/**
 * Un archivo NBT abierto. `root` tiene la forma de prismarine-nbt:
 * `{ type, name, value }`, con los long como `[alto, bajo]` y las listas como
 * `{ type: 'list', value: { type: <tipo de los elementos>, value: [...] } }`.
 */
export interface NbtDocument {
  root: NbtTag & { name: string }
  format: 'big' | 'little' | 'littleVarint'
  compression: 'gzip' | 'zlib' | 'none'
}

export type NbtTagType =
  | 'byte' | 'short' | 'int' | 'long' | 'float' | 'double' | 'string'
  | 'list' | 'compound' | 'byteArray' | 'shortArray' | 'intArray' | 'longArray'

export interface NbtTag {
  type: NbtTagType
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any
}

/** Lo que Modrinth sabe de un .jar del servidor, identificado por su sha1. */
export interface ServerJarMeta {
  projectId: string
  versionId: string
  title: string
  versionNumber: string
  iconUrl: string | null
  clientSide: string
  serverSide: string
  hasUpdate: boolean
}
