// Prueba del canal en vivo (src/main/liveBridge.ts) sin Minecraft ni Electron.
//
// Levanta un mod fport1-social falso (WebSocket JSON-RPC en un puerto aleatorio
// de 127.0.0.1, con su clave) y ejercita live/register, live/heartbeat,
// live/unregister y live/call tal como los usa el puente del launcher, y
// después las herramientas MCP en vivo (aiMcpScript.ts) de punta a punta.
//
// Uso: node scripts/probar-canal-en-vivo.mjs
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { WebSocketServer } from 'ws'
import { spawn } from 'node:child_process'
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'canal-en-vivo-')), 'liveBridge.cjs')
await build({
  entryPoints: [path.join(root, 'src/main/liveBridge.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile: outFile, logLevel: 'error',
  external: ['bufferutil', 'utf-8-validate'],
})
const { createLiveBridge, auditText, LIVE_ERRORS } = createRequire(import.meta.url)(outFile)
// Métricas y resultados de la fase 6 (liveData.ts tampoco depende de Electron)
const dataOut = path.join(path.dirname(outFile), 'liveData.cjs')
await build({ entryPoints: [path.join(root, 'src/main/liveData.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: dataOut, logLevel: 'error' })
const liveData = createRequire(import.meta.url)(dataOut)
// El servidor MCP que usan las IAs (es un texto dentro de aiMcpScript.ts)
const mcpOut = path.join(path.dirname(outFile), 'aiMcpScript.cjs')
await build({ entryPoints: [path.join(root, 'src/main/aiMcpScript.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: mcpOut, logLevel: 'error' })
const { MCP_SCRIPT } = createRequire(import.meta.url)(mcpOut)

// ── Mod falso ───────────────────────────────────────────────────────────────

const ALL_CAPS = ['state', 'perf', 'command', 'command.server', 'nbt', 'perf.server',
  // fase 5 y 6
  'reload.datapacks', 'reload.resources', 'capture', 'camera', 'registry', 'inspect', 'structure', 'teleport', 'spark', 'events', 'metrics']
// Carpeta donde el mod falso deja sus capturas (como screenshots/ de la instancia)
const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canal-en-vivo-capturas-'))
// PNG mínimo válido de 1×1
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

function fakeMod({ instance = 'prueba', caps = ALL_CAPS } = {}) {
  const token = crypto.randomBytes(24).toString('base64url')
  const sockets = new Set()
  const wss = new WebSocketServer({
    host: '127.0.0.1', port: 0, path: '/fport1-ai',
    verifyClient: ({ req }) => !req.headers.origin && req.headers.authorization === `Bearer ${token}`,
  })
  const mod = { token, wss, sockets, helloClient: null, port: 0, caps: [...caps], calls: [] }
  const emit = (ws, type, data) => ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, at: Date.now(), data } }))
  wss.on('connection', (ws) => {
    sockets.add(ws)
    let greeted = false
    const reply = (id, result) => ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }))
    const fail = (id, code, message) => ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }))
    ws.on('message', (buf) => {
      const { id, method, params = {} } = JSON.parse(buf.toString())
      if (method === 'hello') {
        greeted = true
        mod.helloClient = params
        return reply(id, { protocol: 1, mod: 'fport1social', modVersion: '2.0.0-test', mc: '1.21.1', loader: 'fabric', side: 'integrated', serverHasMod: true, permission: 'operator', capabilities: mod.caps, instance })
      }
      if (!greeted) return fail(id, -32006, 'Falta el saludo')
      mod.calls.push({ method, params })
      switch (method) {
        case 'reload.datapacks': {
          const problems = ['Failed to load function prueba:roto']
          emit(ws, 'datapack_error', { problems })
          return reply(id, { packs: ['vanilla', 'file/prueba'], problems })
        }
        case 'reload.resources': return reply(id, { problems: [] })
        case 'capture.screenshot': {
          const file = path.join(shotDir, `captura-${Date.now()}.png`)
          fs.writeFileSync(file, PNG_1x1)
          return reply(id, { path: file, width: 1, height: 1 })
        }
        case 'camera.set': return reply(id, { yaw: params.yaw, pitch: params.pitch })
        case 'registry.list': return reply(id, { registries: ['minecraft:block', 'minecraft:worldgen/biome'] })
        case 'registry.dump': return reply(id, { registry: params.registry, entries: ['minecraft:plains'], byNamespace: { minecraft: 1 }, filter: params.filter, offset: params.offset, limit: params.limit })
        case 'inspect.block': return reply(id, { pos: params.pos, id: 'minecraft:stone' })
        case 'inspect.entity': return reply(id, { uuid: params.uuid, id: 'minecraft:zombie' })
        case 'structure.place': return reply(id, { placed: true, file: params.file, id: params.id, pos: params.pos, rotation: params.rotation })
        case 'player.teleport': return reply(id, { pos: params.pos, dimension: params.dimension })
        case 'spark.run': return reply(id, { output: [`spark ${params.args}`] })
        case 'events.subscribe': {
          reply(id, { subscribed: params.types })
          // Llegan unos cuantos eventos, como en una partida
          setTimeout(() => {
            emit(ws, 'death', { cause: 'minecraft:fall' })
            emit(ws, 'lag_spike', { ms: 230 })
            emit(ws, 'crash_imminent', { reason: 'memory', usedMb: 3880, maxMb: 4000 })
          }, 20)
          return
        }
        case 'metrics.get': return reply(id, { samples: [{ t: 1, fps: { avg: 90 } }], minutes: params.minutes })
        case 'metrics.mark': return reply(id, { id: 'marca123', kind: params.kind, target: params.target, label: params.label })
        case 'metrics.compare': return reply(id, { id: params.id, verdict: 'mejor' })
        case 'state.get': return reply(id, { dimension: 'minecraft:overworld', pos: [1, 64, 2], player: { health: 20 } })
        case 'perf.get': return reply(id, { memory: { usedMb: 900, maxMb: 4096 }, client: { fps: 144 }, server: { mspt: 12.5, tps: 20 } })
        case 'command.run': {
          if (params.command === 'denegar') return fail(id, -32005, 'Denegado por el jugador')
          const out = { command: params.command, output: [`Hecho: ${params.command}`], success: true }
          ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'audit', at: Date.now(), data: { at: new Date().toISOString(), client: 'modpack-launcher', method: 'command.run', detail: params.command, ok: true } } }))
          return reply(id, out)
        }
        case 'lento': return // nunca responde
        default: return fail(id, -32601, `Método desconocido: ${method}`)
      }
    })
    ws.on('close', () => sockets.delete(ws))
  })
  mod.capabilitiesChanged = (newCaps) => {
    mod.caps = newCaps
    for (const ws of sockets) ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'capabilities/changed', params: { side: 'integrated', permission: 'operator', serverHasMod: true, capabilities: newCaps } }))
  }
  mod.kick = () => { for (const ws of sockets) ws.close() }
  mod.close = () => new Promise((r) => { mod.kick(); wss.close(() => r()) })
  return new Promise((resolve) => wss.on('listening', () => { mod.port = wss.address().port; resolve(mod) }))
}

