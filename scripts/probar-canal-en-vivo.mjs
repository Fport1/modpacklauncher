// Prueba del canal en vivo (src/main/liveBridge.ts) sin Minecraft ni Electron.
//
// Levanta un mod fport1-social falso (WebSocket JSON-RPC en un puerto aleatorio
// de 127.0.0.1, con su clave) y ejercita live/register, live/heartbeat,
// live/unregister y live/call tal como los usa el puente del launcher.
//
// Uso: node scripts/probar-canal-en-vivo.mjs
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { WebSocketServer } from 'ws'
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

// ── Mod falso ───────────────────────────────────────────────────────────────

const ALL_CAPS = ['state', 'perf', 'command', 'command.server', 'nbt', 'perf.server']

function fakeMod({ instance = 'prueba', caps = ALL_CAPS } = {}) {
  const token = crypto.randomBytes(24).toString('base64url')
  const sockets = new Set()
  const wss = new WebSocketServer({
    host: '127.0.0.1', port: 0, path: '/fport1-ai',
    verifyClient: ({ req }) => !req.headers.origin && req.headers.authorization === `Bearer ${token}`,
  })
  const mod = { token, wss, sockets, helloClient: null, port: 0, caps: [...caps] }
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
      switch (method) {
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

// La clave del mod nunca aparece en la actividad
check('la clave no sale en la actividad', !h.activity.some((a) => a.text.includes(mod.token)))
check('auditText legible', auditText({ client: 'otra-ia', method: 'command.server', detail: 'stop', ok: false }) === 'Comando en el servidor: stop (desde otra-ia) (falló)')

live.closeAll()
fs.rmSync(path.dirname(outFile), { recursive: true, force: true })
console.log(failures ? `\n${failures} comprobaciones fallidas` : '\nTodo correcto')
process.exit(failures ? 1 : 0)
