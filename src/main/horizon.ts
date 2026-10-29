import { app } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import AdmZip from 'adm-zip'
import axios from 'axios'
import type { MinecraftAccount } from '../shared/types'
import { downloadFile } from './downloader'

// Horizon: Minecraft Java 26.3 reescrito en Rust (https://github.com/horizon-rust/horizon,
// licencia MIT). Aquí se usa nuestra propia versión, el fork Fport1/horizon, y mientras ese
// fork no publique versiones, las oficiales.
//
// Cómo funciona (lo mismo que hace su launcher, launcher/src/backend.rs):
//   1. Se baja el paquete del sistema (horizon-windows-x64.zip…) y se comprueba con SHA256SUMS.
//   2. Se prepara una vez: horizon-prepare saca texturas, datos y sonidos de NUESTRA copia de
//      Minecraft 26.3 (la carpeta compartida del launcher ya tiene versions/, libraries/ y
//      assets/ como el oficial), con el jar de servidor de Mojang y Java 25.
//   3. Se arranca horizon-client con --resources y la cuenta en un archivo de sesión que el
//      juego lee y borra al momento. Cada instancia tiene su propia carpeta (HORIZON_HOME).

/** De dónde salen las versiones: primero la nuestra, luego la oficial. */
export const HORIZON_REPOS = ['Fport1/horizon', 'horizon-rust/horizon']

const ASSET: Record<string, string> = {
  'win32-x64': 'horizon-windows-x64.zip',
  'linux-x64': 'horizon-linux-x86_64.tar.gz',
  'darwin-arm64': 'horizon-macos-arm64.zip',
}

export function horizonSupported(): boolean {
  return !!ASSET[`${process.platform}-${process.arch}`]
}

const root = (): string => path.join(app.getPath('userData'), 'horizon')
export const horizonVersionDir = (tag: string): string => path.join(root(), 'versions', tag.replace(/[^\w.-]/g, '_'))
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name)

export interface HorizonRelease {
  tag: string
  repo: string
  published: string
  url: string
  sumsUrl?: string
  size: number
}

let cache: { at: number; list: HorizonRelease[] } | null = null

/** Versiones del juego (no las de su launcher), las más nuevas primero. */
/** Versiones del juego (no las de su launcher), las más nuevas primero. Con `repos`, solo de esos. */
export async function horizonReleases(repos: string[] = HORIZON_REPOS): Promise<HorizonRelease[]> {
  const useCache = repos === HORIZON_REPOS
  if (useCache && cache && Date.now() - cache.at < 10 * 60_000) return cache.list
  const asset = ASSET[`${process.platform}-${process.arch}`]
  if (!asset) throw new Error('Horizon todavía no tiene versión para este sistema (hay para Windows x64, Linux x64 y Mac con Apple Silicon).')
  for (const repo of repos) {
    try {
      const r = await axios.get(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
        timeout: 15_000, headers: { Accept: 'application/vnd.github+json' },
      })
      const list: HorizonRelease[] = []
      for (const rel of r.data as { tag_name: string; published_at: string; draft: boolean; assets: { name: string; browser_download_url: string; size: number }[] }[]) {
        if (rel.draft || rel.tag_name.startsWith('launcher')) continue
        const a = rel.assets.find((x) => x.name === asset)
        if (!a) continue
        list.push({
          tag: rel.tag_name, repo, published: rel.published_at, url: a.browser_download_url, size: a.size,
          sumsUrl: rel.assets.find((x) => x.name === 'SHA256SUMS')?.browser_download_url,
        })
      }
      if (list.length) {
        if (useCache) cache = { at: Date.now(), list }
        return list
      }
    } catch (e) {
      console.warn(`[Horizon] No se pudieron leer las versiones de ${repo}:`, (e as Error).message)
    }
  }
  throw new Error('No se pudo saber qué versiones de Horizon hay. Revisa tu conexión.')
}

/** Versiones ya bajadas (para jugar sin conexión), las más nuevas primero. */
export async function horizonInstalledTags(): Promise<string[]> {
  const dir = path.join(root(), 'versions')
  const out: { tag: string; at: number }[] = []
  for (const n of await fs.readdir(dir).catch(() => [] as string[])) {
    const info = await fs.readJson(path.join(dir, n, '.installed')).catch(() => null) as { tag: string; at: string } | null
    if (info) out.push({ tag: info.tag, at: Date.parse(info.at) })
  }
  return out.sort((a, b) => b.at - a.at).map((x) => x.tag)
}

