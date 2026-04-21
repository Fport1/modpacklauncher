import { shell } from 'electron'
import axios from 'axios'
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
  if (!url) {
    throw new Error(`No hay enlace de descarga para ${platform} en el manifiesto`)
  }
  shell.openExternal(url)
}
