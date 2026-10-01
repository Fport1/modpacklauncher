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
// El servidor MCP que usan las IAs (es un texto dentro de aiMcpScript.ts)
const mcpOut = path.join(path.dirname(outFile), 'aiMcpScript.cjs')
await build({ entryPoints: [path.join(root, 'src/main/aiMcpScript.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: mcpOut, logLevel: 'error' })
const { MCP_SCRIPT } = createRequire(import.meta.url)(mcpOut)

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