// ── Utilidades ──────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, cond, extra) {
  console.log(`${cond ? 'OK   ' : 'FALLO'} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`)
  if (!cond) failures++
}

function hooks() {
  const h = { activity: [], changes: [] }
  h.hooks = {
    clientVersion: '9.9.9-prueba',
    activity: (instanceId, text, kind) => h.activity.push({ instanceId, text, kind }),
    changed: (instanceId, status) => h.changes.push({ instanceId, status }),
  }
  return h
}

const reg = (mod, extra = {}) => ({ port: mod.port, token: mod.token, side: 'client', mc: '1.21.1', loader: 'fabric', modVersion: '2.0.0-test', protocol: 1, pid: 1234, ...extra })

// ── Pruebas ─────────────────────────────────────────────────────────────────

const mod = await fakeMod()
const h = hooks()
const live = createLiveBridge(h.hooks, { heartbeatTimeoutMs: 1500, callTimeoutMs: 300, helloTimeoutMs: 2000 })

// Clave incorrecta: el mod rechaza la conexión y no queda nada en vivo
let err = null
try { await live.register('prueba', reg(mod, { token: 'no-es-la-clave' })) } catch (e) { err = e }
check('clave incorrecta se rechaza', err && /401|rechaz/i.test(err.message), err?.message)
check('sin clave incorrecta no hay estado', live.status('prueba') === null)

// Registro correcto
const st = await live.register('prueba', reg(mod))
check('registro: saluda con protocolo [1,1] y versión', JSON.stringify(mod.helloClient) === JSON.stringify({ protocol: [1, 1], client: 'modpack-launcher', clientVersion: '9.9.9-prueba' }), mod.helloClient)
check('registro: guarda capacidades, permiso y side', st.side === 'integrated' && st.permission === 'operator' && st.capabilities.includes('command.server'), st)
check('registro: el estado no lleva puerto ni clave', !('token' in st) && !('port' in st) && !JSON.stringify(st).includes(mod.token))
check('registro: avisa al renderer', h.changes.at(-1)?.status?.instanceId === 'prueba')
check('registro: actividad «en vivo»', h.activity.some((a) => /en vivo/i.test(a.text) && a.kind === 'info'), h.activity)
check('list() devuelve la instancia', live.list().length === 1)

