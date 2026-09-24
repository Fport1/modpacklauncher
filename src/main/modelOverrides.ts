import fs from 'fs-extra'
import path from 'path'
import { app } from 'electron'

/**
 * Ajustes de modelos hechos por el usuario en el editor.
 *
 * Van en un JSON legible en la carpeta del usuario, no en localStorage, para
 * poder copiarlos a los valores por defecto de la app
 * (src/renderer/src/lib/modelOverrides.defaults.json) cuando estén listos.
 */
function overridesFile(): string {
  return path.join(app.getPath('userData'), 'model-overrides.json')
}

export async function readModelOverrides(): Promise<Record<string, unknown>> {
  return fs.readJson(overridesFile()).catch(() => ({}))
}

export async function writeModelOverrides(data: Record<string, unknown>): Promise<void> {
  // Escribir a un temporal y renombrar: si la app se cierra a mitad, el JSON
  // anterior queda intacto en vez de a medio escribir.
  const target = overridesFile()
  const tmp = `${target}.tmp`
  await fs.writeJson(tmp, data, { spaces: 2 })
  await fs.move(tmp, target, { overwrite: true })
}
