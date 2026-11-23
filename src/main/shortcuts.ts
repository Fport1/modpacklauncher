import { app, BrowserWindow, ipcMain, nativeImage, shell } from 'electron'
import { execFile } from 'child_process'
import crypto from 'crypto'
import os from 'os'
import path from 'path'
import fs from 'fs-extra'
import type { Instance } from '../shared/types'
import { loadInstances, resolveInstanceDir } from './instances'
import { fetchManifest, compareVersions } from './modpacks'
import { gameEvents, isInstanceRunning, getRunningSnapshot } from './launcher'

/**
 * Accesos directos de instancias en el escritorio: la instancia se abre como si
 * fuera un juego más. El acceso directo arranca el launcher con
 * `--launch-instance=<id>` (Windows y Linux) o abre
 * `modpacklauncher://launch-instance?id=<id>` (macOS), y entonces:
 *
 *  1. si es un modpack, se mira si tiene versión nueva;
 *  2. si no la tiene (o no hay red), se lanza el juego sin enseñar la ventana
 *     principal: solo una ventanita de «Iniciando…» mientras se prepara;
 *  3. si la tiene, se abre el launcher con el aviso de actualización de esa
 *     instancia (lo pinta la interfaz, ver LaunchRequests.tsx).
 *
 * Con el launcher cerrado la ventana principal se crea oculta y, si nadie la
 * llega a abrir, la app se cierra sola cuando se cierra el juego.
 */

export const LAUNCH_ARG = '--launch-instance='

/** Id de instancia de un `--launch-instance=<id>` entre los argumentos, si lo hay. */
export function findLaunchArg(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith(LAUNCH_ARG))
  const id = arg?.slice(LAUNCH_ARG.length).replace(/^"|"$/g, '').trim()
  return id || null
}

// ── Crear el acceso directo ───────────────────────────────────────────────────

/** Nombre válido como fichero en los tres sistemas. */
function safeFileName(name: string): string {
  const clean = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 80)
  return clean || 'Minecraft'
}

/** Carpeta donde se guardan los iconos a los que apuntan los accesos directos (tienen que seguir existiendo). */
function iconsDir(): string {
  return path.join(app.getPath('userData'), 'shortcuts')
}

function bundledIconsDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'icons') : path.join(app.getAppPath(), 'resources', 'icons')
}

/** Icono de la instancia (o el de por defecto) como imagen cuadrada. */
async function instanceIconImage(instance: Instance): Promise<Electron.NativeImage> {
  const candidates: string[] = []
  if (instance.icon) {
    try { candidates.push(path.join(await resolveInstanceDir(instance.id), instance.icon.split('?')[0])) } catch { /* sin carpeta */ }
  }
  candidates.push(path.join(bundledIconsDir(), 'grass_block.png'))
  for (const file of candidates) {
    if (!(await fs.pathExists(file))) continue
    const img = nativeImage.createFromPath(file)
    if (img.isEmpty()) continue
    const { width, height } = img.getSize()
    // Los iconos que no son cuadrados se recortan al centro para que no salgan deformados
    if (width !== height) {
      const side = Math.min(width, height)
      return img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
    }
    return img
  }
  return nativeImage.createEmpty()
}

/**
 * Un .ico con PNG dentro (Windows lo entiende desde Vista). Se mete en varios
 * tamaños para que en el escritorio, en la barra de tareas y en el Explorador
 * se vea nítido. Los iconos pixelados de Minecraft se escalan sin suavizar.
 */
