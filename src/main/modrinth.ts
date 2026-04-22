import axios from 'axios'
import path from 'path'
import fs from 'fs-extra'
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
  limit = 20,
  offset = 0,
  index = 'relevance'
): Promise<ModrinthSearchResult> {
  const facets: string[][] = [['project_type:mod']]
  if (mcVersion) facets.push([`versions:${mcVersion}`])
  if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`])

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

export async function installModFromUrl(
  instanceId: string,
  fileUrl: string,
  filename: string
): Promise<void> {
  const gameDir = await getInstanceGameDir(instanceId)
  const modsDir = path.join(gameDir, 'mods')
  await fs.ensureDir(modsDir)
  const dest = path.join(modsDir, filename)
  const response = await axios.get<Buffer>(fileUrl, {
    responseType: 'arraybuffer',
    timeout: 120_000,
    headers: HEADERS
  })
  await fs.writeFile(dest, Buffer.from(response.data))
}