// Llamadas
const state = await live.call('prueba', 'state.get')
check('state.get', state.result?.dimension === 'minecraft:overworld', state)
const perf = await live.call('prueba', 'perf.get')
check('perf.get', perf.result?.server?.tps === 20, perf)
const cmd = await live.call('prueba', 'command.run', { command: 'time set noon', as: 'server' })
check('command.run como servidor', cmd.result?.success === true && cmd.result.output[0] === 'Hecho: time set noon', cmd)
await sleep(50)
check('evento audit → actividad «change»', h.activity.some((a) => a.kind === 'change' && a.text === 'Comando en la partida: time set noon'), h.activity)
const denied = await live.call('prueba', 'command.run', { command: 'denegar', as: 'player' })
check('denegado: devuelve el código -32005 con explicación', denied.error?.code === -32005 && /denegado/i.test(denied.error.hint ?? ''), denied)
check('denegado: actividad «denied»', h.activity.some((a) => a.kind === 'denied'), h.activity)
const unknown = await live.call('prueba', 'mundo.destruir')
check('método desconocido: se reenvía y vuelve el -32601', unknown.error?.code === -32601, unknown)
const slow = await live.call('prueba', 'lento')
check('tiempo agotado', slow.error?.code === -32603 && /no respondió/.test(slow.error.message), slow)
const helloAgain = await live.call('prueba', 'hello', {})
check('no se deja volver a saludar desde live/call', helloAgain.error?.code === -32600, helloAgain)

// capabilities/changed: sin command.server ya no se ejecuta como servidor
mod.capabilitiesChanged(['state', 'perf', 'command'])
await sleep(50)
check('capabilities/changed actualiza el estado', !live.status('prueba').capabilities.includes('command.server'), live.status('prueba'))
check('capabilities/changed avisa al renderer', h.changes.at(-1)?.status?.capabilities?.length === 3)
const noCap = await live.call('prueba', 'command.run', { command: 'time set noon', as: 'server' })
check('sin la capacidad: -32002 sin preguntar al mod', noCap.error?.code === LIVE_ERRORS.CAPABILITY, noCap)
const asPlayer = await live.call('prueba', 'command.run', { command: 'weather clear', as: 'player' })
check('como jugador sigue funcionando', asPlayer.result?.success === true, asPlayer)

// Latidos
check('latido de la instancia conocida', live.heartbeat('prueba', reg(mod)) === true)
check('latido con otra clave → 404', live.heartbeat('prueba', reg(mod, { token: 'otra' })) === false)
check('latido de una instancia desconocida → 404', live.heartbeat('otra', reg(mod)) === false)
for (let i = 0; i < 3; i++) { await sleep(600); live.heartbeat('prueba', reg(mod)) }
check('con latidos sigue en vivo', live.status('prueba') !== null)
await sleep(1800)
check('sin latidos se da por perdida', live.status('prueba') === null)
check('al perderse avisa al renderer', h.changes.at(-1)?.status === null)
const gone = await live.call('prueba', 'state.get')
check('sin conexión: mensaje claro', gone.error?.code === LIVE_ERRORS.NOT_LIVE && /no está abierta con fport1-social/.test(gone.error.message), gone)
check('tras perderse, el latido responde 404', live.heartbeat('prueba', reg(mod)) === false)

// Volver a registrarse y darse de baja
await live.register('prueba', reg(mod))
check('se vuelve a registrar', live.status('prueba') !== null)
live.unregister('prueba')
check('live/unregister la olvida', live.status('prueba') === null && live.list().length === 0)

// El mod cierra el WebSocket
await live.register('prueba', reg(mod))
mod.kick()
await sleep(100)
check('si el mod cierra el canal, se olvida', live.status('prueba') === null)

// Un mod que dice ser de otra instancia
err = null
try { await live.register('otra-instancia', reg(mod)) } catch (e) { err = e }
check('mod de otra instancia se rechaza', err && /otra instancia/.test(err.message), err?.message)

// Puerto cerrado
err = null
await mod.close()
try { await live.register('prueba', reg(mod)) } catch (e) { err = e }
check('puerto cerrado: error y nada en vivo', err && live.status('prueba') === null, err?.message)

