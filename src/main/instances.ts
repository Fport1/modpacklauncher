import { app } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import AdmZip from 'adm-zip'
import type { Instance } from '../shared/types'

export function getLauncherDir(): string {
  return app.getPath('userData')
}

export function getInstancesDir(): string {
  return path.join(getLauncherDir(), 'instances')
}

export function getSharedDir(): string {
  return path.join(getLauncherDir(), 'shared')
}

function sanitizeDirName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, '_')
      .replace(/^[._]+|[._]+$/g, '')
      .slice(0, 64) || 'instance'
  )
}

async function getUniqueDirName(base: string): Promise<string> {
  const instancesDir = getInstancesDir()
  let name = base
  let i = 2
  while (await fs.pathExists(path.join(instancesDir, name))) {
    name = `${base}_${i++}`
  }
  return name
}

export async function resolveInstanceDir(instanceId: string): Promise<string> {
  const instancesDir = getInstancesDir()
  let entries: import('fs').Dirent[] = []
  try {
    entries = await fs.readdir(instancesDir, { withFileTypes: true })
  } catch {
    return path.join(instancesDir, instanceId)
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const metaPath = path.join(instancesDir, entry.name, 'instance.json')
    try {
      const data = await fs.readJson(metaPath)
      if (data.id === instanceId) return path.join(instancesDir, entry.name)
    } catch {
      continue
    }
  }

  // Fallback for old instances that used ID as folder name
  return path.join(instancesDir, instanceId)
}

export async function getInstanceGameDir(instanceId: string): Promise<string> {
  const dir = await resolveInstanceDir(instanceId)
  return path.join(dir, 'minecraft')
}

export async function loadInstances(): Promise<Instance[]> {
  const instancesDir = getInstancesDir()
  await fs.ensureDir(instancesDir)

  const entries = await fs.readdir(instancesDir, { withFileTypes: true })
  const instances: Instance[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const metaPath = path.join(instancesDir, entry.name, 'instance.json')
    try {
      const data = await fs.readJson(metaPath)
      instances.push(data as Instance)
    } catch {
      // skip corrupted
    }
  }

  return instances.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
}

export async function duplicateInstance(instanceId: string, newName: string): Promise<Instance> {
  const srcDir = await resolveInstanceDir(instanceId)
  const srcMeta = await fs.readJson(path.join(srcDir, 'instance.json')) as Instance

  const dirName = await getUniqueDirName(sanitizeDirName(newName))
  const destDir = path.join(getInstancesDir(), dirName)
  await fs.copy(srcDir, destDir)

  const newInst: Instance = {
    ...srcMeta,
    id: uuidv4(),
    name: newName,
    dirName,
    createdAt: Date.now(),
    lastPlayed: undefined,
    playtime: 0
  }
  await fs.writeJson(path.join(destDir, 'instance.json'), newInst, { spaces: 2 })
  return newInst
}

export async function pickInstanceIcon(
  instanceId: string,
  mainWindow: import('electron').BrowserWindow
): Promise<Instance | null> {
  const { dialog } = await import('electron')
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return null

  const dir = await resolveInstanceDir(instanceId)
  await fs.copy(result.filePaths[0], path.join(dir, 'icon.png'), { overwrite: true })

  const meta = await fs.readJson(path.join(dir, 'instance.json')) as Instance
  meta.icon = 'icon.png'
  await fs.writeJson(path.join(dir, 'instance.json'), meta, { spaces: 2 })
  return meta
}

