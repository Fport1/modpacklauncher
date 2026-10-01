import { WebSocket } from 'ws'
import type { AiActivity, LiveStatus } from '../shared/types'

// Canal en vivo con la partida (mod fport1-social).
//
// Cuando el juego arranca con -Dfport1.bridge y -Dfport1.instance, el mod abre
// un WebSocket local (JSON-RPC 2.0) y se registra en el puente del launcher
// con live/register, mandando su puerto y su clave. El launcher se conecta,
// saluda (hello) y desde entonces reenvía las llamadas de las IAs (live/call):
// las IAs nunca hablan directamente con el juego.
//
// No depende de Electron para poder probarlo con un mod falso
// (scripts/probar-canal-en-vivo.mjs). La clave del mod solo vive en memoria:
// no se escribe a disco, ni a registros, ni sale de este módulo.

/** Lo que manda el mod en live/register, live/heartbeat y live/unregister. */
export interface LiveRegistration {
  port: number
  token: string
  side?: string
  mc?: string
  loader?: string
  modVersion?: string
  protocol?: number
  pid?: number
}

export interface LiveHooks {
  /** Versión del launcher que se manda en el saludo. */
  clientVersion: string
  /** Se añade a la actividad de la instancia (lo ve el usuario). */
  activity(instanceId: string, text: string, kind: AiActivity['kind']): void
  /** La instancia entra en vivo, cambia de capacidades o deja de estar en vivo (null). */
  changed(instanceId: string, status: LiveStatus | null): void
}

export interface LiveOptions {
  /** Sin latido durante este tiempo, la conexión se da por perdida (45 s). */
  heartbeatTimeoutMs?: number
  /** Máximo para una llamada: command.run en multijugador espera hasta 60 s al jugador (70 s). */
  callTimeoutMs?: number
  /** Máximo para conectar y saludar (10 s). */
  helloTimeoutMs?: number
}

/** Error JSON-RPC tal cual lo devuelve el mod (o uno del propio launcher con el mismo formato). */
export interface LiveRpcError {
  code: number
  message: string
  data?: unknown
  /** Explicación del launcher para la IA */
  hint?: string
}
export type LiveCallResult = { result: unknown } | { error: LiveRpcError }

// Códigos del protocolo (docs/PROTOCOLO.md del mod)
export const LIVE_ERRORS = {
  NOT_LIVE: -32000,            // propio del launcher: la partida no está en vivo
  NO_PERMISSION: -32001,
  CAPABILITY: -32002,
  NO_WORLD: -32003,
  RATE_LIMIT: -32004,
  CANCELLED: -32005,
  NO_HELLO: -32006,
  PROTOCOL: -32007,
} as const

/** Explicación para la IA de cada error del mod. */
const ERROR_HINT: Record<number, string> = {
  [-32601]: 'Este método no existe en la versión del mod instalada',
  [-32602]: 'Parámetros incorrectos',
  [-32001]: 'Sin permiso: en este servidor el jugador no es operador',
  [-32002]: 'Capacidad no disponible ahora mismo (p. ej. hace falta estar en un mundo propio o que el servidor tenga el mod)',
  [-32003]: 'No hay ningún mundo cargado: el jugador está en el menú',
  [-32004]: 'Demasiadas peticiones seguidas: espera un poco',
  [-32005]: 'Cancelado: el jugador lo ha denegado en pantalla (o no respondió en 60 s)',
  [-32006]: 'Falta el saludo con el mod',
  [-32007]: 'Versión de protocolo no compatible: actualiza el mod o el launcher',
}

export const NOT_LIVE_MESSAGE = 'La partida no está abierta con fport1-social instalado. Abre el juego con lanzar_juego (o pide al usuario que entre en un mundo) y vuelve a intentarlo.'

/**
 * Capacidades que tiene que declarar el mod para cada método. Lo que no está
 * aquí se reenvía igual y es el mod quien decide (responde -32601 o -32002).
 * Para las herramientas de la fase 5 basta con añadir aquí su método.
 */
export const LIVE_METHOD_CAPABILITIES: Record<string, (params: Record<string, unknown>) => string[]> = {
  'state.get': () => ['state'],
  'perf.get': () => ['perf'],
  'command.run': (p) => (p.as === 'server' ? ['command', 'command.server'] : ['command']),
  // Fase 5
  'reload.datapacks': () => ['reload.datapacks'],
  'reload.resources': () => ['reload.resources'],
  'capture.screenshot': () => ['capture'],
  'camera.set': () => ['camera'],
  'registry.list': () => ['registry'],
  'registry.dump': () => ['registry'],
  'structure.place': () => ['structure'],
  'player.teleport': () => ['teleport'],
  'spark.run': () => ['spark'],
  'events.subscribe': () => ['events'],
  'events.unsubscribe': () => ['events'],
  // Fase 6: antes/después de los cambios de la IA
  'metrics.get': () => ['metrics'],
  'metrics.mark': () => ['metrics'],
  'metrics.compare': () => ['metrics'],
}