function buildIco(img: Electron.NativeImage): Buffer {
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngs = sizes.map((s) => img.resize({ width: s, height: s, quality: img.getSize().width <= 64 ? 'good' : 'best' }).toPNG())
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // icono
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((s, i) => {
    const e = 6 + i * 16
    header.writeUInt8(s >= 256 ? 0 : s, e) // 0 = 256
    header.writeUInt8(s >= 256 ? 0 : s, e + 1)
    header.writeUInt8(0, e + 2)
    header.writeUInt8(0, e + 3)
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(pngs[i].length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += pngs[i].length
  })
  return Buffer.concat([header, ...pngs])
}

/**
 * Guarda el icono con un nombre que cambia con su contenido: el Explorador de
 * Windows recuerda los iconos por ruta y, si se reutilizara, al cambiar el
 * icono de la instancia el acceso directo nuevo seguiría con el viejo.
 */
async function writeIcon(instance: Instance, ext: 'ico' | 'png', data: Buffer): Promise<string> {
  const dir = iconsDir()
  await fs.ensureDir(dir)
  const hash = crypto.createHash('sha1').update(data).digest('hex').slice(0, 8)
  const file = path.join(dir, `${instance.id}-${hash}.${ext}`)
  for (const old of await fs.readdir(dir).catch(() => [] as string[])) {
    if (old.startsWith(`${instance.id}-`) && old.endsWith(`.${ext}`) && path.join(dir, old) !== file) {
      await fs.remove(path.join(dir, old)).catch(() => {})
    }
  }
  await fs.writeFile(file, data)
  return file
}

/** Programa y argumentos para arrancar este launcher (en desarrollo, electron + carpeta del proyecto). */
function launcherCommand(): { exe: string; args: string[] } {
  // AppImage: process.execPath apunta al montaje temporal, que cambia cada vez
  const exe = process.platform === 'linux' && process.env.APPIMAGE ? process.env.APPIMAGE : process.execPath
  return { exe, args: app.isPackaged ? [] : [app.getAppPath()] }
}

function quoteWin(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

/** Comillas de la especificación de .desktop (Exec=). */
function quoteDesktop(arg: string): string {
  const escaped = arg.replace(/([\\"`$])/g, '\\$1').replace(/%/g, '%%')
  return /[\s'"\\`$;&|<>()*?#~]/.test(arg) ? `"${escaped}"` : escaped
}

async function createWindowsShortcut(instance: Instance, desktop: string): Promise<string> {
  const icon = await writeIcon(instance, 'ico', buildIco(await instanceIconImage(instance)))
  const { exe, args } = launcherCommand()
  const file = path.join(desktop, `${safeFileName(instance.name)}.lnk`)
  const ok = shell.writeShortcutLink(file, (await fs.pathExists(file)) ? 'replace' : 'create', {
    target: exe,
    args: [...args, `${LAUNCH_ARG}${instance.id}`].map(quoteWin).join(' '),
    cwd: path.dirname(exe),
    description: `Jugar a ${instance.name} (ModpackLauncher)`,
    icon,
    iconIndex: 0
  })
  if (!ok) throw new Error('Windows no dejó crear el acceso directo')
  return file
}

async function createLinuxShortcut(instance: Instance, desktop: string): Promise<string> {
  const icon = await writeIcon(instance, 'png', (await instanceIconImage(instance)).resize({ width: 256, height: 256 }).toPNG())
  const { exe, args } = launcherCommand()
  const exec = [exe, ...args, `${LAUNCH_ARG}${instance.id}`].map(quoteDesktop).join(' ')
  const name = instance.name.replace(/[\r\n]/g, ' ')
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${name}`,
    `Comment=Jugar a ${name} (ModpackLauncher)`,
    `Exec=${exec}`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=Game;',
    ''
  ].join('\n')
  await fs.ensureDir(desktop)
  const file = path.join(desktop, `modpacklauncher-${safeFileName(instance.name).replace(/\s+/g, '-')}.desktop`)
  await fs.writeFile(file, entry, { mode: 0o755 })
  await fs.chmod(file, 0o755)
  // GNOME (Nautilus/DING) no ejecuta un .desktop del escritorio hasta marcarlo
  // como de confianza («Permitir lanzar»). Se intenta; si no hay gio, no pasa nada.
  execFile('gio', ['set', file, 'metadata::trusted', 'true'], () => { /* opcional */ })
  return file
}

/**
 * macOS no tiene accesos directos con argumentos: se crea una app mínima en el
 * escritorio cuyo único trabajo es abrir modpacklauncher://launch-instance?id=…
 * Así funciona igual con el launcher abierto que cerrado (open-url llega en los
 * dos casos). El icono se convierte a .icns con sips, que viene con el sistema.
 */
async function createMacShortcut(instance: Instance, desktop: string): Promise<string> {
  const appDir = path.join(desktop, `${safeFileName(instance.name)}.app`)
  const contents = path.join(appDir, 'Contents')
  await fs.remove(appDir)
  await fs.ensureDir(path.join(contents, 'MacOS'))
  await fs.ensureDir(path.join(contents, 'Resources'))

  const url = `modpacklauncher://launch-instance?id=${encodeURIComponent(instance.id)}`
  const script = `#!/bin/sh\nexec /usr/bin/open '${url}'\n`
  await fs.writeFile(path.join(contents, 'MacOS', 'launch'), script, { mode: 0o755 })
  await fs.chmod(path.join(contents, 'MacOS', 'launch'), 0o755)

  const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIdentifier</key><string>com.modpacklauncher.shortcut.${instance.id.replace(/[^A-Za-z0-9.-]/g, '')}</string>
  <key>CFBundleName</key><string>${xml(instance.name)}</string>
  <key>CFBundleDisplayName</key><string>${xml(instance.name)}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`
  await fs.writeFile(path.join(contents, 'Info.plist'), plist)

  const png = path.join(os.tmpdir(), `fport1-shortcut-${instance.id}.png`)
  await fs.writeFile(png, (await instanceIconImage(instance)).resize({ width: 512, height: 512 }).toPNG())
  await new Promise<void>((resolve) => {
    execFile('/usr/bin/sips', ['-s', 'format', 'icns', png, '--out', path.join(contents, 'Resources', 'icon.icns')], () => resolve())
  })
  await fs.remove(png).catch(() => {})
  // Que Finder vuelva a leer el icono
  const now = new Date()
  await fs.utimes(appDir, now, now).catch(() => {})
  return appDir
}

// ── Mantenerlos al día ────────────────────────────────────────────────────────
//
// Se apunta qué accesos directos se crearon (instancia → fichero y una «firma»
// con su nombre e icono). Si la instancia cambia de nombre o de icono, el acceso
// directo se rehace; si se borra la instancia, se quita del escritorio. Si el
// usuario lo borró a mano, se olvida y no se vuelve a crear.

interface ShortcutEntry { file: string; sig: string }

function registryFile(): string {
  return path.join(iconsDir(), 'shortcuts.json')
}

async function readRegistry(): Promise<Record<string, ShortcutEntry>> {
  return fs.readJson(registryFile()).catch(() => ({}))
}

async function writeRegistry(reg: Record<string, ShortcutEntry>): Promise<void> {
  await fs.ensureDir(iconsDir())
  await fs.writeJson(registryFile(), reg, { spaces: 2 })
}

/** Lo que, si cambia, obliga a rehacer el acceso directo: el nombre y el icono (también si se cambia el fichero). */
async function signature(instance: Instance): Promise<string> {
  let iconStamp = ''
  if (instance.icon) {
    try {
      const st = await fs.stat(path.join(await resolveInstanceDir(instance.id), instance.icon.split('?')[0]))
      iconStamp = `${st.size}:${st.mtimeMs}`
    } catch { /* sin icono propio */ }
  }
  return JSON.stringify([instance.name, instance.icon ?? '', iconStamp])
}

async function writeShortcutFor(instance: Instance): Promise<string> {
  const desktop = app.getPath('desktop')
  if (process.platform === 'win32') return createWindowsShortcut(instance, desktop)
  if (process.platform === 'darwin') return createMacShortcut(instance, desktop)
  return createLinuxShortcut(instance, desktop)
}

/** Si el nombre cambió, el fichero también: se quita el del nombre viejo. */
async function removeOldFile(oldFile: string | undefined, newFile: string): Promise<void> {
  if (oldFile && path.resolve(oldFile).toLowerCase() !== path.resolve(newFile).toLowerCase()) {
    await fs.remove(oldFile).catch(() => {})
  }
}

// Las escrituras del registro van en fila: dos cambios seguidos no se pisan
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

export function createInstanceShortcut(instanceId: string): Promise<string> {
  return serial(async () => {
    const instance = (await loadInstances()).find((i) => i.id === instanceId)
    if (!instance) throw new Error('No se encontró la instancia')
    const reg = await readRegistry()
    const file = await writeShortcutFor(instance)
    await removeOldFile(reg[instanceId]?.file, file)
    reg[instanceId] = { file, sig: await signature(instance) }
    await writeRegistry(reg)
    return file
  })
}

/** Pone al día el acceso directo de una instancia (o de todas), si tiene. No falla nunca. */
export function syncInstanceShortcuts(instanceId?: string): Promise<void> {
  return serial(async () => {
    const reg = await readRegistry()
    const ids = instanceId ? [instanceId] : Object.keys(reg)
    if (!ids.some((id) => reg[id])) return
    const instances = await loadInstances()
    let changed = false
    for (const id of ids) {
      const entry = reg[id]
      if (!entry) continue
      try {
        if (!(await fs.pathExists(entry.file))) { delete reg[id]; changed = true; continue }
        const instance = instances.find((i) => i.id === id)
        if (!instance) {
          await fs.remove(entry.file).catch(() => {})
          delete reg[id]
          changed = true
          continue
        }
        const sig = await signature(instance)
        if (sig === entry.sig) continue
        const file = await writeShortcutFor(instance)
        await removeOldFile(entry.file, file)
        reg[id] = { file, sig }
        changed = true
      } catch (e) {
        console.warn('[Acceso directo] No se pudo poner al día:', e instanceof Error ? e.message : e)
      }
    }
    if (changed) await writeRegistry(reg)
  }).catch(() => {})
}

export function registerShortcutIpc(): void {
  ipcMain.handle('instances:create-shortcut', (_e, instanceId: string) => createInstanceShortcut(instanceId))
  // Al arrancar: cambios hechos por otros caminos (una actualización del modpack, a mano…)
  setTimeout(() => { void syncInstanceShortcuts() }, 5000)
}

// ── Abrir el acceso directo ───────────────────────────────────────────────────

export interface ShortcutDeps {
  /** Lanza el juego por el mismo camino que el botón Jugar. */
  launch: (instanceId: string) => Promise<void>
  getWindow: () => BrowserWindow | null
  showWindow: () => void
  deliver: (channel: string, ...args: unknown[]) => void
  language: () => 'es' | 'en'
}

const TEXTS = {
  es: { checking: 'Buscando actualizaciones…', starting: 'Iniciando el juego…' },
  en: { checking: 'Checking for updates…', starting: 'Starting the game…' }
}

/** Ventanita de «Iniciando…» para que el doble clic no parezca no hacer nada. */
async function openSplash(instance: Instance, lang: 'es' | 'en'): Promise<BrowserWindow> {
  const icon = await instanceIconImage(instance).then((i) => (i.isEmpty() ? '' : i.resize({ width: 64, height: 64 }).toDataURL())).catch(() => '')
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0f0f14;color:#e6e6ee;font:13px system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden;-webkit-user-select:none;-webkit-app-region:drag}
    .w{display:flex;align-items:center;gap:14px;height:100%;padding:0 18px;box-sizing:border-box;border:1px solid #26262f;border-radius:10px}
    img{width:48px;height:48px;image-rendering:pixelated;border-radius:8px;flex:none}
    .n{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .t{color:#9a9aa8;margin-top:4px;display:flex;align-items:center;gap:8px}
    .s{width:12px;height:12px;border:2px solid #3a3a46;border-top-color:#7c6cff;border-radius:50%;animation:r .8s linear infinite;flex:none}
    @keyframes r{to{transform:rotate(360deg)}}
  </style></head><body><div class="w">${icon ? `<img src="${icon}">` : ''}<div style="min-width:0">
    <div class="n">${esc(instance.name)}</div><div class="t"><span class="s"></span><span id="t">${esc(TEXTS[lang].checking)}</span></div>
  </div></div></body></html>`
  const win = new BrowserWindow({
    width: 340, height: 92, frame: false, resizable: false, maximizable: false, minimizable: false,
    fullscreenable: false, show: false, center: true, alwaysOnTop: true, backgroundColor: '#0f0f14',
    title: instance.name, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {})
  if (!win.isDestroyed()) win.show()
  return win
}

function setSplashText(win: BrowserWindow | null, text: string): void {
  if (!win || win.isDestroyed()) return
  win.webContents.executeJavaScript(`document.getElementById('t').textContent=${JSON.stringify(text)}`).catch(() => {})
}

function closeSplash(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) win.destroy()
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

const inFlight = new Set<string>()

/**
 * Lo que hace el acceso directo. `coldStart`: el launcher se acaba de abrir solo
 * para esto y su ventana está oculta.
 */
export async function runInstanceShortcut(instanceId: string, deps: ShortcutDeps, coldStart: boolean): Promise<void> {
  if (inFlight.has(instanceId)) return
  inFlight.add(instanceId)
  let splash: BrowserWindow | null = null
  const lang = deps.language()
  const fail = (message: string, name?: string): void => {
    closeSplash(splash)
    splash = null
    deps.showWindow()
    deps.deliver('instance-shortcut:error', { instanceId, name, message })
  }
  try {
    const instance = (await loadInstances()).find((i) => i.id === instanceId)
    if (!instance) {
      fail(lang === 'en' ? 'The instance for this shortcut no longer exists.' : 'La instancia de este acceso directo ya no existe.')
      return
    }
    // Ya está abierta: basta con traer el launcher al frente
    if (isInstanceRunning(instanceId)) { deps.showWindow(); return }

    const win = deps.getWindow()
    const launcherInFront = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused()
    if (!launcherInFront) splash = await openSplash(instance, lang).catch(() => null)

    if (instance.modpackUrl) {
      try {
        const manifest = await withTimeout(fetchManifest(instance.modpackUrl, instance.modpackKey), 15_000)
        const hasUpdate = !instance.modpackVersion || compareVersions(manifest.version, instance.modpackVersion) > 0
        if (hasUpdate) {
          closeSplash(splash)
          splash = null
          deps.showWindow()
          deps.deliver('instance-shortcut:update', {
            instanceId,
            name: instance.name,
            modpackUrl: instance.modpackUrl,
            currentVersion: instance.modpackVersion,
            latestVersion: manifest.version
          })
          return
        }
      } catch (e) {
        // Sin red o el servidor del modpack caído: se juega con lo que hay
        console.warn(`[Acceso directo] No se pudo comprobar si «${instance.name}» tiene actualización:`, e instanceof Error ? e.message : e)
      }
    }

    setSplashText(splash, TEXTS[lang].starting)
    try {
      await deps.launch(instanceId)
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e), instance.name)
      return
    }
    closeSplash(splash)
    splash = null

    // Cancelado o cerrado nada más abrir: se enseña el launcher (logs, error…) en vez de quedarse oculto
    if (!isInstanceRunning(instanceId)) { if (coldStart) deps.showWindow(); return }
    if (coldStart) quitWhenGameEnds(instanceId, deps)
  } finally {
    closeSplash(splash)
    inFlight.delete(instanceId)
  }
}

/**
 * Con el launcher abierto solo para el acceso directo, al cerrar el juego se
 * cierra también la app, salvo que mientras tanto alguien haya abierto la
 * ventana o haya otro juego abierto. Se espera a 'session-saved', que llega
 * cuando ya se apuntó el tiempo jugado y se volvió a cerrar la bóveda de un
 * modpack protegido: cerrar antes podría dejar eso a medias.
 */
function quitWhenGameEnds(instanceId: string, deps: ShortcutDeps): void {
  const onSaved = (id: string): void => {
    if (id !== instanceId) return
    gameEvents.off('session-saved', onSaved)
    const win = deps.getWindow()
    const windowOpen = !!win && !win.isDestroyed() && win.isVisible()
    if (!windowOpen && getRunningSnapshot().length === 0) app.quit()
  }
  gameEvents.on('session-saved', onSaved)
}
