import { app, BrowserWindow, shell, protocol, session } from 'electron'
import { setMaxListeners } from 'events'
import path from 'path'
import fs from 'fs-extra'
import { registerIpcHandlers, getSettings } from './ipc'
import { installConsoleCapture, setLoggerWindow } from './logger'
import { checkForUpdates } from './updater'
import { closeAllPaneWindows } from './popout'
import { nativeTitleBar } from './titleBar'
import { registerSocialSession } from './socialSession'
import { registerSocialBridge } from './social'
import { attachContextMenu } from './contextMenu'
import { attachRendererInbox, deliverToRenderer } from './rendererInbox'
import { findLaunchArg, registerShortcutIpc, runInstanceShortcut } from './shortcuts'
import { registerLinuxIntegration } from './linuxIntegration'
import { launchFromMain } from './ipc'

let socialSessionRegistered = false

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

let mainWindow: BrowserWindow | null = null
/** true cuando ya se decidió cerrar (confirmado, o saliendo de la app para actualizar). */
let allowClose = false
/** Acceso directo de instancia que llegó antes de que el launcher estuviera listo. */
let pendingLaunchId: string | null = gotLock ? findLaunchArg(process.argv) : null
/** Enlace modpacklauncher:// que llegó antes de tener ventana (macOS en frío). */
let pendingDeepLink: string | null = null

// macOS: open-file y open-url pueden llegar antes de whenReady (abrir un .fpack o un
// enlace con la app cerrada), así que se escuchan desde el principio.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  handleFpackFile(filePath)
})
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

// Windows/Linux: abrir un .fpack, un enlace o un acceso directo con el launcher ya
// abierto arranca otra copia, que se cierra y pasa aquí sus argumentos.
app.on('second-instance', (_event, argv) => {
  const launchId = findLaunchArg(argv)
  if (launchId) { requestInstanceLaunch(launchId); return }
  showMainWindow()
  const url = argv.find(a => a.startsWith('modpacklauncher://'))
  if (url) handleDeepLink(url)
  const fpack = argv.find(a => a.toLowerCase().endsWith('.fpack'))
  if (fpack) handleFpackFile(fpack)
})

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    // macOS: la app sigue viva sin ventanas; se vuelve a abrir una
    if (app.isReady()) createWindow(true)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Doble clic en un .fpack. La ruta se guarda hasta que la interfaz esté
 * escuchando (ver rendererInbox): con el launcher cerrado la ventana aún no ha
 * cargado cuando llega, y antes el aviso se perdía y solo se abría la app.
 */
function handleFpackFile(filePath: string): void {
  if (!filePath.toLowerCase().endsWith('.fpack')) return
  deliverToRenderer('fpack:open', filePath)
  if (app.isReady()) showMainWindow()
}

/** Acceso directo de una instancia (ver shortcuts.ts). */
let lastShortcutAt = 0
function requestInstanceLaunch(instanceId: string): void {
  lastShortcutAt = Date.now()
  if (!app.isReady()) { pendingLaunchId = instanceId; return }
  // macOS: la app sigue abierta sin ventanas; se crea una oculta
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(false)
  if (!mainWindow) return
  // «En frío»: el launcher solo está abierto por los accesos directos y nadie ha visto la ventana
  const coldStart = !mainWindow.isVisible()
  runInstanceShortcut(instanceId, {
    launch: launchFromMain,
    getWindow: () => mainWindow,
    showWindow: showMainWindow,
    deliver: deliverToRenderer,
    language: () => (getSettings().language === 'en' ? 'en' : 'es')
  }, coldStart).catch((e) => console.error('[Acceso directo]', e))
}

