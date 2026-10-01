import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { gameEvents } from './launcher'
import { getInstance, getInstanceGameDir, listMods } from './instances'
import { worldInfo } from './gameKnowledge'
import { fsCommit, fsRunQuery, fsValue } from './firestoreRest'
import type { Instance } from '../shared/types'
import { getSamples, outcomeDoc, summarizeSamples, type LiveOutcome, type LiveSample } from './liveData'

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
//    Las lecciones no son solo de crashes: también de configs, compatibilidad,
//    construcción (datapacks, packs, shaders, mods), mundo, rendimiento y mecánicas.
// 4. Cada PARTIDA deja un resumen (play_sessions): mods, cómo es el mundo, qué
//    pasó y cómo fue el rendimiento. Con eso la IA sabe cómo se comporta el
//    juego con cada mod (experiencia_comunidad) sin haberlo probado ella.
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

export const LESSON_KINDS = ['crash', 'config', 'compatibilidad', 'construccion', 'mundo', 'rendimiento', 'mecanica'] as const
export type LessonKind = typeof LESSON_KINDS[number]

export interface CommunityLesson { id: string; kind: string; title: string; symptom: string; cause: string; fix: string; mods: string[]; mc: string; loader: string; worked: number; failed: number; sameCrash: boolean }

const words = (s: string): Set<string> => new Set(String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9_]+/).filter((w) => w.length > 3))

/**
 * Lecciones de otros jugadores que encajan con esta instancia, las más útiles primero.
 * Encajan por el mismo crash, por mods en común, por tipo (construcción, mundo…) y por palabras del tema.
 */
export async function findLessons(inst: Instance, opts: { sig?: string; mods?: string[]; kind?: string; tema?: string } = {}): Promise<CommunityLesson[]> {
  if (!enabled) return []
  const sig = opts.sig ?? lastSig.get(inst.id)
  // Mismo loader (lo de mods) y misma versión de Minecraft (lo de datapacks, packs y mecánicas vale con cualquier loader)
  const [byLoader, byMc] = await Promise.all([
    fsRunQuery('', 'ai_lessons', [{ field: 'loader', op: 'EQUAL', value: fsValue(inst.modloader) }], { limit: 300 }).catch(() => []),
    fsRunQuery('', 'ai_lessons', [{ field: 'mc', op: 'EQUAL', value: fsValue(inst.minecraft) }], { limit: 300 }).catch(() => []),
  ])
  const docs = [...new Map([...byLoader, ...byMc].map((d) => [d.id, d])).values()]
  const mine = new Set(opts.mods ?? [])
  const topic = words(opts.tema ?? '')
  const major = inst.minecraft.split('.').slice(0, 2).join('.')
  return docs
    .map(({ id, data: d }) => {
      const mods = (d.mods ?? []) as string[]
      const kind = String(d.kind ?? 'crash')
      const sameCrash = !!sig && d.sig === sig
      const overlap = mods.filter((m) => mine.has(m)).length
      const text = words(`${d.title} ${d.symptom} ${d.cause} ${d.fix}`)
      const topicHits = [...topic].filter((w) => text.has(w)).length
      const worked = Number(d.worked ?? 0), failed = Number(d.failed ?? 0)
      const versionMatch = d.mc === inst.minecraft ? 10 : String(d.mc ?? '').startsWith(major) ? 5 : 0
      const score = (sameCrash ? 100 : 0) + (opts.kind && kind === opts.kind ? 20 : 0) + topicHits * 8 + versionMatch + overlap * 6 + worked * 2 - failed * 3
      const relevant = sameCrash || overlap > 0 || topicHits > 0 || (!!opts.kind && kind === opts.kind && versionMatch > 0)
      return { id, kind, title: d.title, symptom: d.symptom, cause: d.cause, fix: d.fix, mods, mc: d.mc, loader: d.loader, worked, failed, sameCrash, score, relevant }
    })
    .filter((l) => l.relevant && l.failed <= l.worked + 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ score: _s, relevant: _r, ...l }) => l)
}

