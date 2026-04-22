import axios from 'axios'
import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import type { ModpackManifest, PackFile, Modloader } from '../shared/types'
import { getInstanceGameDir, resolveInstanceDir, updateInstance, loadInstances } from './instances'
import { downloadFile, fileMatchesHash, fileExists } from './downloader'
import type { ProgressCallback } from './downloader'
import { checkCancel } from './cancelToken'

// ── URL normalizer ──────────────────────────────────────────────────────────

export function normalizeUrl(url: string): string {
  const gdriveFile = url.match(/drive\.google\.com\/file\/d\/([^/?]+)/)
  if (gdriveFile) return `https://drive.google.com/uc?export=download&id=${gdriveFile[1]}&confirm=t`

  const gdriveOpen = url.match(/drive\.google\.com\/open\?id=([^&]+)/)
  if (gdriveOpen) return `https://drive.google.com/uc?export=download&id=${gdriveOpen[1]}&confirm=t`

  if (url.includes('dropbox.com')) {
    return url
      .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
      .replace('?dl=0', '?dl=1')
  }

  return url
}

// ── Unified file list (new + legacy format) ────────────────────────────────

export function getEffectiveFiles(manifest: ModpackManifest): PackFile[] {
  if (manifest.files && manifest.files.length > 0) return manifest.files

  const files: PackFile[] = []
  for (const mod of manifest.mods ?? []) {
    if (mod.side === 'server') continue
    files.push({ path: `mods/${mod.filename}`, url: mod.url, sha256: mod.sha256 })
  }
  for (const config of manifest.configs ?? []) {
    files.push({ path: config.path, url: config.url, sha256: config.sha256 })
  }
  return files
}

// ── Local manifest storage ─────────────────────────────────────────────────

async function getMetaPath(instanceId: string): Promise<string> {
  const gameDir = await getInstanceGameDir(instanceId)
  return path.join(gameDir, '.modpack-meta.json')
}

export async function saveLocalManifest(instanceId: string, manifest: ModpackManifest): Promise<void> {
  await fs.writeJson(await getMetaPath(instanceId), manifest, { spaces: 2 })
}

export async function loadLocalManifest(instanceId: string): Promise<ModpackManifest | null> {
  const p = await getMetaPath(instanceId)
  if (!(await fs.pathExists(p))) return null
  return fs.readJson(p).catch(() => null)
}

// ── Manifest fetching ──────────────────────────────────────────────────────

export async function fetchManifest(url: string): Promise<ModpackManifest> {
  const { data } = await axios.get<ModpackManifest>(url, {
    timeout: 15_000,
    headers: { 'Cache-Control': 'no-cache' }
  })
  validateManifest(data)
  return data
}

function validateManifest(m: unknown): asserts m is ModpackManifest {
  const man = m as ModpackManifest
  if (!man.id || !man.name || !man.version || !man.minecraft || !man.modloader) {
    throw new Error('Manifiesto inválido: faltan campos requeridos (id, name, version, minecraft, modloader)')
  }
}

// ── Install ────────────────────────────────────────────────────────────────

export async function installModpack(
  instanceId: string,
  manifest: ModpackManifest,
  onProgress?: ProgressCallback
): Promise<void> {
  const gameDir = await getInstanceGameDir(instanceId)
  const files = getEffectiveFiles(manifest)

  for (let i = 0; i < files.length; i++) {
    checkCancel()
    const file = files[i]
    const destPath = path.join(gameDir, file.path)
    onProgress?.(i, files.length, `Descargando ${path.basename(file.path)}...`)
    await fs.ensureDir(path.dirname(destPath))

    const exists = await fileExists(destPath)
    const valid = exists && file.sha256 ? await fileMatchesHash(destPath, file.sha256) : exists
    if (!valid) {
      await downloadFile(normalizeUrl(file.url), destPath, undefined, file.sha256)
    }
  }

  await saveLocalManifest(instanceId, manifest)

  if (manifest.thumbnail) {
    try {
      const iconResp = await axios.get<Buffer>(normalizeUrl(manifest.thumbnail), {
        responseType: 'arraybuffer',
        timeout: 15_000
      })
      const instanceDir = await resolveInstanceDir(instanceId)
      const iconPath = path.join(instanceDir, 'icon.png')
      await fs.writeFile(iconPath, Buffer.from(iconResp.data))
      const instances = await loadInstances()
      const inst = instances.find(i => i.id === instanceId)
      if (inst) await updateInstance({ ...inst, icon: 'icon.png' })
    } catch { /* thumbnail optional — ignore errors */ }
  }

  onProgress?.(files.length, files.length, '¡Modpack instalado!')
}

