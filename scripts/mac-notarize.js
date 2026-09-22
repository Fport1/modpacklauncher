// Notarización del .app, en el hook afterSign.
//
// electron-builder delega en @electron/notarize, que llama a `notarytool submit
// --wait` SIN `--timeout`. Si Apple no responde, el proceso espera
// indefinidamente: en un caso real se quedó 43 minutos dentro de submit hasta
// que el job murió por timeout, sin imprimir ni un error. Y electron-builder no
// deja pasar esa opción.
//
// Haciéndolo aquí se puede acotar la espera y ver la salida real de notarytool.
// afterSign es el momento correcto: ya está firmado y todavía no se han
// construido el DMG ni el ZIP, así que el grapado entra en ambos.
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

/** Minutos que se espera a Apple antes de rendirse. */
const TIMEOUT = '20m'

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' })
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.platform !== 'darwin') return

  // Nombres propios a proposito: con APPLE_API_KEY* en el entorno,
  // electron-builder activa su notarizacion por su cuenta (sin necesidad de
  // notarize: true), corre antes que este hook y se cuelga sin timeout.
  const { NOTARY_KEY: APPLE_API_KEY, NOTARY_KEY_ID: APPLE_API_KEY_ID, NOTARY_ISSUER: APPLE_API_ISSUER } = process.env
  if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) {
    console.log('[notarize] omitido: faltan las credenciales de App Store Connect')
    return
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )
  const zipPath = path.join(os.tmpdir(), `notarize-${Date.now()}.zip`)

  console.log(`[notarize] comprimiendo ${appPath}`)
  run('ditto', ['-c', '-k', '--keepParent', appPath, zipPath])

  try {
    console.log(`[notarize] enviando a Apple (timeout ${TIMEOUT})...`)
    run('xcrun', [
      'notarytool', 'submit', zipPath,
      '--key', APPLE_API_KEY,
      '--key-id', APPLE_API_KEY_ID,
      '--issuer', APPLE_API_ISSUER,
      '--wait',
      '--timeout', TIMEOUT
    ])

    // Grapar el ticket al bundle: así la app se abre sin consultar a Apple,
    // y funciona aunque el usuario no tenga conexión la primera vez.
    console.log('[notarize] grapando el ticket')
    run('xcrun', ['stapler', 'staple', appPath])
    run('xcrun', ['stapler', 'validate', appPath])
    console.log('[notarize] listo')
  } finally {
    fs.rmSync(zipPath, { force: true })
  }
}
