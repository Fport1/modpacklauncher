import { app, BrowserWindow, shell, protocol, Tray, Menu, nativeImage, session } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import { registerIpcHandlers, getSettings } from './ipc'
import { installConsoleCapture, setLoggerWindow } from './logger'

installConsoleCapture()

// Single-instance lock — handle deep links from second-instance args
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let tray: Tray | null = null

function createTray(win: BrowserWindow): void {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const iconPath = path.join(__dirname, `../../build/${iconFile}`)
  const img = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty()

  tray = new Tray(img)
  tray.setToolTip('ModpackLauncher')
  tray.on('click', () => { win.show(); win.focus() })

  const menu = Menu.buildFromTemplate([
    { label: 'Abrir ModpackLauncher', click: () => { win.show(); win.focus() } },
    { type: 'separator' },
    { label: 'Salir', click: () => { tray?.destroy(); app.exit(0) } }
  ])
  tray.setContextMenu(menu)
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
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  registerIpcHandlers(mainWindow)
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

  let isUndoingNav = false
  mainWindow.webContents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
    if (!isMainFrame) return
    if (isUndoingNav) { isUndoingNav = false; return }
    if (mainWindow!.webContents.canGoForward()) {
      isUndoingNav = true
      mainWindow!.webContents.goForward()
      mainWindow!.webContents.send('nav:back')
    }
  })

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
  if (mainWindow) createTray(mainWindow)

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('window-all-closed', () => {
  // When close-to-tray is active we hide instead of close, so this only fires on real quit
  if (process.platform !== 'darwin') app.quit()
})

// Window control IPC (for custom titlebar)
import { ipcMain } from 'electron'

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => {
  const { closeToTray } = getSettings()
  if (closeToTray && tray) {
    mainWindow?.hide()
  } else {
    mainWindow?.webContents.send('app:request-close')
  }
})
ipcMain.on('app:confirm-close', () => { tray?.destroy(); mainWindow?.destroy() })