// ── Update (delta) ─────────────────────────────────────────────────────────

export async function updateModpack(
  instanceId: string,
  manifest: ModpackManifest,
  onProgress?: ProgressCallback
): Promise<{ added: string[]; removed: string[]; updated: string[] }> {
  const gameDir = await getInstanceGameDir(instanceId)
  const newFiles = getEffectiveFiles(manifest)
  const oldManifest = await loadLocalManifest(instanceId)
  const oldFiles = oldManifest ? getEffectiveFiles(oldManifest) : []

  const newPaths = new Set(newFiles.map((f) => f.path))
  const oldMap = new Map(oldFiles.map((f) => [f.path, f]))

  const removed: string[] = []
  for (const old of oldFiles) {
    if (!newPaths.has(old.path)) {
      await fs.remove(path.join(gameDir, old.path)).catch(() => {})
      removed.push(old.path)
    }
  }

  const added: string[] = []
  const updated: string[] = []

  for (let i = 0; i < newFiles.length; i++) {
    checkCancel()
    const file = newFiles[i]
    const destPath = path.join(gameDir, file.path)
    onProgress?.(i, newFiles.length, `Verificando ${path.basename(file.path)}...`)
    await fs.ensureDir(path.dirname(destPath))

    const exists = await fileExists(destPath)
    if (!exists) {
      await downloadFile(normalizeUrl(file.url), destPath, undefined, file.sha256)
      added.push(file.path)
    } else if (file.sha256 && !(await fileMatchesHash(destPath, file.sha256))) {
      await downloadFile(normalizeUrl(file.url), destPath, undefined, file.sha256)
      oldMap.has(file.path) ? updated.push(file.path) : added.push(file.path)
    }
  }

  await saveLocalManifest(instanceId, manifest)
  onProgress?.(newFiles.length, newFiles.length, '¡Actualización completada!')
  return { added, removed, updated }
}

// ── Version compare ────────────────────────────────────────────────────────

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// ── Export to GitHub ───────────────────────────────────────────────────────

export interface ExportParams {
  instanceId: string
  name: string
  version: string
  description: string
  changelog: string
  repoName: string
  selectedPaths: string[]
  githubToken: string
  minecraft: string
  modloader: string
  modloaderVersion?: string
}

interface FileEntry {
  localPath: string
  relativePath: string
  sha256: string
}

type ExportProgress = (message: string, current: number, total: number) => void

async function collectFilesFromPaths(gameDir: string, selectedPaths: string[]): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  const seen = new Set<string>()

  async function addFile(absPath: string, relPath: string) {
    if (seen.has(relPath)) return
    seen.add(relPath)
    try {
      const buf = await fs.readFile(absPath)
      entries.push({ localPath: absPath, relativePath: relPath, sha256: crypto.createHash('sha256').update(buf).digest('hex') })
    } catch { /* skip unreadable */ }
  }

  async function addDirRecursive(absDir: string, relDir: string) {
    const items = await fs.readdir(absDir, { withFileTypes: true }).catch(() => [])
    for (const item of items) {
      const absItem = path.join(absDir, item.name)
      const relItem = `${relDir}/${item.name}`
      if (item.isDirectory()) {
        await addDirRecursive(absItem, relItem)
      } else if (item.isFile()) {
        await addFile(absItem, relItem)
      }
    }
  }

  for (const selPath of selectedPaths) {
    const abs = path.join(gameDir, selPath)
    if (!(await fs.pathExists(abs))) continue
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat) continue
    if (stat.isDirectory()) {
      await addDirRecursive(abs, selPath)
    } else {
      await addFile(abs, selPath)
    }
  }

  return entries
}

