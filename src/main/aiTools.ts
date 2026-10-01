import { app } from 'electron'
import { execFile, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AiToolId, AiToolMissing } from '../shared/types'

// Las IAs de terminal que el launcher abre en una instancia: dónde encontrarlas
// aunque no estén en el PATH, cómo abrirlas en una terminal nueva y cómo
// instalarlas si faltan (Windows, macOS y Linux).

export type AiTool = AiToolId

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

interface ToolInfo {
  name: string
  docs: string
  /** Orden de instalación oficial; la de npm necesita Node.js */
  install: { win: string; unix: string; npm?: boolean }
  /** Lo que hace falta después de instalar, si hay algo */
  after?: string
}

export const AI_TOOLS: Record<AiTool, ToolInfo> = {
  claude: {
    name: 'Claude Code',
    docs: 'https://claude.com/claude-code',
    install: { win: 'irm https://claude.ai/install.ps1 | iex', unix: 'curl -fsSL https://claude.ai/install.sh | bash' },
    after: 'La primera vez te pedirá iniciar sesión con tu cuenta de Claude.',
  },
  codex: {
    name: 'Codex',
    docs: 'https://github.com/openai/codex',
    install: { win: 'npm install -g @openai/codex', unix: 'npm install -g @openai/codex', npm: true },
    after: 'La primera vez te pedirá iniciar sesión con tu cuenta de ChatGPT.',
  },
  gemini: {
    name: 'Gemini CLI',
    docs: 'https://github.com/google-gemini/gemini-cli',
    install: { win: 'npm install -g @google/gemini-cli', unix: 'npm install -g @google/gemini-cli', npm: true },
    after: 'La primera vez te pedirá iniciar sesión con tu cuenta de Google.',
  },
  grok: {
    name: 'Grok CLI',
    docs: 'https://github.com/superagent-ai/grok-cli',
    install: { win: 'npm install -g @vibe-kit/grok-cli', unix: 'npm install -g @vibe-kit/grok-cli', npm: true },
    after: 'Necesita tu clave de la API de xAI (console.x.ai): te la pedirá al abrirlo.',
  },
}

const exists = (p: string): boolean => { try { return fs.statSync(p).isFile() } catch { return false } }

const inPath = (cmd: string): Promise<boolean> =>
  new Promise((res) => execFile(isWin ? 'where' : 'which', [cmd], (err) => res(!err)))

/** Carpetas donde suelen quedar las IAs y npm aunque no estén en el PATH del launcher. */
function knownDirs(): string[] {
  const home = os.homedir()
  if (isWin) {
    return [
      path.join(home, '.local', 'bin'),                    // instalador oficial de Claude Code
      path.join(app.getPath('appData'), 'npm'),            // npm install -g
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'),
    ]
  }
  // En macOS una app abierta desde el Finder no hereda el PATH de la terminal:
  // sin esto no encontraría nada de Homebrew ni de npm aunque esté instalado
  return [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global', 'bin'), path.join(home, '.volta', 'bin'), '/usr/bin']
}

/** Claude Code que trae la app de escritorio de Claude (el de la versión más nueva). */
function desktopClaudeCode(): string | null {
  const base = path.join(app.getPath('appData'), 'Claude', 'claude-code')
  let versions: string[] = []
  try { versions = fs.readdirSync(base) } catch { return null }
  const num = (v: string): number[] => v.split('.').map((x) => parseInt(x, 10) || 0)
  versions.sort((a, b) => { const x = num(a), y = num(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0); return 0 })
  for (const v of versions) {
    const p = path.join(base, v, isWin ? 'claude.exe' : 'claude')
    if (exists(p)) return p
  }
  return null
}

/**
 * Cómo lanzar un programa: su nombre si está en el PATH, o su ruta completa si
 * está instalado en otro sitio conocido. null si no está en este equipo.
 */
export async function resolveCommand(cmd: string): Promise<string | null> {
  if (await inPath(cmd)) return cmd
  const names = isWin ? [`${cmd}.exe`, `${cmd}.cmd`] : [cmd]
  for (const dir of knownDirs()) for (const n of names) if (exists(path.join(dir, n))) return path.join(dir, n)
  if (cmd === 'claude') return desktopClaudeCode()
  return null
}

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
const appleScriptString = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Abre una terminal nueva (visible) que ejecuta `command` en `cwd`. */
export async function openInTerminal(opts: { title: string; cwd: string; win: string; unix: string; powershell?: boolean }): Promise<void> {
  if (isWin) {
    const title = opts.title.replace(/[&|<>^"%]/g, '')
    const args = opts.powershell
      ? ['/c', 'start', `"${title}"`, 'powershell.exe', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', `"${opts.win.replace(/"/g, '\\"')}"`]
      : ['/c', 'start', `"${title}"`, 'cmd.exe', '/k', opts.win]
    spawn('cmd.exe', args, { cwd: opts.cwd, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref()
    return
  }
  const line = `cd ${shQuote(opts.cwd)} && ${opts.unix}`
  if (isMac) {
    spawn('osascript', ['-e', `tell application "Terminal" to do script ${appleScriptString(line)}`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  // Linux: la primera terminal que haya
  const shell = `${line}; exec "\${SHELL:-sh}"`
  const terms: [string, string[]][] = [
    ['x-terminal-emulator', ['-e', 'sh', '-c', shell]],
    ['gnome-terminal', ['--', 'sh', '-c', shell]],
    ['konsole', ['-e', 'sh', '-c', shell]],
    ['xfce4-terminal', ['-x', 'sh', '-c', shell]],
    ['kitty', ['sh', '-c', shell]],
    ['alacritty', ['-e', 'sh', '-c', shell]],
    ['xterm', ['-e', 'sh', '-c', shell]],
  ]
  for (const [bin, args] of terms) {
    if (await inPath(bin)) { spawn(bin, args, { detached: true, stdio: 'ignore' }).unref(); return }
  }
  throw new Error('No se encontró ninguna terminal en este equipo. Abre una y ejecuta: ' + opts.unix)
}

type ToolMissing = AiToolMissing

/** Qué falta para usar una IA y cómo instalarla en este sistema. */
export async function toolMissing(tool: AiTool): Promise<ToolMissing> {
  const t = AI_TOOLS[tool]
  return {
    tool, name: t.name, docs: t.docs,
    command: isWin ? t.install.win : t.install.unix,
    needsNode: !!t.install.npm && !(await resolveCommand('npm')),
    after: t.after,
  }
}

/** Abre una terminal que instala la IA con su orden oficial. */
export async function installTool(tool: AiTool): Promise<ToolMissing> {
  const info = await toolMissing(tool)
  if (info.needsNode) return info
  const t = AI_TOOLS[tool]
  // npm puede estar instalado fuera del PATH del launcher (recién instalado Node, o macOS desde el Finder)
  let win = t.install.win, unix = t.install.unix
  if (t.install.npm) {
    const npm = await resolveCommand('npm')
    if (npm && npm !== 'npm') {
      win = win.replace(/^npm /, `"${npm}" `)
      unix = `PATH=${shQuote(path.dirname(npm))}:"$PATH" ${unix.replace(/^npm /, `${shQuote(npm)} `)}`
    }
  }
  await openInTerminal({ title: `Instalar ${t.name}`, cwd: os.homedir(), win, unix, powershell: isWin && !t.install.npm })
  return info
}