function createWindow(show = true): void {
  const iconExt = process.platform === 'win32' ? 'ico' : process.platform === 'darwin' ? 'icns' : 'png'
  const iconPath = path.join(__dirname, `../../build/icon.${iconExt}`)
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    ...nativeTitleBar(),
    // Oculta al abrir un acceso directo de instancia: si no hay actualización se juega sin verla
    show,
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
  attachRendererInbox(mainWindow)
  if (!socialSessionRegistered) { registerSocialSession(); registerSocialBridge(); socialSessionRegistered = true }
  if (getSettings().devTools) mainWindow.webContents.openDevTools({ mode: 'detach' })
  setLoggerWindow(mainWindow)

  // Si la página de la ventana se cae (memoria, GPU…), se apunta y se recarga en vez de
  // dejar la ventana en negro. Si vuelve a caerse enseguida no se insiste (evita un bucle).
  let lastGone = 0
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[Ventana] La página se cayó: ${details.reason} (código ${details.exitCode})`)
    if (details.reason === 'clean-exit' || allowClose || !mainWindow || mainWindow.isDestroyed()) return
    const now = Date.now()
    if (now - lastGone < 15_000) return
    lastGone = now
    mainWindow.webContents.reload()
  })
  mainWindow.on('unresponsive', () => console.error('[Ventana] La página no responde'))

  // Enlace modpacklauncher:// que llegó antes de tener ventana
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingDeepLink) {
      const url = pendingDeepLink
      pendingDeepLink = null
      handleDeepLink(url)
    }
  })

  attachContextMenu(mainWindow)

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

  // El botón de cerrar es ahora el del sistema: se intercepta para seguir
  // preguntando si hay algo en marcha. Al salir de la app de otra forma
  // (actualizar, Cmd+Q) no se pregunta: ver before-quit.
  mainWindow.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    mainWindow?.webContents.send('app:request-close')
  })

  // Los cuadros de Servidores sacados aparte dependen de la principal: se cierran con ella
  mainWindow.on('closed', () => { closeAllPaneWindows(); mainWindow = null })

  // Titlebar window controls
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false))

  // Con Minecraft abierto la GPU va muy cargada y, al maximizar, restaurar o volver de
  // minimizado, Chromium a veces se queda con el dibujo anterior: la ventana se ve cortada
  // o con trozos viejos. Se pide un repintado completo justo después de cada cambio.
  const repaint = (): void => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.invalidate()
    }, 60)
  }
  for (const ev of ['maximize', 'unmaximize', 'restore', 'show', 'resized', 'enter-full-screen', 'leave-full-screen'] as const) {
    mainWindow.on(ev as 'maximize', repaint)
  }
}

function handleDeepLink(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'modpacklauncher:') return
    const host = parsed.hostname // e.g. 'friend-add' or 'install'
    // Accesos directos de instancia en macOS (ver shortcuts.ts): no abren la ventana
    if (host === 'launch-instance') {
      const id = parsed.searchParams.get('id')
      if (id) requestInstanceLaunch(id)
      return
    }
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
      pendingDeepLink = url
      if (app.isReady() && (!mainWindow || mainWindow.isDestroyed())) createWindow(true)
      return
    }
    showMainWindow()
    mainWindow.webContents.send('deep-link', host, Object.fromEntries(parsed.searchParams.entries()))
  } catch { /* ignore malformed URLs */ }
}

app.whenReady().then(() => {
  // Copia secundaria: ya le pasó sus argumentos a la principal y se está cerrando
  if (!gotLock) return
  // Cámara (para leer QR) y portapapeles. Sin el permiso del portapapeles,
  // navigator.clipboard.writeText fallaba con «Write permission denied» y botones como
  // «Copiar dirección» no hacían nada.
  const allowedPermissions = new Set(['media', 'clipboard-sanitized-write', 'clipboard-read'])
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission))
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
  // AppImage: sin esto el sistema no sabe que los .fpack (ni los enlaces) se abren con el launcher
  registerLinuxIntegration()
  registerShortcutIpc()

  // Acceso directo de instancia: la ventana se crea oculta y se decide luego si se enseña
  const launchId = pendingLaunchId
  pendingLaunchId = null
  createWindow(!launchId)
  if (launchId) requestInstanceLaunch(launchId)

  // Windows/Linux, primer arranque: el .fpack o el enlace llegan como argumentos.
  // El .fpack se encola hasta que la interfaz escucha (antes se perdía aquí).
  const urlArg = process.argv.find(a => a.startsWith('modpacklauncher://'))
  if (urlArg) handleDeepLink(urlArg)
  const fpackArg = process.argv.find(a => a.toLowerCase().endsWith('.fpack'))
  if (fpackArg) handleFpackFile(fpackArg)

  // Acceso directo que llegó (macOS, open-url) mientras se creaba la ventana
  if (pendingLaunchId) {
    const id = pendingLaunchId
    pendingLaunchId = null
    requestInstanceLaunch(id)
  }

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
    // macOS manda 'activate' también al abrir la app por un enlace: si viene de un acceso
    // directo de instancia no se enseña la ventana (ya la enseña él si hace falta).
    if (Date.now() - lastShortcutAt < 3000) return
    showMainWindow()
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
ipcMain.on('app:confirm-close', () => { allowClose = true; mainWindow?.destroy() })
// Salir de la app (instalar una actualización, Cmd+Q en Mac) no debe quedarse esperando la pregunta
app.on('before-quit', () => { allowClose = true })
