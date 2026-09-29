import { BrowserWindow, dialog, ipcMain } from 'electron'
import axios from 'axios'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'

// Puente del chat de fport1social con la web.
//
// Los adjuntos del chat no tienen URL pública: la web entrega enlaces
// temporales en /api/chat-media tras comprobar la sesión, y avisa por push en
// /api/notify. Esas rutas no mandan cabeceras CORS, así que desde el renderer
// (origen file://) el navegador bloquearía la respuesta; aquí no hay CORS.

const WEB = 'https://fport1web.vercel.app'
const ALLOWED_POST = new Set(['/api/chat-media', '/api/notify', '/api/chat-upload-check'])

// Solo se descargan archivos del Storage del proyecto y de Giphy
const ALLOWED_DOWNLOAD = /^https:\/\/(firebasestorage\.googleapis\.com|[a-z0-9.-]+\.firebasestorage\.app|storage\.googleapis\.com|media\d*\.giphy\.com|i\.giphy\.com)\//i

export function registerSocialBridge(): void {
  ipcMain.handle('social:web-post', async (_e, endpoint: string, idToken: string, body: unknown) => {
    if (!ALLOWED_POST.has(endpoint)) throw new Error('Ruta no permitida')
    const res = await axios.post(`${WEB}${endpoint}`, body, {
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      timeout: 20_000,
      validateStatus: () => true
    })
    return { status: res.status, data: res.data }
  })

  ipcMain.handle('social:save-file', async (e, url: string, name: string) => {
    if (!ALLOWED_DOWNLOAD.test(url)) throw new Error('Origen de descarga no permitido')
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.SaveDialogOptions = { title: 'Guardar archivo', defaultPath: name.replace(/[\\/:*?"<>|]+/g, '_') }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    const res = await axios.get(url, { responseType: 'stream', timeout: 60_000 })
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(r.filePath!)
      res.data.pipe(out)
      out.on('finish', () => resolve())
      out.on('error', reject)
      res.data.on('error', reject)
    })
    return r.filePath
  })

  // Creaciones publicadas en la fuente Fport1 de Explorar: un .fpack se
  // descarga a temporal para importarlo con el flujo de siempre.
  ipcMain.handle('fport1:download-temp', async (_e, url: string, filename: string) => {
    if (!ALLOWED_DOWNLOAD.test(url)) throw new Error('Origen de descarga no permitido')
    const dir = path.join(os.tmpdir(), 'fport1-content')
    await fs.ensureDir(dir)
    const dest = path.join(dir, `${Date.now()}-${path.basename(filename).replace(/[^\w.-]+/g, '_')}`)
    const res = await axios.get(url, { responseType: 'stream', timeout: 120_000 })
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(dest)
      res.data.pipe(out)
      out.on('finish', () => resolve())
      out.on('error', reject)
      res.data.on('error', reject)
    })
    return dest
  })
}
