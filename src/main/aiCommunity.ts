import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { gameEvents } from './launcher'
import { getInstance, getInstanceGameDir } from './instances'
import { fsCommit, fsRunQuery, fsValue } from './firestoreRest'
import type { Instance } from '../shared/types'

// Aprendizaje colectivo de la IA (se puede desactivar en Ajustes › Privacidad).
//
// 1. Cada crash deja una HUELLA anónima en crash_signatures/{hash}: el tipo de
//    error, los mods implicados, versión de Minecraft y loader, y cuántas veces
//    ha pasado. Sin rutas, nombres ni nada del equipo.
// 2. Cuando una IA arregla algo, la LECCIÓN (síntoma, causa, arreglo, mods) se
//    comparte en ai_lessons, ligada a la huella del crash que resolvió.
// 3. Cuando otra instancia crashea con la misma huella (o con los mismos mods),
//    la IA recibe primero las lecciones que ya funcionaron. Después de probar
//    una, la IA la valora: funcionó / no funcionó. Las buenas suben y las malas
//    bajan, así que el conocimiento mejora solo, sin que nadie lo revise.
//
// Todo el texto pasa por sanitize() antes de salir del equipo.

let enabled = false
let playerNames: () => string[] = () => []
const lastSig = new Map<string, string>() // instancia → huella del último crash

export function setAiLearningEnabled(on: boolean): void { enabled = on }
export function aiLearningEnabled(): boolean { return enabled }

