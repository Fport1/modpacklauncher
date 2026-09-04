// Firma ad-hoc del .app en macOS.
//
// Sin un certificado Developer ID, electron-builder no firma nada, y al
// reempaquetar el binario de Electron (icono, Info.plist, extraResources) se
// invalida la firma ad-hoc que traia de origen. En Apple Silicon un binario sin
// firma valida no se puede ejecutar: macOS lo bloquea con "Malware bloqueado"
// sin opcion de abrirlo igualmente.
//
// Firmamos ad-hoc (identidad "-") de dentro hacia fuera. No sustituye a la
// notarizacion: el usuario aun vera el aviso de desarrollador no identificado
// la primera vez, pero podra abrir la app.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function sign(target) {
  execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', target], {
    stdio: 'inherit'
  })
}

function nestedBundles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.app') || name.endsWith('.framework'))
    .map((name) => path.join(dir, name))
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.platform !== 'darwin') {
    console.warn('[mac-adhoc-sign] omitido: codesign solo existe en macOS')
    return
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )

  // Primero los bundles anidados (helpers y frameworks), luego el contenedor.
  for (const bundle of nestedBundles(path.join(appPath, 'Contents', 'Frameworks'))) {
    sign(bundle)
  }
  sign(appPath)

  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
  console.log(`[mac-adhoc-sign] firma ad-hoc aplicada a ${appPath}`)
}
