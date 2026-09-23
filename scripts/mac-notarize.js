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

/**
 * Minutos que se espera a Apple antes de rendirse.
 *
 * 20 se quedaron cortos: el envio se acepta y se queda "In Progress" mas de
 * ese rato. El escaneo de Apple no tiene tiempo garantizado y se resiente
 * cuando su infraestructura de subida va tocada.
 */
const TIMEOUT = '35m'

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
  } catch (error) {
    // No se aborta la release por esto.
    //
    // La app queda firmada con el Developer ID, que es lo que exige Squirrel
    // para poder autoactualizarse, y macOS la abre con el aviso de
    // desarrollador no identificado — el suave, con su boton de abrir
    // igualmente, no el bloqueo duro de una app sin firma. Sin notarizar es
    // un escalon peor que el ideal, pero quedarse sin poder publicar lo es
    // mucho mas.
    console.warn('══════════════════════════════════════════════════════════')
    console.warn('[notarize] AVISO: la notarizacion no termino a tiempo.')
    console.warn('[notarize] La app va FIRMADA pero SIN NOTARIZAR.')
    console.warn('[notarize] Los usuarios veran el aviso de desarrollador no')
    console.warn('[notarize] identificado la primera vez que la abran.')
    console.warn(`[notarize] Motivo: ${error instanceof Error ? error.message : error}`)
    console.warn('══════════════════════════════════════════════════════════')
  } finally {
    fs.rmSync(zipPath, { force: true })
  }
}