// ── Fase 5: métodos nuevos, eventos y capacidades ───────────────────────────

const mod3 = await fakeMod()
const h3 = hooks()
const live3 = createLiveBridge(h3.hooks, { callTimeoutMs: 2000 })
await live3.register('prueba', reg(mod3, { pid: 111 }))
const rl = await live3.call('prueba', 'reload.datapacks')
check('reload.datapacks devuelve problems', rl.result?.problems?.length === 1, rl)
await sleep(50)
check('datapack_error → actividad «error» con el problema', h3.activity.some((a) => a.kind === 'error' && /Errores al recargar datapacks \(1\): Failed to load function prueba:roto/.test(a.text)), h3.activity)
check('datapack_error se guarda como evento', live3.events('prueba').some((e) => e.type === 'datapack_error'))
const sub = await live3.call('prueba', 'events.subscribe', { types: ['*'] })
check('events.subscribe', JSON.stringify(sub.result?.subscribed) === '["*"]', sub)
// Espera a que lleguen los eventos (con el equipo cargado pueden tardar algo más)
for (let i = 0; i < 50 && !live3.events('prueba').some((e) => e.type === 'crash_imminent'); i++) await sleep(50)
const evs = live3.events('prueba')
check('eventos guardados (death, lag_spike, crash_imminent)', ['death', 'lag_spike', 'crash_imminent'].every((t) => evs.some((e) => e.type === t)), evs)
check('audit no se guarda como evento', !evs.some((e) => e.type === 'audit'))
check('crash_imminent → actividad «error»', h3.activity.some((a) => a.kind === 'error' && /sin memoria \(97 % de 4000 MB\)/.test(a.text)), h3.activity)
check('lag_spike y death no llenan la actividad', !h3.activity.some((a) => /lag_spike|death/.test(a.text)))
check('eventos por tipo', live3.events('prueba', undefined, ['death']).length === 1)
const lastAt = Math.max(...evs.map((e) => e.at))
check('eventos desde una marca de tiempo', live3.events('prueba', lastAt).length === 0 && live3.events('prueba', lastAt - 1).length >= 1)
for (const [m, p] of [['reload.resources', {}], ['capture.screenshot', { hideHud: true }], ['camera.set', { yaw: 10, pitch: 5 }], ['registry.list', {}], ['registry.dump', { registry: 'minecraft:worldgen/biome' }],
  ['inspect.block', { pos: [1, 2, 3] }], ['inspect.entity', { uuid: 'x' }], ['structure.place', { id: 'minecraft:igloo/top', pos: [0, 64, 0] }], ['player.teleport', { pos: [0, 70, 0] }],
  ['spark.run', { args: 'tps' }], ['metrics.get', { minutes: 5 }], ['metrics.mark', { kind: 'mod', target: 'sodium' }], ['metrics.compare', { id: 'marca123' }]]) {
  const r = await live3.call('prueba', m, p)
  check(`fase 5/6: ${m}`, r.result !== undefined, r)
}
// Sin la capacidad, no se pregunta al mod; inspect vale con inspect o con inspect.server
mod3.capabilitiesChanged(['state', 'inspect.server'])
await sleep(50)
const ins = await live3.call('prueba', 'inspect.block', { pos: [1, 2, 3] })
check('inspect.block vale con inspect.server', ins.result?.id === 'minecraft:stone', ins)
const noCap3 = await live3.call('prueba', 'capture.screenshot')
check('capture sin la capacidad: -32002', noCap3.error?.code === LIVE_ERRORS.CAPABILITY, noCap3)
mod3.capabilitiesChanged(['state'])
await sleep(50)
const noIns = await live3.call('prueba', 'inspect.entity', { uuid: 'x' })
check('inspect sin inspect ni inspect.server: -32002', noIns.error?.code === LIVE_ERRORS.CAPABILITY && /inspect o inspect\.server/.test(noIns.error.message), noIns)
check('auditText de métodos nuevos', auditText({ method: 'structure.place', detail: 'minecraft:igloo/top', ok: true }) === 'Estructura colocada: minecraft:igloo/top')
// Otra partida (otro proceso): los eventos empiezan de cero; la misma partida que se reconecta los conserva
await live3.register('prueba', reg(mod3, { pid: 111 }))
check('reconexión del mismo proceso conserva los eventos', live3.events('prueba').length > 0)
await live3.register('prueba', reg(mod3, { pid: 222 }))
check('otro proceso: eventos vacíos', live3.events('prueba').length === 0)
live3.closeAll()
await mod3.close()

