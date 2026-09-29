import axios from 'axios'

// Cliente de la API de CurseForge. La clave es del autor del launcher y va
// fija aquí, no como ajuste del usuario.

const CF_API_KEY = '$2a$10$lH3wV/Q8E/bCpE7.jyIeWObw2LhbSypU8klDDAXvLsuikkHHJyAx.'
const CF_BASE = 'https://api.curseforge.com'
const HEADERS = {
  'x-api-key': CF_API_KEY,
  Accept: 'application/json',
  'User-Agent': 'ModpackLauncher/1.9 (contact@fport1.dev)'
}

export const CF_GAME_MINECRAFT = 432
/** classId de CurseForge para cada tipo de contenido. */
export const CF_CLASS = { mod: 6, resourcepack: 12, modpack: 4471, shader: 6552, datapack: 6945, world: 17, bukkitPlugin: 5 } as const
/** modLoader de los índices de archivos de CurseForge. */
export const CF_LOADER: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }

export async function cfGet<T = any>(apiPath: string): Promise<T> {
  const res = await axios.get(`${CF_BASE}${apiPath}`, { headers: HEADERS, timeout: 20_000 })
  return res.data
}

export async function cfPost<T = any>(apiPath: string, body: unknown): Promise<T> {
  const res = await axios.post(`${CF_BASE}${apiPath}`, body, { headers: { ...HEADERS, 'Content-Type': 'application/json' }, timeout: 20_000 })
  return res.data
}

/**
 * Huella de CurseForge de un archivo: MurmurHash2 de 32 bits (semilla 1)
 * sobre los bytes del archivo quitando tabuladores, saltos de línea y
 * espacios. Con ella /v1/fingerprints dice qué proyecto y archivo es.
 */
export function cfFingerprint(buf: Buffer): number {
  const filtered = Buffer.allocUnsafe(buf.length)
  let len = 0
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (b !== 9 && b !== 10 && b !== 13 && b !== 32) filtered[len++] = b
  }
  const m = 0x5bd1e995
  let h = (1 ^ len) >>> 0
  let i = 0
  while (len - i >= 4) {
    let k = filtered[i] | (filtered[i + 1] << 8) | (filtered[i + 2] << 16) | (filtered[i + 3] << 24)
    k = Math.imul(k, m)
    k ^= k >>> 24
    k = Math.imul(k, m)
    h = Math.imul(h, m) ^ k
    i += 4
  }
  switch (len - i) {
    case 3: h ^= filtered[i + 2] << 16 // falls through
    case 2: h ^= filtered[i + 1] << 8 // falls through
    case 1: h ^= filtered[i]; h = Math.imul(h, m)
  }
  h ^= h >>> 13
  h = Math.imul(h, m)
  h ^= h >>> 15
  return h >>> 0
}
