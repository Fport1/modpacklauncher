import fs from 'fs-extra'
import zlib from 'zlib'
import nbt from 'prismarine-nbt'
import type { NbtDocument } from '../shared/types'
import { ftpReadBytes, ftpWriteBytes } from './ftp'

// Lectura y escritura de archivos NBT (playerdata/<uuid>.dat, scoreboard.dat,
// level.dat, estructuras…), para editarlos como con NBT Explorer.
//
// Cada archivo se vuelve a guardar exactamente como estaba: misma compresión
// y mismo orden de bytes. Minecraft Java usa gzip y big-endian casi siempre,
// pero hay archivos sin comprimir y Bedrock usa little-endian.

const MAX_NBT_BYTES = 20 * 1024 * 1024

function compressionOf(data: Buffer): NbtDocument['compression'] {
  if (data[0] === 0x1f && data[1] === 0x8b) return 'gzip'
  // Cabecera zlib: 0x78 seguido de un byte que hace múltiplo de 31 la pareja
  if (data[0] === 0x78 && ((data[0] << 8) | data[1]) % 31 === 0) return 'zlib'
  return 'none'
}

async function decode(data: Buffer): Promise<NbtDocument> {
  if (data.length > MAX_NBT_BYTES) throw new Error('El archivo es demasiado grande para abrirlo aquí (más de 20 MB).')
  const compression = compressionOf(data)
  const raw = compression === 'gzip' ? zlib.gunzipSync(data) : compression === 'zlib' ? zlib.inflateSync(data) : data
  let parsed: nbt.NBT
  let format: nbt.NBTFormat
  try {
    const result = await nbt.parse(raw)
    parsed = result.parsed
    format = result.type
  } catch {
    throw new Error('No es un archivo NBT válido o está dañado.')
  }
  return { root: parsed, format, compression }
}

function encode(doc: NbtDocument): Buffer {
  const raw = nbt.writeUncompressed(doc.root as nbt.NBT, doc.format)
  if (doc.compression === 'gzip') return zlib.gzipSync(raw)
  if (doc.compression === 'zlib') return zlib.deflateSync(raw)
  return raw
}

/**
 * Antes de guardar se comprueba que lo que se va a escribir se vuelve a leer
 * bien: un .dat roto hace que el jugador aparezca con el inventario vacío o
 * que el mundo no cargue, y eso es mucho peor que un error al guardar.
 */
async function encodeChecked(doc: NbtDocument): Promise<Buffer> {
  const data = encode(doc)
  const back = await decode(data)
  if (!nbt.equal(back.root as nbt.Tags[nbt.TagType], doc.root as nbt.Tags[nbt.TagType])) {
    throw new Error('Los datos no se pudieron codificar correctamente; no se ha guardado nada.')
  }
  return data
}

export async function nbtReadRemote(remote: string): Promise<NbtDocument> {
  return decode(await ftpReadBytes(remote))
}

/** Guarda en el servidor dejando el archivo anterior como `<nombre>.bak`. */
export async function nbtWriteRemote(remote: string, doc: NbtDocument): Promise<void> {
  const data = await encodeChecked(doc)
  const previous = await ftpReadBytes(remote).catch(() => null)
  if (previous) await ftpWriteBytes(`${remote}.bak`, previous)
  await ftpWriteBytes(remote, data)
}

export async function nbtReadLocal(file: string): Promise<NbtDocument> {
  return decode(await fs.readFile(file))
}

export async function nbtWriteLocal(file: string, doc: NbtDocument): Promise<void> {
  const data = await encodeChecked(doc)
  if (await fs.pathExists(file)) await fs.copy(file, `${file}.bak`, { overwrite: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, data)
  await fs.move(tmp, file, { overwrite: true })
}
