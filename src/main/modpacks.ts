import axios from 'axios'
import fs from 'fs-extra'
import path from 'path'
import AdmZip from 'adm-zip'
import type { ModpackManifest } from '../shared/types'
import { getInstanceGameDir } from './instances'
import { downloadFile, fileMatchesHash, fileExists } from './downloader'
import type { ProgressCallback } from './downloader'
import { checkCancel } from './cancelToken'

export async function fetchManifest(url: string): Promise<ModpackManifest> {
  const { data } = await axios.get<ModpackManifest>(url, { timeout: 15_000 })
  validateManifest(data)
  return data
}

function validateManifest(m: unknown): asserts m is ModpackManifest {
  const man = m as ModpackManifest
  if (!man.id || !man.name || !man.version || !man.minecraft || !man.modloader) {
    throw new Error('Invalid modpack manifest: missing required fields')
  }
}

export async function installModpack(
  instanceId: string,
  manifest: ModpackManifest,
  onProgress?: ProgressCallback
): Promise<void> {
  const gameDir = await getInstanceGameDir(instanceId)
  const modsDir = path.join(gameDir, 'mods')
  await fs.ensureDir(modsDir)

  const clientMods = manifest.mods.filter(
    (m) => m.side !== 'server' && m.required !== false
  )

  onProgress?.(0, clientMods.length, 'Instalando mods...')

  for (let i = 0; i < clientMods.length; i++) {
    checkCancel()
    const mod = clientMods[i]
    const destPath = path.join(modsDir, mod.filename)
    onProgress?.(i, clientMods.length, `Descargando ${mod.name}...`)

    const exists = await fileExists(destPath)
    const valid = exists && mod.sha256 ? await fileMatchesHash(destPath, mod.sha256) : exists

    if (!valid) {
      await downloadFile(mod.url, destPath, undefined, mod.sha256)
    }
  }

  if (manifest.configs) {
    onProgress?.(clientMods.length, clientMods.length + manifest.configs.length, 'Instalando configuraciones...')

    for (const config of manifest.configs) {
      checkCancel()
      const destPath = path.join(gameDir, config.path)
      if (config.path.endsWith('.zip')) {
        const tmpPath = destPath + '.tmp.zip'
        await downloadFile(config.url, tmpPath, undefined, config.sha256)
        const zip = new AdmZip(tmpPath)
        zip.extractAllTo(path.dirname(destPath), true)
        await fs.remove(tmpPath)
      } else {
        await downloadFile(config.url, destPath, undefined, config.sha256)
      }
    }
  }

  onProgress?.(clientMods.length, clientMods.length, '¡Modpack instalado!')
}

export async function updateModpack(
  instanceId: string,
  manifest: ModpackManifest,
  onProgress?: ProgressCallback
): Promise<{ added: string[]; removed: string[]; updated: string[] }> {
  const gameDir = await getInstanceGameDir(instanceId)
  const modsDir = path.join(gameDir, 'mods')
  await fs.ensureDir(modsDir)

  const clientMods = manifest.mods.filter((m) => m.side !== 'server')
  const manifestFilenames = new Set(clientMods.map((m) => m.filename))

  // Remove mods not in the manifest
  const existingFiles = await fs.readdir(modsDir).catch(() => [] as string[])
  const removed: string[] = []
  for (const file of existingFiles) {
    if (file.endsWith('.jar') && !manifestFilenames.has(file)) {
      await fs.remove(path.join(modsDir, file))
      removed.push(file)
    }
  }

  // Download new/changed mods
  const added: string[] = []
  const updated: string[] = []

  for (let i = 0; i < clientMods.length; i++) {
    checkCancel()
    const mod = clientMods[i]
    const destPath = path.join(modsDir, mod.filename)
    onProgress?.(i, clientMods.length, `Verificando ${mod.name}...`)

    const exists = await fileExists(destPath)

    if (!exists) {
      await downloadFile(mod.url, destPath, undefined, mod.sha256)
      added.push(mod.filename)
    } else if (mod.sha256 && !(await fileMatchesHash(destPath, mod.sha256))) {
      await downloadFile(mod.url, destPath, undefined, mod.sha256)
      updated.push(mod.filename)
    }
  }

  onProgress?.(clientMods.length, clientMods.length, '¡Actualización completada!')

  return { added, removed, updated }
}

export async function getLocalModList(instanceId: string): Promise<string[]> {
  const modsDir = path.join(await getInstanceGameDir(instanceId), 'mods')
  try {
    const files = await fs.readdir(modsDir)
    return files.filter((f) => f.endsWith('.jar'))
  } catch {
    return []
  }
}

export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)
  const len = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < len; i++) {
    const va = partsA[i] ?? 0
    const vb = partsB[i] ?? 0
    if (va !== vb) return va - vb
  }
  return 0
}
