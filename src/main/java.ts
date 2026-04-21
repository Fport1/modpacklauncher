import { app } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import { exec } from 'child_process'
import { promisify } from 'util'
import AdmZip from 'adm-zip'
import axios from 'axios'

const execAsync = promisify(exec)

export function getRequiredJavaMajor(mcVersion: string): number {
  // Snapshot format: YYwNNa (e.g., 25w10a) — modern snapshots all use Java 21
  if (/^\d{2}w\d{2}[a-z]$/i.test(mcVersion)) return 21

  const parts = mcVersion.split('.').map(Number)
  const minor = parts[1] ?? 0
  const patch = parts[2] ?? 0

  if (minor >= 21) return 21
  if (minor === 20 && patch >= 5) return 21
  if (minor >= 17) return 17
  return 8
}

async function getRequiredJavaMajorFromVersionJson(mcVersion: string): Promise<number | null> {
  const versionJsonPath = path.join(
    app.getPath('userData'),
    'shared',
    'versions',
    mcVersion,
    `${mcVersion}.json`
  )
  try {
    const data = await fs.readJson(versionJsonPath)
    if (typeof data.javaVersion?.majorVersion === 'number') {
      return data.javaVersion.majorVersion as number
    }
  } catch {
    // version not downloaded yet
  }
  return null
}

export async function getRequiredJavaMajorAsync(mcVersion: string): Promise<number> {
  const fromJson = await getRequiredJavaMajorFromVersionJson(mcVersion)
  return fromJson ?? getRequiredJavaMajor(mcVersion)
}

export async function ensureJava(
  mcVersion: string,
  onProgress?: (current: number, total: number, msg: string) => void
): Promise<string> {
  const major = await getRequiredJavaMajorAsync(mcVersion)

  const managed = await findManagedJava(major)
  if (managed) return managed

  const system = await detectSystemJava(major)
  if (system) return system

  return installJava(major, onProgress)
}

export async function checkJavaStatus(mcVersion: string): Promise<{
  found: boolean
  path?: string
  version?: number
  required: number
  managed: boolean
}> {
  const required = await getRequiredJavaMajorAsync(mcVersion)

  const managed = await findManagedJava(required)
  if (managed) {
    const version = await getJavaVersion(managed).catch(() => 0)
    return { found: true, path: managed, version, required, managed: true }
  }

  const system = await detectSystemJava(required)
  if (system) {
    const version = await getJavaVersion(system).catch(() => 0)
    return { found: true, path: system, version, required, managed: false }
  }

  return { found: false, required, managed: false }
}

function getManagedJavaDir(major: number): string {
  return path.join(app.getPath('userData'), 'jre', `java${major}`)
}

async function findManagedJava(major: number): Promise<string | null> {
  const dir = getManagedJavaDir(major)
  if (!(await fs.pathExists(dir))) return null
  return findJavaExe(dir)
}

async function detectSystemJava(requiredMajor: number): Promise<string | null> {
  const candidates =
    process.platform === 'win32'
      ? ['java', 'javaw']
      : ['/usr/bin/java', '/usr/local/bin/java', '/opt/homebrew/bin/java']

  for (const candidate of candidates) {
    try {
      const version = await getJavaVersion(candidate)
      if (version >= requiredMajor) return candidate
    } catch {
      continue
    }
  }
  return null
}

async function getJavaVersion(javaPath: string): Promise<number> {
  const { stderr } = await execAsync(`"${javaPath}" -version`, { timeout: 5000 })
  const match = stderr.match(/version "(\d+)(?:\.(\d+))?/)
  if (!match) throw new Error('Cannot parse Java version')
  const major = parseInt(match[1])
  // Java 8 reports as "1.8.x", Java 17+ reports as "17.x"
  return major === 1 ? 8 : major
}

async function installJava(
  major: number,
  onProgress?: (current: number, total: number, msg: string) => void
): Promise<string> {
  const osName = getAdoptiumOs()
  const arch = getAdoptiumArch()
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`

  const ext = process.platform === 'win32' ? '.zip' : '.tar.gz'
  const dir = getManagedJavaDir(major)
  const archivePath = path.join(dir, `java${major}${ext}`)

  await fs.ensureDir(dir)

  onProgress?.(0, 3, `Descargando Java ${major}...`)

  const response = await axios.get(url, {
    responseType: 'stream',
    maxRedirects: 10,
    timeout: 120_000
  })

  const total = parseInt(response.headers['content-length'] || '0', 10)
  let current = 0
  const writer = fs.createWriteStream(archivePath)

  await new Promise<void>((resolve, reject) => {
    response.data.on('data', (chunk: Buffer) => {
      current += chunk.length
      if (total > 0) onProgress?.(current, total, `Descargando Java ${major}...`)
    })
    response.data.pipe(writer)
    writer.on('finish', resolve)
    writer.on('error', reject)
    response.data.on('error', reject)
  })

  onProgress?.(1, 3, `Extrayendo Java ${major}...`)
  await extractArchive(archivePath, dir)
  await fs.remove(archivePath)

  onProgress?.(2, 3, 'Buscando ejecutable...')
  const javaExe = await findJavaExe(dir)
  if (!javaExe) throw new Error(`No se encontró el ejecutable de Java ${major} tras la instalación`)

  onProgress?.(3, 3, `Java ${major} instalado!`)
  return javaExe
}

function getAdoptiumOs(): string {
  switch (process.platform) {
    case 'win32': return 'windows'
    case 'darwin': return 'mac'
    default: return 'linux'
  }
}

function getAdoptiumArch(): string {
  switch (process.arch) {
    case 'arm64': return 'aarch64'
    case 'ia32': return 'x32'
    default: return 'x64'
  }
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  if (process.platform === 'win32') {
    const zip = new AdmZip(archivePath)
    zip.extractAllTo(destDir, true)
  } else {
    await execAsync(`tar -xzf "${archivePath}" -C "${destDir}"`)
  }
}

async function findJavaExe(dir: string): Promise<string | null> {
  const exeName = process.platform === 'win32' ? 'java.exe' : 'java'

  async function search(currentDir: string, depth: number): Promise<string | null> {
    if (depth > 6) return null
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() && entry.name === exeName) {
          return path.join(currentDir, entry.name)
        }
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const result = await search(path.join(currentDir, entry.name), depth + 1)
          if (result) return result
        }
      }
    } catch {
      // ignore
    }
    return null
  }

  return search(dir, 0)
}
