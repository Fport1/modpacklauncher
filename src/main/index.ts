import { app, BrowserWindow, shell, protocol, Tray, Menu, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import { registerIpcHandlers, getSettings } from './ipc'

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

let mainWindow: BrowserWindow | null = null

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

app.whenReady().then(() => {
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

  createWindow()
  if (mainWindow) createTray(mainWindow)

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
