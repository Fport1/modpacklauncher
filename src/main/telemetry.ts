import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { gameEvents } from './launcher'
import { loadInstances } from './instances'
import { fsCommit } from './firestoreRest'

// Estadísticas de uso ANÓNIMAS (se pueden desactivar en Ajustes › Privacidad).
//
// Qué se envía: un identificador aleatorio de esta instalación (no sale de
// ningún dato del equipo ni de la cuenta), versión del launcher, sistema y
// arquitectura, idioma, cuántas veces se abre, cuántos días se usa, minutos de
// juego, crashes, nº de instancias y qué loaders/versiones usan, y si hay una
// sesión de fport1social o una cuenta premium (sí/no). Nada más: ni nombres,
// ni correos, ni rutas, ni contenido de mundos o chats.
//
// Dónde: launcher_installs/{id} (una ficha por instalación) y
// launcher_days/{AAAA-MM-DD} (totales del día). Con eso se calculan descargas
// activas, usuarios diarios/semanales/mensuales, retención, versiones…

interface LocalState { id: string; firstRun: string; lastDay?: string; registered?: boolean }

let enabled = false
let pending: { inc: Record<string, number>; dayInc: Record<string, number> } = { inc: {}, dayInc: {} }
let deps: { socialLinked: () => boolean; premium: () => boolean; language: () => string } | null = null
const sessionStart = new Map<string, number>()

const stateFile = (): string => path.join(app.getPath('userData'), 'telemetry.json')
const today = (): string => new Date().toISOString().slice(0, 10)

function localState(): LocalState {
  try { return fs.readJsonSync(stateFile()) as LocalState } catch {
    const s = { id: crypto.randomUUID(), firstRun: today() }
    fs.outputJsonSync(stateFile(), s)
    return s
  }
}

/** Id aleatorio de esta instalación (UUID con guiones; no sale de ningún dato personal). */
export function installId(): string { return localState().id }

function add(field: string, n = 1, day = true): void {
  pending.inc[field] = (pending.inc[field] ?? 0) + n
  if (day) pending.dayInc[field] = (pending.dayInc[field] ?? 0) + n
}

/** Envía lo acumulado. Si falla (sin red), se queda para el siguiente intento. */
async function flush(): Promise<void> {
  if (!enabled || !deps) return
  const st = localState()
  const d = today()
  const newDay = st.lastDay !== d
  const first = !st.registered
  const snapshot = pending
  pending = { inc: {}, dayInc: {} }
  try {
    const instances = await loadInstances().catch(() => [])
    const loaders: Record<string, number> = {}
    const mc: Record<string, number> = {}
    for (const i of instances) {
      loaders[i.modloader] = (loaders[i.modloader] ?? 0) + 1
      const k = i.minecraft.replace(/\./g, '_')
      mc[k] = (mc[k] ?? 0) + 1
    }
    const topMc = Object.fromEntries(Object.entries(mc).sort((a, b) => b[1] - a[1]).slice(0, 8))
    const social = deps.socialLinked()
    const inc = { ...snapshot.inc, ...(newDay ? { days: 1 } : {}) }
    const dayInc = { ...snapshot.dayInc, ...(newDay ? { active: 1, ...(social ? { socialActive: 1 } : {}) } : {}), ...(first ? { new: 1 } : {}) }
    await fsCommit([
      {
        path: `launcher_installs/${st.id}`,
        set: {
          v: app.getVersion(), os: process.platform, arch: process.arch, osv: os.release().split('.')[0],
          lang: deps.language(), sysLang: (app.getLocale() || 'xx').slice(0, 2),
          instances: instances.length, loaders, mc: topMc, social, premium: deps.premium(),
          ...(first ? { firstDay: st.firstRun } : {}),
        },
        inc,
        // firstSeen solo la primera vez (las reglas no dejan cambiarlo después)
        now: first ? ['lastSeen', 'firstSeen'] : ['lastSeen'],
      },
      { path: `launcher_days/${d}`, set: {}, inc: dayInc },
    ])
    fs.outputJsonSync(stateFile(), { ...st, lastDay: d, registered: true })
  } catch {
    // Sin red o sin reglas todavía: se reintenta más tarde con lo acumulado
    for (const [k, n] of Object.entries(snapshot.inc)) pending.inc[k] = (pending.inc[k] ?? 0) + n
    for (const [k, n] of Object.entries(snapshot.dayInc)) pending.dayInc[k] = (pending.dayInc[k] ?? 0) + n
  }
}

export function startTelemetry(opts: { enabled: boolean; socialLinked: () => boolean; premium: () => boolean; language: () => string }): void {
  deps = opts
  enabled = opts.enabled
  localState()
  add('launches')
  // Unos segundos después de arrancar, para no competir con la carga de la ventana
  setTimeout(() => { flush().catch(() => {}) }, 15_000)
  setInterval(() => { flush().catch(() => {}) }, 30 * 60_000)

  gameEvents.on('start', (id: string) => { sessionStart.set(id, Date.now()); add('sessions') })
  gameEvents.on('exit', (id: string, code: number | null) => {
    const t0 = sessionStart.get(id)
    sessionStart.delete(id)
    if (t0) add('playMinutes', Math.min(600, Math.round((Date.now() - t0) / 60_000)))
    if (code !== 0 && code !== null) add('crashes')
    flush().catch(() => {})
  })
}

export function setTelemetryEnabled(on: boolean): void {
  enabled = on
  if (!on) pending = { inc: {}, dayInc: {} }
}

/** Cuenta algo que ha pasado (p. ej. una acción de la IA). */
export function countEvent(field: 'aiActions' | 'aiLessonsShared' | 'modInstalls', n = 1): void {
  if (enabled) add(field, n)
}
