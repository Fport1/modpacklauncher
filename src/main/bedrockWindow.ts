import { app } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs-extra'
import path from 'path'
import type { BedrockWindowSettings } from '../shared/types'

// Bedrock en ventana con una resolución exacta (para pantallas con medidas
// poco comunes y para OBS). Bedrock no tiene opción de resolución: se le quita
// la pantalla completa en su options.txt y, al abrirse, el launcher coloca su
// ventana con la API de Windows (SetWindowPos) para que el ÁREA DE JUEGO mida
// justo lo pedido, contando el marco de la ventana y el escalado de pantalla.
// Sin bordes, la ventana entera es el área de juego (lo más cómodo para OBS).

export type { BedrockWindowSettings }

export const DEFAULT_WINDOW: BedrockWindowSettings = { enabled: false, width: 1920, height: 1080, borderless: false, position: 'center' }

// BEDROCK_WINDOW_PROCESS solo lo usan las pruebas (otra ventana en vez de Bedrock)
const PROCESS = (process.env.BEDROCK_WINDOW_PROCESS || 'Minecraft.Windows').replace(/[^\w.-]/g, '')

const settingsFile = (): string => path.join(app.getPath('userData'), 'bedrock-window.json')

export async function getBedrockWindowSettings(): Promise<BedrockWindowSettings> {
  return { ...DEFAULT_WINDOW, ...(await fs.readJson(settingsFile()).catch(() => ({}))) }
}

export async function setBedrockWindowSettings(s: BedrockWindowSettings): Promise<BedrockWindowSettings> {
  const clean: BedrockWindowSettings = {
    enabled: !!s.enabled,
    width: Math.max(320, Math.min(16384, Math.round(Number(s.width) || 1920))),
    height: Math.max(240, Math.min(16384, Math.round(Number(s.height) || 1080))),
    borderless: !!s.borderless,
    position: s.position === 'topleft' ? 'topleft' : typeof s.position === 'object' && s.position ? { x: Math.round(Number(s.position.x) || 0), y: Math.round(Number(s.position.y) || 0) } : 'center',
  }
  await fs.outputJson(settingsFile(), clean, { spaces: 2 })
  return clean
}

/** options.txt de Bedrock: GDK (desde 2025) por usuario, y la ruta antigua de UWP. */
async function optionsFiles(): Promise<string[]> {
  const out: string[] = []
  const gdk = path.join(app.getPath('appData'), 'Minecraft Bedrock', 'Users')
  for (const u of await fs.readdir(gdk).catch(() => [] as string[])) {
    const f = path.join(gdk, u, 'games', 'com.mojang', 'minecraftpe', 'options.txt')
    if (await fs.pathExists(f)) out.push(f)
  }
  const uwp = path.join(process.env.LOCALAPPDATA ?? '', 'Packages', 'Microsoft.MinecraftUWP_8wekyb3d8bbwe', 'LocalState', 'games', 'com.mojang', 'minecraftpe', 'options.txt')
  if (await fs.pathExists(uwp)) out.push(uwp)
  return out
}

/** Quita la pantalla completa para que arranque en ventana (con el juego cerrado). */
export async function disableBedrockFullscreen(): Promise<number> {
  let changed = 0
  for (const f of await optionsFiles()) {
    const t = await fs.readFile(f, 'utf8').catch(() => '')
    if (/^gfx_fullscreen:1\s*$/m.test(t)) { await fs.writeFile(f, t.replace(/^gfx_fullscreen:1\s*$/m, 'gfx_fullscreen:0')); changed++ }
  }
  return changed
}