/** Métodos que valen con cualquiera de estas capacidades (inspeccionar desde el cliente o con acceso al servidor). */
export const LIVE_METHOD_ANY_OF: Record<string, string[]> = {
  'inspect.block': ['inspect', 'inspect.server'],
  'inspect.entity': ['inspect', 'inspect.server'],
}

/** Un evento del mod (todos menos audit, que va a la actividad). */
export interface LiveEvent { type: string; at: number; data: unknown }
const MAX_EVENTS = 200

/** Texto para la actividad de los eventos que el usuario tiene que ver (el resto solo se guarda). */
export function eventActivity(type: string, data: unknown): { text: string; kind: AiActivity['kind'] } | null {
  const d = (data ?? {}) as Record<string, any>
  if (type === 'datapack_error') {
    const problems: unknown[] = Array.isArray(d.problems) ? d.problems : []
    const first = problems.length ? String(typeof problems[0] === 'string' ? problems[0] : (problems[0] as any)?.message ?? JSON.stringify(problems[0])).slice(0, 160) : ''
    return { text: `Errores al recargar datapacks${problems.length ? ` (${problems.length})` : ''}${first ? `: ${first}` : ''}`, kind: 'error' }
  }
  if (type === 'crash_imminent') {
    // El mod manda {reason: "memory", usedMb, maxMb}
    const pct = typeof d.usedMb === 'number' && typeof d.maxMb === 'number' && d.maxMb > 0 ? ` (${Math.round((d.usedMb / d.maxMb) * 100)} % de ${d.maxMb} MB)` : ''
    return { text: `La partida se está quedando sin memoria${pct}: puede cerrarse en cualquier momento`, kind: 'error' }
  }
  return null
}

const PROTOCOL_RANGE: [number, number] = [1, 1]

interface Pending { resolve: (r: LiveCallResult) => void; timer: NodeJS.Timeout }

interface Conn {
  instanceId: string
  port: number
  token: string
  pid?: number
  ws: WebSocket
  status?: LiveStatus
  nextId: number
  pending: Map<number, Pending>
  watchdog?: NodeJS.Timeout
  closed: boolean
}

export interface LiveBridge {
  /** Conecta con el mod y saluda. Rechaza si no se puede (el mod lo reintentará con su latido). */
  register(instanceId: string, reg: LiveRegistration): Promise<LiveStatus>
  /** false si no se conoce esa instancia (o cambió de puerto/clave): hay que responder 404. */
  heartbeat(instanceId: string, reg: Partial<LiveRegistration>): boolean
  unregister(instanceId: string, reason?: string): void
  call(instanceId: string, method: string, params?: Record<string, unknown>): Promise<LiveCallResult>
  /** Eventos guardados de la instancia (los últimos 200), opcionalmente desde una marca de tiempo y de ciertos tipos. */
  events(instanceId: string, since?: number, types?: string[]): LiveEvent[]
  status(instanceId: string): LiveStatus | null
  list(): LiveStatus[]
  closeAll(): void
}

/** Texto legible de un evento audit del mod ({at, client, method, detail, ok}). */
export function auditText(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>
  const what: Record<string, string> = {
    'command.run': 'Comando en la partida',
    'command.server': 'Comando en el servidor',
    'reload.datapacks': 'Recarga de datapacks',
    'reload.resources': 'Recarga de resource packs',
    'capture.screenshot': 'Captura de pantalla',
    'camera.set': 'Cámara movida',
    'structure.place': 'Estructura colocada',
    'player.teleport': 'Teletransporte',
    'spark.run': 'Perfil de rendimiento (spark)',
    'metrics.mark': 'Medición antes de un cambio',
  }
  const method = String(d.method ?? '?')
  const client = d.client && d.client !== 'modpack-launcher' ? ` (desde ${d.client})` : ''
  const detail = d.detail ? `: ${String(d.detail).slice(0, 200)}` : ''
  return `${what[method] ?? `En la partida, ${method}`}${detail}${client}${d.ok === false ? ' (falló)' : ''}`
}

