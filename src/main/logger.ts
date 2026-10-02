import { app, type BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'

export interface LogEntry {
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
  at: number
}

const MAX = 1000
const buf: LogEntry[] = []
let _win: BrowserWindow | null = null
let sending = false

export function setLoggerWindow(w: BrowserWindow): void {
  _win = w
  w.webContents.on('did-finish-load', () => {
    if (!w.isDestroyed()) w.webContents.send('console:history', buf.slice())
  })
}

// Los errores también van a disco (userData/logs/errores.log): el buffer vive en memoria
// y, si la ventana se queda en negro o el launcher se cierra, se perdería lo que pasó.
const ERRORS_MAX_BYTES = 1024 * 1024
let errorsFile: string | null = null

function persistError(entry: LogEntry): void {
  try {
    if (!errorsFile) {
      const dir = path.join(app.getPath('userData'), 'logs')
      fs.mkdirSync(dir, { recursive: true })
      errorsFile = path.join(dir, 'errores.log')
    }
    const size = fs.existsSync(errorsFile) ? fs.statSync(errorsFile).size : 0
    if (size > ERRORS_MAX_BYTES) fs.renameSync(errorsFile, errorsFile.replace(/.log$/, '.anterior.log'))
    fs.appendFileSync(errorsFile, `[${new Date(entry.at).toISOString()}] v${app.getVersion()} ${entry.message}
`)
  } catch { /* sin disco no hay registro, pero el launcher sigue */ }
}

/** Ruta del registro de errores (para enseñarla o abrirla). */
export function errorsLogPath(): string {
  return path.join(app.getPath('userData'), 'logs', 'errores.log')
}

function push(level: LogEntry['level'], args: unknown[]): void {
  const msg = args.map(a => {
    if (typeof a === 'string') return a
    if (a instanceof Error) return a.stack ?? a.message
    try { return JSON.stringify(a) } catch { return String(a) }
  }).join(' ')
  const entry: LogEntry = { level, message: msg, at: Date.now() }
  buf.push(entry)
  if (buf.length > MAX) buf.splice(0, buf.length - MAX)
  if (level === 'error') persistError(entry)
  // Si la página de la ventana se está recargando o se cayó, Electron no lanza al
  // enviar: escribe «Error sending from webFrameMain…» con console.error, que vuelve
  // a pasar por aquí y vuelve a enviar, en bucle. Mientras se envía no se reenvía,
  // y sin página viva no se envía (el buffer la pone al día con getLogBuffer()).
  if (sending || !_win || _win.isDestroyed() || _win.webContents.isDestroyed() || _win.webContents.isCrashed() || _win.webContents.isLoading()) return
  sending = true
  try { _win.webContents.send('console:log', entry) } catch { /* ignore */ } finally { sending = false }
}

export function installConsoleCapture(): void {
  const _log   = console.log.bind(console)
  const _info  = console.info.bind(console)
  const _warn  = console.warn.bind(console)
  const _error = console.error.bind(console)
  console.log   = (...a: unknown[]) => { _log(...a);   push('log',   a) }
  console.info  = (...a: unknown[]) => { _info(...a);  push('info',  a) }
  console.warn  = (...a: unknown[]) => { _warn(...a);  push('warn',  a) }
  console.error = (...a: unknown[]) => { _error(...a); push('error', a) }
  process.on('uncaughtException', (e) => push('error', [`[UncaughtException] ${e.stack ?? e.message}`]))
  process.on('unhandledRejection', (r) => push('error', [`[UnhandledRejection] ${r}`]))
}

/** Un error de la interfaz (la ventana) llega por IPC y se guarda igual que los del proceso principal. */
export function logRendererError(message: string): void {
  push('error', [`[Interfaz] ${String(message).slice(0, 8000)}`])
}

export function getLogBuffer(): LogEntry[] {
  return buf.slice()
}
