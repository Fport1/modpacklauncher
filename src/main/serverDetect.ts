import type { RemoteEntry, ServerInfo } from '../shared/types'

// Detección del software de un servidor de Minecraft mirando sus archivos.
//
// Sirve para no ofrecer en el buscador cosas que ese servidor no puede cargar:
// un Paper no carga mods de Fabric, un Fabric no carga plugins, y un Folia solo
// carga plugins preparados para Folia.

type Lister = (dir: string) => Promise<RemoteEntry[]>
type Reader = (file: string) => Promise<Buffer>

const join = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`)

/** Lo que un servidor de cada tipo acepta, en el formato de loaders de Modrinth. */
const PLUGIN_LOADERS: Record<string, string> = {
  folia: 'folia',
  purpur: 'purpur,paper,spigot,bukkit',
  paper: 'paper,spigot,bukkit',
  pufferfish: 'paper,spigot,bukkit',
  spigot: 'spigot,bukkit',
  bukkit: 'bukkit',
  velocity: 'velocity',
  bungeecord: 'bungeecord,waterfall'
}

const LABELS: Record<string, string> = {
  fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge',
  paper: 'Paper', purpur: 'Purpur', folia: 'Folia', pufferfish: 'Pufferfish', spigot: 'Spigot', bukkit: 'Bukkit',
  velocity: 'Velocity', bungeecord: 'BungeeCord', vanilla: 'Vanilla'
}

export async function detectServer(root: string, list: Lister, read: Reader): Promise<ServerInfo> {
  const evidence: string[] = []
  const safeList = async (dir: string): Promise<RemoteEntry[]> => list(dir).catch(() => [])
  const safeReadText = async (file: string, maxBytes: number): Promise<string> => {
    try {
      const data = await read(file)
      return data.subarray(0, maxBytes).toString('utf8')
    } catch {
      return ''
    }
  }

  const entries = await safeList(root)
  const has = (name: string): RemoteEntry | undefined => entries.find((e) => e.name === name)
  const hasDir = (name: string): boolean => !!has(name)?.isDir
  const hasFile = (name: string): boolean => !!has(name) && !has(name)!.isDir

  // ── Pistas del registro: lo más fiable para la versión y a menudo el software ──
  let logText = ''
  const logs = hasDir('logs') ? await safeList(join(root, 'logs')) : []
  const latest = logs.find((e) => e.name === 'latest.log')
  // Basta con el arranque, que está al principio: quien llama lee solo el
  // comienzo del archivo, que en un servidor con días encendido pesa decenas de MB.
  if (latest) {
    logText = await safeReadText(join(join(root, 'logs'), 'latest.log'), 256 * 1024)
  }

  let minecraft = ''
  const fromLog =
    /Starting minecraft server version ([0-9][\w.\-]*)/.exec(logText) ??
    /Loading Minecraft ([0-9][\w.\-]*) with Fabric Loader/.exec(logText) ??
    /\(MC: ([0-9][\w.\-]*)\)/.exec(logText)
  if (fromLog) {
    minecraft = fromLog[1]
    evidence.push(`Versión ${minecraft} según logs/latest.log`)
  }

  // Paper y derivados guardan el historial de versiones
  let versionHistory = ''
  if (hasFile('version_history.json')) {
    versionHistory = await safeReadText(join(root, 'version_history.json'), 64 * 1024)
    const mc = /\(MC: ([0-9][\w.\-]*)\)/.exec(versionHistory)
    if (mc && !minecraft) {
      minecraft = mc[1]
      evidence.push(`Versión ${minecraft} según version_history.json`)
    }
  }

  // Paper deja una carpeta versions/<mc>/ con el jar de Mojang
  if (!minecraft && hasDir('versions')) {
    const dirs = (await safeList(join(root, 'versions'))).filter((e) => e.isDir && /^\d+\.\d+/.test(e.name))
    if (dirs.length > 0) {
      minecraft = dirs.map((d) => d.name).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
      evidence.push(`Versión ${minecraft} según la carpeta versions/`)
    }
  }

  // Forge y NeoForge dejan el servidor de Mojang en libraries/net/minecraft/server/<mc>
  const libs = hasDir('libraries') ? await safeList(join(root, 'libraries')) : []
  const libNet = libs.some((e) => e.name === 'net') ? await safeList(join(root, 'libraries/net')) : []
  const libNames = new Set(libNet.map((e) => e.name))
  if (!minecraft && libNames.has('minecraft')) {
    const server = await safeList(join(root, 'libraries/net/minecraft/server'))
    const ver = server.filter((e) => e.isDir).map((e) => e.name).find((n) => /^\d+\.\d+/.test(n))
    if (ver) {
      minecraft = ver.split('-')[0]
      evidence.push(`Versión ${minecraft} según libraries/`)
    }
  }

  // ── Qué software es ──
  const hasPlugins = hasDir('plugins')
  const hasMods = hasDir('mods')
  let loader = ''

  if (hasFile('velocity.toml')) {
    loader = 'velocity'; evidence.push('velocity.toml')
  } else if (hasFile('config.yml') && hasDir('modules') && !hasMods) {
    loader = 'bungeecord'; evidence.push('config.yml + modules/ (BungeeCord/Waterfall)')
  }

  // Mods: por las librerías que instala cada loader, o por sus archivos propios
  // Primero los archivos, que son inequívocos; el registro solo si no hay
  // ninguno, porque un mod puede nombrar a otro loader en sus mensajes.
  let modLoader = ''
  if (libNames.has('neoforged')) {
    modLoader = 'neoforge'; evidence.push('libraries/net/neoforged')
  } else if (libNames.has('minecraftforge')) {
    modLoader = 'forge'; evidence.push('libraries/net/minecraftforge')
  } else if (hasDir('.quilt') || hasFile('quilt-server-launch.jar')) {
    modLoader = 'quilt'; evidence.push('archivos de Quilt')
  } else if (hasDir('.fabric') || hasFile('fabric-server-launch.jar') || hasFile('fabric-server-launcher.properties')) {
    modLoader = 'fabric'; evidence.push(hasDir('.fabric') ? 'carpeta .fabric' : 'lanzador de Fabric')
  } else if (/Quilt Loader/i.test(logText)) {
    modLoader = 'quilt'; evidence.push('Quilt en el registro')
  } else if (/Fabric Loader/i.test(logText)) {
    modLoader = 'fabric'; evidence.push('Fabric en el registro')
  } else if (/NeoForge/i.test(logText)) {
    modLoader = 'neoforge'; evidence.push('NeoForge en el registro')
  } else if (/MinecraftForge|Forge Mod Loader/i.test(logText)) {
    modLoader = 'forge'; evidence.push('Forge en el registro')
  }

  // Plugins: del más específico al más general, porque cada uno trae los archivos de los anteriores
  let pluginLoader = ''
  if (!loader && (hasPlugins || !hasMods)) {
    const config = hasDir('config') ? await safeList(join(root, 'config')) : []
    const inConfig = (n: string): boolean => config.some((e) => e.name === n)
    if (/Folia/i.test(versionHistory) || /running Folia/i.test(logText)) {
      pluginLoader = 'folia'; evidence.push('Folia en version_history/registro')
    } else if (hasFile('purpur.yml')) {
      pluginLoader = 'purpur'; evidence.push('purpur.yml')
    } else if (hasFile('pufferfish.yml')) {
      pluginLoader = 'pufferfish'; evidence.push('pufferfish.yml')
    } else if (inConfig('paper-global.yml') || hasFile('paper.yml') || /Paper/i.test(versionHistory)) {
      pluginLoader = 'paper'; evidence.push(inConfig('paper-global.yml') ? 'config/paper-global.yml' : hasFile('paper.yml') ? 'paper.yml' : 'version_history.json')
    } else if (hasFile('spigot.yml')) {
      pluginLoader = 'spigot'; evidence.push('spigot.yml')
    } else if (hasFile('bukkit.yml')) {
      pluginLoader = 'bukkit'; evidence.push('bukkit.yml')
    }
  }

  // ── Resultado ──
  const withVersion = (label: string): string => (minecraft ? `${label} · MC ${minecraft}` : label)

  if (loader === 'velocity' || loader === 'bungeecord') {
    return {
      kind: 'proxy', loader, label: withVersion(LABELS[loader]), minecraft,
      mods: null,
      plugins: { loaders: PLUGIN_LOADERS[loader], folder: join(root, 'plugins') },
      evidence
    }
  }

  // Híbridos (Mohist, Arclight…): cargan mods de Forge/NeoForge y plugins de Bukkit a la vez
  if (modLoader && hasPlugins && (modLoader === 'forge' || modLoader === 'neoforge')) {
    evidence.push('mods/ y plugins/ a la vez: servidor híbrido')
    return {
      kind: 'hybrid', loader: modLoader, label: withVersion(`${LABELS[modLoader]} + plugins (híbrido)`), minecraft,
      mods: { loaders: modLoader, folder: join(root, 'mods') },
      plugins: { loaders: PLUGIN_LOADERS.spigot, folder: join(root, 'plugins') },
      evidence
    }
  }

  if (modLoader) {
    return {
      kind: 'mods', loader: modLoader, label: withVersion(LABELS[modLoader]), minecraft,
      mods: { loaders: modLoader, folder: join(root, 'mods') },
      plugins: null,
      evidence
    }
  }

  if (pluginLoader) {
    return {
      kind: 'plugins', loader: pluginLoader, label: withVersion(LABELS[pluginLoader]), minecraft,
      mods: null,
      plugins: { loaders: PLUGIN_LOADERS[pluginLoader], folder: join(root, 'plugins') },
      evidence
    }
  }

  if (hasFile('server.properties')) {
    evidence.push('server.properties sin rastro de mods ni plugins')
    return { kind: 'vanilla', loader: 'vanilla', label: withVersion('Vanilla'), minecraft, mods: null, plugins: null, evidence }
  }

  return { kind: 'unknown', loader: '', label: 'No reconocido', minecraft, mods: null, plugins: null, evidence }
}

/** Los tipos que se pueden elegir a mano cuando la detección falla o se equivoca. */
export const MANUAL_LOADERS = [
  'fabric', 'quilt', 'forge', 'neoforge', 'paper', 'purpur', 'folia', 'spigot', 'bukkit', 'velocity', 'bungeecord', 'vanilla'
] as const

/** ServerInfo a partir de lo que el usuario eligió a mano. */
export function serverInfoFor(loader: string, minecraft: string, root: string): ServerInfo {
  const label = `${LABELS[loader] ?? loader}${minecraft ? ` · MC ${minecraft}` : ''}`
  const evidence = ['Elegido a mano']
  if (['fabric', 'quilt', 'forge', 'neoforge'].includes(loader)) {
    return { kind: 'mods', loader, label, minecraft, mods: { loaders: loader, folder: join(root, 'mods') }, plugins: null, evidence, manual: true }
  }
  if (PLUGIN_LOADERS[loader]) {
    const kind = loader === 'velocity' || loader === 'bungeecord' ? 'proxy' : 'plugins'
    return { kind, loader, label, minecraft, mods: null, plugins: { loaders: PLUGIN_LOADERS[loader], folder: join(root, 'plugins') }, evidence, manual: true }
  }
  return { kind: 'vanilla', loader: 'vanilla', label, minecraft, mods: null, plugins: null, evidence, manual: true }
}
