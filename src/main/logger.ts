import type { BrowserWindow } from 'electron'

export interface LogEntry {
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
  at: number
}

const MAX = 1000
const buf: LogEntry[] = []
let _win: BrowserWindow | null = null

export function setLoggerWindow(w: BrowserWindow): void {
  _win = w
  w.webContents.on('did-finish-load', () => {
    if (!w.isDestroyed()) w.webContents.send('console:history', buf.slice())
  })
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
  try { if (_win && !_win.isDestroyed()) _win.webContents.send('console:log', entry) } catch { /* ignore */ }
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

export function getLogBuffer(): LogEntry[] {
  return buf.slice()
}
