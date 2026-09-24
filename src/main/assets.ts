import fs from 'fs-extra'
import path from 'path'
import AdmZip from 'adm-zip'
import type { AssetSource, AssetEntry } from '../shared/types'
import { getSharedDir, getInstanceGameDir, loadInstances } from './instances'
import { safeJoin } from './paths'

// ── Source registry ──────────────────────────────────────────────────────────
// Sources are discovered in the main process and referenced by id from the
// renderer, so the renderer never passes filesystem paths directly.

interface RegisteredSource extends AssetSource {
  path: string
}

const sourceRegistry = new Map<string, RegisteredSource>()

export async function listAssetSources(): Promise<{ versions: AssetSource[]; packs: AssetSource[]; mods: AssetSource[] }> {
  sourceRegistry.clear()
  const versions: AssetSource[] = []
  const packs: AssetSource[] = []
  const mods: AssetSource[] = []

  // Installed vanilla version jars (shared/versions/<v>/<v>.jar)
  const versionsDir = path.join(getSharedDir(), 'versions')
  const versionDirs = await fs.readdir(versionsDir).catch(() => [] as string[])
  for (const name of versionDirs) {
    const jarPath = path.join(versionsDir, name, `${name}.jar`)
    if (!(await fs.pathExists(jarPath))) continue
    // Modloader version dirs (fabric-loader-*, *-forge-*) either have no jar or
    // ship a jar without assets — vanilla jars are the useful ones, but we keep
    // anything with a jar and let the browser show what's inside.
    const source: RegisteredSource = { id: `jar:${name}`, label: name, kind: 'jar', path: jarPath }
    sourceRegistry.set(source.id, source)
    versions.push({ id: source.id, label: source.label, kind: source.kind })
  }
  versions.sort((a, b) => b.label.localeCompare(a.label, undefined, { numeric: true }))

  // Resource packs + mod jars from every instance
  const instances = await loadInstances()
  for (const inst of instances) {
    const gameDir = await getInstanceGameDir(inst.id)

    const rpDir = path.join(gameDir, 'resourcepacks')
    const rpEntries = await fs.readdir(rpDir, { withFileTypes: true }).catch(() => [])
    for (const entry of rpEntries) {
      const full = path.join(rpDir, entry.name)
      let source: RegisteredSource | null = null
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
        source = { id: `pack:${inst.id}:${entry.name}`, label: entry.name.replace(/\.zip$/i, ''), kind: 'zip', path: full, instanceName: inst.name }
      } else if (entry.isDirectory() && (await fs.pathExists(path.join(full, 'pack.mcmeta')))) {
        source = { id: `pack:${inst.id}:${entry.name}`, label: entry.name, kind: 'folder', path: full, instanceName: inst.name }
      }
      if (source) {
        sourceRegistry.set(source.id, source)
        packs.push({ id: source.id, label: source.label, kind: source.kind, instanceName: source.instanceName })
      }
    }

    // Mod jars — they carry their own assets/<modid>/models + textures
    const modsDir = path.join(gameDir, 'mods')
    const modEntries = await fs.readdir(modsDir, { withFileTypes: true }).catch(() => [])
    for (const entry of modEntries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) continue
      const source: RegisteredSource = {
        id: `mod:${inst.id}:${entry.name}`,
        label: entry.name.replace(/\.jar$/i, ''),
        kind: 'zip',
        path: path.join(modsDir, entry.name),
        instanceName: inst.name,
      }
      sourceRegistry.set(source.id, source)
      mods.push({ id: source.id, label: source.label, kind: source.kind, instanceName: source.instanceName })
    }
  }

  return { versions, packs, mods }
}

// ── Zip directory index cache ────────────────────────────────────────────────

interface ZipIndex {
  zip: AdmZip
  dirs: Map<string, AssetEntry[]>
}

const zipCache = new Map<string, ZipIndex>()
const ZIP_CACHE_MAX = 4

function getZipIndex(zipPath: string): ZipIndex {
  const cached = zipCache.get(zipPath)
  if (cached) return cached

  if (zipCache.size >= ZIP_CACHE_MAX) {
    const oldest = zipCache.keys().next().value
    if (oldest) zipCache.delete(oldest)
  }

  const zip = new AdmZip(zipPath)
  const dirMaps = new Map<string, Map<string, AssetEntry>>()
  const put = (dir: string, entry: AssetEntry) => {
    let m = dirMaps.get(dir)
    if (!m) { m = new Map(); dirMaps.set(dir, m) }
    if (!m.has(entry.name)) m.set(entry.name, entry)
  }

  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue
    const parts = e.entryName.split('/').filter(Boolean)
    let dir = ''
    for (let i = 0; i < parts.length - 1; i++) {
      put(dir, { name: parts[i], isDir: true })
      dir = dir ? `${dir}/${parts[i]}` : parts[i]
    }
    put(dir, { name: parts[parts.length - 1], isDir: false, size: e.header.size })
  }

  const dirs = new Map<string, AssetEntry[]>()
  for (const [dir, m] of dirMaps) dirs.set(dir, sortEntries([...m.values()]))

  const index: ZipIndex = { zip, dirs }
  zipCache.set(zipPath, index)
  return index
}

function sortEntries(entries: AssetEntry[]): AssetEntry[] {
  return entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function normalizeInnerPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

// ── Browse + read ────────────────────────────────────────────────────────────

export async function listAssetDir(sourceId: string, dir: string): Promise<AssetEntry[]> {
  const source = sourceRegistry.get(sourceId)
  if (!source) return []
  const inner = normalizeInnerPath(dir)

  if (source.kind === 'folder') {
    const target = inner ? safeJoin(source.path, inner) : source.path
    const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => [])
    const result: AssetEntry[] = []
    for (const e of entries) {
      if (e.isDirectory()) result.push({ name: e.name, isDir: true })
      else {
        const stat = await fs.stat(path.join(target, e.name)).catch(() => null)
        result.push({ name: e.name, isDir: false, size: stat?.size })
      }
    }
    return sortEntries(result)
  }

  return getZipIndex(source.path).dirs.get(inner) ?? []
}

/** Returns the file content base64-encoded, or null if it doesn't exist. */
export async function readAssetFile(sourceId: string, filePath: string): Promise<string | null> {
  const source = sourceRegistry.get(sourceId)
  if (!source) return null
  const inner = normalizeInnerPath(filePath)
  if (!inner) return null

  if (source.kind === 'folder') {
    const target = safeJoin(source.path, inner)
    const buf = await fs.readFile(target).catch(() => null)
    return buf ? buf.toString('base64') : null
  }

  try {
    const entry = getZipIndex(source.path).zip.getEntry(inner)
    if (!entry || entry.isDirectory) return null
    return entry.getData().toString('base64')
  } catch {
    return null
  }
}
