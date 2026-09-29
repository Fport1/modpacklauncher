// Servidor MCP (stdio) y orden de consola que se deja en userData/ai para que
// cualquier IA controle una instancia a través del puente local (aiBridge.ts).
// Es JavaScript plano sin dependencias: se ejecuta con el propio ejecutable del
// launcher en modo Node (ELECTRON_RUN_AS_NODE=1), así no hace falta tener Node.
//
//   MCP:     modpack-mcp.cjs            (lo arranca Claude Code, Cursor, Gemini…)
//   Consola: modpack-mcp.cjs <herramienta> clave=valor …
//
// Nota: el texto del script no usa comillas invertidas para poder ir dentro de
// esta plantilla sin escapar nada.

export const MCP_SCRIPT = `'use strict'
const fs = require('fs')
const http = require('http')

const BRIDGE = process.env.MODPACK_BRIDGE
const INSTANCE = process.env.MODPACK_INSTANCE

function bridge() {
  try { return JSON.parse(fs.readFileSync(BRIDGE, 'utf8')) } catch { return null }
}

function call(route, body, timeoutMs) {
  return new Promise((resolve) => {
    const b = bridge()
    if (!b) return resolve({ error: 'El launcher no está abierto. Pide al usuario que abra Modpack Launcher y vuelve a intentarlo.' })
    const data = Buffer.from(JSON.stringify(body || {}))
    const req = http.request({ host: '127.0.0.1', port: b.port, path: route, method: 'POST', timeout: timeoutMs || 30000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Authorization: 'Bearer ' + b.token } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { resolve({ error: String(e) }) } })
    })
    req.on('timeout', () => { req.destroy(); resolve({ error: 'El launcher tardó demasiado en responder' }) })
    req.on('error', () => resolve({ error: 'El launcher no está abierto (o se cerró). Pide al usuario que lo abra.' }))
    req.end(data)
  })
}

const S = (props, required) => ({ type: 'object', properties: props || {}, required: required || [] })
const str = (d) => ({ type: 'string', description: d })
const num = (d) => ({ type: 'number', description: d })
const bool = (d) => ({ type: 'boolean', description: d })
const src = { type: 'string', enum: ['modrinth', 'curseforge'], description: 'Fuente del mod (por defecto modrinth)' }

const kind = { type: 'string', enum: ['mod', 'resourcepack', 'shader', 'datapack'], description: 'Tipo de contenido (por defecto mod)' }
const world = str('Carpeta del mundo en saves/ (obligatorio para datapacks)')

const TOOLS = [
  { name: 'lanzar_juego', route: 'launch', timeout: 660000,
    description: 'Abre Minecraft con esta instancia desde el launcher y espera a que llegue al menú o se cierre. Devuelve state (running | crashed | exited | launch-failed), exitCode, errorLines, logTail y crashReport si crasheó. Úsalo tras cada cambio para comprobar si el arreglo funciona.',
    input: S({ esperar_segundos: num('Máximo a esperar (por defecto 240)') }), map: (a) => ({ waitSeconds: a.esperar_segundos }) },
  { name: 'cerrar_juego', route: 'stop', description: 'Cierra el juego de esta instancia si está abierto.', input: S() },
  { name: 'estado_juego', route: 'state', description: 'Si el juego está abierto y el resumen de la última ejecución (errores, final del log).', input: S() },
  { name: 'leer_log', route: 'log', description: 'Últimas líneas de logs/latest.log, opcionalmente filtradas por una expresión regular.',
    input: S({ lineas: num('Cuántas (por defecto 300)'), filtro: str('Regex, p. ej. "ERROR|Exception"') }), map: (a) => ({ lines: a.lineas, filter: a.filtro }) },
  { name: 'crashes', route: 'crashes', description: 'Lista los crash reports y devuelve el contenido del más reciente (también hs_err_pid de la JVM).', input: S() },
  { name: 'listar_contenido', route: 'content',
    description: 'Lo instalado de un tipo. Mods: archivo, activo, nombre, modIds, requires (dependencias), fuente y proyecto, si hay actualización. Resource packs y shaders: archivos y cuál está seleccionado. Datapacks: sin mundo lista los mundos; con mundo, sus datapacks.',
    input: S({ tipo: kind, mundo: world }), map: (a) => ({ kind: a.tipo, world: a.mundo }) },
  { name: 'activar', route: 'toggle', description: 'Activa o desactiva un mod, resource pack, shader o datapack de un mundo. Reversible.',
    input: S({ tipo: kind, archivo: str('Nombre del archivo (o id del datapack)'), activo: bool('true para activar, false para desactivar'), mundo: world }, ['archivo', 'activo']),
    map: (a) => ({ kind: a.tipo, filename: a.archivo, enabled: a.activo, world: a.mundo }) },
  { name: 'quitar', route: 'remove', description: 'Quita un mod/pack moviéndolo a .ai/papelera (se puede restaurar).',
    input: S({ tipo: kind, archivo: str('Nombre del archivo'), mundo: world }, ['archivo']), map: (a) => ({ kind: a.tipo, filename: a.archivo, world: a.mundo }) },
  { name: 'restaurar', route: 'restore', description: 'Devuelve a su sitio algo que se quitó a .ai/papelera.',
    input: S({ tipo: kind, archivo: str('Nombre del archivo'), mundo: world }, ['archivo']), map: (a) => ({ kind: a.tipo, filename: a.archivo, world: a.mundo }) },
  { name: 'buscar', route: 'search', description: 'Busca mods, resource packs, shaders o datapacks compatibles con la versión (y el loader) de la instancia.',
    input: S({ tipo: kind, texto: str('Qué buscar'), fuente: src }, ['texto']), map: (a) => ({ kind: a.tipo, query: a.texto, source: a.fuente }) },
  { name: 'versiones', route: 'versions', description: 'Versiones de un proyecto para esta versión de Minecraft (y loader), con fechas.',
    input: S({ tipo: kind, proyecto: str('slug/id de Modrinth o id numérico de CurseForge'), fuente: src }, ['proyecto']), map: (a) => ({ kind: a.tipo, project: a.proyecto, source: a.fuente }) },
  { name: 'instalar', route: 'install', timeout: 300000,
    description: 'Instala un mod, resource pack, shader o datapack (la última versión estable o la indicada). Para cambiar de versión pasa reemplaza = archivo actual: el viejo va a .ai/papelera.',
    input: S({ tipo: kind, proyecto: str('slug/id de Modrinth o id de CurseForge'), fuente: src, version: str('id o número de versión (opcional)'), reemplaza: str('archivo que sustituye (opcional)'), mundo: world }, ['proyecto']),
    map: (a) => ({ kind: a.tipo, project: a.proyecto, source: a.fuente, version: a.version, replaceFilename: a.reemplaza, world: a.mundo }) },
  { name: 'copiar_archivo', route: 'install-file',
    description: 'Copia un archivo a la instancia: el .jar compilado de un mod en desarrollo, o un pack .zip (resource pack, shader, datapack con mundo).',
    input: S({ tipo: kind, ruta: str('Ruta absoluta del archivo'), mundo: world }, ['ruta']), map: (a) => ({ kind: a.tipo, path: a.ruta, world: a.mundo }) },
  { name: 'enlazar_proyecto', route: 'link',
    description: 'Enlaza la carpeta de un proyecto de datapack, resource pack o shader a la instancia. Lo que edites en el proyecto se ve en el juego al recargar (/reload, F3+T o R), sin copiar nada.',
    input: S({ tipo: kind, carpeta_proyecto: str('Ruta absoluta del proyecto'), mundo: world, nombre: str('Nombre dentro de la instancia (opcional)') }, ['tipo', 'carpeta_proyecto']),
    map: (a) => ({ kind: a.tipo, projectDir: a.carpeta_proyecto, world: a.mundo, name: a.nombre }) },
  { name: 'listar_archivos', route: 'files', description: 'Lista una carpeta de la instancia (por defecto config/). Sirve para encontrar configs, options.txt, defaultconfigs, serverconfig…',
    input: S({ ruta: str('Ruta relativa a la carpeta del juego') }), map: (a) => ({ path: a.ruta }) },
  { name: 'leer_archivo', route: 'files/read', description: 'Lee un archivo de texto de la instancia (config de un mod, options.txt…).',
    input: S({ ruta: str('Ruta relativa a la carpeta del juego') }, ['ruta']), map: (a) => ({ path: a.ruta }) },
  { name: 'escribir_archivo', route: 'files/write', description: 'Escribe un archivo de texto de la instancia (config de un mod, options.txt…). El launcher guarda antes una copia en .ai/copias. Mejor con el juego cerrado.',
    input: S({ ruta: str('Ruta relativa a la carpeta del juego'), texto: str('Contenido completo nuevo') }, ['ruta', 'texto']), map: (a) => ({ path: a.ruta, text: a.texto }) },
  { name: 'lecciones', route: 'lessons', description: 'Lee .ai/lecciones.md: lo aprendido en arreglos anteriores de este modpack. Léelo antes de diagnosticar.', input: S() },
  { name: 'anotar_leccion', route: 'lessons/add', description: 'Guarda en .ai/lecciones.md lo aprendido tras arreglar algo, para detectarlo antes la próxima vez.',
    input: S({ titulo: str('Resumen corto'), sintoma: str('Qué se veía (línea clave del log/crash)'), causa: str('Causa real'), arreglo: str('Qué lo arregló'), mods: str('Mods/packs implicados') }, ['titulo', 'sintoma', 'causa', 'arreglo']),
    map: (a) => ({ title: a.titulo, symptom: a.sintoma, cause: a.causa, fix: a.arreglo, mods: a.mods }) },
]

async function run(name, args) {
  const t = TOOLS.find((x) => x.name === name)
  if (!t) return { error: 'Herramienta desconocida: ' + name }
  if (!INSTANCE) return { error: 'Falta MODPACK_INSTANCE' }
  return call('/instance/' + encodeURIComponent(INSTANCE) + '/' + t.route, t.map ? t.map(args || {}) : {}, t.timeout)
}

// ── Modo consola ──
const argv = process.argv.slice(2)
if (argv.length) {
  if (argv[0] === 'ayuda' || argv[0] === 'help' || argv[0] === '--help') {
    console.log('Uso: launcher <herramienta> clave=valor ...\\n')
    for (const t of TOOLS) console.log('  ' + t.name + '  ' + Object.keys(t.input.properties).map((k) => k + '=').join(' ') + '\\n      ' + t.description)
    process.exit(0)
  }
  const args = {}
  for (const kv of argv.slice(1)) {
    const i = kv.indexOf('=')
    const k = i < 0 ? kv : kv.slice(0, i)
    let v = i < 0 ? true : kv.slice(i + 1)
    if (v === 'true') v = true; else if (v === 'false') v = false; else if (typeof v === 'string' && /^\\d+$/.test(v)) v = Number(v)
    args[k] = v
  }
  run(argv[0], args).then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r && r.error ? 1 : 0) })
} else {
  // ── Modo MCP (JSON-RPC por líneas en stdin/stdout) ──
  const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) handle(line)
    }
  })
  process.stdin.on('end', () => process.exit(0))

  async function handle(line) {
    let msg
    try { msg = JSON.parse(line) } catch { return }
    const { id, method, params } = msg
    if (id === undefined) return
    try {
      if (method === 'initialize') {
        return out({ jsonrpc: '2.0', id, result: {
          protocolVersion: (params && params.protocolVersion) || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'modpack-launcher', version: '1.0.0' },
          instructions: 'Herramientas para probar, arreglar y editar esta instancia de Minecraft a través de Modpack Launcher (mods, resource packs, shaders, datapacks y configs). Todo cambio pasa por el launcher, que lo muestra al usuario y, si así está configurado, le pide permiso. Tras cada cambio usa lanzar_juego para comprobarlo. Lee lecciones antes de diagnosticar y usa anotar_leccion al terminar.',
        } })
      }
      if (method === 'ping') return out({ jsonrpc: '2.0', id, result: {} })
      if (method === 'tools/list') {
        return out({ jsonrpc: '2.0', id, result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input })) } })
      }
      if (method === 'tools/call') {
        const r = await run(params.name, params.arguments)
        return out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !!(r && r.error) } })
      }
      out({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Método no soportado: ' + method } })
    } catch (e) {
      out({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e && e.message || e) } })
    }
  }
}
`
