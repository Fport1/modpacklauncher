// Compila el programa auxiliar en Rust (native/) y lo deja en native/dist/, que es lo que
// electron-builder mete en el instalador (extraResources → resources/native/).
//
// En macOS se compila para Intel y Apple Silicon y se juntan en un binario universal, porque
// el mismo job saca los dos DMG. Sin Rust instalado avisa y no hace nada: el launcher
// funciona igual, solo que todo en JavaScript.

const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'native')
const dist = path.join(root, 'dist')
const exe = process.platform === 'win32' ? 'fport1-native.exe' : 'fport1-native'

const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' })
if (cargo.status !== 0) {
  console.warn('[build-native] No hay Rust (cargo): el launcher irá sin el programa auxiliar.')
  process.exit(0)
}

const run = (args) => execFileSync('cargo', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
fs.mkdirSync(dist, { recursive: true })

if (process.platform === 'darwin') {
  const targets = ['aarch64-apple-darwin', 'x86_64-apple-darwin']
  for (const t of targets) run(['build', '--release', '--target', t])
  execFileSync('lipo', ['-create', ...targets.map((t) => path.join(root, 'target', t, 'release', exe)), '-output', path.join(dist, exe)], { stdio: 'inherit' })
} else {
  run(['build', '--release'])
  fs.copyFileSync(path.join(root, 'target', 'release', exe), path.join(dist, exe))
}
if (process.platform !== 'win32') fs.chmodSync(path.join(dist, exe), 0o755)
console.log(`[build-native] Listo: ${path.join(dist, exe)}`)
