// Datos en vivo de la partida para el aprendizaje (fase 6 del mod fport1-social).
//
// El mod manda cada minuto una muestra (live/metrics) y, cuando una IA ha
// marcado un cambio con metrics.mark y hay 5 minutos de juego después, el
// resultado medido antes/después (live/outcome). Aquí se acumulan en memoria
// por instancia y se preparan los documentos que se subirían a Firestore.
//
// La subida la hace aiCommunity.ts con las reglas que publicó fport1web
// (docs/APRENDIZAJE.md del mod, §2). El campo `label` (texto libre de la IA)
// no se sube nunca.
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
  // Los minutos con pantalla de carga o con más de 30 s en pausa no cuentan para
  // el rendimiento (falsearían la media), igual que hace el mod
  const play = list.filter((s) => !s.loadMs && !((num(s.pausedS) ?? 0) > 30))
  const base = play.length ? play : list
  // Las claves van con «_» en vez de «:» y «/», como world.gen en play_sessions
  const top: Record<string, number> = {}
  for (const s of list) {
    for (const [k, v] of Object.entries((s.server?.topEntities ?? {}) as Record<string, unknown>)) {
      const id = k.toLowerCase().replace(/[^a-z0-9_.:/-]/g, '').replace(/[:/]/g, '_').slice(0, 64)
      const n = num(v)
      if (id && n !== undefined) top[id] = Math.max(top[id] ?? 0, n)
    }
  }
  const clamp = (v: number | undefined, max: number): number | undefined => (v === undefined ? undefined : Math.max(0, Math.min(max, v)))
  const out: Record<string, unknown> = {
    // Rangos de liveValido en las reglas: FPS 0-2000, MSPT 0-60000
    fpsAvg: clamp(round(avg(pick(base, (s) => s.fps?.avg))), 2000),
    fpsP5: clamp(round(avg(pick(base, (s) => s.fps?.p5))), 2000),
    msptAvg: clamp(round(avg(pick(base, (s) => s.mspt?.avg))), 60000),
    msptP95: clamp(round(avg(pick(base, (s) => s.mspt?.p95))), 60000),
    lagPerMin: round(avg(pick(list, (s) => s.lagSpikes)), 2),
    worldLoadMs: round(avg(pick(list, (s) => s.loadMs?.world)), 0),
    dimLoadMs: round(avg(pick(list, (s) => s.loadMs?.dimension)), 0),
    memMaxMb: Math.max(0, ...pick(list, (s) => s.memMb?.used)) || undefined, // la memoria más alta usada
    topEntities: Object.keys(top).length ? Object.fromEntries(Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 10)) : undefined,
    samples: list.length,
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined))
}

const KINDS = ['mod', 'config', 'datapack', 'resourcepack', 'shader', 'world', 'other']
const VERDICTS = ['mejor', 'peor', 'igual', 'sin datos', 'sin datos de antes']
const SUMMARY_KEYS = ['minutes', 'counted', 'fpsAvg', 'fpsMin', 'msptAvg', 'msptP95', 'errorsPerMin', 'warningsPerMin', 'lagPerMin', 'worldLoadMs']

function cleanSummary(r: unknown): Record<string, number> | undefined {
  if (!r || typeof r !== 'object') return undefined
  const src = r as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const k of SUMMARY_KEYS) {
    const v = num(src[k])
    if (v === undefined) continue
    out[k] = k === 'minutes' || k === 'counted' ? Math.max(0, Math.min(1440, Math.round(v))) : round(v, 2)!
  }
  return out
}

/**
 * Documento para live_outcomes (reglas publicadas por fport1web): solo los
 * campos permitidos, `target` normalizado y SIN `label`, `id` ni el `at` del mod
 * (`at` lo pone Firestore con la hora del servidor). `before` y `after` son
 * opcionales: con veredictos como «sin datos de antes» falta uno o los dos.
 */
export function outcomeDoc(o: LiveOutcome, ctx: { mc: string; loader: string; v: string; modVersion?: string; mods?: string[] }): Record<string, unknown> {
  const target = String(o.target ?? '').toLowerCase().replace(/[^a-z0-9_.:/-]/g, '').slice(0, 64)
  const doc: Record<string, unknown> = {
    kind: KINDS.includes(String(o.kind)) ? String(o.kind) : 'other',
    target,
    mc: ctx.mc.slice(0, 24), loader: ctx.loader.slice(0, 16), v: ctx.v.slice(0, 20),
    ranAfter: !!o.ranAfter,
    verdict: VERDICTS.includes(String(o.verdict)) ? String(o.verdict) : 'sin datos',
  }
  const before = cleanSummary(o.before), after = cleanSummary(o.after)
  if (before) doc.before = before
  if (after) doc.after = after
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

export const SERIES_MAX_BYTES = 262_144
let seriesBlockedUntil = 0 // tras un 429 no se vuelve a pedir hasta que pase retryAfter

/**
 * Sube la serie completa de la partida (json.gz) a Storage ai-data/perf/:
 * 1. POST {web}/api/ai-data-upload {kind:'perf', size, installId} → URL firmada;
 * 2. PUT a esa URL con EXACTAMENTE las cabeceras que devuelve la web (sin
 *    x-goog-content-length-range, Storage la rechaza aunque la URL sea válida).
 * Un 429 (cupo del día) bloquea nuevos intentos hasta que pase retryAfter.
 */
export async function uploadSeries(gz: Uint8Array, installId: string, web: string): Promise<'subido' | 'grande' | 'limitado' | 'error'> {
  if (gz.length > SERIES_MAX_BYTES) return 'grande'
  if (Date.now() < seriesBlockedUntil) return 'limitado'
  try {
    const res = await fetch(`${web}/api/ai-data-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'perf', size: gz.length, installId }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json().catch(() => null)) as Record<string, any> | null
    if (res.status === 429) {
      seriesBlockedUntil = Date.now() + Math.max(60, Number(data?.retryAfter) || 3600) * 1000
      return 'limitado'
    }
    if (!res.ok || typeof data?.url !== 'string') return 'error'
    const headers: Record<string, string> = data.cabeceras && typeof data.cabeceras === 'object'
      ? Object.fromEntries(Object.entries(data.cabeceras).map(([k, v]) => [k, String(v)]))
      : { 'Content-Type': 'application/gzip', 'x-goog-content-length-range': `0,${SERIES_MAX_BYTES}` }
    const put = await fetch(data.url, { method: 'PUT', headers, body: gz, signal: AbortSignal.timeout(30_000) })
    return put.ok ? 'subido' : 'error'
  } catch { return 'error' }
}

/** Solo para las pruebas: olvida un 429 anterior. */
export function resetSeriesLimit(): void { seriesBlockedUntil = 0 }
