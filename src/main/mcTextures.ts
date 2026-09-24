import fs from 'fs-extra'
import path from 'path'
import AdmZip from 'adm-zip'
import { getSharedDir } from './instances'

// Texturas de Minecraft (objetos, bloques, corazones, comida, efectos…) para
// que los editores sencillos se vean como el juego. Se sacan del .jar de la
// versión más nueva que el launcher ya tenga descargada: nada se baja de
// internet y siempre coinciden con el juego de verdad.

let jar: { path: string; zip: AdmZip } | null = null
const cache = new Map<string, string | null>()

const isRelease = (name: string): boolean => /^\d+\.\d+(\.\d+)?$/.test(name)

async function openJar(): Promise<AdmZip | null> {
  if (jar) return jar.zip
  const dir = path.join(getSharedDir(), 'versions')
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter(isRelease)
  names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const name of names) {
    const file = path.join(dir, name, `${name}.jar`)
    if (await fs.pathExists(file)) {
      jar = { path: file, zip: new AdmZip(file) }
      return jar.zip
    }
  }
  return null
}

function readPng(zip: AdmZip, rel: string): string | null {
  const entry = zip.getEntry(`assets/minecraft/textures/${rel}.png`)
  if (!entry) return null
  return `data:image/png;base64,${entry.getData().toString('base64')}`
}

/**
 * Textura para cada clave pedida. Las claves son:
 * - "item:<id>": el icono de un objeto (o la cara de su bloque si no tiene icono propio)
 * - cualquier otra: ruta dentro de textures/ sin .png ("gui/sprites/hud/heart/full")
 * Lo que no existe vuelve como null.
 */
export async function getTextures(keys: string[]): Promise<Record<string, string | null>> {
  const zip = await openJar()
  const out: Record<string, string | null> = {}
  for (const key of keys) {
    if (cache.has(key)) { out[key] = cache.get(key)!; continue }
    let url: string | null = null
    if (zip) {
      if (key.startsWith('item:')) {
        const id = key.slice(5).replace(/^minecraft:/, '')
        for (const rel of [`item/${id}`, `block/${id}`, `block/${id}_front`, `block/${id}_side`, `block/${id}_top`, `item/${id}_00`]) {
          url = readPng(zip, rel)
          if (url) break
        }
      } else {
        url = readPng(zip, key)
      }
    }
    cache.set(key, url)
    out[key] = url
  }
  return out
}
