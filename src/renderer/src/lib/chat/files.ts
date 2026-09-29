// Validación de adjuntos del chat, igual que en la web (src/lib/chatFileGuard.js
// de fport1web): se mira la firma real del archivo, no la extensión, y las
// reglas de Storage solo aceptan la misma lista blanca de tipos.

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file'

export const MAX_BYTES = 25 * 1024 * 1024
export const MAX_VIDEO_SECS = 90

const ALLOWED: Record<Exclude<AttachmentKind, 'file'>, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm']
}

const DOC_EXT = new Set([
  'pdf', 'txt', 'rtf', 'md', 'csv', 'json', 'xml', 'html', 'htm', 'svg',
  'doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'pptm',
  'odt', 'ods', 'odp', 'zip', 'rar', '7z', 'tar', 'gz'
])

const EXT_BLOQUEADAS = new Set([
  'exe', 'msi', 'com', 'scr', 'pif', 'cpl', 'dll', 'sys', 'drv', 'msc',
  'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'mjs', 'jse', 'wsf', 'wsh',
  'hta', 'reg', 'lnk', 'jar', 'apk', 'app', 'dmg', 'pkg', 'deb', 'rpm',
  'sh', 'bash', 'run', 'bin', 'iso', 'img', 'gadget'
])

const RIESGOSOS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'svg', 'html', 'htm', 'docm', 'xlsm', 'pptm'])

const MIME_POR_EXT: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain', rtf: 'application/rtf',
  md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  xml: 'application/xml', html: 'text/html', htm: 'text/html', svg: 'image/svg+xml',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip', rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed', tar: 'application/x-tar', gz: 'application/gzip'
}

export const extensionDe = (nombre = ''): string =>
  String(nombre).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''

export const esDescargaRiesgosa = (nombre: string): boolean => RIESGOSOS.has(extensionDe(nombre))

const startsWith = (b: Uint8Array, bytes: number[], off = 0): boolean =>
  b.length >= off + bytes.length && bytes.every((v, i) => b[off + i] === v)
const ascii = (b: Uint8Array, off: number, txt: string): boolean =>
  [...txt].every((c, i) => b[off + i] === c.charCodeAt(0))

export function sniff(buf: Uint8Array): string | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (ascii(buf, 0, 'GIF87a') || ascii(buf, 0, 'GIF89a')) return 'image/gif'
  if (ascii(buf, 0, 'RIFF') && ascii(buf, 8, 'WEBP')) return 'image/webp'
  if (ascii(buf, 0, 'RIFF') && ascii(buf, 8, 'WAVE')) return 'audio/wav'
  if (ascii(buf, 4, 'ftyp')) {
    const marca = String.fromCharCode(buf[8], buf[9], buf[10], buf[11])
    if (marca === 'qt  ') return 'video/quicktime'
    if (marca.startsWith('M4A')) return 'audio/mp4'
    return 'video/mp4'
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm'
  if (startsWith(buf, [0x49, 0x44, 0x33])) return 'audio/mpeg'
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  if (ascii(buf, 0, 'OggS')) return 'audio/ogg'
  return null
}

function esEjecutable(b: Uint8Array): string | null {
  if (b[0] === 0x4d && b[1] === 0x5a) return 'programa de Windows'
  if (b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) return 'programa de Linux'
  const m = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(m)) return 'programa de macOS'
  if (b[0] === 0x23 && b[1] === 0x21) return 'script del sistema'
  return null
}

export function mediaDuration(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement(file.type.startsWith('audio') ? 'audio' : 'video')
    const done = (d: number): void => { URL.revokeObjectURL(url); resolve(d) }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0)
    el.onerror = () => done(0)
    el.src = url
    setTimeout(() => done(0), 8000)
  })
}

