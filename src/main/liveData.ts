// Datos en vivo de la partida para el aprendizaje (fase 6 del mod fport1-social).
//
// El mod manda cada minuto una muestra (live/metrics) y, cuando una IA ha
// marcado un cambio con metrics.mark y hay 5 minutos de juego después, el
// resultado medido antes/después (live/outcome). Aquí se acumulan en memoria
// por instancia y se preparan los documentos que se subirían a Firestore.
//
// La SUBIDA está preparada pero desactivada hasta que fport1web publique las
// reglas nuevas (docs/APRENDIZAJE.md del mod, §2): ver LIVE_UPLOAD_ENABLED en
// aiCommunity.ts. El campo `label` (texto libre de la IA) no se sube nunca.
//
// No depende de Electron para poder probarlo (scripts/probar-canal-en-vivo.mjs).

export type LiveSample = Record<string, any>

export interface LiveOutcome {
  kind?: string
  target?: string
  label?: string
  before?: Record<string, any>
  after?: Record<string, any>
  ranAfter?: boolean
  verdict?: string
  lessonId?: string
  at?: number
}

const MAX_SAMPLES = 24 * 60 // un día de partida
const MAX_OUTCOMES = 100

const samples = new Map<string, LiveSample[]>()
const outcomes = new Map<string, LiveOutcome[]>()

/** Una partida nueva empieza sin muestras. */
export function clearSession(instanceId: string): void { samples.delete(instanceId) }

export function addSample(instanceId: string, s: LiveSample): number {
  const list = samples.get(instanceId) ?? []
  list.push({ ...s, t: typeof s.t === 'number' ? s.t : Date.now() })
  if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES)
  samples.set(instanceId, list)
  return list.length
}

export function getSamples(instanceId: string): LiveSample[] { return samples.get(instanceId) ?? [] }

export function addOutcome(instanceId: string, o: LiveOutcome): void {
  const list = outcomes.get(instanceId) ?? []
  list.push({ ...o, at: o.at ?? Date.now() })
  if (list.length > MAX_OUTCOMES) list.shift()
  outcomes.set(instanceId, list)
}

export function getOutcomes(instanceId: string): LiveOutcome[] { return outcomes.get(instanceId) ?? [] }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const avg = (xs: number[]): number | undefined => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined)
const round = (v: number | undefined, d = 1): number | undefined => (v === undefined ? undefined : Math.round(v * 10 ** d) / 10 ** d)
const pick = (list: LiveSample[], f: (s: LiveSample) => unknown): number[] => list.map(f).map(num).filter((x): x is number => x !== undefined)

/**
 * Resumen de la partida para el mapa `live` de play_sessions (claves de la
 * propuesta de reglas: fpsAvg, fpsP5, msptAvg, msptP95, lagPerMin, worldLoadMs,
 * dimLoadMs, memMaxMb, topEntities, samples).
 */
export function summarizeSamples(list: LiveSample[]): Record<string, unknown> | null {
  if (!list.length) return null
  // Los minutos con pantalla de carga no cuentan para el rendimiento (falsearían la media)
  const play = list.filter((s) => !s.loadMs)
  const base = play.length ? play : list
  const top: Record<string, number> = {}
  for (const s of list) for (const [k, v] of Object.entries((s.server?.topEntities ?? {}) as Record<string, number>)) if (typeof v === 'number') top[k] = Math.max(top[k] ?? 0, v)
  const out: Record<string, unknown> = {
    fpsAvg: round(avg(pick(base, (s) => s.fps?.avg))),
    fpsP5: round(avg(pick(base, (s) => s.fps?.p5))),
    msptAvg: round(avg(pick(base, (s) => s.mspt?.avg))),
    msptP95: round(avg(pick(base, (s) => s.mspt?.p95))),
    lagPerMin: round(avg(pick(list, (s) => s.lagSpikes)), 2),
    worldLoadMs: round(avg(pick(list, (s) => s.loadMs?.world)), 0),
    dimLoadMs: round(avg(pick(list, (s) => s.loadMs?.dimension)), 0),
    memMaxMb: Math.max(0, ...pick(list, (s) => s.memMb?.max)) || undefined,
    topEntities: Object.keys(top).length ? Object.fromEntries(Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 10)) : undefined,
    samples: list.length,
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined))
}

const KINDS = ['mod', 'config', 'datapack', 'resourcepack', 'shader', 'world', 'other']
const VERDICTS = ['mejor', 'peor', 'igual', 'sin datos', 'sin datos de antes']
const SUMMARY_KEYS = ['minutes', 'counted', 'fpsAvg', 'fpsMin', 'msptAvg', 'msptP95', 'errorsPerMin', 'warningsPerMin', 'lagPerMin', 'worldLoadMs']

function cleanSummary(r: unknown): Record<string, number> {
  const src = (r ?? {}) as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const k of SUMMARY_KEYS) {
    const v = num(src[k])
    if (v === undefined) continue
    out[k] = k === 'minutes' || k === 'counted' ? Math.max(0, Math.min(1440, Math.round(v))) : round(v, 2)!
  }
  if (out.minutes === undefined) out.minutes = 0
  return out
}

/**
 * Documento para live_outcomes (propuesta §2.2): solo los campos permitidos,
 * `target` normalizado y SIN `label`. Devuelve null si no hay nada que subir.
 */
export function outcomeDoc(o: LiveOutcome, ctx: { mc: string; loader: string; v: string; modVersion?: string; mods?: string[] }): Record<string, unknown> | null {
  if (!o.before && !o.after) return null
  const target = String(o.target ?? '').toLowerCase().replace(/[^a-z0-9_.:/-]/g, '').slice(0, 64)
  const doc: Record<string, unknown> = {
    kind: KINDS.includes(String(o.kind)) ? String(o.kind) : 'other',
    target,
    mc: ctx.mc.slice(0, 24), loader: ctx.loader.slice(0, 16), v: ctx.v.slice(0, 20),
    before: cleanSummary(o.before), after: cleanSummary(o.after),
    ranAfter: !!o.ranAfter,
    verdict: VERDICTS.includes(String(o.verdict)) ? String(o.verdict) : 'sin datos',
  }
  if (ctx.modVersion) doc.modVersion = ctx.modVersion.slice(0, 24)
  if (ctx.mods?.length) doc.mods = ctx.mods.filter((m) => /^[a-z0-9_.-]{2,64}$/.test(m)).slice(0, 150)
  if (o.lessonId && /^[A-Za-z0-9]{8,40}$/.test(o.lessonId)) doc.lessonId = o.lessonId
  return doc
}

/** Texto para la actividad del launcher. */
export function outcomeText(o: LiveOutcome): string {
  const what = o.target ? `${o.kind && o.kind !== 'other' ? `${o.kind} ` : ''}${o.target}` : 'algo'
  const b = o.before ?? {}, a = o.after ?? {}
  const fps = num(b.fpsAvg) !== undefined && num(a.fpsAvg) !== undefined ? ` · FPS ${round(b.fpsAvg, 0)} → ${round(a.fpsAvg, 0)}` : ''
  const mspt = num(b.msptAvg) !== undefined && num(a.msptAvg) !== undefined ? ` · MSPT ${round(b.msptAvg)} → ${round(a.msptAvg)}` : ''
  return `La IA cambió ${what}: ${o.verdict ?? 'sin datos'}${fps}${mspt}`
}