/** Quita de un texto todo lo que pueda identificar a la persona o a su equipo. */
export function sanitize(text: string, max = 600): string {
  let s = String(text ?? '')
  const home = os.homedir()
  const user = os.userInfo().username
  const esc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (home) s = s.replace(new RegExp(esc(home).replace(/\\\\/g, '[\\\\/]'), 'gi'), '~')
  for (const n of [user, ...playerNames()].filter((x) => x && x.length >= 3)) s = s.replace(new RegExp(`\\b${esc(n)}\\b`, 'gi'), '<nombre>')
  s = s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<correo>')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, '<ip>')
    .replace(/\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<token>')
    // Las rutas se quedan solo con el nombre del archivo (las carpetas pueden llevar nombres de instancias o mundos)
    .replace(/(?:[A-Za-z]:|~)[\\/](?:[^\\/\n:*?"<>|]+[\\/])+/g, '<ruta>/')
    .replace(/\/(?:home|Users)\/[^/\s]+(?:\/[^/\s]+)*\//g, '<ruta>/')
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** Huella de un crash: el error y los mods, sin números, rutas ni datos del equipo. */
export function crashSignature(crash: string): { sig: string; hash: string; mods: string[] } {
  const lines = crash.split(/\r?\n/)
  const desc = lines.find((l) => /^Description:/i.test(l))?.replace(/^Description:\s*/i, '') ?? ''
  const exc = lines.find((l) => /^\s*([\w$.]+(Exception|Error)|Caused by:)/.test(l)) ?? ''
  const causes = lines.filter((l) => /^\s*Caused by:/.test(l)).slice(-1)[0] ?? ''
  const mods = new Set<string>()
  // NeoForge/Forge: «Suspected Mods: Xyz (xyz), …»; Fabric: «mod xyz»
  for (const l of lines) {
    const m = l.match(/Suspected Mods?:\s*(.+)/i)
    if (m) for (const id of m[1].matchAll(/\(([a-z0-9_.-]+)\)/g)) mods.add(id[1])
    const f = l.match(/Mod ID:\s*'?([a-z0-9_.-]+)/i)
    if (f) mods.add(f[1].toLowerCase())
  }
  const norm = (x: string): string => sanitize(x, 300).replace(/\d+/g, '#').replace(/@[0-9a-f]+/gi, '').replace(/\s+/g, ' ').trim()
  const sig = [norm(desc), norm(exc), norm(causes)].filter(Boolean).join(' | ').slice(0, 500)
  const hash = crypto.createHash('sha1').update(sig + '|' + [...mods].sort().join(',')).digest('hex').slice(0, 24)
  return { sig, hash, mods: [...mods].slice(0, 10) }
}

async function latestCrashText(gameDir: string, since: number): Promise<string | null> {
  const dir = path.join(gameDir, 'crash-reports')
  const names = await fs.readdir(dir).catch(() => [] as string[])
  let best: { f: string; t: number } | null = null
  for (const n of names) {
    const st = await fs.stat(path.join(dir, n)).catch(() => null)
    if (st && st.mtimeMs >= since && (!best || st.mtimeMs > best.t)) best = { f: path.join(dir, n), t: st.mtimeMs }
  }
  return best ? fs.readFile(best.f, 'utf8').catch(() => null) : null
}

/** Registra la huella de un crash (siempre en local; en la nube si se permite). */
export async function reportCrash(inst: Instance, crash: string): Promise<{ sig: string; hash: string; mods: string[] }> {
  const s = crashSignature(crash)
  lastSig.set(inst.id, s.hash)
  if (enabled && s.sig) {
    await fsCommit([{
      path: `crash_signatures/${s.hash}`,
      set: { sig: s.sig, mods: s.mods, mc: inst.minecraft, loader: inst.modloader },
      inc: { count: 1 },
      now: ['lastSeen'],
    }]).catch(() => {})
  }
  return s
}

export interface CommunityLesson { id: string; title: string; symptom: string; cause: string; fix: string; mods: string[]; mc: string; loader: string; worked: number; failed: number; sameCrash: boolean }

/** Lecciones de otros jugadores que encajan con esta instancia, las más útiles primero. */
export async function findLessons(inst: Instance, opts: { sig?: string; mods?: string[] } = {}): Promise<CommunityLesson[]> {
  if (!enabled) return []
  const sig = opts.sig ?? lastSig.get(inst.id)
  const docs = await fsRunQuery('', 'ai_lessons', [{ field: 'loader', op: 'EQUAL', value: fsValue(inst.modloader) }], { limit: 300 }).catch(() => [])
  const mine = new Set(opts.mods ?? [])
  const major = inst.minecraft.split('.').slice(0, 2).join('.')
  return docs
    .map(({ id, data: d }) => {
      const mods = (d.mods ?? []) as string[]
      const sameCrash = !!sig && d.sig === sig
      const overlap = mods.filter((m) => mine.has(m)).length
      const worked = Number(d.worked ?? 0), failed = Number(d.failed ?? 0)
      const score = (sameCrash ? 100 : 0) + (d.mc === inst.minecraft ? 10 : String(d.mc ?? '').startsWith(major) ? 5 : 0) + overlap * 6 + worked * 2 - failed * 3
      return { id, title: d.title, symptom: d.symptom, cause: d.cause, fix: d.fix, mods, mc: d.mc, loader: d.loader, worked, failed, sameCrash, score, overlap }
    })
    .filter((l) => (l.sameCrash || l.overlap > 0) && l.failed <= l.worked + 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score: _s, overlap: _o, ...l }) => l)
}

/** Comparte una lección aprendida (ya saneada) ligada al último crash de la instancia. */
export async function shareLesson(inst: Instance, l: { title: string; symptom: string; cause: string; fix: string; mods?: string }): Promise<string | null> {
  if (!enabled) return null
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20)
  const mods = String(l.mods ?? '').toLowerCase().split(/[\s,;]+/).filter((m) => /^[a-z0-9_.-]{2,64}$/.test(m)).slice(0, 10)
  try {
    await fsCommit([{
      path: `ai_lessons/${id}`,
      set: {
        title: sanitize(l.title, 120), symptom: sanitize(l.symptom), cause: sanitize(l.cause), fix: sanitize(l.fix),
        mods, mc: inst.minecraft, loader: inst.modloader, sig: lastSig.get(inst.id) ?? '', v: app.getVersion(), worked: 0, failed: 0,
      },
      now: ['created'],
      mustNotExist: true,
    }])
    return id
  } catch { return null }
}

/** La IA dice si una lección de la comunidad le sirvió: así se ordenan solas. */
export async function rateLesson(id: string, worked: boolean): Promise<void> {
  if (!enabled || !/^[A-Za-z0-9]{8,40}$/.test(id)) return
  await fsCommit([{ path: `ai_lessons/${id}`, set: {}, inc: { [worked ? 'worked' : 'failed']: 1 } }]).catch(() => {})
}

/** Huella del último crash de una instancia (para ligar la lección que lo arregle). */
export function lastCrashSig(instanceId: string): string | undefined { return lastSig.get(instanceId) }

export function startAiCommunity(opts: { enabled: boolean; playerNames: () => string[] }): void {
  enabled = opts.enabled
  playerNames = opts.playerNames
  // Cualquier crash (con o sin IA) aporta su huella
  const started = new Map<string, number>()
  gameEvents.on('start', (id: string) => started.set(id, Date.now()))
  gameEvents.on('exit', async (id: string, code: number | null) => {
    const t0 = started.get(id) ?? 0
    started.delete(id)
    if (code === 0 || code === null) return
    const inst = await getInstance(id)
    if (!inst) return
    const text = await latestCrashText(await getInstanceGameDir(id), t0)
    if (text) await reportCrash(inst, text)
  })
}