async function ghRequest<T>(method: string, url: string, token: string, data?: unknown): Promise<T> {
  const res = await axios.request<T>({
    method, url, data,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    timeout: 30_000
  })
  return res.data
}

async function ensureRepo(owner: string, repoName: string, token: string): Promise<void> {
  try {
    await ghRequest('GET', `https://api.github.com/repos/${owner}/${repoName}`, token)
  } catch {
    await ghRequest('POST', 'https://api.github.com/user/repos', token, {
      name: repoName, description: 'Modpack', private: false, auto_init: true
    })
    await new Promise((r) => setTimeout(r, 2500))
  }
}

async function createGhRelease(owner: string, repo: string, version: string, changelog: string, token: string): Promise<{ id: number }> {
  return ghRequest('POST', `https://api.github.com/repos/${owner}/${repo}/releases`, token, {
    tag_name: `v${version}`, name: `v${version}`, body: changelog || '', draft: false, prerelease: false
  })
}

async function uploadAsset(releaseId: number, assetName: string, filePath: string, owner: string, repo: string, token: string): Promise<void> {
  const buf = await fs.readFile(filePath)
  await axios.post(
    `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`,
    buf,
    {
      headers: { Authorization: `token ${token}`, 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length },
      maxBodyLength: Infinity,
      timeout: 300_000
    }
  )
}

async function upsertRepoFile(owner: string, repo: string, filePath: string, content: string, token: string, message: string): Promise<void> {
  let sha: string | undefined
  try {
    const existing = await ghRequest<{ sha: string }>('GET', `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, token)
    sha = existing.sha
  } catch { /* new file */ }

  await ghRequest('PUT', `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, token, {
    message,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {})
  })
}

export async function exportModpack(params: ExportParams, onProgress: ExportProgress): Promise<string> {
  const { instanceId, name, version, description, changelog, repoName, selectedPaths, githubToken, minecraft, modloader, modloaderVersion } = params

  onProgress('Leyendo archivos de la instancia...', 0, 1)
  const gameDir = await getInstanceGameDir(instanceId)
  const files = await collectFilesFromPaths(gameDir, selectedPaths)

  if (files.length === 0) throw new Error('No se encontraron archivos en las categorías seleccionadas')

  const totalSteps = files.length + 4

  onProgress('Conectando con GitHub...', 1, totalSteps)
  const user = await ghRequest<{ login: string }>('GET', 'https://api.github.com/user', githubToken)
  const owner = user.login

  onProgress('Preparando repositorio...', 2, totalSteps)
  await ensureRepo(owner, repoName, githubToken)

  onProgress('Creando versión en GitHub...', 3, totalSteps)
  const release = await createGhRelease(owner, repoName, version, changelog, githubToken)

  const packFiles: PackFile[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    onProgress(`Subiendo ${path.basename(file.localPath)} (${i + 1}/${files.length})`, 4 + i, totalSteps)
    const assetName = file.relativePath.replace(/\//g, '__')
    await uploadAsset(release.id, assetName, file.localPath, owner, repoName, githubToken)
    const downloadUrl = `https://github.com/${owner}/${repoName}/releases/download/v${version}/${encodeURIComponent(assetName)}`
    packFiles.push({ path: file.relativePath, url: downloadUrl, sha256: file.sha256 })
  }

  const manifest: ModpackManifest = {
    id: repoName, name, version,
    description: description || undefined,
    changelog: changelog || undefined,
    minecraft,
    modloader: modloader as Modloader,
    modloaderVersion: modloaderVersion || undefined,
    files: packFiles
  }

  onProgress('Publicando manifiesto...', totalSteps - 1, totalSteps)
  await upsertRepoFile(owner, repoName, 'modpack.json', JSON.stringify(manifest, null, 2), githubToken, `Release v${version}`)

  return `https://raw.githubusercontent.com/${owner}/${repoName}/main/modpack.json`
}

export async function getLocalModList(instanceId: string): Promise<string[]> {
  const modsDir = path.join(await getInstanceGameDir(instanceId), 'mods')
  try {
    return (await fs.readdir(modsDir)).filter((f) => f.endsWith('.jar'))
  } catch {
    return []
  }
}
