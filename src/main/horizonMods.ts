import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'
import { downloadFile } from './downloader'
import { getInstanceGameDir } from './instances'
import type { HorizonModProject, HorizonModInstalled } from '../shared/types'

// Registro de mods de Horizon (el mismo índice público que usa su launcher):
// https://horizon-rust.github.io/horizon-mods/index.json
//
// Dónde va cada cosa en la carpeta de la instancia (HORIZON_HOME), como en su launcher:
//   - resourcepack → resourcepacks/<archivo>
//   - shader       → shaderpacks/<archivo>
//   - mod (.hmod)  → horizon-mods/<id>.hmod, encendido con «mod.<id>:true» en horizon-mods.txt
//   - native-mod   → código Rust que se compila dentro del juego: su launcher recompila el juego
//                    entero. Aquí se listan pero no se instalan (hace falta compilar Horizon).
// Cada archivo se comprueba con el SHA-256 del índice antes de ponerlo en su sitio.

const INDEX_URL = 'https://horizon-rust.github.io/horizon-mods/index.json'
const RATINGS_URL = 'https://playhorizon.dev/api/mods/ratings'
const MODS_DIR = 'horizon-mods'
const MODS_LIST = 'horizon-mods.txt'
const STATE = '.fport1-horizon-mods.json'

interface RawVersion {
  version: string; published: string; changelog?: string; api?: string; game?: string; side?: string; capabilities?: string[]
  file: { name: string; url: string; size: number; sha256: string }
}
interface RawProject {
  id: string; kind: HorizonModProject['kind']; name: string; summary: string; description?: string; authors: string[]
  license?: string; source?: string; icon?: string; categories?: string[]; tags?: string[]; screenshots?: string[]
  versions: RawVersion[]; downloads?: number
}

let cache: { at: number; projects: HorizonModProject[] } | null = null

export async function horizonModsIndex(force = false): Promise<HorizonModProject[]> {
  if (!force && cache && Date.now() - cache.at < 10 * 60_000) return cache.projects
  const r = await axios.get(INDEX_URL, { timeout: 20_000 })
  const j = r.data as { projects: RawProject[]; revoked?: unknown }
  const ratings = await axios.get(RATINGS_URL, { timeout: 8_000 }).then((x) => x.data as Record<string, { mean?: number; count?: number }>).catch(() => ({} as Record<string, { mean?: number; count?: number }>))
  const projects: HorizonModProject[] = j.projects.map((p) => {
    const v = [...p.versions].sort((a, b) => b.published.localeCompare(a.published))
    const rating = (ratings as Record<string, { mean?: number; count?: number }>)[p.id]
    return {
      id: p.id, kind: p.kind, name: p.name, summary: p.summary, description: p.description ?? '', authors: p.authors ?? [],
      license: p.license, source: p.source, icon: p.icon, categories: p.categories ?? [], tags: p.tags ?? [], screenshots: p.screenshots ?? [],
      downloads: p.downloads ?? 0, rating: rating?.mean, ratingCount: rating?.count,
      installable: p.kind === 'resourcepack' || p.kind === 'shader' || p.kind === 'mod',
      updated: v[0]?.published ?? '',
      versions: v.map((x) => ({ version: x.version, published: x.published, changelog: x.changelog ?? '', game: x.game ?? '', side: x.side, capabilities: x.capabilities ?? [], file: x.file })),
    }
  })
  cache = { at: Date.now(), projects }
  return projects
}

type State = Record<string, { version: string; file: string; kind: string }>
const readState = async (home: string): Promise<State> => fs.readJson(path.join(home, STATE)).catch(() => ({}))

async function setEnabled(home: string, id: string, on: boolean): Promise<void> {
  const file = path.join(home, MODS_LIST)
  const key = `mod.${id}`
  const lines = (await fs.readFile(file, 'utf8').catch(() => '')).split(/\r?\n/).filter((l) => l && !l.startsWith(`${key}:`))
  lines.push(`${key}:${on}`)
  await fs.writeFile(file, `${lines.join('\n')}\n`)
}

export async function horizonModsInstalled(instanceId: string): Promise<HorizonModInstalled[]> {
  const home = await getInstanceGameDir(instanceId)
  const st = await readState(home)
  const list = (await fs.readFile(path.join(home, MODS_LIST), 'utf8').catch(() => ''))
  const out: HorizonModInstalled[] = []
  for (const [id, s] of Object.entries(st)) {
    if (!(await fs.pathExists(path.join(home, s.file)))) continue
    out.push({ id, version: s.version, kind: s.kind, file: s.file, enabled: s.kind !== 'mod' || new RegExp(`^mod\\.${id}:true$`, 'm').test(list) })
  }
  return out
}

export async function horizonModInstall(instanceId: string, id: string, version: string | undefined, onProgress: (p: number) => void): Promise<HorizonModInstalled> {
  const home = await getInstanceGameDir(instanceId)
  const p = (await horizonModsIndex()).find((x) => x.id === id)
  if (!p) throw new Error('Ese mod ya no está en el registro de Horizon')
  if (!p.installable) throw new Error('Este mod es nativo: hay que compilar Horizon con él dentro, y eso aún no lo hace el launcher')
  const v = (version ? p.versions.find((x) => x.version === version) : undefined) ?? p.versions[0]
  if (!v) throw new Error('No tiene versiones')
  const safeName = path.basename(v.file.name).replace(/[^\w.\-+]/g, '_')
  const rel = p.kind === 'mod' ? `${MODS_DIR}/${id}.hmod` : `${p.kind === 'shader' ? 'shaderpacks' : 'resourcepacks'}/${safeName}`
  const tmp = path.join(home, '.downloads', `${id}-${v.version}.part`)
  await fs.ensureDir(path.dirname(tmp))
  await downloadFile(v.file.url, tmp, (done: number, total: number) => onProgress(total ? done / total : 0))
  const hash = crypto.createHash('sha256').update(await fs.readFile(tmp)).digest('hex')
  if (hash !== v.file.sha256) { await fs.remove(tmp); throw new Error('El archivo descargado no coincide con el del registro (SHA-256)') }
  // Quitar la versión anterior si tenía otro nombre
  const st = await readState(home)
  if (st[id] && st[id].file !== rel) await fs.remove(path.join(home, st[id].file)).catch(() => {})
  await fs.ensureDir(path.dirname(path.join(home, rel)))
  await fs.move(tmp, path.join(home, rel), { overwrite: true })
  if (p.kind === 'mod') await setEnabled(home, id, true)
  st[id] = { version: v.version, file: rel, kind: p.kind }
  await fs.writeJson(path.join(home, STATE), st, { spaces: 2 })
  return { id, version: v.version, kind: p.kind, file: rel, enabled: true }
}

export async function horizonModRemove(instanceId: string, id: string): Promise<void> {
  const home = await getInstanceGameDir(instanceId)
  const st = await readState(home)
  const s = st[id]
  if (!s) return
  await fs.remove(path.join(home, s.file)).catch(() => {})
  if (s.kind === 'mod') {
    const file = path.join(home, MODS_LIST)
    const lines = (await fs.readFile(file, 'utf8').catch(() => '')).split(/\r?\n/).filter((l) => l && !l.startsWith(`mod.${id}:`))
    await fs.writeFile(file, lines.length ? `${lines.join('\n')}\n` : '')
  }
  delete st[id]
  await fs.writeJson(path.join(home, STATE), st, { spaces: 2 })
}

export async function horizonModToggle(instanceId: string, id: string, on: boolean): Promise<void> {
  const home = await getInstanceGameDir(instanceId)
  await setEnabled(home, id, on)
}