// ── Fase 6: métricas y resultados (liveData.ts) ────────────────────────────

liveData.clearSession('prueba')
const sampleBase = { side: 'integrated', fps: { avg: 100, min: 40, p5: 60 }, mspt: { avg: 8, p95: 12, max: 40 }, tps: 20, memMb: { used: 500, max: 4000 },
  server: { topEntities: { 'minecraft:zombie': 20, 'minecraft:cow': 12 } }, log: { warnings: 0, errors: 0 }, lagSpikes: 1 }
liveData.addSample('prueba', { ...sampleBase, t: 1 })
liveData.addSample('prueba', { ...sampleBase, t: 2, fps: { avg: 80, p5: 40 }, mspt: { avg: 10, p95: 16 }, lagSpikes: 0 })
liveData.addSample('prueba', { ...sampleBase, t: 3, fps: { avg: 5 }, loadMs: { world: 8000 } }) // minuto con carga: no cuenta para FPS
const sum = liveData.summarizeSamples(liveData.getSamples('prueba'))
check('resumen: FPS sin contar el minuto de carga', sum.fpsAvg === 90 && sum.fpsP5 === 50, sum)
check('resumen: MSPT, lag, carga, memoria, entidades y muestras', sum.msptAvg === 9 && sum.msptP95 === 14 && sum.lagPerMin === 0.67 && sum.worldLoadMs === 8000 && sum.memMaxMb === 4000 && sum.topEntities['minecraft:zombie'] === 20 && sum.samples === 3, sum)
check('resumen: solo claves permitidas por las reglas', Object.keys(sum).every((k) => ['fpsAvg', 'fpsP5', 'msptAvg', 'msptP95', 'lagPerMin', 'worldLoadMs', 'dimLoadMs', 'memMaxMb', 'topEntities', 'samples'].includes(k)), Object.keys(sum))
liveData.clearSession('prueba')
check('una partida nueva empieza sin muestras', liveData.getSamples('prueba').length === 0)
const outcome = { kind: 'mod', target: 'Sodium Extra!', label: 'texto libre de la IA con C:/Users/pepe', before: { minutes: 10, counted: 9, fpsAvg: 57.6, msptAvg: 21.2, secreto: 1 }, after: { minutes: 6000, fpsAvg: 80 }, ranAfter: true, verdict: 'mejor', lessonId: 'abcdEFGH1234' }
const doc = liveData.outcomeDoc(outcome, { mc: '1.21.1', loader: 'fabric', v: '1.10.4', modVersion: '2.0.0', mods: ['sodium', 'Mal Id'] })
check('resultado: sin label', !('label' in doc) && !JSON.stringify(doc).includes('pepe'), doc)
check('resultado: target normalizado', doc.target === 'sodiumextra', doc.target)
check('resultado: solo claves permitidas en before/after y minutos ≤ 1440', !('secreto' in doc.before) && doc.after.minutes === 1440, doc)
check('resultado: mods válidos y lessonId', doc.mods.join() === 'sodium' && doc.lessonId === 'abcdEFGH1234', doc)
check('resultado: kind y verdict inventados se corrigen', liveData.outcomeDoc({ kind: 'hack', verdict: 'genial', before: {} }, { mc: '1.21.1', loader: 'fabric', v: 'x' }).kind === 'other' && liveData.outcomeDoc({ kind: 'hack', verdict: 'genial', before: {} }, { mc: '1.21.1', loader: 'fabric', v: 'x' }).verdict === 'sin datos')
check('resultado: sin before ni after no hay documento', liveData.outcomeDoc({ kind: 'mod' }, { mc: '1.21.1', loader: 'fabric', v: 'x' }) === null)
check('texto del resultado', liveData.outcomeText(outcome) === 'La IA cambió mod Sodium Extra!: mejor · FPS 58 → 80 · MSPT 21.2 → undefined'.replace(' · MSPT 21.2 → undefined', ''), liveData.outcomeText(outcome))

// ── De punta a punta: servidor MCP → puente (live/call) → partida ────────────
// El puente HTTP de aquí reproduce las acciones live/* de aiBridge.ts (que no se
// puede cargar sin Electron) usando el mismo liveBridge.