export async function getInstanceIconBase64(instanceId: string): Promise<string | null> {
  try {
    const dir = await resolveInstanceDir(instanceId)
    const meta = await fs.readJson(path.join(dir, 'instance.json')) as Instance
    if (!meta.icon) return null
    const iconPath = path.join(dir, meta.icon)
    if (!(await fs.pathExists(iconPath))) return null
    const buf = await fs.readFile(iconPath)
    const ext = path.extname(iconPath).slice(1).toLowerCase()
    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch { return null }
}

export async function listDefaultIcons(): Promise<Array<{ name: string; base64: string }>> {
  const { app } = await import('electron')
  const iconsDir = path.join(app.getPath('userData'), 'icons')
  await fs.ensureDir(iconsDir)
  const entries = await fs.readdir(iconsDir, { withFileTypes: true }).catch(() => [])
  const result: Array<{ name: string; base64: string }> = []
  for (const e of entries) {
    if (!e.isFile()) continue
    const lower = e.name.toLowerCase()
    if (!lower.endsWith('.png') && !lower.endsWith('.jpg') && !lower.endsWith('.jpeg')) continue
    try {
      const buf = await fs.readFile(path.join(iconsDir, e.name))
      const mime = lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
      result.push({ name: e.name, base64: `data:${mime};base64,${buf.toString('base64')}` })
    } catch { /* skip */ }
  }
  return result
}

export async function checkInstanceNameExists(name: string, excludeId?: string): Promise<boolean> {
  const instances = await loadInstances()
  return instances.some(i => i.name.toLowerCase() === name.toLowerCase() && i.id !== excludeId)
}

export async function createInstance(
  data: Omit<Instance, 'id' | 'createdAt'>
): Promise<Instance> {
  await fs.ensureDir(getInstancesDir())
  const dirName = await getUniqueDirName(sanitizeDirName(data.name))

  const instance: Instance = {
    ...data,
    id: uuidv4(),
    dirName,
    createdAt: Date.now()
  }

  const dir = path.join(getInstancesDir(), dirName)
  const gameDir = path.join(dir, 'minecraft')

  for (const sub of ['mods', 'saves', 'config', 'resourcepacks', 'shaderpacks', 'screenshots']) {
    await fs.ensureDir(path.join(gameDir, sub))
  }

  await fs.writeJson(path.join(dir, 'instance.json'), instance, { spaces: 2 })
  return instance
}

export async function updateInstance(instance: Instance): Promise<void> {
  const dir = await resolveInstanceDir(instance.id)
  await fs.writeJson(path.join(dir, 'instance.json'), instance, { spaces: 2 })
}

export async function deleteInstance(instanceId: string): Promise<void> {
  const dir = await resolveInstanceDir(instanceId)
  await fs.remove(dir)
}

export async function getInstance(instanceId: string): Promise<Instance | null> {
  const dir = await resolveInstanceDir(instanceId)
  try {
    return await fs.readJson(path.join(dir, 'instance.json'))
  } catch {
    return null
  }
}

export async function openInstanceFolder(instanceId: string): Promise<void> {
  const { shell } = await import('electron')
  const gameDir = await getInstanceGameDir(instanceId)
  await fs.ensureDir(gameDir)
  shell.openPath(gameDir)
}

export interface ModMeta {
  name?: string
  author?: string
  iconBase64?: string
}

export interface ModFile {
  filename: string
  size: number
  enabled: boolean
  date: number
  meta?: ModMeta
}

// Cache keyed by "filename:size" so stale entries self-invalidate when file changes
const modMetaCache = new Map<string, ModMeta>()

function readModMeta(jarPath: string, cacheKey: string): ModMeta {
  if (modMetaCache.has(cacheKey)) return modMetaCache.get(cacheKey)!
  const meta: ModMeta = {}
  try {
    const zip = new AdmZip(jarPath)

    // ── Fabric ──────────────────────────────────────────────────────────────
    const fabricEntry = zip.getEntry('fabric.mod.json')
    if (fabricEntry) {
      const d = JSON.parse(fabricEntry.getData().toString('utf-8'))
      meta.name = d.name
      if (Array.isArray(d.authors))
        meta.author = d.authors.map((a: string | { name: string }) => typeof a === 'string' ? a : a.name).join(', ')
      if (typeof d.icon === 'string') {
        const ic = zip.getEntry(d.icon)
        if (ic) meta.iconBase64 = `data:image/png;base64,${ic.getData().toString('base64')}`
      }
    }

    // ── Quilt ───────────────────────────────────────────────────────────────
    if (!meta.name) {
      const quiltEntry = zip.getEntry('quilt.mod.json')
      if (quiltEntry) {
        const d = JSON.parse(quiltEntry.getData().toString('utf-8'))
        const qm = d.quilt_loader?.metadata ?? d
        meta.name = qm.name
        if (qm.icon) {
          const ic = zip.getEntry(qm.icon)
          if (ic) meta.iconBase64 = `data:image/png;base64,${ic.getData().toString('base64')}`
        }
      }
    }

    // ── Forge / NeoForge (mods.toml) ────────────────────────────────────────
    if (!meta.name) {
      const tomlEntry = zip.getEntry('META-INF/neoforge.mods.toml') ?? zip.getEntry('META-INF/mods.toml')
      if (tomlEntry) {
        const toml = tomlEntry.getData().toString('utf-8')
        meta.name   = toml.match(/displayName\s*=\s*["']([^"']+)["']/)?.[1]
        meta.author = toml.match(/authors\s*=\s*["']([^"']+)["']/)?.[1]
        const logo  = toml.match(/logoFile\s*=\s*["']([^"']+)["']/)?.[1]
        if (logo) {
          const ic = zip.getEntry(logo)
          if (ic) {
            const ext = logo.split('.').pop()?.toLowerCase()
            const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
            meta.iconBase64 = `data:${mime};base64,${ic.getData().toString('base64')}`
          }
        }
      }
    }

    // ── Old Forge (mcmod.info) ───────────────────────────────────────────────
    if (!meta.name) {
      const mcmodEntry = zip.getEntry('mcmod.info')
      if (mcmodEntry) {
        const d = JSON.parse(mcmodEntry.getData().toString('utf-8'))
        const mod = Array.isArray(d) ? d[0] : d.modList?.[0]
        if (mod) {
          meta.name = mod.name
          meta.author = Array.isArray(mod.authorList) ? mod.authorList.join(', ') : mod.authors
          if (mod.logoFile) {
            const ic = zip.getEntry(mod.logoFile)
            if (ic) meta.iconBase64 = `data:image/png;base64,${ic.getData().toString('base64')}`
          }
        }
      }
    }
  } catch { /* corrupted or unsigned jar — skip */ }

  modMetaCache.set(cacheKey, meta)
  return meta
}

export interface WorldFolder {
  name: string
  lastPlayed?: number
  iconBase64?: string
}

export interface ScreenshotFile {
  filename: string
  filePath: string
  date: number
  size: number
}

export async function listMods(instanceId: string): Promise<ModFile[]> {
  const gameDir = await getInstanceGameDir(instanceId)
  const modsDir = path.join(gameDir, 'mods')
  if (!(await fs.pathExists(modsDir))) return []
  const entries = await fs.readdir(modsDir, { withFileTypes: true })
  const result: ModFile[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    if (!lower.endsWith('.jar') && !lower.endsWith('.zip') && !lower.endsWith('.disabled')) continue
    const filePath = path.join(modsDir, entry.name)
    const stat = await fs.stat(filePath)
    const meta = readModMeta(filePath, `${entry.name}:${stat.size}`)
    result.push({ filename: entry.name, size: stat.size, enabled: !entry.name.toLowerCase().endsWith('.disabled'), date: stat.mtimeMs, meta })
  }
  return result.sort((a, b) => a.filename.localeCompare(b.filename))
}

export async function listWorlds(instanceId: string): Promise<WorldFolder[]> {
  const gameDir = await getInstanceGameDir(instanceId)
  const savesDir = path.join(gameDir, 'saves')
  if (!(await fs.pathExists(savesDir))) return []
  const entries = await fs.readdir(savesDir, { withFileTypes: true })
  const result: WorldFolder[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const levelDat = path.join(savesDir, entry.name, 'level.dat')
    let lastPlayed: number | undefined
    try {
      const stat = await fs.stat(levelDat)
      lastPlayed = stat.mtimeMs
    } catch { /* ignore */ }

    let iconBase64: string | undefined
    try {
      const iconPath = path.join(savesDir, entry.name, 'icon.png')
      if (await fs.pathExists(iconPath)) {
        const buf = await fs.readFile(iconPath)
        iconBase64 = `data:image/png;base64,${buf.toString('base64')}`
      }
    } catch { /* ignore */ }

    result.push({ name: entry.name, lastPlayed, iconBase64 })
  }
  return result.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
}

export async function listResourcepacks(instanceId: string): Promise<ModFile[]> {
  const gameDir = await getInstanceGameDir(instanceId)
  const rpDir = path.join(gameDir, 'resourcepacks')
  if (!(await fs.pathExists(rpDir))) return []
  const entries = await fs.readdir(rpDir, { withFileTypes: true })
  const result: ModFile[] = []
  for (const entry of entries) {
    const lower = entry.name.toLowerCase()
    const valid = (entry.isFile() && (lower.endsWith('.zip') || lower.endsWith('.pack') || lower.endsWith('.disabled'))) || entry.isDirectory()
    if (!valid) continue
    let size = 0
    let date = 0
    try {
      const stat = await fs.stat(path.join(rpDir, entry.name))
      if (stat.isFile()) size = stat.size
      date = stat.mtimeMs
    } catch { /* ignore */ }
    result.push({ filename: entry.name, size, enabled: !lower.endsWith('.disabled'), date })
  }
  return result.sort((a, b) => a.filename.localeCompare(b.filename))
}

export async function openModsFolder(instanceId: string): Promise<void> {
  const { shell } = await import('electron')
  const gameDir = await getInstanceGameDir(instanceId)
  const modsDir = path.join(gameDir, 'mods')
  await fs.ensureDir(modsDir)
  shell.openPath(modsDir)
}

export async function openSavesFolder(instanceId: string): Promise<void> {
  const { shell } = await import('electron')
  const gameDir = await getInstanceGameDir(instanceId)
  const savesDir = path.join(gameDir, 'saves')
  await fs.ensureDir(savesDir)
  shell.openPath(savesDir)
}

export async function openResourcepacksFolder(instanceId: string): Promise<void> {
  const { shell } = await import('electron')
  const gameDir = await getInstanceGameDir(instanceId)
  const rpDir = path.join(gameDir, 'resourcepacks')
  await fs.ensureDir(rpDir)
  shell.openPath(rpDir)
}

export async function listShaderpacks(instanceId: string): Promise<ModFile[]> {
  const gameDir = await getInstanceGameDir(instanceId)
  const dir = path.join(gameDir, 'shaderpacks')
  if (!(await fs.pathExists(dir))) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result: ModFile[] = []
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    const stat = await fs.stat(entryPath)
    result.push({ filename: entry.name, size: stat.size, enabled: !entry.name.toLowerCase().endsWith('.disabled'), date: stat.mtimeMs })
  }
  return result.sort((a, b) => a.filename.localeCompare(b.filename))
}