/** Comparte una lección aprendida (ya saneada), ligada al último crash si es de crash. */
export async function shareLesson(inst: Instance, l: { kind?: string; title: string; symptom: string; cause: string; fix: string; mods?: string }): Promise<string | null> {
  if (!enabled) return null
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20)
  const mods = String(l.mods ?? '').toLowerCase().split(/[\s,;]+/).filter((m) => /^[a-z0-9_.-]{2,64}$/.test(m)).slice(0, 10)
  const kind = (LESSON_KINDS as readonly string[]).includes(String(l.kind)) ? String(l.kind) : 'crash'
  try {
    await fsCommit([{
      path: `ai_lessons/${id}`,
      set: {
        kind, title: sanitize(l.title, 120), symptom: sanitize(l.symptom), cause: sanitize(l.cause), fix: sanitize(l.fix),
        mods, mc: inst.minecraft, loader: inst.modloader, sig: kind === 'crash' ? lastSig.get(inst.id) ?? '' : '', v: app.getVersion(), worked: 0, failed: 0,
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

// ── Partidas: cómo se comporta el juego con cada combinación de mods ─────────
//
// Al cerrar el juego se resume la partida, sin nada personal: mods activos
// (ids), versión y loader, el mundo jugado (dimensiones, cómo se generan,
// modo, dificultad, reglas), qué pasó en esa partida (mobs matados, muertes,
// minutos) y cómo fue el rendimiento (tiempo de carga, avisos de lag, errores
// por mod, crash). Nunca: nombre del mundo, semilla, coordenadas, nombres de
// jugadores, chat, carteles ni libros.

type StatsSnap = Record<string, Record<string, number>>
const statsAtStart = new Map<string, Map<string, StatsSnap>>() // instancia → mundo → stats

async function readWorldStats(worldDir: string): Promise<StatsSnap> {
  const out: StatsSnap = {}
  // 26.1+ guarda las estadísticas en players/stats; antes, en stats/
  const dir = (await fs.pathExists(path.join(worldDir, 'players', 'stats'))) ? path.join(worldDir, 'players', 'stats') : path.join(worldDir, 'stats')
  for (const f of (await fs.readdir(dir).catch(() => [] as string[])).filter((x) => x.endsWith('.json'))) {
    const s = (await fs.readJson(path.join(dir, f)).catch(() => ({}))).stats ?? {}
    for (const [cat, vals] of Object.entries(s as StatsSnap)) {
      const c = (out[cat.replace('minecraft:', '')] ??= {})
      for (const [k, v] of Object.entries(vals)) c[k] = (c[k] ?? 0) + Number(v)
    }
  }
  return out
}

function delta(after: StatsSnap, before: StatsSnap | undefined, cat: string, n: number): Record<string, number> {
  const a = after[cat] ?? {}, b = before?.[cat] ?? {}
  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k.replace('minecraft:', ''), v - (b[k] ?? 0)] as [string, number]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, n))
}

const cleanId = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_.:/-]/g, '').slice(0, 80)

/** Rendimiento de la partida leído del log: carga, lag, errores y avisos por origen. */
function logSignals(log: string): { loadSeconds: number | null; lagWarnings: number; errors: number; warnings: number; noisy: Record<string, number> } {
  const lines = log.split(/\r?\n/)
  // Vanilla/Fabric: [12:00:00] …; NeoForge/Forge: [29sep.2026 12:00:00.123] …
  const ts = (l: string): number | null => { const m = /^\[[^\]]*?(\d\d):(\d\d):(\d\d)/.exec(l); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null }
  const t0 = lines.map(ts).find((x) => x !== null) ?? null
  const readyLine = lines.find((l) => /Sound engine started|Loaded \d+ advancements|Preparing spawn area/.test(l))
  const t1 = readyLine ? ts(readyLine) : null
  const noisy: Record<string, number> = {}
  let errors = 0, warnings = 0, lagWarnings = 0
  for (const l of lines) {
    // Origen del aviso: NeoForge lo pone entre corchetes ([modid/]), Fabric entre paréntesis ((Logger)), vanilla no lo pone
    const m = /\/(WARN|ERROR|FATAL)\](?: \[([^\]/]+)\/?[^\]]*\]| \(([^)\s]+)\))?/.exec(l)
    if (!m) continue
    if (m[1] === 'WARN') warnings++; else errors++
    if (/Can't keep up!/.test(l)) lagWarnings++
    // Solo se cuentan por origen los avisos que dicen de dónde vienen (muchos logs no lo ponen)
    const raw = m[2] ?? m[3]
    const src = raw ? cleanId(raw.split('/')[0]) : ''
    if (src) noisy[src] = (noisy[src] ?? 0) + 1
  }
  return {
    loadSeconds: t0 !== null && t1 !== null ? ((t1 - t0 + 86400) % 86400) : null,
    lagWarnings, errors, warnings,
    noisy: Object.fromEntries(Object.entries(noisy).sort((a, b) => b[1] - a[1]).slice(0, 12)),
  }
}

