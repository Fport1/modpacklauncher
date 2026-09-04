// Firma ad-hoc del .app en macOS.
//
// Sin un certificado Developer ID, electron-builder no firma nada, y al
// reempaquetar el binario de Electron (icono, Info.plist, extraResources) se
// invalida la firma ad-hoc que traia de origen. En Apple Silicon un binario sin
// firma valida no se puede ejecutar: macOS lo bloquea con "Malware bloqueado"
// sin opcion de abrirlo igualmente.
//
// Se usa --deep porque codesign se niega a firmar un bundle cuyos
// subcomponentes anidados no estan firmados (Electron Framework contiene
// helpers como chrome_crashpad_handler varios niveles mas abajo). --deep se
// desaconseja cuando cada binario necesita sus propios entitlements o hardened
// runtime; aqui no usamos ninguno de los dos, asi que es el enfoque adecuado.
//
// Esto no sustituye a la notarizacion: el usuario aun vera el aviso de
// desarrollador no identificado la primera vez, pero podra abrir la app.
const { execFileSync } = require('child_process')
const path = require('path')

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

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
    { stdio: 'inherit' }
  )
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })

  console.log(`[mac-adhoc-sign] firma ad-hoc aplicada a ${appPath}`)
}
