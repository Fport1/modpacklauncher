import type { LocalEntry, RemoteEntry } from '../../../../shared/types'

// Utilidades comunes del gestor de servidores (cuadros, editores, ventanas).

export type Side = 'local' | 'remote'
export type Entry = LocalEntry | RemoteEntry
export type SortKey = 'name' | 'size' | 'modified'
export type LogKind = 'info' | 'ok' | 'error'

export const MAX_EDIT_BYTES = 5 * 1024 * 1024

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / Math.pow(1024, i)
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function formatDate(ms: number | null): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString(undefined, {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

/** Rutas del servidor: siempre con '/', sea cual sea el sistema local. */
export function remoteJoin(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`
}
export function remoteParent(dir: string): string {
  const trimmed = dir.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i <= 0 ? '/' : trimmed.slice(0, i)
}
/** Rutas locales con el separador que ya use la carpeta (\ en Windows). */
export function localJoin(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}
export const joinFor = (side: Side, dir: string, name: string): string =>
  side === 'remote' ? remoteJoin(dir, name) : localJoin(dir, name)

export function baseNameOf(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
}

/** Quita el envoltorio que Electron pone a los errores que cruzan el IPC. */
export function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '')
}

/** Si el foco está en un campo de texto, los atajos del gestor no deben saltar. */
export function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || !!el.closest?.('.monaco-editor'))
}

const ext = (name: string): string => name.split('.').pop()?.toLowerCase() ?? ''

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg']
export const isImageFile = (name: string): boolean => IMAGE_EXTS.includes(ext(name))

/** Archivos NBT: datos de jugadores, scoreboard, level.dat, estructuras y esquemas. */
const NBT_EXTS = ['dat', 'dat_old', 'nbt', 'schem', 'schematic', 'litematic']
export const isNbtFile = (name: string): boolean => NBT_EXTS.includes(ext(name))
export const PLAYER_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.dat(_old)?$/i

/** Qué editor le toca a cada archivo; los que tienen modo sencillo empiezan en él. */
export type FileKind = 'text' | 'image' | 'nbt' | 'properties' | 'scoreboard' | 'playerdata' | 'level'
export function fileKindOf(name: string, isText: (n: string) => boolean): FileKind | null {
  const lower = name.toLowerCase()
  if (lower === 'server.properties') return 'properties'
  if (lower === 'scoreboard.dat') return 'scoreboard'
  if (lower === 'level.dat') return 'level'
  if (PLAYER_FILE.test(name)) return 'playerdata'
  if (isImageFile(name)) return 'image'
  if (isNbtFile(name)) return 'nbt'
  if (isText(name)) return 'text'
  return null
}

/** Lo que se arrastra de un cuadro a otro (también entre ventanas). */
export interface DragPayload {
  side: Side
  dir: string
  names: string[]
  entries: Entry[]
}

/** Cabeza de la skin de un jugador por su nombre, para listas de miembros. */
export const headUrl = (name: string, size = 32): string =>
  `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`