async function reportSession(inst: Instance, t0: number, code: number | null): Promise<void> {
  if (!enabled) return
  const gameDir = await getInstanceGameDir(inst.id)
  const mods = [...new Set((await listMods(inst.id).catch(() => [])).filter((m) => m.enabled).flatMap((m) => m.meta?.modIds ?? []))]
    .map(cleanId).filter((m) => /^[a-z0-9_.-]{2,64}$/.test(m)).slice(0, 150)
  // El mundo jugado: el que más recientemente se guardó durante la partida
  let world: Record<string, unknown> | undefined
  const saves = path.join(gameDir, 'saves')
  let best: { name: string; t: number } | null = null
  for (const n of await fs.readdir(saves).catch(() => [] as string[])) {
    const st = await fs.stat(path.join(saves, n, 'level.dat')).catch(() => null)
    if (st && st.mtimeMs >= t0 && (!best || st.mtimeMs > best.t)) best = { name: n, t: st.mtimeMs }
  }
  if (best) {
    try {
      const info = await worldInfo(inst, best.name) as Record<string, any>
      const after = await readWorldStats(path.join(saves, best.name))
      const before = statsAtStart.get(inst.id)?.get(best.name)
      const played = (after.custom?.['minecraft:play_time'] ?? after.custom?.['minecraft:play_one_minute'] ?? 0) - (before?.custom?.['minecraft:play_time'] ?? before?.custom?.['minecraft:play_one_minute'] ?? 0)
      const rules: Record<string, string> = {}
      for (const [k, v] of Object.entries(info.reglas ?? {}).slice(0, 80)) rules[cleanId(k)] = String(v).slice(0, 12)
      world = {
        mode: info.modo, difficulty: info.dificultad, hardcore: info.hardcore, cheats: info.trucos,
        dims: Object.keys(info.regionesExploradasPorDimension ?? {}).filter((d) => (info.regionesExploradasPorDimension[d] ?? 0) > 0).map(cleanId).slice(0, 30),
        gen: Object.fromEntries(Object.entries(info.dimensiones ?? {}).slice(0, 30).map(([id, v]: [string, any]) => [cleanId(id).replace(/[:/]/g, '_'), cleanId(`${v.generador ?? ''} ${v.biomas?.fuente ?? ''}`)])),
        datapacks: (info.datapacks?.activos ?? []).length,
        rules,
        minutes: Math.max(0, Math.round(played / 20 / 60)),
        killed: delta(after, before, 'killed', 20),
        killedBy: delta(after, before, 'killed_by', 10),
        deaths: (after.custom?.['minecraft:deaths'] ?? 0) - (before?.custom?.['minecraft:deaths'] ?? 0),
        mined: Object.values(delta(after, before, 'mined', 500)).reduce((s, v) => s + v, 0),
      }
    } catch { /* mundo ilegible: la partida se registra sin él */ }
  }
  const log = await fs.readFile(path.join(gameDir, 'logs', 'latest.log'), 'utf8').catch(() => '')
  const perf = logSignals(log)
  const crashed = code !== 0 && code !== null
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20)
  const liveSummary = summarizeSamples(getSamples(inst.id))
  if (LIVE_UPLOAD_ENABLED && getSamples(inst.id).length) await uploadLiveSeries(inst, getSamples(inst.id)).catch(() => {})
  await fsCommit([{
    path: `play_sessions/${id}`,
    set: {
      mc: inst.minecraft, loader: inst.modloader, v: app.getVersion(), mods, modCount: mods.length,
      minutes: Math.min(1440, Math.round((Date.now() - t0) / 60_000)), crashed, sig: crashed ? lastSig.get(inst.id) ?? '' : '',
      loadSeconds: perf.loadSeconds ?? -1, lagWarnings: perf.lagWarnings, errors: perf.errors, warnings: perf.warnings, noisy: perf.noisy,
      ...(world ? { world } : {}),
      // Resumen de las métricas en vivo del mod (solo cuando fport1web acepte el campo «live»)
      ...(LIVE_UPLOAD_ENABLED && liveSummary ? { live: liveSummary } : {}),
    },
    now: ['at'],
    mustNotExist: true,
  }]).catch(() => {})
}