export function createLiveBridge(hooks: LiveHooks, opts: LiveOptions = {}): LiveBridge {
  const heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? 45_000
  const callTimeoutMs = opts.callTimeoutMs ?? 70_000
  const helloTimeoutMs = opts.helloTimeoutMs ?? 10_000
  const conns = new Map<string, Conn>()
  // Eventos por instancia: sobreviven a una reconexión del mod dentro de la misma partida
  const eventLog = new Map<string, LiveEvent[]>()
  const lastPid = new Map<string, number>()

  const armWatchdog = (c: Conn): void => {
    if (c.watchdog) clearTimeout(c.watchdog)
    c.watchdog = setTimeout(() => drop(c, 'Se perdió la conexión en vivo con la partida (sin latido)'), heartbeatTimeoutMs)
    c.watchdog.unref?.()
  }

  /** Cierra y olvida una conexión. Las llamadas pendientes reciben un error. */
  const drop = (c: Conn, reason?: string): void => {
    if (c.closed) return
    c.closed = true
    if (c.watchdog) clearTimeout(c.watchdog)
    for (const [, p] of c.pending) { clearTimeout(p.timer); p.resolve({ error: { code: LIVE_ERRORS.NOT_LIVE, message: NOT_LIVE_MESSAGE } }) }
    c.pending.clear()
    try { c.ws.close() } catch { /* ya cerrado */ }
    if (conns.get(c.instanceId) === c) {
      conns.delete(c.instanceId)
      if (c.status) {
        hooks.changed(c.instanceId, null)
        if (reason) hooks.activity(c.instanceId, reason, 'info')
      }
    }
  }

  const send = (c: Conn, method: string, params: unknown, timeoutMs: number): Promise<LiveCallResult> =>
    new Promise((resolve) => {
      if (c.closed || c.ws.readyState !== WebSocket.OPEN) return resolve({ error: { code: LIVE_ERRORS.NOT_LIVE, message: NOT_LIVE_MESSAGE } })
      const id = c.nextId++
      const timer = setTimeout(() => {
        c.pending.delete(id)
        resolve({ error: { code: -32603, message: `La partida no respondió a ${method} en ${Math.round(timeoutMs / 1000)} s` } })
      }, timeoutMs)
      c.pending.set(id, { resolve, timer })
      c.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }), (err) => {
        if (!err) return
        clearTimeout(timer)
        c.pending.delete(id)
        resolve({ error: { code: -32603, message: `No se pudo enviar a la partida: ${err.message}` } })
      })
    })

  const onMessage = (c: Conn, raw: string): void => {
    let msg: any
    try { msg = JSON.parse(raw) } catch { return }
    if (msg && msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const p = c.pending.get(msg.id)
      if (!p) return
      clearTimeout(p.timer)
      c.pending.delete(msg.id)
      p.resolve(msg.error ? { error: msg.error } : { result: msg.result })
      return
    }
    // Notificaciones del mod
    if (msg?.method === 'event' && msg.params?.type === 'audit') {
      hooks.activity(c.instanceId, auditText(msg.params.data), 'change')
    } else if (msg?.method === 'event' && typeof msg.params?.type === 'string') {
      const ev: LiveEvent = { type: msg.params.type, at: typeof msg.params.at === 'number' ? msg.params.at : Date.now(), data: msg.params.data ?? null }
      const list = eventLog.get(c.instanceId) ?? []
      list.push(ev)
      if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS)
      eventLog.set(c.instanceId, list)
      const a = eventActivity(ev.type, ev.data)
      if (a) hooks.activity(c.instanceId, a.text, a.kind)
    } else if (msg?.method === 'capabilities/changed' && c.status) {
      const p = msg.params ?? {}
      c.status = {
        ...c.status,
        side: p.side ?? c.status.side,
        permission: p.permission ?? c.status.permission,
        serverHasMod: p.serverHasMod ?? c.status.serverHasMod,
        capabilities: Array.isArray(p.capabilities) ? p.capabilities.map(String) : c.status.capabilities,
      }
      hooks.changed(c.instanceId, c.status)
    }
  }

  const connect = (c: Conn): Promise<void> =>
    new Promise((resolve, reject) => {
      const fail = (e: Error): void => { cleanup(); reject(e) }
      const cleanup = (): void => { c.ws.off('open', ok); c.ws.off('error', fail); c.ws.off('unexpected-response', bad) }
      const ok = (): void => { cleanup(); resolve() }
      const bad = (_req: unknown, res: { statusCode?: number }): void => fail(new Error(`el mod rechazó la conexión (HTTP ${res.statusCode})`))
      c.ws.once('open', ok)
      c.ws.once('error', fail)
      c.ws.once('unexpected-response', bad)
    })

  return {
    async register(instanceId, reg) {
      const port = Number(reg.port)
      if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('Puerto inválido')
      if (!reg.token || typeof reg.token !== 'string') throw new Error('Falta la clave del mod')
      // Un registro nuevo sustituye al anterior (el juego se reinició o se perdió la conexión)
      const old = conns.get(instanceId)
      if (old) drop(old)
      // Otro proceso es otra partida: sus eventos empiezan de cero
      if (reg.pid != null && lastPid.get(instanceId) !== reg.pid) eventLog.delete(instanceId)
      if (reg.pid != null) lastPid.set(instanceId, reg.pid)

      const ws = new WebSocket(`ws://127.0.0.1:${port}/fport1-ai`, {
        headers: { Authorization: `Bearer ${reg.token}` },
        handshakeTimeout: helloTimeoutMs,
        maxPayload: 16 * 1024 * 1024,
      })
      const c: Conn = { instanceId, port, token: reg.token, pid: reg.pid, ws, nextId: 1, pending: new Map(), closed: false }
      conns.set(instanceId, c)
      ws.on('message', (data) => onMessage(c, data.toString()))
      ws.on('close', () => drop(c, 'La partida cerró el canal en vivo'))
      ws.on('error', () => { /* lo trata connect() o el cierre */ })
      armWatchdog(c)

      try {
        await connect(c)
        const hello = await send(c, 'hello', { protocol: PROTOCOL_RANGE, client: 'modpack-launcher', clientVersion: hooks.clientVersion }, helloTimeoutMs)
        if ('error' in hello) throw new Error(`saludo rechazado: ${hello.error.message}`)
        const h = (hello.result ?? {}) as Record<string, any>
        // El mod dice de qué instancia es: tiene que ser esta
        if (h.instance && h.instance !== instanceId) throw new Error(`el mod es de otra instancia (${h.instance})`)
        c.status = {
          instanceId,
          side: String(h.side ?? reg.side ?? 'client'),
          permission: String(h.permission ?? 'read'),
          serverHasMod: !!h.serverHasMod,
          capabilities: Array.isArray(h.capabilities) ? h.capabilities.map(String) : [],
          mc: h.mc ?? reg.mc,
          loader: h.loader ?? reg.loader,
          modVersion: h.modVersion ?? reg.modVersion,
          protocol: typeof h.protocol === 'number' ? h.protocol : reg.protocol,
          connectedAt: Date.now(),
        }
      } catch (e) {
        drop(c)
        throw new Error(`No se pudo conectar con la partida: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (c.closed) throw new Error('La partida cerró el canal en vivo nada más conectar')
      hooks.changed(instanceId, c.status)
      hooks.activity(instanceId, `Partida en vivo: conectado con fport1-social${c.status.modVersion ? ` ${c.status.modVersion}` : ''} (${c.status.side}, permiso ${c.status.permission})`, 'info')
      return c.status
    },

    heartbeat(instanceId, reg) {
      const c = conns.get(instanceId)
      if (!c || c.closed) return false
      // Si el mod cambió de puerto o de clave es otra partida: que se vuelva a registrar
      if ((reg.port != null && Number(reg.port) !== c.port) || (reg.token != null && reg.token !== c.token)) return false
      armWatchdog(c)
      return true
    },

    unregister(instanceId, reason) {
      const c = conns.get(instanceId)
      if (c) drop(c, reason ?? 'La partida se cerró: fin del canal en vivo')
    },

    async call(instanceId, method, params = {}) {
      const c = conns.get(instanceId)
      if (!c || c.closed || !c.status) return { error: { code: LIVE_ERRORS.NOT_LIVE, message: NOT_LIVE_MESSAGE } }
      if (!method || method === 'hello') return { error: { code: -32600, message: 'Método no permitido' } }
      // El mod tiene que declarar la capacidad (cambia al entrar o salir de un mundo)
      const need = LIVE_METHOD_CAPABILITIES[method]?.(params) ?? []
      const missing = need.filter((cap) => !c.status!.capabilities.includes(cap))
      const anyOf = LIVE_METHOD_ANY_OF[method]
      if (anyOf && !anyOf.some((cap) => c.status!.capabilities.includes(cap))) missing.push(anyOf.join(' o '))
      if (missing.length) {
        return { error: { code: LIVE_ERRORS.CAPABILITY, message: `La partida no ofrece ${missing.join(', ')} ahora mismo (${c.status.side}, permiso ${c.status.permission}). Capacidades: ${c.status.capabilities.join(', ') || 'ninguna'}` } }
      }
      const r = await send(c, method, params, callTimeoutMs)
      if ('error' in r) {
        const hint = ERROR_HINT[r.error.code]
        if (r.error.code === LIVE_ERRORS.CANCELLED) hooks.activity(instanceId, `El jugador denegó ${method === 'command.run' ? 'el comando' : method}${typeof params.command === 'string' ? ` ${params.command}` : ''}`, 'denied')
        return { error: hint ? { ...r.error, hint } : r.error }
      }
      return r
    },

    events(instanceId, since, types) {
      const list = eventLog.get(instanceId) ?? []
      const want = types?.length && !types.includes('*') ? new Set(types) : null
      return list.filter((e) => (since == null || e.at > since) && (!want || want.has(e.type)))
    },

    status: (instanceId) => conns.get(instanceId)?.status ?? null,
    list: () => [...conns.values()].flatMap((c) => (c.status && !c.closed ? [c.status] : [])),
    closeAll() { for (const c of [...conns.values()]) drop(c) },
  }
}
