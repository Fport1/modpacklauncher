import { app } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import nbt from 'prismarine-nbt'
import type { NbtDocument } from '../shared/types'
import { nativeAvailable, nativeCall } from './native'

// Archivos de región (.mca) en el launcher: la lista de chunks, el NBT de cada uno, guardarlo
// y borrar chunks. Todo lo hace el programa en Rust (native/chunks.rs).
//
// Los del servidor se bajan a una copia (con sus entities/ y poi/ al lado, que llevan los
// mismos chunks), se trabaja sobre ella y cada cambio se sube enseguida, dejando antes el
// archivo de antes como .bak en el servidor.

export interface RegionChunk {
  index: number; x: number; z: number; sectors: number; bytes: number; timestamp: number
  compression: number; external: boolean
  dataVersion: number | null; status: string | null; inhabited: number | null; lastUpdate: number | null
  error: string | null
}

const rjoin = (a: string, b: string): string => path.posix.join(a, b)

interface Opened { local: string; remote?: string; siblings: { local: string; remote: string }[] }
const opened = new Map<string, Opened>()

function need(): void {
  if (!nativeAvailable()) throw new Error('Abrir regiones necesita el programa auxiliar del launcher, que no está disponible en este equipo.')
}

/** Abre una región. Devuelve la ruta local con la que trabajar. */
export async function regionOpen(side: 'local' | 'remote', file: string): Promise<string> {
  need()
  if (side === 'local') { opened.set(file, { local: file, siblings: [] }); return file }
  const { ftpReadBytes } = await import('./ftp')
  const base = path.join(app.getPath('userData'), 'cache', 'regions', crypto.createHash('sha1').update(file).digest('hex').slice(0, 16))
  await fs.emptyDir(base)
  const name = path.posix.basename(file)
  const dimRemote = path.posix.dirname(path.posix.dirname(file))
  const local = path.join(base, 'region', name)
  await fs.outputFile(local, await ftpReadBytes(file))
  const siblings: Opened['siblings'] = []
  for (const kind of ['entities', 'poi']) {
    const remote = rjoin(rjoin(dimRemote, kind), name)
    const data = await ftpReadBytes(remote).catch(() => null)
    if (!data) continue
    const l = path.join(base, kind, name)
    await fs.outputFile(l, data)
    siblings.push({ local: l, remote })
  }
  opened.set(local, { local, remote: file, siblings })
  return local
}

export async function regionList(local: string): Promise<{ size: number; chunks: RegionChunk[] }> {
  need()
  return nativeCall('region-list', { file: local })
}

export async function regionRead(local: string, index: number): Promise<NbtDocument & { regionCompression: number }> {
  need()
  return nativeCall('region-read', { file: local, index })
}

/** La primera vez que se cambia una región en esta sesión se guarda una copia al lado. */
const backedUp = new Set<string>()
async function backupLocal(o: Opened): Promise<void> {
  if (o.remote || backedUp.has(o.local)) return
  backedUp.add(o.local)
  await fs.copy(o.local, `${o.local}.bak`, { overwrite: true })
  for (const s of o.siblings) await fs.copy(s.local, `${s.local}.bak`, { overwrite: true }).catch(() => {})
}

/** Sube la copia de trabajo al servidor, dejando la de antes como .bak. */
async function pushRemote(o: Opened, withSiblings: boolean): Promise<void> {
  if (!o.remote) return
  const { ftpReadBytes, ftpWriteBytes, ftpRemove } = await import('./ftp')
  const put = async (local: string, remote: string): Promise<void> => {
    if (!backedUp.has(remote)) {
      const before = await ftpReadBytes(remote).catch(() => null)
      if (before) await ftpWriteBytes(`${remote}.bak`, before)
      backedUp.add(remote)
    }
    // Si al borrar chunks no quedó ninguno, la región desaparece también en el servidor
    if (await fs.pathExists(local)) await ftpWriteBytes(remote, await fs.readFile(local))
    else await ftpRemove(remote, false)
  }
  await put(o.local, o.remote)
  if (withSiblings) for (const s of o.siblings) await put(s.local, s.remote)
}

export async function regionWrite(local: string, index: number, doc: NbtDocument, compression: number): Promise<void> {
  need()
  const o = opened.get(local) ?? { local, siblings: [] }
  await backupLocal(o)
  const raw = nbt.writeUncompressed(doc.root as nbt.NBT, 'big')
  await nativeCall('region-write', { file: local, index, data: Buffer.from(raw).toString('base64'), compression })
  await pushRemote(o, false)
}

export async function regionDelete(local: string, indices: number[]): Promise<void> {
  need()
  const o = opened.get(local) ?? { local, siblings: [] }
  await backupLocal(o)
  await nativeCall('region-delete', { file: local, indices })
  await pushRemote(o, true)
}
