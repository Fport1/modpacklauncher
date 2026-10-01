import fs from 'fs-extra'
import path from 'path'

// Qué pack está ACTIVO, no solo instalado.
//
// Que un resource pack o un shader esté en su carpeta solo hace que el juego lo
// ofrezca en su lista. Para usarlo:
// - resource packs: tiene que estar en `resourcePacks` de options.txt (el último
//   tiene más prioridad), o activarlo el jugador en Opciones › Paquetes de recursos;
// - shaders con Iris: `shaderPack` y `enableShaders` de config/iris.properties;
//   con OptiFine: `shaderPack` de optionsshaders.txt.
// El juego lee esos archivos AL ARRANCAR y los reescribe al cambiar opciones o al
// cerrar: con la partida abierta, editarlos no hace nada y además se pierde.

const RP_LINE = /^resourcePacks:(.*)$/m

/** Lista de resource packs activos en options.txt (ids como «vanilla» o «file/Pack.zip»). */
export async function activeResourcePacks(gameDir: string): Promise<string[]> {
  const opts = await fs.readFile(path.join(gameDir, 'options.txt'), 'utf8').catch(() => '')
  try { const v = JSON.parse(opts.match(RP_LINE)?.[1] ?? '[]'); return Array.isArray(v) ? v.map(String) : [] } catch { return [] }
}

/**
 * Activa o desactiva un resource pack en options.txt para el próximo arranque.
 * Al activarlo va el último (encima de los demás). Si options.txt no existe
 * todavía (el juego nunca se abrió), se crea solo con esa línea: el juego
 * completa el resto al arrancar.
 */
export async function setResourcePackActive(gameDir: string, filename: string, on: boolean): Promise<string[]> {
  const file = path.join(gameDir, 'options.txt')
  const opts = await fs.readFile(file, 'utf8').catch(() => '')
  const id = `file/${filename.replace(/\.disabled$/, '')}`
  let list = await activeResourcePacks(gameDir)
  if (!list.length) list = ['vanilla']
  list = list.filter((x) => x !== id)
  if (on) list.push(id)
  const line = `resourcePacks:${JSON.stringify(list)}`
  const next = RP_LINE.test(opts) ? opts.replace(RP_LINE, line) : `${opts}${opts && !opts.endsWith('\n') ? '\n' : ''}${line}\n`
  // Un pack que se desactiva tampoco debe quedarse en la lista de «incompatibles» aceptados
  const incompat = /^incompatibleResourcePacks:(.*)$/m
  const cleaned = on ? next : next.replace(incompat, (_m, v: string) => {
    try { return `incompatibleResourcePacks:${JSON.stringify((JSON.parse(v) as string[]).filter((x) => x !== id))}` } catch { return _m }
  })
  await fs.outputFile(file, cleaned)
  return list
}

/** Qué gestor de shaders tiene la instancia, según su configuración y sus mods. */
export async function shaderLoader(gameDir: string): Promise<'iris' | 'optifine' | null> {
  if (await fs.pathExists(path.join(gameDir, 'config', 'iris.properties'))) return 'iris'
  if (await fs.pathExists(path.join(gameDir, 'optionsshaders.txt'))) return 'optifine'
  const mods = await fs.readdir(path.join(gameDir, 'mods')).catch(() => [] as string[])
  if (mods.some((m) => /^iris|oculus/i.test(m) && !m.endsWith('.disabled'))) return 'iris'
  if (mods.some((m) => /optifine/i.test(m) && !m.endsWith('.disabled'))) return 'optifine'
  return null
}

function setProp(text: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(text) ? text.replace(re, `${key}=${value}`) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${key}=${value}\n`
}

/** Selecciona (o quita) el shader para el próximo arranque. Devuelve el gestor usado, o null si no hay. */
export async function setShaderSelected(gameDir: string, filename: string | null): Promise<'iris' | 'optifine' | null> {
  const loader = await shaderLoader(gameDir)
  const name = filename?.replace(/\.disabled$/, '') ?? ''
  if (loader === 'iris') {
    const file = path.join(gameDir, 'config', 'iris.properties')
    let t = await fs.readFile(file, 'utf8').catch(() => '')
    if (name) t = setProp(t, 'shaderPack', name)
    t = setProp(t, 'enableShaders', name ? 'true' : 'false')
    await fs.outputFile(file, t)
  } else if (loader === 'optifine') {
    const file = path.join(gameDir, 'optionsshaders.txt')
    await fs.outputFile(file, setProp(await fs.readFile(file, 'utf8').catch(() => ''), 'shaderPack', name || 'OFF'))
  }
  return loader
}

/** Shader seleccionado ahora mismo (para el próximo arranque o el que ya está en uso). */
export async function selectedShader(gameDir: string): Promise<{ loader: 'iris' | 'optifine' | null; pack: string | null; enabled: boolean }> {
  const loader = await shaderLoader(gameDir)
  if (loader === 'iris') {
    const t = await fs.readFile(path.join(gameDir, 'config', 'iris.properties'), 'utf8').catch(() => '')
    return { loader, pack: t.match(/^shaderPack=(.*)$/m)?.[1]?.trim() || null, enabled: !/^enableShaders=false$/m.test(t) }
  }
  if (loader === 'optifine') {
    const p = (await fs.readFile(path.join(gameDir, 'optionsshaders.txt'), 'utf8').catch(() => '')).match(/^shaderPack=(.*)$/m)?.[1]?.trim() || null
    return { loader, pack: p && p !== 'OFF' ? p : null, enabled: !!p && p !== 'OFF' }
  }
  return { loader, pack: null, enabled: false }
}