export async function openShaderpacks(instanceId: string): Promise<void> {
  const { shell } = await import('electron')
  const gameDir = await getInstanceGameDir(instanceId)
  const dir = path.join(gameDir, 'shaderpacks')
  await fs.ensureDir(dir)
  shell.openPath(dir)
}

export async function listScreenshots(instanceId: string): Promise<ScreenshotFile[]> {
  const gameDir = await getInstanceGameDir(instanceId)
  const dir = path.join(gameDir, 'screenshots')
  if (!(await fs.pathExists(dir))) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result: ScreenshotFile[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    if (!lower.endsWith('.png') && !lower.endsWith('.jpg')) continue
    const filePath = path.join(dir, entry.name)
    const stat = await fs.stat(filePath)
    result.push({ filename: entry.name, filePath, date: stat.mtimeMs, size: stat.size })
  }
  return result.sort((a, b) => b.date - a.date)
}

export async function openScreenshotsFolder(instanceId: string): Promise<void> {
  const { shell } = await import('electron')
  const gameDir = await getInstanceGameDir(instanceId)
  const dir = path.join(gameDir, 'screenshots')
  await fs.ensureDir(dir)
  shell.openPath(dir)
}

export interface CrashReport {
  filename: string
  date: number
}

export async function listCrashReports(instanceId: string): Promise<CrashReport[]> {
  const gameDir = await getInstanceGameDir(instanceId)
  const dir = path.join(gameDir, 'crash-reports')
  if (!(await fs.pathExists(dir))) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result: CrashReport[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const stat = await fs.stat(path.join(dir, entry.name))
    result.push({ filename: entry.name, date: stat.mtimeMs })
  }
  return result.sort((a, b) => b.date - a.date)
}

