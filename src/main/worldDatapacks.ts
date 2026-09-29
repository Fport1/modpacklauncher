import fs from 'fs-extra'
import path from 'path'
import AdmZip from 'adm-zip'
import { getInstanceGameDir } from './instances'
import { nbtReadLocal, nbtWriteLocal } from './nbt'
import { safeJoin } from './paths'
import type { NbtDocument } from '../shared/types'

// Datapacks de un mundo: los de la carpeta saves/<mundo>/datapacks y cuáles
// están activos. Minecraft guarda el estado en level.dat, en
// Data.DataPacks.Enabled / Disabled, con ids "file/<nombre>" para los de la
// carpeta y "vanilla", "bundle"… para los integrados. Un pack de la carpeta
// que no esté en ninguna de las dos listas se activa solo al abrir el mundo.

export interface WorldDatapack {
  id: string
  filename: string | null
  builtIn: boolean
  enabled: boolean
  description: string | null
  iconBase64: string | null
  size: number
}

type Tag = { type: string; value: any }

async function worldDir(instanceId: string, world: string): Promise<string> {
  return safeJoin(path.join(await getInstanceGameDir(instanceId), 'saves'), world)
}

function packLists(doc: NbtDocument): { enabled: string[]; disabled: string[] } {
  const dp = (doc.root as any).value?.Data?.value?.DataPacks?.value
  const read = (t?: Tag): string[] => (t?.value?.value ?? []).filter((x: unknown) => typeof x === 'string')
  return { enabled: read(dp?.Enabled), disabled: read(dp?.Disabled) }
}

function setPackLists(doc: NbtDocument, enabled: string[], disabled: string[]): void {
  const data = (doc.root as any).value?.Data
  if (!data) throw new Error('level.dat no tiene la sección Data')
  const list = (v: string[]): Tag => ({ type: 'list', value: { type: 'string', value: v } })
  data.value.DataPacks = { type: 'compound', value: { ...(data.value.DataPacks?.value ?? {}), Enabled: list(enabled), Disabled: list(disabled) } }
}

/** Descripción e icono del pack.mcmeta / pack.png de una carpeta o zip. */
async function readPackInfo(full: string): Promise<{ description: string | null; iconBase64: string | null }> {
  let mcmeta: string | null = null
  let icon: Buffer | null = null
  try {
    if ((await fs.stat(full)).isDirectory()) {
      mcmeta = await fs.readFile(path.join(full, 'pack.mcmeta'), 'utf8').catch(() => null)
      icon = await fs.readFile(path.join(full, 'pack.png')).catch(() => null)
    } else {
      const zip = new AdmZip(full)
      mcmeta = zip.getEntry('pack.mcmeta')?.getData().toString('utf8') ?? null
      icon = zip.getEntry('pack.png')?.getData() ?? null
    }
  } catch { /* zip roto: se lista igual */ }
  let description: string | null = null
  if (mcmeta) {
    try {
      const d = JSON.parse(mcmeta.replace(/^﻿/, '')).pack?.description
      description = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: any) => (typeof x === 'string' ? x : x?.text ?? '')).join('') : d?.text ?? null
      if (description) description = description.replace(/§./g, '')
    } catch { /* mcmeta inválido */ }
  }
  return { description, iconBase64: icon ? `data:image/png;base64,${icon.toString('base64')}` : null }
}

export async function listWorldDatapacks(instanceId: string, world: string): Promise<WorldDatapack[]> {
  const dir = await worldDir(instanceId, world)
  const levelDat = path.join(dir, 'level.dat')
  const { enabled, disabled } = (await fs.pathExists(levelDat))
    ? packLists(await nbtReadLocal(levelDat))
    : { enabled: [], disabled: [] }

  const out: WorldDatapack[] = []
  const dpDir = path.join(dir, 'datapacks')
  const names = (await fs.pathExists(dpDir)) ? await fs.readdir(dpDir) : []
  for (const name of names) {
    const full = path.join(dpDir, name)
    const st = await fs.stat(full).catch(() => null)
    if (!st) continue
    if (!st.isDirectory() && !name.toLowerCase().endsWith('.zip')) continue
    const id = `file/${name}`
    const info = await readPackInfo(full)
    out.push({ id, filename: name, builtIn: false, enabled: !disabled.includes(id), size: st.isDirectory() ? 0 : st.size, ...info })
  }
  // Integrados (vanilla, bundle, trade_rebalance…) según lo que diga level.dat
  for (const id of [...new Set([...enabled, ...disabled])]) {
    if (id.startsWith('file/')) continue
    out.push({ id, filename: null, builtIn: true, enabled: enabled.includes(id), description: null, iconBase64: null, size: 0 })
  }
  return out.sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || a.id.localeCompare(b.id))
}

export async function setWorldDatapackEnabled(instanceId: string, world: string, id: string, on: boolean): Promise<void> {
  if (id === 'vanilla' && !on) throw new Error('El datapack vanilla no se puede desactivar')
  const levelDat = path.join(await worldDir(instanceId, world), 'level.dat')
  const doc = await nbtReadLocal(levelDat)
  const { enabled, disabled } = packLists(doc)
  const en = enabled.filter((x) => x !== id)
  const dis = disabled.filter((x) => x !== id)
  if (on) en.push(id); else dis.push(id)
  setPackLists(doc, en, dis)
  await nbtWriteLocal(levelDat, doc)
}

export async function deleteWorldDatapack(instanceId: string, world: string, filename: string): Promise<void> {
  const dir = await worldDir(instanceId, world)
  await fs.remove(safeJoin(path.join(dir, 'datapacks'), filename))
  // Quitarlo también de las listas para que no quede un id huérfano
  const levelDat = path.join(dir, 'level.dat')
  if (await fs.pathExists(levelDat)) {
    const doc = await nbtReadLocal(levelDat)
    const { enabled, disabled } = packLists(doc)
    const id = `file/${filename}`
    if (enabled.includes(id) || disabled.includes(id)) {
      setPackLists(doc, enabled.filter((x) => x !== id), disabled.filter((x) => x !== id))
      await nbtWriteLocal(levelDat, doc)
    }
  }
}

/** Copia datapacks (zip o carpeta) al mundo. Devuelve los nombres copiados. */
export async function addWorldDatapacks(instanceId: string, world: string, sources: string[]): Promise<string[]> {
  const dpDir = path.join(await worldDir(instanceId, world), 'datapacks')
  await fs.ensureDir(dpDir)
  const done: string[] = []
  for (const src of sources) {
    const name = path.basename(src)
    const st = await fs.stat(src)
    if (!st.isDirectory() && !name.toLowerCase().endsWith('.zip')) continue
    // Un datapack de verdad lleva pack.mcmeta (en la raíz del zip o de la carpeta)
    const hasMeta = st.isDirectory()
      ? await fs.pathExists(path.join(src, 'pack.mcmeta'))
      : (() => { try { return !!new AdmZip(src).getEntry('pack.mcmeta') } catch { return false } })()
    if (!hasMeta) throw new Error(`"${name}" no es un datapack: le falta pack.mcmeta`)
    await fs.copy(src, safeJoin(dpDir, name), { overwrite: true })
    done.push(name)
  }
  return done
}