const mod2 = await fakeMod()
const live2 = createLiveBridge(h.hooks, { callTimeoutMs: 2000 })
const bridgeToken = crypto.randomBytes(24).toString('hex')
const bridgeSrv = http.createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
  if (req.headers.authorization !== `Bearer ${bridgeToken}`) return send(401, { error: 'Clave incorrecta' })
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  const m = req.url.match(/^\/instance\/([^/]+)\/(.+)$/)
  const id = decodeURIComponent(m?.[1] ?? '')
  switch (m?.[2]) {
    case 'live/register': live2.register(id, body).catch(() => {}); return send(200, { ok: true })
    case 'live/heartbeat': return live2.heartbeat(id, body) ? send(200, { ok: true }) : send(404, { error: 'Sin registrar' })
    case 'live/unregister': live2.unregister(id); return send(200, { ok: true })
    case 'live/call': {
      if (!live2.status(id)) return send(409, { error: 'La partida no está abierta con fport1-social instalado', code: -32000 })
      const r = await live2.call(id, String(body.method), body.params ?? {})
      return 'error' in r ? send(200, { error: r.error.message, code: r.error.code, motivo: r.error.hint }) : send(200, { result: r.result })
    }
    case 'live/events': {
      const evs = live2.events(id, body.since != null ? Number(body.since) : undefined, body.types)
      return send(200, { eventos: evs.slice(-100), total: evs.length, enVivo: !!live2.status(id) })
    }
    case 'live/metrics': return send(200, { ok: true, muestras: liveData.addSample(id, body) })
    case 'live/outcome': {
      liveData.addOutcome(id, body)
      h.activity.push({ instanceId: id, text: liveData.outcomeText(body), kind: body.verdict === 'peor' ? 'error' : 'info' })
      return send(200, { ok: true, subida: 'desactivado' })
    }
    default: return send(404, { error: 'Acción desconocida' })
  }
})
await new Promise((r) => bridgeSrv.listen(0, '127.0.0.1', r))
const tmp = path.dirname(outFile)
const bridgeFile = path.join(tmp, 'ai-bridge.json')
fs.writeFileSync(bridgeFile, JSON.stringify({ port: bridgeSrv.address().port, token: bridgeToken, pid: process.pid, version: 'prueba' }))
const mcpFile = path.join(tmp, 'modpack-mcp.cjs')
fs.writeFileSync(mcpFile, MCP_SCRIPT)
const env = { ...process.env, MODPACK_BRIDGE: bridgeFile, MODPACK_INSTANCE: 'prueba' }

function tool(name, args = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [mcpFile, name, ...Object.entries(args).map(([k, v]) => `${k}=${v}`)], { env })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('close', (code) => { try { resolve({ code, json: JSON.parse(out) }) } catch { resolve({ code, out }) } })
  })
}
function mcpList() {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [mcpFile], { env })
    let out = ''
    p.stdout.on('data', (d) => {
      out += d
      const lines = out.split('\n').filter(Boolean)
      if (lines.length >= 2) { p.kill(); resolve(JSON.parse(lines[1]).result.tools) }
    })
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n')
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n')
  })
}

/** Llamada MCP de verdad (JSON-RPC por stdio), como hace Claude Code: devuelve el `result` con su `content`. */
function mcpCall(name, args = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [mcpFile], { env })
    let out = ''
    p.stdout.on('data', (d) => {
      out += d
      const lines = out.split('\n').filter(Boolean)
      if (lines.length >= 2) { p.kill(); resolve(JSON.parse(lines[1]).result) }
    })
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n')
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }) + '\n')
  })
}
/** Lo que mandó la partida en la última llamada (el mod falso lo apunta). */
const lastCall = (m) => m.calls.at(-1)

const tools = await mcpList()
const names = tools.map((t) => t.name)
check('MCP: ofrece estado_en_vivo, rendimiento_en_vivo y ejecutar_comando', ['estado_en_vivo', 'rendimiento_en_vivo', 'ejecutar_comando'].every((n) => names.includes(n)), names)
const ej = tools.find((t) => t.name === 'ejecutar_comando')
check('MCP: ejecutar_comando pide comando y como (jugador|servidor)', ej.inputSchema.required.includes('comando') && ej.inputSchema.properties.como.enum.join() === 'jugador,servidor', ej.inputSchema)

const before = await tool('estado_en_vivo')
check('MCP sin partida: error claro', before.code === 1 && /no está abierta con fport1-social/.test(before.json?.error), before)

