import { BrowserWindow, screen, shell } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import { nativeTitleBar } from './titleBar'

// Los dos cuadros de Servidores (este equipo y el servidor) se pueden sacar,
// cada uno por su lado, a una ventana propia: uno en una pantalla con lo que
// se va a subir o editar, el otro en la otra con el servidor.
//
// La conexión vive en el proceso principal, así que sacar un cuadro no
// desconecta nada. Lo que sí hace falta es que las ventanas se enteren de lo
// que pasa en las otras: qué carpeta tiene abierta cada cuadro (para saber a
// dónde subir o descargar), qué se está arrastrando y qué carpetas cambiaron.

export type PaneSide = 'local' | 'remote'

const paneWindows: Record<PaneSide, BrowserWindow | null> = { local: null, remote: null }
const paneDirs: Record<PaneSide, string> = { local: '', remote: '' }
let dragPayload: unknown = null

function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

export function paneState(): Record<PaneSide, boolean> {
  return {
    local: !!paneWindows.local && !paneWindows.local.isDestroyed(),
    remote: !!paneWindows.remote && !paneWindows.remote.isDestroyed()
  }
}

/** Dónde abrirla: en otra pantalla si la hay, que es para lo que sirve. */
function pickBounds(from: BrowserWindow | null): Electron.Rectangle {
  const displays = screen.getAllDisplays()
  const current = from && !from.isDestroyed() ? screen.getDisplayMatching(from.getBounds()) : screen.getPrimaryDisplay()
  const target = displays.find((d) => d.id !== current.id) ?? current
  const area = target.workArea
  const w = Math.min(900, area.width)
  const h = Math.min(760, area.height)
  return { x: area.x + Math.round((area.width - w) / 2), y: area.y + Math.round((area.height - h) / 2), width: w, height: h }
}

export function openPaneWindow(side: PaneSide, from: BrowserWindow | null): void {
  const existing = paneWindows[side]
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }

  const iconExt = process.platform === 'win32' ? 'ico' : process.platform === 'darwin' ? 'icns' : 'png'
  const iconPath = path.join(__dirname, `../../build/icon.${iconExt}`)
  const win = new BrowserWindow({
    ...pickBounds(from),
    minWidth: 520,
    minHeight: 420,
    ...nativeTitleBar(),
    title: side === 'local' ? 'Este equipo — Modpack Launcher' : 'Servidor — Modpack Launcher',
    backgroundColor: '#0f0f14',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  paneWindows[side] = win

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  const hash = `/ftp-pane?side=${side}`
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash })

  // Igual que en la principal: botones laterales del ratón y estado de maximizado
  win.on('app-command', (event, command) => {
    if (command === 'browser-backward') { event.preventDefault(); win.webContents.send('nav:back') }
    else if (command === 'browser-forward') { event.preventDefault(); win.webContents.send('nav:forward') }
  })
  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))

  win.on('closed', () => {
    paneWindows[side] = null
    broadcast('ftp:pane-state', paneState())
  })
  broadcast('ftp:pane-state', paneState())
}

export function closePaneWindow(side: PaneSide): void {
  const win = paneWindows[side]
  if (win && !win.isDestroyed()) win.close()
}

export function closeAllPaneWindows(): void {
  closePaneWindow('local')
  closePaneWindow('remote')
}

// ── Estado compartido entre ventanas ─────────────────────────────────────────

export function setPaneDir(side: PaneSide, dir: string): void {
  if (paneDirs[side] === dir) return
  paneDirs[side] = dir
  broadcast('ftp:pane-dirs', { ...paneDirs })
}

export function getPaneDirs(): Record<PaneSide, string> {
  return { ...paneDirs }
}

/** Lo que se arrastra desde un cuadro, para que lo pueda recoger el de otra ventana. */
export function setDrag(payload: unknown): void {
  dragPayload = payload
  broadcast('ftp:drag', payload)
}

export function getDrag(): unknown {
  return dragPayload
}

/** Una carpeta cambió (se subió, descargó, borró…): el cuadro que la tenga abierta se recarga. */
export function notifyChanged(change: { side: PaneSide; dir: string; names?: string[] }): void {
  broadcast('ftp:changed', change)
}

export function pushLog(line: { kind: 'info' | 'ok' | 'error'; text: string }): void {
  broadcast('ftp:log', { ...line, t: Date.now() })
}