/** Lo que la comunidad sabe de un mod (o de esta versión/loader): estabilidad, rendimiento y uso. */
export async function communityExperience(inst: Instance, mod?: string): Promise<unknown> {
  if (!enabled) return { error: 'El aprendizaje compartido está desactivado en Ajustes › Privacidad.' }
  const base = await fsRunQuery('', 'play_sessions', [{ field: 'mc', op: 'EQUAL', value: fsValue(inst.minecraft) }], { limit: 400 }).catch(() => [])
  const sessions = (mod
    ? await fsRunQuery('', 'play_sessions', [{ field: 'mods', op: 'ARRAY_CONTAINS_ANY', value: fsValue([cleanId(mod)]) }], { limit: 400 }).catch(() => [])
    : base.filter((s) => s.data.loader === inst.modloader)).map((s) => s.data)
  const summarize = (list: Record<string, any>[]): Record<string, unknown> => {
    const n = list.length || 1
    const count = (get: (s: Record<string, any>) => string[] | Record<string, number> | undefined, top = 12): Record<string, number> => {
      const acc: Record<string, number> = {}
      for (const s of list) {
        const v = get(s)
        if (Array.isArray(v)) for (const k of v) acc[k] = (acc[k] ?? 0) + 1
        else if (v) for (const [k, x] of Object.entries(v)) acc[k] = (acc[k] ?? 0) + Number(x)
      }
      return Object.fromEntries(Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, top))
    }
    const loads = list.map((s) => s.loadSeconds).filter((x) => x >= 0)
    return {
      partidas: list.length,
      crashes: `${Math.round((list.filter((s) => s.crashed).length / n) * 100)} %`,
      cargaMediaSeg: loads.length ? Math.round(loads.reduce((a, b) => a + b, 0) / loads.length) : null,
      avisosDeLagPorPartida: +(list.reduce((a, s) => a + (s.lagWarnings ?? 0), 0) / n).toFixed(1),
      erroresPorPartida: +(list.reduce((a, s) => a + (s.errors ?? 0), 0) / n).toFixed(1),
      origenesQueMasAvisan: count((s) => s.noisy),
      modsQueSeUsanJunto: mod ? count((s) => (s.mods ?? []).filter((m: string) => m !== cleanId(mod)), 15) : undefined,
      dimensionesJugadas: count((s) => s.world?.dims),
      mobsMatados: count((s) => s.world?.killed),
      causasDeMuerte: count((s) => s.world?.killedBy),
    }
  }
  return { mod: mod ?? null, minecraft: inst.minecraft, loader: inst.modloader, conEsteMod: summarize(sessions), referenciaMismaVersion: mod ? summarize(base.map((s) => s.data)) : undefined }
}

