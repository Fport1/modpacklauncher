import axios from 'axios'
import path from 'path'
import fs from 'fs-extra'
import crypto from 'crypto'
import { getInstanceGameDir } from './instances'

const BASE = 'https://api.modrinth.com/v2'
const HEADERS = { 'User-Agent': 'ModpackLauncher/1.0.1 (franciscomanuelportoperez@gmail.com)' }

export interface ModrinthHit {
  project_id: string
  slug: string
  title: string
  description: string
  icon_url: string | null
  downloads: number
  follows: number
  categories: string[]
  display_categories: string[]
  versions: string[]
  date_modified: string
  client_side: string
  server_side: string
}

export interface ModrinthVersion {
  id: string
  version_number: string
  name: string
  loaders: string[]
  game_versions: string[]
  date_published: string
  downloads: number
  files: { url: string; filename: string; primary: boolean; size: number }[]
  dependencies: { project_id: string | null; dependency_type: 'required' | 'optional' | 'incompatible' }[]
}

export interface ModrinthCategory {
  name: string
  project_type: string
  header: string
}

export interface ModrinthSearchResult {
  hits: ModrinthHit[]
  total_hits: number
  offset: number
  limit: number
}

export async function searchMods(
  query: string,
  mcVersion: string,
  loader: string,
  categories: string[],
  environment: string,
  projectType: string = 'mod',
  limit = 20,
  offset = 0,
  index = 'relevance'
): Promise<ModrinthSearchResult> {
  const facets: string[][] = [[`project_type:${projectType}`]]
  if (mcVersion && projectType === 'mod') facets.push([`versions:${mcVersion}`])
  else if (mcVersion) facets.push([`versions:${mcVersion}`])
  if (loader && loader !== 'vanilla' && projectType === 'mod') facets.push([`categories:${loader}`])
  for (const cat of categories) facets.push([`categories:${cat}`])
  if (environment === 'client') facets.push(['client_side:required', 'client_side:optional'])
  if (environment === 'server') facets.push(['server_side:required', 'server_side:optional'])

  const { data } = await axios.get<ModrinthSearchResult>(`${BASE}/search`, {
    params: { query, facets: JSON.stringify(facets), limit, offset, index },
    headers: HEADERS,
    timeout: 15_000
  })
  return data
}

export async function getModVersions(
  projectId: string,
  mcVersion: string,
  loader: string
): Promise<ModrinthVersion[]> {
  const params: Record<string, string> = {}
  if (mcVersion) params.game_versions = JSON.stringify([mcVersion])
  if (loader && loader !== 'vanilla') params.loaders = JSON.stringify([loader])

  const { data } = await axios.get<ModrinthVersion[]>(`${BASE}/project/${projectId}/version`, {
    params,
    headers: HEADERS,
    timeout: 15_000
  })
  return data
}

export async function getModrinthCategories(projectType = 'mod'): Promise<ModrinthCategory[]> {
  const { data } = await axios.get<ModrinthCategory[]>(`${BASE}/tag/category`, {
    headers: HEADERS,
    timeout: 10_000
  })
  return data.filter(c => c.project_type === projectType)
}

export async function getInstalledProjectIds(instanceId: string, subFolder: string = 'mods', extensions: string[] = ['.jar', '.jar.disabled']): Promise<string[]> {
  const gameDir = await getInstanceGameDir(instanceId)
  const dir = path.join(gameDir, subFolder)
  if (!(await fs.pathExists(dir))) return []

  const files = (await fs.readdir(dir)).filter(f => extensions.some(ext => f.endsWith(ext)))
  if (files.length === 0) return []

  const hashes: string[] = []
  for (const file of files) {
    try {
      const buf = await fs.readFile(path.join(dir, file))
      hashes.push(crypto.createHash('sha1').update(buf).digest('hex'))
    } catch { }
  }
  if (hashes.length === 0) return []

  try {
    const { data } = await axios.post<Record<string, { project_id: string }>>(
      `${BASE}/version_files`,
      { hashes, algorithm: 'sha1' },
      { headers: HEADERS, timeout: 15_000 }
    )
    return [...new Set(Object.values(data).map(v => v.project_id))]
  } catch {
    return []
  }
}

export async function getInstalledProjectIcons(instanceId: string, subFolder: string = 'shaderpacks', extensions: string[] = ['.zip', '.zip.disabled']): Promise<Record<string, string | null>> {
  const gameDir = await getInstanceGameDir(instanceId)
  const dir = path.join(gameDir, subFolder)
  if (!(await fs.pathExists(dir))) return {}

  const files = (await fs.readdir(dir)).filter(f => extensions.some(ext => f.endsWith(ext)))
  if (files.length === 0) return {}

  const fileHashMap: Record<string, string> = {}
  for (const file of files) {
    try {
      const buf = await fs.readFile(path.join(dir, file))
      fileHashMap[file] = crypto.createHash('sha1').update(buf).digest('hex')
    } catch { }
  }
  const hashes = Object.values(fileHashMap)
  if (hashes.length === 0) return {}

  try {
    const { data: versionFiles } = await axios.post<Record<string, { project_id: string }>>(
      `${BASE}/version_files`,
      { hashes, algorithm: 'sha1' },
      { headers: HEADERS, timeout: 15_000 }
    )

    const hashToProjectId: Record<string, string> = {}
    for (const [hash, v] of Object.entries(versionFiles)) hashToProjectId[hash] = v.project_id

    const projectIds = [...new Set(Object.values(hashToProjectId))]
    if (projectIds.length === 0) return {}

    const { data: projects } = await axios.get<{ id: string; icon_url: string | null }[]>(
      `${BASE}/projects`,
      { params: { ids: JSON.stringify(projectIds) }, headers: HEADERS, timeout: 15_000 }
    )
    const projectIconMap: Record<string, string | null> = {}
    for (const p of projects) projectIconMap[p.id] = p.icon_url

    const result: Record<string, string | null> = {}
    for (const [file, hash] of Object.entries(fileHashMap)) {
      const projectId = hashToProjectId[hash]
      result[file] = projectId ? (projectIconMap[projectId] ?? null) : null
    }
    return result
  } catch {
    return {}
  }
}

export async function getProjectVersionForInstall(projectId: string, mcVersion: string, loader: string): Promise<ModrinthVersion | null> {
  try {
    const versions = await getModVersions(projectId, mcVersion, loader)
    return versions[0] ?? null
  } catch {
    return null
  }
}

export async function installModFromUrl(
  instanceId: string,
  fileUrl: string,
  filename: string,
  subFolder: string = 'mods'
): Promise<void> {
  const gameDir = await getInstanceGameDir(instanceId)
  const destDir = path.join(gameDir, subFolder)
  await fs.ensureDir(destDir)
  const dest = path.join(destDir, filename)
  const response = await axios.get<Buffer>(fileUrl, {
    responseType: 'arraybuffer',
    timeout: 120_000,
    headers: HEADERS
  })
  await fs.writeFile(dest, Buffer.from(response.data))
}
