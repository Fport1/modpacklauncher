import fs from 'fs-extra'
import path from 'path'
import { statfs } from 'fs/promises'
import { shell, type BrowserWindow } from 'electron'
import { getLauncherDir } from './instances'
import type { DiskInfo, StorageChild, StorageScanProgress } from '../shared/types'

/**
 * Árbol de tamaños construido en el último escaneo.
 *
 * Se guarda entero en memoria para que navegar hacia dentro sea instantáneo:
 * medir de nuevo cada carpeta al abrirla obligaría a recorrer miles de ficheros
 * otra vez. Son unas decenas de miles de nodos, apenas unos MB.
 */
interface Node {
  name: string
  /** Ruta relativa a la carpeta del launcher; '' es la raíz. */
  rel: string
  bytes: number
  isDir: boolean
  children: Node[]
}

let tree: Node | null = null

/** Nombres que no aportan nada al usuario y solo ensucian el listado. */
const HIDDEN = new Set(['.DS_Store', 'Thumbs.db'])

/**
 * Recorre un directorio construyendo el árbol y avisando del avance.
 *
 * Los enlaces simbólicos no se siguen: el runtime de Java trae varios apuntando
 * dentro de sí mismo y se contaría lo mismo varias veces.
 */
async function walk(
  abs: string,
  rel: string,
  name: string,
  state: { bytes: number; files: number; tick: (current: string) => void }
): Promise<Node> {
  const node: Node = { name, rel, bytes: 0, isDir: true, children: [] }
  const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (HIDDEN.has(entry.name)) continue
    if (entry.isSymbolicLink()) continue

    const childAbs = path.join(abs, entry.name)
    const childRel = rel ? `${rel}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      const child = await walk(childAbs, childRel, entry.name, state)
      node.children.push(child)
      node.bytes += child.bytes
    } else if (entry.isFile()) {
      const stat = await fs.stat(childAbs).catch(() => null)
      const size = stat?.size ?? 0
      node.children.push({ name: entry.name, rel: childRel, bytes: size, isDir: false, children: [] })
      node.bytes += size
      state.bytes += size
      state.files++
      state.tick(childRel)
    }
  }

  node.children.sort((a, b) => b.bytes - a.bytes)
  return node
}

/**
 * Escanea la carpeta del launcher y va informando del avance.
 *
 * El total crece en vivo en vez de aparecer de golpe al final, que con decenas
 * de miles de ficheros de assets se hacía eterno sin señal de vida.
 */
export async function scanStorage(window: BrowserWindow | null): Promise<StorageScanProgress> {
  const root = getLauncherDir()
  let lastEmit = 0

  const state = {
    bytes: 0,
    files: 0,
    tick: (current: string): void => {
      const now = Date.now()
      if (now - lastEmit < 100) return
      lastEmit = now
      if (window && !window.isDestroyed()) {
        window.webContents.send('storage:scan-progress', {
          bytes: state.bytes,
          files: state.files,
          current,
          done: false
        } satisfies StorageScanProgress)
      }
    }
  }

  tree = await walk(root, '', 'ModpackLauncher', state)
  return { bytes: tree.bytes, files: state.files, current: '', done: true }
}

function findNode(rel: string): Node | null {
  if (!tree) return null
  if (!rel) return tree

  let node: Node = tree
  for (const part of rel.split('/')) {
    const next = node.children.find((c) => c.name === part)
    if (!next) return null
    node = next
  }
  return node
}

/** Hijos directos de una ruta del árbol, ya ordenados de mayor a menor. */
export function listStorageChildren(rel: string): StorageChild[] {
  const node = findNode(rel)
  if (!node) return []
  return node.children.map((c) => ({
    name: c.name,
    rel: c.rel,
    bytes: c.bytes,
    isDir: c.isDir,
    childCount: c.children.length
  }))
}

export function getNodeBytes(rel: string): number {
  return findNode(rel)?.bytes ?? 0
}

/** Ruta absoluta de un nodo, comprobando que no se salga de la carpeta del launcher. */
function resolveInside(rel: string): string {
  const root = getLauncherDir()
  const abs = path.resolve(root, rel)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new Error('Ruta fuera de la carpeta del launcher')
  }
  return abs
}

/**
 * Borra un fichero o carpeta concretos.
 *
 * Se acepta cualquier ruta dentro de la carpeta del launcher, no una lista
 * cerrada, porque el objetivo es poder afinar hasta el fichero suelto. La
 * comprobación de contención es lo que impide que un fallo del renderer acabe
 * borrando fuera de ahí.
 */
export async function deleteStoragePath(rel: string): Promise<void> {
  if (!rel) throw new Error('No se puede borrar la carpeta raíz')
  const abs = resolveInside(rel)
  await fs.remove(abs)

  // Mantener el árbol coherente sin volver a escanear entero.
  const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  const removed = findNode(rel)
  const parent = findNode(parentRel)
  if (removed && parent) {
    parent.children = parent.children.filter((c) => c.rel !== rel)
    for (let p: Node | null = parent, r = parentRel; p; ) {
      p.bytes -= removed.bytes
      if (!r) break
      r = r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : ''
      p = findNode(r)
    }
  }
}

export function openStoragePath(rel?: string): void {
  const abs = resolveInside(rel ?? '')
  shell.openPath(abs)
}

export function revealStoragePath(rel: string): void {
  shell.showItemInFolder(resolveInside(rel))
}

/**
 * Ocupación del disco donde vive el launcher.
 *
 * `others` es todo lo que no es el launcher: sistema, otras apps y archivos del
 * usuario. Sirve para que la barra tenga contexto — 3 GB significan cosas muy
 * distintas en un disco de 128 GB lleno que en uno de 2 TB vacío.
 */
export async function getDiskInfo(): Promise<DiskInfo> {
  const launcher = tree?.bytes ?? 0
  try {
    const stats = await statfs(getLauncherDir())
    // bavail es el hueco realmente utilizable; bfree incluye el reservado.
    const blockSize = Number(stats.bsize)
    const total = Number(stats.blocks) * blockSize
    const free = Number(stats.bavail) * blockSize
    const used = total - free
    return { total, free, used, launcher, others: Math.max(0, used - launcher) }
  } catch {
    return { total: 0, free: 0, used: 0, launcher, others: 0 }
  }
}
