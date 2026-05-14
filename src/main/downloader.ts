import axios from 'axios'
import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'

export type ProgressCallback = (current: number, total: number, message: string) => void

async function downloadFileOnce(
  url: string,
  destPath: string,
  onProgress?: ProgressCallback,
  expectedSha256?: string
): Promise<void> {
  await fs.ensureDir(path.dirname(destPath))

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 60_000
  })

  const total = parseInt(response.headers['content-length'] || '0', 10)
  let current = 0

  const writer = fs.createWriteStream(destPath)
  const hash = expectedSha256 ? crypto.createHash('sha256') : null

  await new Promise<void>((resolve, reject) => {
    response.data.on('data', (chunk: Buffer) => {
      current += chunk.length
      hash?.update(chunk)
      if (onProgress && total > 0) {
        onProgress(current, total, path.basename(destPath))
      }
    })

    response.data.pipe(writer)
    writer.on('finish', resolve)
    writer.on('error', reject)
    response.data.on('error', reject)
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
      lastError = e
      if (attempt < maxRetries - 1) {
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
