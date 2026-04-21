import { app, BrowserWindow, shell, protocol } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import { registerIpcHandlers } from './ipc'

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Window control IPC (for custom titlebar)
import { ipcMain } from 'electron'

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())
