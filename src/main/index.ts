import { app, BrowserWindow, shell, protocol, session } from 'electron'
import { setMaxListeners } from 'events'
import path from 'path'
import fs from 'fs-extra'
import { registerIpcHandlers, getSettings } from './ipc'
import { installConsoleCapture, setLoggerWindow } from './logger'
import { checkForUpdates } from './updater'
import { closeAllPaneWindows } from './popout'

/** Cada cuánto se mira si hay versión nueva, con la app abierta. */
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// @xmcl/installer uses concurrent downloads that each add an abort listener to the same
// AbortSignal. With >10 concurrent downloads Node.js emits MaxListenersExceededWarning.
// Setting 0 removes the limit without hiding real leaks (the listeners are all short-lived).
setMaxListeners(0)

installConsoleCapture()

// Single-instance lock — handle deep links from second-instance args
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { bypassCSP: true, stream: true } }
])

// macOS: open-file can fire before whenReady — capture early
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  handleFpackFile(filePath)
})

let mainWindow: BrowserWindow | null = null
let pendingFpackFile: string | null = null

function handleFpackFile(filePath: string): void {
  if (!filePath.toLowerCase().endsWith('.fpack')) return
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('fpack:open', filePath)
  } else {
    pendingFpackFile = filePath
  }
}

function createWindow(): void {
  const iconExt = process.platform === 'win32' ? 'ico' : process.platform === 'darwin' ? 'icns' : 'png'
  const iconPath = path.join(__dirname, `../../build/icon.${iconExt}`)
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f0f14',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  registerIpcHandlers(mainWindow)
  if (getSettings().devTools) mainWindow.webContents.openDevTools({ mode: 'detach' })
  setLoggerWindow(mainWindow)

  // Send any pending .fpack file once the renderer is ready
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingFpackFile) {
      mainWindow?.webContents.send('fpack:open', pendingFpackFile)
      pendingFpackFile = null
    }
  })

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  // Botones laterales del ratón. En Windows llegan como app-command del
  // sistema y no como evento de ratón en el DOM, segun el ratón y su driver,
  // asi que se reenvian al renderer, que decide si toca cerrar un modal o
  // moverse por el historial de paginas.
  mainWindow.on('app-command', (event, command) => {
    if (command === 'browser-backward') {
      event.preventDefault()
      mainWindow?.webContents.send('nav:back')
    } else if (command === 'browser-forward') {
      event.preventDefault()
      mainWindow?.webContents.send('nav:forward')
    }
  })

  // Los cuadros de Servidores sacados aparte dependen de la principal: se cierran con ella
  mainWindow.on('closed', () => closeAllPaneWindows())

  // Titlebar window controls
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false))
}

function handleDeepLink(url: string): void {
  if (!mainWindow) return
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'modpacklauncher:') return
    const host = parsed.hostname // e.g. 'friend-add' or 'install'
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('deep-link', host, Object.fromEntries(parsed.searchParams.entries()))
  } catch { /* ignore malformed URLs */ }
}

app.whenReady().then(() => {
  // Allow camera access for QR scanning in the renderer
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })

  protocol.handle('media', async (request) => {
    try {
      const filePath = decodeURIComponent(request.url.slice('media:///'.length)).replace(/\//g, path.sep)
      const buf = await fs.readFile(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
      return new Response(buf, { headers: { 'Content-Type': mime } })
    } catch {
      return new Response('', { status: 404 })
    }
  })

  // Register modpacklauncher:// protocol handler
  app.setAsDefaultProtocolClient('modpacklauncher')

  createWindow()

  // Handle deep links / .fpack files from argv on Windows/Linux (first launch)
  const urlArg = process.argv.find(a => a.startsWith('modpacklauncher://'))
  if (urlArg) handleDeepLink(urlArg)
  const fpackArg = process.argv.find(a => a.toLowerCase().endsWith('.fpack'))
  if (fpackArg) handleFpackFile(fpackArg)

  // Handle second-instance (Windows/Linux — subsequent launches pass args via argv)
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    const url = argv.find(a => a.startsWith('modpacklauncher://'))
    if (url) handleDeepLink(url)
    const fpack = argv.find(a => a.toLowerCase().endsWith('.fpack'))
    if (fpack) handleFpackFile(fpack)
  })

  // Handle deep links on macOS via open-url event
  app.on('open-url', (_event, url) => handleDeepLink(url))

  // open-file is already handled by the early listener registered before whenReady

  // Apply startup setting on launch
  const startupSetting = getSettings().launchAtStartup
  app.setLoginItemSettings({ openAtLogin: startupSetting })

  // Comprobar actualizaciones sin que el usuario haga nada: al arrancar y cada
  // pocas horas. Encontrar una versión nueva dispara la descarga en segundo
  // plano, y se instala al cerrar la app. Los fallos se ignoran a propósito —
  // quedarse sin internet no debe molestar a nadie con un aviso.
  const checkQuietly = (): void => { checkForUpdates().catch(() => { /* sin red, ya se reintenta */ }) }
  setTimeout(checkQuietly, 10_000)
  setInterval(checkQuietly, UPDATE_CHECK_INTERVAL_MS)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Window control IPC (for custom titlebar)
import { ipcMain } from 'electron'

// Cada ventana controla la suya: también la de Servidores cuando está aparte
const senderWindow = (e: Electron.IpcMainEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender)
ipcMain.on('window:minimize', (e) => senderWindow(e)?.minimize())
ipcMain.on('window:maximize', (e) => {
  const win = senderWindow(e)
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
})
ipcMain.on('window:close', (e) => {
  const win = senderWindow(e)
  // La principal pregunta antes si hay algo en marcha; las demás se cierran sin más
  if (win && win !== mainWindow) win.close()
  else mainWindow?.webContents.send('app:request-close')
})
ipcMain.on('app:confirm-close', () => { mainWindow?.destroy() })
