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
  version_type: 'release' | 'beta' | 'alpha'
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
  if (loader) facets.push([`categories:${loader}`])
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
  loader: string,
  channel: 'all' | 'stable' = 'all'
): Promise<ModrinthVersion[]> {
  const params: Record<string, string> = {}
  if (mcVersion) params.game_versions = JSON.stringify([mcVersion])
  if (loader && loader !== 'vanilla') params.loaders = JSON.stringify([loader])

  const { data } = await axios.get<ModrinthVersion[]>(`${BASE}/project/${projectId}/version`, {
    params,
    headers: HEADERS,
    timeout: 15_000
  })
  if (channel === 'stable') return data.filter(v => v.version_type === 'release')
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

export async function getProject(projectId: string): Promise<any> {
  const { data } = await axios.get(`${BASE}/project/${projectId}`, { headers: HEADERS, timeout: 10_000 })
  return data
}

export async function getProjects(projectIds: string[]): Promise<any[]> {
  if (projectIds.length === 0) return []
  const { data } = await axios.get<any[]>(`${BASE}/projects`, {
    params: { ids: JSON.stringify(projectIds) },
    headers: HEADERS,
    timeout: 10_000
  })
  return data
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

export interface InstalledModMeta {
  iconUrl?: string | null
  clientSide?: string
  serverSide?: string
  projectId?: string
  installedVersionId?: string
  hasUpdate?: boolean
}

type MetaCacheEntry = { mcVersion: string; loader: string } & InstalledModMeta
type MetaCache = Record<string, MetaCacheEntry>

async function loadMetaCache(cacheFile: string): Promise<MetaCache> {
  try { return await fs.readJson(cacheFile) } catch { return {} }
}

function saveMetaCache(cacheFile: string, cache: MetaCache): void {
  fs.writeJson(cacheFile, cache, { spaces: 2 }).catch(() => {})
}

export async function getInstalledModsMeta(
  instanceId: string,
  mcVersion: string,
  loader: string,
  subFolder = 'mods',
  extensions = ['.jar', '.jar.disabled']
): Promise<Record<string, InstalledModMeta>> {
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
  if (Object.keys(fileHashMap).length === 0) return {}

  // Load disk cache and split into cached/uncached
  const cacheFile = path.join(gameDir, `modrinth-meta-cache-${subFolder.replace(/[/\\]/g, '-')}.json`)
  const cache = await loadMetaCache(cacheFile)
  const normalizedLoader = loader || 'vanilla'

  const cachedResult: Record<string, InstalledModMeta> = {}
  const uncachedHashes: string[] = []
  const hashToFile: Record<string, string> = {}

  for (const [file, hash] of Object.entries(fileHashMap)) {
    const entry = cache[hash]
    if (entry && entry.mcVersion === mcVersion && entry.loader === normalizedLoader) {
      const { mcVersion: _mv, loader: _l, ...meta } = entry
      cachedResult[file] = meta
    } else {
      uncachedHashes.push(hash)
      hashToFile[hash] = file
    }
  }

  if (uncachedHashes.length === 0) return cachedResult

  try {
    const updateBody: Record<string, unknown> = { hashes: uncachedHashes, algorithm: 'sha1' }
    if (mcVersion) updateBody.game_versions = [mcVersion]
    if (loader && loader !== 'vanilla') updateBody.loaders = [loader]

    const [installedRes, latestRes] = await Promise.allSettled([
      axios.post<Record<string, { id: string; project_id: string }>>(
        `${BASE}/version_files`, { hashes: uncachedHashes, algorithm: 'sha1' }, { headers: HEADERS, timeout: 15_000 }
      ),
      axios.post<Record<string, { id: string; project_id: string }>>(
        `${BASE}/version_files/update`, updateBody, { headers: HEADERS, timeout: 15_000 }
      )
    ])

    const installedData: Record<string, { id: string; project_id: string }> =
      installedRes.status === 'fulfilled' ? installedRes.value.data : {}
    const latestData: Record<string, { id: string; project_id: string }> =
      latestRes.status === 'fulfilled' ? latestRes.value.data : {}

    const projectIds = [...new Set(Object.values(installedData).map(v => v.project_id).filter(Boolean))]
    const projectMeta: Record<string, { icon_url: string | null; client_side: string; server_side: string }> = {}

    if (projectIds.length > 0) {
      try {
        const { data: projects } = await axios.get<{ id: string; icon_url: string | null; client_side: string; server_side: string }[]>(
          `${BASE}/projects`,
          { params: { ids: JSON.stringify(projectIds) }, headers: HEADERS, timeout: 15_000 }
        )
        for (const p of projects) projectMeta[p.id] = p
      } catch { }
    }

    const newEntries: MetaCache = {}
    const fetchedResult: Record<string, InstalledModMeta> = {}

    for (const hash of uncachedHashes) {
      const file = hashToFile[hash]
      const installed = installedData[hash]
      const latest = latestData[hash]
      const project = installed ? projectMeta[installed.project_id] : undefined
      const meta: InstalledModMeta = {
        iconUrl: project?.icon_url ?? null,
        clientSide: project?.client_side,
        serverSide: project?.server_side,
        projectId: installed?.project_id,
        installedVersionId: installed?.id,
        hasUpdate: !!(installed && latest && installed.id !== latest.id)
      }
      fetchedResult[file] = meta
      newEntries[hash] = { mcVersion, loader: normalizedLoader, ...meta }
    }

    saveMetaCache(cacheFile, { ...cache, ...newEntries })
    return { ...cachedResult, ...fetchedResult }
  } catch {
    return cachedResult
  }
}

export async function getProjectVersionForInstall(projectId: string, mcVersion: string, loader: string, channel: 'all' | 'stable' = 'all'): Promise<ModrinthVersion | null> {
  try {
    const versions = await getModVersions(projectId, mcVersion, loader, channel)
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