await live2.register('prueba', reg(mod2))
const beat = setInterval(() => live2.heartbeat('prueba', reg(mod2)), 10_000)
const est = await tool('estado_en_vivo')
check('MCP estado_en_vivo → state.get', est.code === 0 && est.json?.result?.dimension === 'minecraft:overworld', est)
const ren = await tool('rendimiento_en_vivo')
check('MCP rendimiento_en_vivo → perf.get', ren.code === 0 && ren.json?.result?.client?.fps === 144, ren)
const com = await tool('ejecutar_comando', { comando: 'time set noon', como: 'servidor' })
check('MCP ejecutar_comando como servidor → command.run as=server', com.code === 0 && com.json?.result?.command === 'time set noon', com)
const den = await tool('ejecutar_comando', { comando: 'denegar' })
check('MCP comando denegado: error con código y motivo', den.code === 1 && den.json?.code === -32005 && !!den.json?.motivo, den)

// Fase 5 por MCP: cada herramienta llega al método correcto con los parámetros traducidos
const NEW_TOOLS = ['recargar', 'captura', 'camara', 'registro_en_vivo', 'inspeccionar', 'colocar_estructura', 'ir_a', 'spark', 'observar_eventos', 'eventos_en_vivo', 'medir_cambio', 'comparar_cambio', 'metricas_en_vivo']
check('MCP: ofrece las herramientas de las fases 5 y 6', NEW_TOOLS.every((n) => names.includes(n)), NEW_TOOLS.filter((n) => !names.includes(n)))
await tool('recargar', { que: 'resource_packs' })
check('MCP recargar resource_packs → reload.resources', lastCall(mod2)?.method === 'reload.resources', lastCall(mod2))
const rec = await tool('recargar', { que: 'datapacks' })
check('MCP recargar datapacks → reload.datapacks con problems', lastCall(mod2)?.method === 'reload.datapacks' && rec.json?.result?.problems?.length === 1, rec)
await tool('registro_en_vivo')
check('MCP registro_en_vivo sin registro → registry.list', lastCall(mod2)?.method === 'registry.list')
await tool('registro_en_vivo', { registro: 'minecraft:worldgen/biome', filtro: 'plains', desde: 10, cuantos: 5 })
check('MCP registro_en_vivo con registro → registry.dump traducido', lastCall(mod2)?.method === 'registry.dump' && JSON.stringify(lastCall(mod2).params) === JSON.stringify({ registry: 'minecraft:worldgen/biome', filter: 'plains', offset: 10, limit: 5 }), lastCall(mod2))
await tool('inspeccionar', { pos: '1,64,-2' })
check('MCP inspeccionar pos → inspect.block [1,64,-2]', lastCall(mod2)?.method === 'inspect.block' && JSON.stringify(lastCall(mod2).params.pos) === '[1,64,-2]', lastCall(mod2))
await tool('inspeccionar', { uuid: 'abc' })
check('MCP inspeccionar uuid → inspect.entity', lastCall(mod2)?.method === 'inspect.entity' && lastCall(mod2).params.uuid === 'abc')
await tool('colocar_estructura', { archivo: 'estructuras/casa.nbt', pos: '0,64,0', rotacion: 'clockwise_90', espejo: 'none' })
check('MCP colocar_estructura → structure.place {file, pos, rotation, mirror}', lastCall(mod2)?.method === 'structure.place' && JSON.stringify(lastCall(mod2).params) === JSON.stringify({ file: 'estructuras/casa.nbt', pos: [0, 64, 0], rotation: 'clockwise_90', mirror: 'none' }), lastCall(mod2))
await tool('ir_a', { pos: '0,70,0', rotacion: '90,10', dimension: 'minecraft:the_nether' })
check('MCP ir_a → player.teleport {pos, rot, dimension}', lastCall(mod2)?.method === 'player.teleport' && JSON.stringify(lastCall(mod2).params) === JSON.stringify({ pos: [0, 70, 0], rot: [90, 10], dimension: 'minecraft:the_nether' }), lastCall(mod2))
await tool('camara', { yaw: 45, pitch: -10 })
check('MCP camara → camera.set', lastCall(mod2)?.method === 'camera.set' && lastCall(mod2).params.yaw === 45 && lastCall(mod2).params.pitch === -10, lastCall(mod2))
await tool('spark', { args: 'tps' })
check('MCP spark → spark.run', lastCall(mod2)?.method === 'spark.run' && lastCall(mod2).params.args === 'tps')
const mark = await tool('medir_cambio', { tipo: 'mod', objetivo: 'sodium', descripcion: 'probar sodium' })
check('MCP medir_cambio → metrics.mark {kind, target, label}', lastCall(mod2)?.method === 'metrics.mark' && JSON.stringify(lastCall(mod2).params) === JSON.stringify({ kind: 'mod', target: 'sodium', label: 'probar sodium' }) && mark.json?.result?.id === 'marca123', lastCall(mod2))
await tool('comparar_cambio', { id: 'marca123' })
check('MCP comparar_cambio → metrics.compare', lastCall(mod2)?.method === 'metrics.compare' && lastCall(mod2).params.id === 'marca123')
await tool('metricas_en_vivo', { minutos: 15 })
check('MCP metricas_en_vivo → metrics.get', lastCall(mod2)?.method === 'metrics.get' && lastCall(mod2).params.minutes === 15)