export async function readCrashReport(instanceId: string, filename: string): Promise<string> {
  const gameDir = await getInstanceGameDir(instanceId)
  const filePath = path.join(gameDir, 'crash-reports', filename)
  return fs.readFile(filePath, 'utf-8')
}

export async function readLatestLog(instanceId: string): Promise<string> {
  const gameDir = await getInstanceGameDir(instanceId)
  const logPath = path.join(gameDir, 'logs', 'latest.log')
  if (!(await fs.pathExists(logPath))) return ''
  const content = await fs.readFile(logPath, 'utf-8')
  return content.slice(-100_000) // last 100KB to avoid huge strings
}

export async function openLogsFolder(instanceId: string): Promise<void> {
  const { shell } = await import('electron')
  const gameDir = await getInstanceGameDir(instanceId)
  const dir = path.join(gameDir, 'logs')
  await fs.ensureDir(dir)
  shell.openPath(dir)
}

export async function openCrashReportsFolder(instanceId: string): Promise<void> {
  const { shell } = await import('electron')
  const gameDir = await getInstanceGameDir(instanceId)
  const dir = path.join(gameDir, 'crash-reports')
  await fs.ensureDir(dir)
  shell.openPath(dir)
}

export async function readOptionsFile(instanceId: string): Promise<string> {
  const gameDir = await getInstanceGameDir(instanceId)
  const optPath = path.join(gameDir, 'options.txt')
  if (!(await fs.pathExists(optPath))) return ''
  return fs.readFile(optPath, 'utf-8')
}

