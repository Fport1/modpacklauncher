import fs from 'fs-extra'
import path from 'path'
import type { Instance, OpDetail, TransferKey, TransferCategory, TransferItem, TransferPlan, TransferRequest, TransferResult } from '../shared/types'
export type { TransferRequest }
import { getInstanceGameDir, loadInstances } from './instances'
import { isInstanceRunning } from './launcher'
import { safeJoin } from './paths'
import { checkCancel } from './cancelToken'

// Pasar contenido de una instancia a otra (también a/desde .minecraft): mods, packs,
// mundos, configuración… copiándolo o moviéndolo, para no tener que volver a instalarlo.

interface CategoryDef {
  key: TransferKey
  label: string
  hint: string
  dir?: string
  file?: string
}

const CATEGORIES: CategoryDef[] = [
  { key: 'mods', label: 'Mods', hint: 'Los archivos .jar de la carpeta mods', dir: 'mods' },
  { key: 'resourcepacks', label: 'Resource packs', hint: 'Texturas y sonidos', dir: 'resourcepacks' },
  { key: 'shaderpacks', label: 'Shaders', hint: 'Packs de shaders (Iris u OptiFine)', dir: 'shaderpacks' },
  { key: 'saves', label: 'Mundos', hint: 'Tus partidas guardadas', dir: 'saves' },
  { key: 'config', label: 'Configuración de mods', hint: 'La carpeta config: cómo está ajustado cada mod', dir: 'config' },
  { key: 'screenshots', label: 'Capturas', hint: 'Capturas de pantalla', dir: 'screenshots' },
  { key: 'options', label: 'Ajustes del juego', hint: 'options.txt: vídeo, sonido, controles…', file: 'options.txt' },
  { key: 'servers', label: 'Lista de servidores', hint: 'servers.dat: los servidores guardados', file: 'servers.dat' },
]

async function sizeOf(p: string): Promise<number> {
  const st = await fs.stat(p).catch(() => null)
  if (!st) return 0
  if (!st.isDirectory()) return st.size
  let total = 0
  for (const e of await fs.readdir(p).catch(() => [] as string[])) total += await sizeOf(path.join(p, e))
  return total
}

/** «sodium-fabric-0.6.1+mc1.21.jar» → «sodium-fabric»: para avisar de versiones distintas del mismo mod. */
function modKey(name: string): string {
  return name.toLowerCase()
    .replace(/\.disabled$/, '')
    .replace(/\.(jar|zip)$/, '')
    .replace(/[-_+ ]?(v?\d+[\w.+-]*|mc\d[\w.+-]*)$/g, '')
    .replace(/[-_+ ]+(fabric|forge|neoforge|quilt)$/, '')
}

async function getInstance(id: string): Promise<Instance> {
  const inst = (await loadInstances()).find((i) => i.id === id)
  if (!inst) throw new Error('Instancia no encontrada')
  return inst
}

export async function planTransfer(sourceId: string, targetId: string): Promise<TransferPlan> {
  if (sourceId === targetId) throw new Error('El origen y el destino son la misma instancia')
  const [src, dst] = await Promise.all([getInstance(sourceId), getInstance(targetId)])
  const srcDir = await getInstanceGameDir(sourceId)
  const dstDir = await getInstanceGameDir(targetId)
  const categories: TransferCategory[] = []

  for (const c of CATEGORIES) {
    if (c.file) {
      const p = path.join(srcDir, c.file)
      if (!(await fs.pathExists(p))) continue
      categories.push({
        key: c.key, label: c.label, hint: c.hint, single: true,
        items: [{ name: c.file, size: await sizeOf(p), isDir: false, exists: await fs.pathExists(path.join(dstDir, c.file)) }]
      })
      continue
    }
    const from = path.join(srcDir, c.dir!)
    const entries = await fs.readdir(from, { withFileTypes: true }).catch(() => [])
    if (!entries.length) continue
    const destNames = await fs.readdir(path.join(dstDir, c.dir!)).catch(() => [] as string[])
    const destSet = new Set(destNames.map((n) => n.toLowerCase()))
    const destKeys = new Map(destNames.map((n) => [modKey(n), n]))
    const items: TransferItem[] = []
    for (const e of entries) {
      if (!e.isFile() && !e.isDirectory()) continue
      const exists = destSet.has(e.name.toLowerCase())
      const twin = c.key === 'mods' && !exists ? destKeys.get(modKey(e.name)) : undefined
      items.push({ name: e.name, size: await sizeOf(path.join(from, e.name)), isDir: e.isDirectory(), exists, ...(twin ? { similar: twin } : {}) })
    }
    items.sort((a, b) => a.name.localeCompare(b.name))
    categories.push({ key: c.key, label: c.label, hint: c.hint, single: false, items })
  }

  return {
    source: { id: src.id, name: src.name, minecraft: src.minecraft, modloader: src.modloader },
    target: { id: dst.id, name: dst.name, minecraft: dst.minecraft, modloader: dst.modloader },
    categories,
    sourceRunning: isInstanceRunning(sourceId),
    targetRunning: isInstanceRunning(targetId),
  }
}

export async function runTransfer(
  req: TransferRequest,
  onProgress: (message: string, current: number, total: number, detail?: OpDetail) => void
): Promise<TransferResult> {
  if (req.sourceId === req.targetId) throw new Error('El origen y el destino son la misma instancia')
  // Con el juego abierto los archivos están en uso y el juego reescribe sus ajustes al cerrar
  if (isInstanceRunning(req.targetId)) throw new Error('Cierra el juego de la instancia de destino antes de pasarle contenido.')
  if (req.mode === 'move' && isInstanceRunning(req.sourceId)) throw new Error('Cierra el juego de la instancia de origen antes de mover contenido desde ella.')

  const srcDir = await getInstanceGameDir(req.sourceId)
  const dstDir = await getInstanceGameDir(req.targetId)
  const jobs: { from: string; to: string; name: string }[] = []
  for (const sel of req.selection) {
    const def = CATEGORIES.find((c) => c.key === sel.key)
    if (!def) continue
    for (const name of sel.names) {
      const rel = def.file ?? path.join(def.dir!, name)
      jobs.push({ from: safeJoin(srcDir, rel), to: safeJoin(dstDir, rel), name: def.file ?? `${def.dir}/${name}` })
    }
  }

  const result: TransferResult = { done: 0, skipped: 0, failed: [] }
  const verb = req.mode === 'move' ? 'Moviendo' : 'Copiando'
  for (let i = 0; i < jobs.length; i++) {
    checkCancel()
    const job = jobs[i]
    onProgress(`${verb} ${job.name}...`, i, jobs.length, { phase: verb, filesDone: i, filesTotal: jobs.length, file: job.name })
    try {
      const exists = await fs.pathExists(job.to)
      if (exists && req.conflict === 'skip') { result.skipped++; continue }
      await fs.ensureDir(path.dirname(job.to))
      if (exists) await fs.remove(job.to)
      if (req.mode === 'move') await fs.move(job.from, job.to, { overwrite: true })
      else await fs.copy(job.from, job.to, { overwrite: true, preserveTimestamps: true })
      result.done++
    } catch (e) {
      result.failed.push({ name: job.name, error: (e as Error)?.message ?? String(e) })
    }
  }
  onProgress('Listo', jobs.length, jobs.length, { phase: verb, filesDone: jobs.length, filesTotal: jobs.length })
  console.log(`[Transferir] ${req.mode} ${req.sourceId} → ${req.targetId}: ${result.done} hechos, ${result.skipped} saltados, ${result.failed.length} fallidos`)
  return result
}
