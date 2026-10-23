import axios from 'axios'
import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import type { OpDetail } from '../shared/types'
import { getAbortSignal, CancelError } from './cancelToken'
import { TransferMeter } from './transferMeter'

export type ProgressCallback = (current: number, total: number, message: string, detail?: OpDetail) => void

/**
 * Si no llega ningún dato en este tiempo, la descarga se da por colgada y se reintenta.
 * Sin esto, una conexión que se queda a medias deja la barra parada para siempre: el
 * timeout de axios solo cubre hasta que empiezan a llegar datos.
 */
const STALL_TIMEOUT_MS = 45_000

async function downloadFileOnce(
  url: string,
  destPath: string,
  onProgress?: ProgressCallback,
  expectedSha256?: string
): Promise<void> {
  await fs.ensureDir(path.dirname(destPath))

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 60_000,
    signal: getAbortSignal()
  })

  const total = parseInt(String(response.headers['content-length'] ?? '0'), 10)
  let current = 0

  const writer = fs.createWriteStream(destPath)
  const hash = expectedSha256 ? crypto.createHash('sha256') : null
  const meter = new TransferMeter()
  const name = path.basename(destPath)
  let lastReport = 0

  await new Promise<void>((resolve, reject) => {
    let stall: ReturnType<typeof setTimeout> | undefined
    const armStall = (): void => {
      clearTimeout(stall)
      stall = setTimeout(() => {
        response.data.destroy(new Error(`La descarga de ${name} se quedó parada ${STALL_TIMEOUT_MS / 1000} s sin recibir datos`))
      }, STALL_TIMEOUT_MS)
    }
    armStall()
    response.data.on('data', (chunk: Buffer) => {
      armStall()
      current += chunk.length
      hash?.update(chunk)
      const now = Date.now()
      if (onProgress && (now - lastReport > 250 || current === total)) {
        lastReport = now
        const speed = meter.sample(current, now)
        onProgress(current, total || current, name, {
          bytes: current,
          totalBytes: total || undefined,
          speed,
          eta: TransferMeter.eta(current, total, speed),
          file: name
        })
      }
    })

    response.data.pipe(writer)
    writer.on('finish', () => { clearTimeout(stall); resolve() })
    writer.on('error', (e) => { clearTimeout(stall); reject(e) })
    response.data.on('error', (e: Error) => { clearTimeout(stall); writer.destroy(); reject(e) })
  })

  if (hash && expectedSha256) {
    const digest = hash.digest('hex')
    if (digest !== expectedSha256) {
      await fs.remove(destPath)
      throw new Error(`Hash mismatch for ${path.basename(destPath)}: expected ${expectedSha256}, got ${digest}`)
    }
  }
}

export async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: ProgressCallback,
  expectedSha256?: string,
  maxRetries = 3
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) await fs.remove(destPath).catch(() => {})
      await downloadFileOnce(url, destPath, onProgress, expectedSha256)
      return
    } catch (e) {
      // Propagate cancellation immediately without retry
      if (axios.isCancel(e) || (e as NodeJS.ErrnoException)?.code === 'ERR_CANCELED') {
        throw new CancelError()
      }
      lastError = e
      if (attempt < maxRetries - 1) {
        console.warn(`[descargas] ${path.basename(destPath)}: intento ${attempt + 1} fallido (${(e as Error)?.message ?? e}), reintentando...`)
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
      }
    }
  }
  throw lastError
}

export async function downloadFiles(
  files: Array<{ url: string; dest: string; sha256?: string; name?: string }>,
  onProgress?: ProgressCallback
): Promise<void> {
  const total = files.length
  let current = 0

  for (const file of files) {
    onProgress?.(current, total, `Downloading ${file.name ?? path.basename(file.dest)}...`)
    await downloadFile(file.url, file.dest, undefined, file.sha256)
    current++
    onProgress?.(current, total, `Downloaded ${file.name ?? path.basename(file.dest)}`)
  }
}

export async function fileMatchesHash(filePath: string, sha256: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath)
    const digest = crypto.createHash('sha256').update(content).digest('hex')
    return digest === sha256
  } catch {
    return false
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  return fs.pathExists(filePath)
}
