import { execFile, spawn } from 'child_process'
import { shell } from 'electron'
import type { BedrockEdition, BedrockStatus } from '../shared/types'

// Minecraft Bedrock (Minecraft for Windows) desde el launcher, solo en Windows.
//
// El juego lo instala y actualiza la Microsoft Store: aquí solo se mira si
// está instalado, se abre, y para instalar o actualizar se lleva al usuario a
// su página de la Store. La licencia la comprueba el propio juego al abrir.

/** Página de «Minecraft for Windows» en la Microsoft Store. */
const STORE_PRODUCT = '9NBLGGH2JHXJ'
const PREVIEW_PRODUCT = '9P5X4QVLC2XR'

const PACKAGES: Record<BedrockEdition, string> = {
  release: 'Microsoft.MinecraftUWP',
  preview: 'Microsoft.MinecraftWindowsBeta'
}

function powershell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

interface RawPackage { Name: string; Version: string; PackageFamilyName: string; AppId: string | null }

/**
 * Qué ediciones hay instaladas. El identificador de la aplicación se lee del
 * manifiesto: era "App" en la versión UWP y es "Game" desde que Bedrock pasó
 * a GDK en 2025; así funciona con las dos.
 */
export async function bedrockStatus(): Promise<BedrockStatus> {
  if (process.platform !== 'win32') return { supported: false, editions: {} }
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$out = @()
foreach ($n in @('${PACKAGES.release}', '${PACKAGES.preview}')) {
  $p = Get-AppxPackage -Name $n | Select-Object -First 1
  if ($p) {
    $id = $null
    $m = Get-AppxPackageManifest $p
    if ($m) { $id = @($m.Package.Applications.Application)[0].Id }
    $out += [pscustomobject]@{ Name = $p.Name; Version = $p.Version; PackageFamilyName = $p.PackageFamilyName; AppId = $id }
  }
}
ConvertTo-Json -InputObject @($out) -Compress`
  let packages: RawPackage[] = []
  try {
    const raw = (await powershell(script)).trim()
    if (raw) packages = JSON.parse(raw)
  } catch { /* sin PowerShell o sin permisos: como si no estuviera */ }

  const running = await isRunning()
  const editions: BedrockStatus['editions'] = {}
  for (const edition of Object.keys(PACKAGES) as BedrockEdition[]) {
    const pkg = packages.find((p) => p.Name.toLowerCase() === PACKAGES[edition].toLowerCase())
    if (!pkg) continue
    editions[edition] = {
      version: pkg.Version,
      packageFamilyName: pkg.PackageFamilyName,
      appId: pkg.AppId ?? (edition === 'release' ? 'Game' : 'App'),
      running: edition === 'release' ? running : false
    }
  }
  return { supported: true, editions }
}

/** Si el juego está abierto (su proceso se llama igual en UWP y en GDK). */
function isRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq Minecraft.Windows.exe', '/NH'], { windowsHide: true, timeout: 10_000 },
      (err, stdout) => resolve(!err && /Minecraft\.Windows\.exe/i.test(stdout)))
  })
}

/** Abre el juego como lo haría el menú Inicio. */
export async function bedrockLaunch(edition: BedrockEdition): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Minecraft Bedrock solo está disponible en Windows')
  const status = await bedrockStatus()
  const info = status.editions[edition]
  if (!info) throw new Error('Minecraft Bedrock no está instalado')
  try {
    const child = spawn('explorer.exe', [`shell:AppsFolder\\${info.packageFamilyName}!${info.appId}`], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  } catch {
    // Alternativa: el protocolo que registra el juego
    await shell.openExternal(edition === 'preview' ? 'minecraft-preview:' : 'minecraft:')
  }
}

/** Su página en la Store: ahí se instala, se compra o se actualiza. */
export async function bedrockOpenStore(edition: BedrockEdition, updates = false): Promise<void> {
  if (updates) {
    await shell.openExternal('ms-windows-store://downloadsandupdates')
    return
  }
  await shell.openExternal(`ms-windows-store://pdp/?ProductId=${edition === 'preview' ? PREVIEW_PRODUCT : STORE_PRODUCT}`)
}
