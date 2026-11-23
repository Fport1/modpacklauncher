import { app } from 'electron'
import { execFile } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs-extra'

/**
 * Linux (AppImage): electron-builder pone la asociación de .fpack y del
 * protocolo modpacklauncher:// en el .desktop que va DENTRO del AppImage, pero
 * el sistema no lo ve salvo que el usuario use AppImageLauncher o similar. Por
 * eso hacer doble clic en un .fpack no abría el launcher en Linux.
 *
 * Al arrancar se escribe (solo si cambió) en ~/.local/share:
 *  - mime/packages/modpacklauncher-fpack.xml: el tipo application/x-fpack para *.fpack
 *  - applications/modpacklauncher.desktop: el launcher, con Exec apuntando al AppImage
 *    (que puede haberse movido desde la última vez) y los tipos que abre
 * y se pide al sistema que lo use por defecto para esos tipos.
 *
 * Con el .deb/.rpm o el AppImage integrado no hace falta, y sin APPIMAGE no se hace nada.
 */
export function registerLinuxIntegration(): void {
  if (process.platform !== 'linux' || !process.env.APPIMAGE) return
  run().catch((e) => console.warn('[Linux] No se pudo registrar la asociación de .fpack:', e instanceof Error ? e.message : e))
}

function quoteExec(arg: string): string {
  const escaped = arg.replace(/([\\"`$])/g, '\\$1').replace(/%/g, '%%')
  return /[\s'"\\`$;&|<>()*?#~]/.test(arg) ? `"${escaped}"` : escaped
}

async function writeIfChanged(file: string, content: string): Promise<boolean> {
  const current = await fs.readFile(file, 'utf8').catch(() => null)
  if (current === content) return false
  await fs.ensureDir(path.dirname(file))
  await fs.writeFile(file, content)
  return true
}

function exec(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => execFile(cmd, args, () => resolve()))
}

async function run(): Promise<void> {
  const appImage = process.env.APPIMAGE as string
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  const mimeDir = path.join(dataHome, 'mime')
  const appsDir = path.join(dataHome, 'applications')

  const mimeXml = `<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-fpack">
    <comment>Modpack fport1</comment>
    <comment xml:lang="es">Modpack fport1</comment>
    <glob pattern="*.fpack"/>
  </mime-type>
</mime-info>
`
  // Icono: el del launcher, copiado fuera del AppImage (su montaje cambia en cada arranque)
  const iconSrc = path.join(process.resourcesPath, 'icons', 'grass_block.png')
  const iconDst = path.join(app.getPath('userData'), 'shortcuts', 'modpacklauncher.png')
  if (await fs.pathExists(iconSrc) && !(await fs.pathExists(iconDst))) {
    await fs.ensureDir(path.dirname(iconDst))
    await fs.copy(iconSrc, iconDst).catch(() => {})
  }

  const desktop = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=ModpackLauncher',
    'Comment=Launcher de Minecraft y modpacks',
    `Exec=${quoteExec(appImage)} %U`,
    ...(await fs.pathExists(iconDst) ? [`Icon=${iconDst}`] : []),
    'Terminal=false',
    'Categories=Game;',
    'MimeType=application/x-fpack;x-scheme-handler/modpacklauncher;',
    'StartupWMClass=ModpackLauncher',
    ''
  ].join('\n')

  const mimeChanged = await writeIfChanged(path.join(mimeDir, 'packages', 'modpacklauncher-fpack.xml'), mimeXml)
  const desktopChanged = await writeIfChanged(path.join(appsDir, 'modpacklauncher.desktop'), desktop)
  if (!mimeChanged && !desktopChanged) return

  // Todo esto es opcional: si falta alguna herramienta se sigue sin ella
  if (mimeChanged) await exec('update-mime-database', [mimeDir])
  await exec('update-desktop-database', [appsDir])
  await exec('xdg-mime', ['default', 'modpacklauncher.desktop', 'application/x-fpack'])
  await exec('xdg-mime', ['default', 'modpacklauncher.desktop', 'x-scheme-handler/modpacklauncher'])
}