export async function horizonInstalled(tag: string): Promise<boolean> {
  return fs.pathExists(path.join(horizonVersionDir(tag), '.installed'))
}

type Progress = (fraction: number, msg: string) => void

async function sha256(file: string): Promise<string> {
  const h = crypto.createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve()).on('error', reject)
  })
  return h.digest('hex')
}

/** Baja y descomprime una versión, comprobando su suma SHA-256. */
export async function installHorizon(rel: HorizonRelease, onProgress?: Progress): Promise<void> {
  const dir = horizonVersionDir(rel.tag)
  if (await horizonInstalled(rel.tag)) return
  const tmp = path.join(root(), 'downloads')
  await fs.ensureDir(tmp)
  const file = path.join(tmp, path.basename(new URL(rel.url).pathname))
  onProgress?.(0, `Descargando Horizon ${rel.tag}...`)
  await downloadFile(rel.url, file, (done: number, total: number) => onProgress?.(total ? (done / total) * 0.8 : 0, `Descargando Horizon ${rel.tag}...`))
  if (rel.sumsUrl) {
    const sums = String((await axios.get(rel.sumsUrl, { timeout: 15_000, responseType: 'text' })).data)
    const want = sums.split('\n').map((l) => l.trim().split(/\s+\*?/)).find(([, n]) => n === path.basename(file))?.[0]
    const got = await sha256(file)
    if (want && want.toLowerCase() !== got) {
      await fs.remove(file)
      throw new Error('La descarga de Horizon no coincide con su suma de comprobación: se ha borrado. Vuelve a intentarlo.')
    }
  }
  onProgress?.(0.85, 'Descomprimiendo Horizon...')
  const staging = `${dir}.part`
  await fs.remove(staging)
  await fs.ensureDir(staging)
  if (file.endsWith('.zip')) {
    const { nativeAvailable, nativeZipExtract } = await import('./native')
    const ok = nativeAvailable() && await nativeZipExtract(file, staging).then(() => true).catch(() => false)
    if (!ok) new AdmZip(file).extractAllTo(staging, true)
  } else {
    const { execFile } = await import('child_process')
    await new Promise<void>((resolve, reject) => execFile('tar', ['xzf', file, '-C', staging], (e) => (e ? reject(e) : resolve())))
  }
  // El paquete trae una carpeta (horizon-windows-x64/): su contenido es la versión
  const inner = (await fs.readdir(staging)).filter((n) => !n.startsWith('.'))
  const top = inner.length === 1 && (await fs.stat(path.join(staging, inner[0]))).isDirectory() ? path.join(staging, inner[0]) : staging
  await fs.remove(dir)
  await fs.move(top, dir)
  await fs.remove(staging).catch(() => {})
  if (process.platform !== 'win32') {
    for (const b of ['horizon-client', 'horizon-prepare', 'horizon-ctl', 'horizon-server']) await fs.chmod(path.join(dir, b), 0o755).catch(() => {})
  }
  await fs.writeFile(path.join(dir, '.installed'), JSON.stringify({ tag: rel.tag, repo: rel.repo, at: new Date().toISOString() }))
  await fs.remove(file).catch(() => {})
  onProgress?.(1, `Horizon ${rel.tag} instalado`)
}

/** La versión de Minecraft que pide (26.3) y su Java, de research-lock.json. */
export async function horizonPins(tag: string): Promise<{ minecraft: string; javaMajor: number }> {
  const lock = await fs.readJson(path.join(horizonVersionDir(tag), 'research-lock.json')).catch(() => null) as { minecraft?: { version?: string; java_major?: number } } | null
  return { minecraft: lock?.minecraft?.version ?? '26.3', javaMajor: lock?.minecraft?.java_major ?? 25 }
}

const resourcesDir = async (tag: string): Promise<string> =>
  path.join(horizonVersionDir(tag), '.local', 'horizon-client', (await horizonPins(tag)).minecraft)

export async function horizonPrepared(tag: string): Promise<boolean> {
  return fs.pathExists(path.join(await resourcesDir(tag), 'horizon-resources.json'))
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, onLine: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env, windowsHide: true })
    let last: string[] = []
    const take = (b: Buffer): void => {
      for (const l of b.toString().split(/\r?\n/)) if (l.trim()) { onLine(l); last = [...last.slice(-15), l] }
    }
    p.stdout.on('data', take)
    p.stderr.on('data', take)
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`horizon-prepare terminó con error (${code}):\n${last.join('\n')}`))))
  })
}