/** Qué tipo de adjunto es un archivo elegido por el usuario. */
export async function kindOf(file: File): Promise<AttachmentKind> {
  const real = sniff(new Uint8Array(await file.slice(0, 32).arrayBuffer()))
  if (real?.startsWith('image/')) return 'image'
  if (real?.startsWith('video/')) return 'video'
  if (real?.startsWith('audio/')) return 'audio'
  return 'file'
}

export async function guardChatFile(file: Blob & { name?: string }, kind: AttachmentKind): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const name = file.name ?? 'archivo'
  if (file.size > MAX_BYTES) return { ok: false, motivo: `"${name}" supera los 25 MB.` }
  const cab = new Uint8Array(await file.slice(0, 32).arrayBuffer())

  if (kind === 'file') {
    const ext = extensionDe(name)
    if (!ext) return { ok: false, motivo: `"${name}" no tiene extensión, no se puede comprobar qué es.` }
    if (EXT_BLOQUEADAS.has(ext)) return { ok: false, motivo: `Los archivos .${ext} no se pueden enviar: son programas.` }
    if (!DOC_EXT.has(ext)) return { ok: false, motivo: `No se permiten archivos .${ext}. Puedes enviar documentos, PDF, imágenes o comprimidos.` }
    const prog = esEjecutable(cab)
    if (prog) return { ok: false, motivo: `"${name}" dice ser .${ext} pero por dentro es un ${prog}.` }
    return { ok: true }
  }

  const real = sniff(cab)
  if (!real) return { ok: false, motivo: `"${name}" no es un archivo válido de ese tipo.` }
  const encaja = ALLOWED[kind].includes(real) || (kind === 'audio' && real === 'video/webm')
  if (!encaja) return { ok: false, motivo: `"${name}" no está permitido (se detectó ${real}).` }
  if (kind === 'video') {
    const secs = await mediaDuration(file)
    if (secs > MAX_VIDEO_SECS + 0.5) return { ok: false, motivo: 'El video dura más de 1:30. Recórtalo antes de enviarlo.' }
  }
  return { ok: true }
}

/** Tipo MIME con el que se sube: firma real → extensión → lo que diga el sistema. */
export async function tipoSeguro(file: Blob & { name?: string }): Promise<string> {
  try {
    const real = sniff(new Uint8Array(await file.slice(0, 32).arrayBuffer()))
    if (real) return real
  } catch { /* seguimos */ }
  return MIME_POR_EXT[extensionDe(file.name ?? '')] ?? (file.type || 'application/octet-stream')
}

export interface Attachment {
  kind: AttachmentKind
  name?: string
  path?: string
  url?: string
  size?: number | null
  contentType?: string
  isGif?: boolean
}

/** Texto de la lista de chats para un adjunto (sin nombre de archivo). */
export function attachmentPreviewLabel(att: Attachment | undefined, viewOnce = false): string {
  if (!att) return ''
  if (att.isGif) return '🎞️ GIF'
  if (att.kind === 'image') return viewOnce ? '① 📷' : '📷 Foto'
  if (att.kind === 'video') return viewOnce ? '① 🎥' : '🎥 Video'
  if (att.kind === 'audio') return viewOnce ? '① 🎤' : '🎤 Audio'
  return '📎 Archivo'
}

const IMG_URL_RE = /^https?:\/\/\S+\.(gif|png|jpe?g|webp|avif)(\?\S*)?$/i
/** Si el texto es SOLO un enlace a una imagen o GIF, para incrustarlo. */
export function imageUrlFromText(t: string): { url: string; isGif: boolean } | null {
  const s = (t || '').trim()
  if (!s || /\s/.test(s)) return null
  if (IMG_URL_RE.test(s)) return { url: s, isGif: /\.gif(\?|$)/i.test(s) }
  if (/^https?:\/\/(media\d*\.giphy\.com|media\d*\.tenor\.com|c\.tenor\.com|i\.giphy\.com)\//i.test(s)) return { url: s, isGif: true }
  return null
}

export function fmtBytes(n?: number | null): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