export async function writeOptionsFile(instanceId: string, content: string): Promise<void> {
  const gameDir = await getInstanceGameDir(instanceId)
  await fs.ensureDir(gameDir)
  await fs.writeFile(path.join(gameDir, 'options.txt'), content, 'utf-8')
}

function toggledFilename(filename: string): string {
  return filename.endsWith('.disabled')
    ? filename.slice(0, -'.disabled'.length)
    : filename + '.disabled'
}

export async function toggleMod(instanceId: string, filename: string): Promise<string> {
  const dir = path.join(await getInstanceGameDir(instanceId), 'mods')
  const next = toggledFilename(filename)
  await fs.rename(path.join(dir, filename), path.join(dir, next))
  return next
}

export async function deleteMod(instanceId: string, filename: string): Promise<void> {
  await fs.remove(path.join(await getInstanceGameDir(instanceId), 'mods', filename))
}

export async function toggleResourcepack(instanceId: string, filename: string): Promise<string> {
  const dir = path.join(await getInstanceGameDir(instanceId), 'resourcepacks')
  const next = toggledFilename(filename)
  await fs.rename(path.join(dir, filename), path.join(dir, next))
  return next
}

export async function deleteResourcepack(instanceId: string, filename: string): Promise<void> {
  await fs.remove(path.join(await getInstanceGameDir(instanceId), 'resourcepacks', filename))
}

export async function toggleShaderpack(instanceId: string, filename: string): Promise<string> {
  const dir = path.join(await getInstanceGameDir(instanceId), 'shaderpacks')
  const next = toggledFilename(filename)
  await fs.rename(path.join(dir, filename), path.join(dir, next))
  return next
}

export async function deleteShaderpack(instanceId: string, filename: string): Promise<void> {
  await fs.remove(path.join(await getInstanceGameDir(instanceId), 'shaderpacks', filename))
}

export async function deleteWorld(instanceId: string, worldName: string): Promise<void> {
  await fs.remove(path.join(await getInstanceGameDir(instanceId), 'saves', worldName))
}

export async function deleteScreenshot(instanceId: string, filename: string): Promise<void> {
  await fs.remove(path.join(await getInstanceGameDir(instanceId), 'screenshots', filename))
}

export interface GameDirEntry {
  name: string
  relativePath: string
  isDir: boolean
  size?: number
}

export async function listGameDirEntries(instanceId: string, subPath?: string): Promise<GameDirEntry[]> {
  const gameDir = await getInstanceGameDir(instanceId)
  const targetDir = subPath ? path.join(gameDir, subPath) : gameDir
  if (!(await fs.pathExists(targetDir))) return []

  const entries = await fs.readdir(targetDir, { withFileTypes: true })
  const result: GameDirEntry[] = []
  for (const e of entries) {
    const relPath = subPath ? `${subPath}/${e.name}` : e.name
    const isDir = e.isDirectory()
    let size: number | undefined
    if (!isDir) {
      try { size = (await fs.stat(path.join(targetDir, e.name))).size } catch { /* skip */ }
    }
    result.push({ name: e.name, relativePath: relPath, isDir, size })
  }
  return result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