/**
 * Prepara los recursos una vez por versión, desde la copia de Minecraft del launcher.
 * `javaPath` es el java del launcher para esa versión; `sharedDir`, la carpeta con
 * versions/, libraries/ y assets/.
 */
export async function prepareHorizon(tag: string, sharedDir: string, javaPath: string, onProgress?: Progress, onLine?: (l: string) => void): Promise<void> {
  if (await horizonPrepared(tag)) return
  const dir = horizonVersionDir(tag)
  const { minecraft } = await horizonPins(tag)
  const manifest = await fs.readJson(path.join(sharedDir, 'versions', minecraft, `${minecraft}.json`)) as { downloads?: { server?: { url: string; sha1: string } } }
  const server = manifest.downloads?.server
  if (!server) throw new Error(`Minecraft ${minecraft} no trae el jar de servidor que necesita Horizon.`)
  const jar = path.join(root(), 'server-jars', `${minecraft}.jar`)
  if (!(await fs.pathExists(jar))) {
    onProgress?.(0.02, `Descargando el servidor de Minecraft ${minecraft} (Mojang)...`)
    await fs.ensureDir(path.dirname(jar))
    await downloadFile(server.url, `${jar}.part`)
    const got = crypto.createHash('sha1').update(await fs.readFile(`${jar}.part`)).digest('hex')
    if (got !== server.sha1) { await fs.remove(`${jar}.part`); throw new Error('El jar de servidor descargado de Mojang no coincide con su suma: vuelve a intentarlo.') }
    await fs.move(`${jar}.part`, jar, { overwrite: true })
  }
  const javaHome = path.dirname(path.dirname(javaPath))
  const env = { ...process.env, JAVA_HOME: javaHome, PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH ?? ''}` }
  let lines = 0
  const log = (l: string): void => {
    lines++
    onLine?.(l)
    // Unas 400 líneas en una preparación completa
    onProgress?.(0.05 + 0.85 * (1 - Math.exp(-lines / 150)), `Preparando Horizon: ${l.slice(0, 80)}`)
  }
  onProgress?.(0.05, 'Preparando Horizon con tu copia de Minecraft (solo la primera vez, unos minutos)...')
  await run(path.join(dir, exe('horizon-prepare')), ['--prepare', '--server-jar', jar, '--minecraft-dir', sharedDir, '--root', dir], env, dir, log)
  onProgress?.(0.92, 'Copiando los sonidos...')
  // Los sonidos son opcionales: sin ellos el juego va en silencio, pero funciona
  await run(path.join(dir, exe('horizon-prepare')), ['sounds', '--minecraft-dir', sharedDir, '--root', dir], env, dir, log)
    .catch((e) => onLine?.(`Sin sonidos (el juego irá en silencio): ${(e as Error).message}`))
  onProgress?.(1, 'Horizon preparado')
}

/**
 * Arranca el juego. Con cuenta premium va la sesión en un archivo de un solo uso (el juego lo
 * borra al leerlo y no acepta uno de más de dos minutos); sin ella, sin conexión con --name.
 */
export async function startHorizon(tag: string, gameDir: string, account: MinecraftAccount, size?: { width?: number; height?: number }): Promise<ChildProcess> {
  const dir = horizonVersionDir(tag)
  await fs.ensureDir(gameDir)
  const args = ['--resources', await resourcesDir(tag)]
  if (account.type === 'microsoft' && account.accessToken && account.accessToken !== 'offline') {
    const sessions = path.join(gameDir, 'sessions')
    await fs.ensureDir(sessions)
    const file = path.join(sessions, `session-${crypto.randomBytes(12).toString('hex')}.json`)
    await fs.writeFile(file, JSON.stringify({ name: account.username, uuid: account.uuid.replace(/-/g, ''), access_token: account.accessToken, user_type: 'msa', xuid: '' }), { flag: 'wx', mode: 0o600 })
    args.push('--session-file', file)
  } else {
    args.push('--name', account.username)
  }
  if (size?.width && size?.height) args.push('--width', String(size.width), '--height', String(size.height))
  return spawn(path.join(dir, exe('horizon-client')), args, {
    cwd: gameDir,
    env: { ...process.env, HORIZON_HOME: gameDir },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  })
}
