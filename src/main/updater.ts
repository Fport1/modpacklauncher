import { shell, app } from 'electron'
import { spawn } from 'child_process'
import axios from 'axios'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { APP_VERSION } from '../shared/types'

export interface UpdateManifest {
  version: string
  releaseNotes?: string
  date?: string
  files: {
    win32?: string
    darwin?: string
    linux?: string
  }
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  manifest?: UpdateManifest
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export async function checkForUpdates(manifestUrl: string): Promise<UpdateCheckResult> {
  if (!manifestUrl?.trim()) return { hasUpdate: false, currentVersion: APP_VERSION }

  const { data } = await axios.get<UpdateManifest>(manifestUrl.trim(), {
    timeout: 10_000,
    headers: { 'Cache-Control': 'no-cache' }
  })

  if (!data?.version) throw new Error('El archivo de actualización no tiene un campo "version"')

  const hasUpdate = compareVersions(data.version, APP_VERSION) > 0
  return { hasUpdate, currentVersion: APP_VERSION, manifest: data }
}

export function openDownloadPage(manifest: UpdateManifest): void {
  const platform = process.platform as 'win32' | 'darwin' | 'linux'
  const url = manifest.files[platform]
  if (!url) throw new Error(`No hay enlace de descarga para ${platform} en el manifiesto`)
  shell.openExternal(url)
}

export async function downloadAndInstall(
  manifest: UpdateManifest,
  onProgress: (pct: number) => void
): Promise<void> {
  const platform = process.platform as 'win32' | 'darwin' | 'linux'
  const url = manifest.files[platform]
  if (!url) throw new Error(`No hay enlace de descarga para ${platform} en el manifiesto`)

  const filename = url.split('/').pop() ?? `update-${manifest.version}.exe`
  const dest = path.join(os.tmpdir(), filename)

  const response = await axios.get<NodeJS.ReadableStream>(url, {
    responseType: 'stream',
    timeout: 0
  })

  const total = parseInt(response.headers['content-length'] ?? '0', 10)
  let downloaded = 0

  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(dest)
    response.data.on('data', (chunk: Buffer) => {
      downloaded += chunk.length
      if (total > 0) onProgress(Math.round((downloaded / total) * 100))
    })
    response.data.pipe(writer)
    writer.on('finish', resolve)
    writer.on('error', reject)
  })

  onProgress(100)

  if (platform === 'win32') {
    // NSIS installer: run and quit
    spawn(dest, [], { detached: true, stdio: 'ignore' }).unref()
    setTimeout(() => app.quit(), 500)
  } else if (platform === 'linux') {
    // AppImage needs execute permission before it can be launched
    fs.chmodSync(dest, '755')
    spawn(dest, [], { detached: true, stdio: 'ignore' }).unref()
    setTimeout(() => app.quit(), 500)
  } else if (platform === 'darwin') {
    // Mount the DMG, copy the .app replacing the running one, relaunch
    const appName = 'ModpackLauncher.app'
    const mountPoint = path.join(os.tmpdir(), 'ModpackLauncherUpdate')
    const currentAppPath = app.getAppPath().split('/Contents/')[0]
    const applicationsPath = '/Applications/' + appName

    // hdiutil attach mounts the DMG
    spawn('hdiutil', ['attach', dest, '-mountpoint', mountPoint, '-nobrowse', '-quiet'], {
      stdio: 'ignore'
    }).on('close', () => {
      const sourcePath = path.join(mountPoint, appName)
      const targetPath = fs.existsSync(applicationsPath) ? applicationsPath : currentAppPath

      // Remove quarantine from the new app, then replace atomically with ditto
      spawn('xattr', ['-rd', 'com.apple.quarantine', sourcePath], { stdio: 'ignore' })
        .on('close', () => {
          spawn('ditto', [sourcePath, targetPath], { stdio: 'ignore' })
            .on('close', () => {
              spawn('hdiutil', ['detach', mountPoint, '-quiet'], { stdio: 'ignore' })
              spawn('open', [targetPath], { detached: true, stdio: 'ignore' }).unref()
              setTimeout(() => app.quit(), 1000)
            })
        })
    })
  }
}