// C# que se compila al vuelo en PowerShell: busca la ventana de Minecraft.Windows,
// ajusta estilo, tamaño y posición, y devuelve el tamaño real del área de juego.
const CSHARP = `
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class BW {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern bool AdjustWindowRectExForDpi(ref RECT r, int st, bool m, int ex, uint dpi);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO i);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  public static IntPtr Find(string name) {
    foreach (var p in Process.GetProcessesByName(name)) { if (p.MainWindowHandle != IntPtr.Zero) return p.MainWindowHandle; }
    return IntPtr.Zero;
  }
  public static string Apply(string name, int w, int h, bool borderless, int mode, int px, int py) {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    IntPtr hwnd = Find(name);
    if (hwnd == IntPtr.Zero) return "NOWINDOW";
    if (IsZoomed(hwnd)) ShowWindow(hwnd, 9);
    const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
    int style = GetWindowLong(hwnd, GWL_STYLE);
    const int WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000, WS_SYSMENU = 0x00080000, WS_MINBOX = 0x00020000, WS_MAXBOX = 0x00010000;
    int frame = WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINBOX | WS_MAXBOX;
    style = borderless ? (style & ~frame) : (style | frame);
    SetWindowLong(hwnd, GWL_STYLE, style);
    int ex = GetWindowLong(hwnd, GWL_EXSTYLE);
    RECT r = new RECT { L = 0, T = 0, R = w, B = h };
    uint dpi = GetDpiForWindow(hwnd); if (dpi == 0) dpi = 96;
    if (!borderless) AdjustWindowRectExForDpi(ref r, style, false, ex, dpi);
    int ow = r.R - r.L, oh = r.B - r.T;
    MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref mi);
    int x, y;
    if (mode == 0) { x = mi.rcWork.L + Math.Max(0, ((mi.rcWork.R - mi.rcWork.L) - ow) / 2); y = mi.rcWork.T + Math.Max(0, ((mi.rcWork.B - mi.rcWork.T) - oh) / 2); }
    else if (mode == 1) { x = mi.rcMonitor.L; y = mi.rcMonitor.T; }
    else { x = px; y = py; }
    // SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOZORDER
    SetWindowPos(hwnd, IntPtr.Zero, x, y, ow, oh, 0x0020 | 0x0040 | 0x0004);
    RECT c; GetClientRect(hwnd, out c);
    return "OK " + (c.R - c.L) + "x" + (c.B - c.T) + " dpi" + dpi;
  }
}`

function runPs(script: string, timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error(stderr?.trim() || err.message)) : resolve(stdout.trim())))
  })
}

export interface ApplyResult { ok: boolean; message: string; clientWidth?: number; clientHeight?: number }

/** Coloca la ventana de Bedrock (si está abierta). */
export async function applyBedrockWindow(s: BedrockWindowSettings): Promise<ApplyResult> {
  if (process.platform !== 'win32') return { ok: false, message: 'Solo en Windows' }
  const mode = s.position === 'center' ? 0 : s.position === 'topleft' ? 1 : 2
  const pos = typeof s.position === 'object' ? s.position : { x: 0, y: 0 }
  // El C# va en una here-string literal de PowerShell (sin interpolar)
  const script = `Add-Type -TypeDefinition @'\n${CSHARP}\n'@ -Language CSharp\n[BW]::Apply('${PROCESS}', ${s.width}, ${s.height}, $${s.borderless ? 'true' : 'false'}, ${mode}, ${pos.x}, ${pos.y})`
  const out = await runPs(script)
  if (out.includes('NOWINDOW')) return { ok: false, message: 'Bedrock no está abierto (o aún no ha creado su ventana).' }
  const m = /OK (\d+)x(\d+)/.exec(out)
  if (!m) return { ok: false, message: `No se pudo colocar la ventana: ${out.slice(0, 200)}` }
  const cw = Number(m[1]), ch = Number(m[2])
  const exact = cw === s.width && ch === s.height
  return {
    ok: true, clientWidth: cw, clientHeight: ch,
    message: exact ? `Ventana de Bedrock a ${cw}×${ch}${s.borderless ? ' sin bordes' : ''}.` : `Ventana colocada, pero el área de juego quedó en ${cw}×${ch} (Windows no la deja más grande que la pantalla o Bedrock la ajustó).`,
  }
}

let waiting = false

/**
 * Tras abrir Bedrock: espera a que aparezca su ventana y la coloca. Bedrock
 * cambia su tamaño mientras carga, así que se vuelve a comprobar unos segundos
 * después y se corrige si hace falta.
 */
export async function placeBedrockWindowAfterLaunch(onDone?: (r: ApplyResult) => void): Promise<void> {
  const s = await getBedrockWindowSettings()
  if (!s.enabled || waiting) return
  waiting = true
  try {
    let last: ApplyResult = { ok: false, message: 'Bedrock no llegó a abrir su ventana.' }
    const until = Date.now() + 120_000
    let placedAt = 0
    let corrections = 0
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, placedAt ? 4000 : 2000))
      const r = await applyBedrockWindow(s).catch((e) => ({ ok: false, message: String(e?.message ?? e) } as ApplyResult))
      if (!r.ok) { if (placedAt) break; continue }
      last = r
      if (!placedAt) placedAt = Date.now()
      else if (r.clientWidth === s.width && r.clientHeight === s.height && ++corrections >= 2) break
      if (Date.now() - placedAt > 25_000) break
    }
    onDone?.(last)
  } finally { waiting = false }
}