// ── Datos en vivo del mod fport1-social (fase 6) ─────────────────────────────
//
// PREPARADO PERO APAGADO: hasta que fport1web publique las reglas nuevas
// (live_outcomes, el campo «live» de play_sessions y la ruta ai-data/ de Storage
// con /api/ai-data-upload, ver docs/APRENDIZAJE.md del mod) cualquier escritura
// sería rechazada. Para activarlo basta con poner esto a true, después de
// comprobar las reglas publicadas.
export const LIVE_UPLOAD_ENABLED = false
const WEB = 'https://fport1web.vercel.app'

/** Sube el resultado medido de un cambio de la IA (sin label). Devuelve por qué no se subió, si no se subió. */
export async function uploadLiveOutcome(inst: Instance, o: LiveOutcome, modVersion?: string): Promise<'subido' | 'desactivado' | 'sin datos' | 'error'> {
  if (!LIVE_UPLOAD_ENABLED || !enabled) return 'desactivado'
  const mods = [...new Set((await listMods(inst.id).catch(() => [])).filter((m) => m.enabled).flatMap((m) => m.meta?.modIds ?? []))]
  const doc = outcomeDoc(o, { mc: inst.minecraft, loader: inst.modloader, v: app.getVersion(), modVersion, mods })
  if (!doc) return 'sin datos'
  try {
    await fsCommit([{ path: `live_outcomes/${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, set: doc, now: ['at'], mustNotExist: true }])
    // Si el cambio venía de una lección, el resultado medido la vota
    if (doc.lessonId && (doc.verdict === 'mejor' || doc.verdict === 'peor')) await rateLesson(String(doc.lessonId), doc.verdict === 'mejor')
    return 'subido'
  } catch { return 'error' }
}

/** Serie completa por minuto de la partida → Storage ai-data/ con una URL firmada que da la web. */
async function uploadLiveSeries(inst: Instance, list: LiveSample[]): Promise<void> {
  if (!LIVE_UPLOAD_ENABLED || !enabled || !list.length) return
  // Solo números y nombres públicos (dimensiones, tipos de entidad, loggers): las muestras del mod ya vienen así,
  // pero se vuelve a limpiar cualquier texto por si acaso
  const clean = list.map((s) => JSON.parse(JSON.stringify(s, (_k, v) => (typeof v === 'string' ? sanitize(v, 120) : v))))
  const gz = (await import('zlib')).gzipSync(Buffer.from(JSON.stringify({ mc: inst.minecraft, loader: inst.modloader, v: app.getVersion(), samples: clean })))
  if (gz.length > 262_144) return
  const axios = (await import('axios')).default
  const { data } = await axios.post(`${WEB}/api/ai-data-upload`, { kind: 'perf', size: gz.length }, { timeout: 15_000 })
  if (!data?.url) return
  await axios.put(data.url, gz, { headers: { 'Content-Type': 'application/gzip' }, timeout: 30_000, maxBodyLength: 300_000 })
}

export function startAiCommunity(opts: { enabled: boolean; playerNames: () => string[] }): void {
  enabled = opts.enabled
  playerNames = opts.playerNames
  const started = new Map<string, number>()
  gameEvents.on('start', async (id: string) => {
    started.set(id, Date.now())
    // Estadísticas de cada mundo al empezar, para saber qué pasó en ESTA partida
    const saves = path.join(await getInstanceGameDir(id), 'saves')
    const snap = new Map<string, StatsSnap>()
    for (const n of await fs.readdir(saves).catch(() => [] as string[])) snap.set(n, await readWorldStats(path.join(saves, n)))
    statsAtStart.set(id, snap)
  })
  gameEvents.on('exit', async (id: string, code: number | null) => {
    const t0 = started.get(id) ?? Date.now()
    started.delete(id)
    const inst = await getInstance(id)
    if (!inst) return
    // Cualquier crash (con o sin IA) aporta su huella
    if (code !== 0 && code !== null) {
      const text = await latestCrashText(await getInstanceGameDir(id), t0)
      if (text) await reportCrash(inst, text)
    }
    await reportSession(inst, t0, code).catch(() => {})
    statsAtStart.delete(id)
  })
}