// Captura: vuelve como imagen MCP leída del disco (no por el WebSocket)
const cap = await mcpCall('captura', { ocultar_hud: true, rotacion: [30, 15] })
check('MCP captura → capture.screenshot {hideHud, rot}', lastCall(mod2)?.method === 'capture.screenshot' && JSON.stringify(lastCall(mod2).params) === JSON.stringify({ hideHud: true, rot: [30, 15] }), lastCall(mod2))
const imgPart = cap?.content?.find((c) => c.type === 'image')
check('MCP captura devuelve contenido de imagen PNG', imgPart?.mimeType === 'image/png' && Buffer.from(imgPart.data, 'base64').equals(PNG_1x1), cap?.content?.map((c) => c.type))

// Eventos por MCP
await tool('observar_eventos')
check('MCP observar_eventos → events.subscribe ["*"]', lastCall(mod2)?.method === 'events.subscribe' && JSON.stringify(lastCall(mod2).params.types) === '["*"]', lastCall(mod2))
for (let i = 0; i < 50 && !live2.events('prueba').some((e) => e.type === 'crash_imminent'); i++) await sleep(50)
const ev = await tool('eventos_en_vivo')
check('MCP eventos_en_vivo devuelve los eventos guardados', ev.code === 0 && ['death', 'lag_spike', 'crash_imminent', 'datapack_error'].every((t) => ev.json?.eventos?.some((e) => e.type === t)), ev.json)
const evDeath = await tool('eventos_en_vivo', { tipos: 'death' })
check('MCP eventos_en_vivo por tipo', evDeath.json?.eventos?.length === 1 && evDeath.json.eventos[0].type === 'death', evDeath.json)

// Lo que manda el mod por su cuenta (live/metrics y live/outcome)
const postBridge = (action, body) => new Promise((resolve) => {
  const data = Buffer.from(JSON.stringify(body))
  const r = http.request({ host: '127.0.0.1', port: bridgeSrv.address().port, path: `/instance/prueba/${action}`, method: 'POST', headers: { Authorization: `Bearer ${bridgeToken}`, 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
    let out = ''; res.on('data', (d) => (out += d)); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(out) }))
  })
  r.end(data)
})
liveData.clearSession('prueba')
const m1 = await postBridge('live/metrics', { ...sampleBase, t: Date.now() })
const m2 = await postBridge('live/metrics', { ...sampleBase, t: Date.now() + 60000 })
check('live/metrics acumula las muestras de la partida', m1.status === 200 && m2.json?.muestras === 2, m2)
const oc = await postBridge('live/outcome', { kind: 'config', target: 'prueba:zombis', label: '20 zombis más', before: { minutes: 10, fpsAvg: 90 }, after: { minutes: 5, fpsAvg: 60 }, ranAfter: true, verdict: 'peor' })
check('live/outcome responde y no sube nada (reglas pendientes)', oc.status === 200 && oc.json?.subida === 'desactivado', oc)
check('live/outcome se muestra como actividad', h.activity.some((a) => a.text === 'La IA cambió config prueba:zombis: peor · FPS 90 → 60' && a.kind === 'error'), h.activity.slice(-3))

mod2.capabilitiesChanged(['state', 'perf'])
await sleep(50)
const sinCap = await tool('ejecutar_comando', { comando: 'say hola' })
check('MCP sin la capacidad command: -32002', sinCap.code === 1 && sinCap.json?.code === -32002, sinCap)
clearInterval(beat)
live2.closeAll()
await mod2.close()
bridgeSrv.close()

// La clave del mod nunca aparece en la actividad
check('la clave no sale en la actividad', !h.activity.some((a) => a.text.includes(mod.token)))
check('auditText legible', auditText({ client: 'otra-ia', method: 'command.server', detail: 'stop', ok: false }) === 'Comando en el servidor: stop (desde otra-ia) (falló)')

live.closeAll()
fs.rmSync(path.dirname(outFile), { recursive: true, force: true })
console.log(failures ? `\n${failures} comprobaciones fallidas` : '\nTodo correcto')
process.exit(failures ? 1 : 0)
