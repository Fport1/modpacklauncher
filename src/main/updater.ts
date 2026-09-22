import { shell, app } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { APP_VERSION } from '../shared/types'
import { hasRunningInstances } from './launcher'

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

const RELEASES_PAGE = 'https://github.com/Fport1/modpacklauncher/releases/latest'

// Comportamiento de Discord, Steam o el launcher oficial: en cuanto se detecta
// una versión nueva se descarga en segundo plano, y se aplica sola al cerrar la
// app. El usuario puede además reiniciar en el momento desde el aviso.
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

/**
 * La actualización ya descargada y lista para instalarse, si la hay.
 *
 * Hace falta guardarla porque la descarga arranca sola al comprobar: cuando el
 * usuario pulsa "instalar" puede haber terminado ya, y entonces esperar al
 * evento `update-downloaded` colgaría para siempre.
 */
let readyToInstall: UpdateInfo | null = null
autoUpdater.on('update-downloaded', (info) => {
  readyToInstall = info
})

// Nunca instalar con una partida abierta. El proceso de Minecraft es hijo del
// launcher, asi que reiniciar para actualizar se lo llevaria por delante y el
// usuario perderia lo que estuviera haciendo. La actualizacion ya descargada
// se queda esperando y entra en el siguiente cierre con el juego cerrado,
// que es como se comportan Steam o Discord.
app.on('before-quit', () => {
  autoUpdater.autoInstallOnAppQuit = !hasRunningInstances()
})

function toManifest(info: UpdateInfo): UpdateManifest {
  const notes =
    typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : info.releaseNotes?.map((n) => n.note ?? '').join('\n\n')

  return {
    version: info.version,
    releaseNotes: notes || undefined,
    date: info.releaseDate,
    // electron-updater resuelve el fichero concreto por su cuenta; estos
    // enlaces son solo para el botón de "descargar manualmente".
    files: { win32: RELEASES_PAGE, darwin: RELEASES_PAGE, linux: RELEASES_PAGE }
  }
}

/**
 * El parámetro se conserva por compatibilidad con la llamada existente, pero ya
 * no se usa: electron-updater lee el feed de `app-update.yml`, que
 * electron-builder genera con la configuración `publish` y apunta a las
 * releases de GitHub. El ajuste de URL de manifiesto queda sin efecto.
 */
export async function checkForUpdates(_manifestUrl?: string): Promise<UpdateCheckResult> {
  // En desarrollo no hay app empaquetada contra la que comparar.
  if (!app.isPackaged) return { hasUpdate: false, currentVersion: APP_VERSION }

  if (readyToInstall) {
    return { hasUpdate: true, currentVersion: APP_VERSION, manifest: toManifest(readyToInstall) }
  }

  const result = await autoUpdater.checkForUpdates()
  const info = result?.updateInfo
  if (!info || info.version === APP_VERSION) {
    return { hasUpdate: false, currentVersion: APP_VERSION }
  }

  return { hasUpdate: true, currentVersion: APP_VERSION, manifest: toManifest(info) }
}

export function openDownloadPage(_manifest: UpdateManifest): void {
  shell.openExternal(RELEASES_PAGE)
}

/**
 * Espera a que termine la descarga (que ya va sola en segundo plano) y reinicia
 * aplicando la actualización.
 *
 * No hace falta verificar la descarga a mano: electron-updater comprueba el
 * SHA-512 de cada fichero contra el publicado en `latest*.yml` y aborta si no
 * cuadra, y en Windows valida además la firma del instalador.
 */
export async function downloadAndInstall(
  _manifest: UpdateManifest,
  onProgress: (pct: number) => void
): Promise<void> {
  if (!app.isPackaged) throw new Error('Las actualizaciones solo funcionan en la app instalada')
  if (hasRunningInstances()) {
    throw new Error('Cierra Minecraft antes de actualizar: al reiniciar el launcher se cerraria la partida.')
  }

  if (!readyToInstall) {
    await new Promise<void>((resolve, reject) => {
      const onProgressEvent = (p: { percent: number }): void => onProgress(Math.round(p.percent))
      const onDone = (): void => { cleanup(); resolve() }
      const onError = (err: Error): void => { cleanup(); reject(err) }
      function cleanup(): void {
        autoUpdater.off('download-progress', onProgressEvent)
        autoUpdater.off('update-downloaded', onDone)
        autoUpdater.off('error', onError)
      }

      autoUpdater.on('download-progress', onProgressEvent)
      autoUpdater.once('update-downloaded', onDone)
      autoUpdater.once('error', onError)

      // Si autoDownload no llegó a arrancarla (por ejemplo tras un error
      // anterior), se pide explícitamente.
      autoUpdater.downloadUpdate().catch(onError)
    })
  }

  onProgress(100)
  // isSilent=false en Windows para que el instalador muestre su progreso;
  // isForceRunAfter reabre la app ya actualizada.
  autoUpdater.quitAndInstall(false, true)
}
