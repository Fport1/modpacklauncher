import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import fs from 'fs-extra'
import path from 'path'

// Sesión de fport1social (Firebase Auth) guardada por el proceso principal.
//
// Firebase la guardaba en el IndexedDB de cada origen del renderer: la app
// instalada (file://) y la de desarrollo (localhost) tenían sesiones distintas,
// y cualquier limpieza de ese almacenamiento cerraba la sesión. Aquí vive en
// un archivo de userData, cifrado con safeStorage como la cuenta de Microsoft,
// y lo comparten todas las ventanas.

type Value = unknown
const file = (): string => path.join(app.getPath('userData'), 'social-session.bin')
let data: Record<string, Value> | null = null

function load(): Record<string, Value> {
  if (data) return data
  try {
    const raw = fs.readFileSync(file())
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
    data = JSON.parse(json) as Record<string, Value>
  } catch {
    data = {}
  }
  return data
}

function save(): void {
  const json = JSON.stringify(data ?? {})
  const out = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8')
  fs.ensureDirSync(path.dirname(file()))
  // Escribir y renombrar: si el launcher se cierra a mitad no queda un archivo roto
  fs.writeFileSync(file() + '.tmp', out)
  fs.renameSync(file() + '.tmp', file())
}

function broadcast(sender: Electron.WebContents, key: string, value: Value | null): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents.id !== sender.id) {
      w.webContents.send('social-session:changed', key, value)
    }
  }
}

/** Si hay una sesión de fport1social guardada (solo sí/no, para las estadísticas). */
export function hasSocialSession(): boolean {
  return Object.keys(load()).some((k) => k.startsWith('firebase:authUser'))
}

export function registerSocialSession(): void {
  ipcMain.handle('social-session:get', (_e, key: string) => load()[key] ?? null)
  ipcMain.handle('social-session:set', (e, key: string, value: Value) => {
    load()[key] = value
    save()
    broadcast(e.sender, key, value)
  })
  ipcMain.handle('social-session:remove', (e, key: string) => {
    if (!(key in load())) return
    delete load()[key]
    save()
    broadcast(e.sender, key, null)
  })
}
