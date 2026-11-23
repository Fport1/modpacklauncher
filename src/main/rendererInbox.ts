import { ipcMain, type BrowserWindow } from 'electron'

/**
 * Avisos del proceso principal a la interfaz que pueden llegar antes de que esta
 * esté lista para recibirlos: un .fpack abierto con doble clic con el launcher
 * cerrado, un acceso directo de instancia con una actualización pendiente…
 *
 * Antes se mandaban con webContents.send nada más crear la ventana (o en
 * did-finish-load), pero quien los escucha en la interfaz se monta después de
 * cargar cuentas y ajustes, así que se perdían. Ahora se guardan en cola hasta
 * que la interfaz avisa de que ya escucha ('inbox:ready'), y se le entregan
 * todos de una vez. A partir de ahí van directos. Si la página se recarga, se
 * vuelve a encolar hasta que avise otra vez.
 */

interface Item { channel: string; args: unknown[] }

let win: BrowserWindow | null = null
let ready = false
const queue: Item[] = []

export function attachRendererInbox(w: BrowserWindow): void {
  win = w
  ready = false
  // Solo una carga nueva de la página entera (recarga, o se cayó y volvió). No vale
  // did-start-loading: salta también con iframes y navegación interna, y dejaba la
  // interfaz por «no lista» con el launcher abierto.
  w.webContents.on('did-navigate', () => { ready = false })
  w.webContents.on('render-process-gone', () => { ready = false })
  w.on('closed', () => { if (win === w) { win = null; ready = false } })
}

export function deliverToRenderer(channel: string, ...args: unknown[]): void {
  if (ready && win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, ...args)
  } else {
    queue.push({ channel, args })
  }
}

ipcMain.handle('inbox:ready', () => {
  ready = true
  return queue.splice(0)
})
