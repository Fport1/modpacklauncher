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
    description: 'Abre Minecraft con esta instancia desde el launcher y espera a que llegue al menú o se cierre. Devuelve state (running | crashed | exited | launch-failed), exitCode, errorLines, logTail y, si crasheó, crashReport y knownFixes (arreglos que ya funcionaron a otros con este mismo crash: pruébalos primero). Úsalo tras cada cambio para comprobar si el arreglo funciona.',
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
  { name: 'leer_archivo', route: 'files/read',
    description: 'Lee y ENTIENDE cualquier archivo de la instancia (o de los compartidos con el prefijo shared:, p. ej. shared:versions/1.21.1/1.21.1.jar): texto en cualquier codificación, JSON, configs; NBT (.dat, level.dat, playerdata, .nbt, scoreboard) en SNBT; regiones .mca (resumen o un chunk con chunk={x,z}); comprimidos .zip/.jar/.mrpack/.rar (lista, o un archivo de dentro con entrada, y uno dentro de otro con «!/»); clases Java (.class) con nombres reales aunque el juego esté ofuscado; modelos (Java, Bedrock/GeckoLib .geo.json, animaciones, Blockbench .bbmodel, OBJ) y esquemáticas (.nbt de estructura, .schem, .schematic, .litematic) con un análisis de lo que contienen.',
    input: S({ ruta: str('ruta relativa a la carpeta del juego, o shared:...'), entrada: str('archivo dentro de un comprimido (p. ej. fabric.mod.json o META-INF/jars/x.jar!/fabric.mod.json)'), filtro: str('filtrar la lista de un comprimido, p. ej. *.json o assets/*/geo/*'), chunk: { type: 'object', properties: { x: { type: 'number' }, z: { type: 'number' } }, description: 'chunk de una región .mca' }, crudo: bool('sin análisis, solo el contenido') }, ['ruta']),
    map: (a) => ({ path: a.ruta, entry: a.entrada, filter: a.filtro, chunk: a.chunk, raw: a.crudo }) },
  { name: 'editar_nbt', route: 'files/nbt',
    description: 'Cambia UN valor de un archivo NBT (level.dat, playerdata, data/*.dat, estructuras .nbt) por su camino, conservando el tipo. Guarda copia en .ia-bak. Con el juego cerrado.',
    input: S({ ruta: str('ruta relativa a la carpeta del juego'), camino: str('p. ej. Data.GameRules.keepInventory, Inventory[0].count, data.minecraft:keep_inventory'), valor: str('valor en SNBT: 1b, 20.0f, 64, texto…') }, ['ruta', 'camino', 'valor']),
    map: (a) => ({ path: a.ruta, nbtPath: a.camino, value: a.valor }) },
  { name: 'desofuscar', route: 'deobf',
    description: 'Traduce a nombres reales un crash, log o stack trace de una versión ofuscada (hasta 1.21.11): nombres de Fabric (class_1234, method_5678, field_12) y ofuscados de vanilla (at abc.a(...)). Usa los mapeos oficiales de Mojang. Desde 26.1 el juego ya no está ofuscado. Los crashes de lanzar_juego y crashes ya vienen traducidos en textoConNombresReales.',
    input: S({ texto: str('texto a traducir'), ruta: str('o un archivo de la instancia (p. ej. logs/latest.log)'), version: str('versión de Minecraft si no es la de la instancia') }),
    map: (a) => ({ text: a.texto, path: a.ruta, version: a.version }) },
  { name: 'ver_clase', route: 'class',
    description: 'Campos y métodos de una clase del juego (por su nombre REAL, p. ej. net.minecraft.world.entity.monster.Zombie, aunque el jar esté ofuscado) o de un mod instalado. Útil para mixins, para entender un crash o para programar un mod.',
    input: S({ clase: str('nombre completo o simple de la clase') }, ['clase']), map: (a) => ({ name: a.clase }) },
  { name: 'escribir_archivo', route: 'files/write', description: 'Escribe un archivo de texto de la instancia (config de un mod, options.txt…). El launcher guarda antes una copia en .ai/copias. Mejor con el juego cerrado.',
    input: S({ ruta: str('Ruta relativa a la carpeta del juego'), texto: str('Contenido completo nuevo') }, ['ruta', 'texto']), map: (a) => ({ path: a.ruta, text: a.texto }) },
  { name: 'registro', route: 'registry',
    description: 'Lo que EXISTE en esta instancia (vanilla de esta versión exacta + mods activos + datapacks del mundo): ítems, bloques, entidades, efectos, biomas, dimensiones, tipos de dimensión, estructuras, features, ruido/worldgen, encantamientos, recetas, loot tables, logros, funciones, tags, texturas, modelos, sonidos, shaders, reglas del juego, tipos de daño. Sin tipo devuelve el resumen de tipos y namespaces. Úsalo antes de escribir cualquier id.',
    input: S({ tipo: str('item, block, entity, effect, biome, dimension, dimension_type, structure, feature, noise, enchantment, recipe, loot_table, advancement, function, tag, texture, model, geo (modelos GeckoLib), animation, particle, sound, shader, gamerule, damage_type (o un tipo real del resumen, p. ej. worldgen/placed_feature)'), buscar: str('texto a buscar en id o nombre'), namespace: str('p. ej. minecraft o el id de un mod'), mundo: str('para incluir los datapacks de ese mundo'), limite: num('máximo de resultados (300)') }),
    map: (a) => ({ type: a.tipo, search: a.buscar, namespace: a.namespace, world: a.mundo, limit: a.limite }) },
  { name: 'ver_recurso', route: 'resource',
    description: 'Contenido real de un recurso del juego o de un mod: el JSON de un bioma, dimensión, receta, loot table, modelo, blockstate, el .mcfunction, un shader… Úsalo como base para crear o modificar (cópialo y cámbialo). Las texturas, sonidos y estructuras .nbt se extraen a .ai/extraidos y te da la ruta para abrirlas.',
    input: S({ tipo: str('tipo como en registro'), id: str('namespace:id'), ruta: str('o la ruta exacta dentro del jar (data/... o assets/...)'), mundo: str('si viene de un datapack del mundo'), extraer: bool('guardar una copia en .ai/extraidos') }),
    map: (a) => ({ type: a.tipo, id: a.id, path: a.ruta, world: a.mundo, extract: a.extraer }) },
  { name: 'mundo', route: 'world',
    description: 'Sin mundo: lista los mundos. Con mundo: versión, modo, dificultad, reglas, dimensiones (también las de mods y datapacks) y cómo se genera cada una (generador, fuente de biomas), cuánto se ha explorado de cada dimensión, datapacks activos, jugador (dimensión, posición, vida) y estadísticas (mobs matados, qué le mató, bloques minados, muertes, minutos). Sirve para ver cómo se comporta el juego con los cambios.',
    input: S({ mundo: str('carpeta del mundo en saves/') }), map: (a) => ({ world: a.mundo }) },
  { name: 'regla_mundo', route: 'world/rule', description: 'Cambia una regla del juego (gamerule) de un mundo con el juego cerrado. Con el juego abierto usa /gamerule.',
    input: S({ mundo: str('carpeta del mundo'), regla: str('p. ej. keepInventory, doMobSpawning, randomTickSpeed'), valor: str('true/false o número') }, ['mundo', 'regla', 'valor']), map: (a) => ({ world: a.mundo, rule: a.regla, value: a.valor }) },
  { name: 'copiar_mundo', route: 'world/copy', description: 'Hace una copia de un mundo para experimentar (worldgen, mobs, mecánicas, datapacks) sin tocar el original.',
    input: S({ mundo: str('carpeta del mundo'), nombre: str('nombre de la copia (opcional)') }, ['mundo']), map: (a) => ({ world: a.mundo, name: a.nombre }) },
  { name: 'crear_proyecto', route: 'project/create',
    description: 'Crea el esqueleto de un proyecto con el pack_format y las carpetas correctas para la versión de la instancia: datapack (con load/tick), resourcepack, shader (Iris/OptiFine) o mod (instrucciones y enlace al generador oficial con las versiones exactas). Por defecto en .ai/proyectos; luego enlázalo con enlazar_proyecto.',
    input: S({ tipo: { type: 'string', enum: ['datapack', 'resourcepack', 'shader', 'mod'] }, nombre: str('nombre del proyecto'), carpeta: str('carpeta donde crearlo (opcional)'), namespace: str('namespace / mod id (opcional)'), descripcion: str('descripción (opcional)') }, ['tipo', 'nombre']),
    map: (a) => ({ kind: a.tipo, name: a.nombre, folder: a.carpeta, namespace: a.namespace, description: a.descripcion }) },
  { name: 'validar_pack', route: 'project/validate',
    description: 'Revisa un datapack o resource pack antes de probarlo: JSON válido, pack_format de esta versión, carpetas con el nombre correcto (singular/plural según versión) e ítems/bloques/entidades que no existen en la instancia.',
    input: S({ ruta: str('ruta absoluta de la carpeta del pack'), mundo: str('mundo, para tener en cuenta sus otros datapacks') }, ['ruta']), map: (a) => ({ path: a.ruta, world: a.mundo }) },
  { name: 'documentacion', route: 'docs', timeout: 180000,
    description: 'Documentación A FONDO de un mod (instalado o no): su wiki oficial, su sitio de documentación, README y la documentación que trae dentro del jar. Sin página: índice de páginas. Con pagina: esa página completa. Con buscar: fragmentos que hablan de eso en toda la documentación. Úsala antes de configurar o usar un mod en serio (comandos, formatos de archivo, permisos, API) en vez de fiarte de lo que recuerdes.',
    input: S({ mod: str('id del mod, nombre o slug de Modrinth (p. ej. plasmovoice, voicechat, worldedit, axiom, cpm, entity_model_features, polytone, flashback)'), pagina: str('título de la página'), buscar: str('texto a buscar, p. ej. "permissions" o ".jem"'), actualizar: bool('volver a descargarla') }, ['mod']),
    map: (a) => ({ mod: a.mod, page: a.pagina, search: a.buscar, refresh: a.actualizar }) },
  { name: 'experiencia_comunidad', route: 'community',
    description: 'Lo que se sabe por las partidas de otros jugadores (anónimo): con un mod concreto o con esta versión y loader — % de crashes, tiempo de carga, avisos de lag y errores por partida, qué origen genera más avisos, mods que se usan junto, dimensiones jugadas, mobs y causas de muerte, comparado con la media de la versión. Útil antes de añadir un mod o para diagnosticar rendimiento.',
    input: S({ mod: str('id del mod (opcional)') }), map: (a) => ({ mod: a.mod }) },
  { name: 'lecciones', route: 'lessons', description: 'Lo aprendido antes: local = .ai/lecciones.md de este modpack; community = lecciones de otros jugadores (crashes, configs, compatibilidad, construcción, mundo, rendimiento, mecánicas) que encajan con estos mods, esta versión y el tema, ordenadas por lo que funcionó. Úsalo antes de diagnosticar Y antes de construir algo.',
    input: S({ tipo: { type: 'string', enum: ['crash', 'config', 'compatibilidad', 'construccion', 'mundo', 'rendimiento', 'mecanica'] }, tema: str('de qué va, p. ej. "bioma personalizado" o "item model 1.21.4"') }), map: (a) => ({ kind: a.tipo, topic: a.tema }) },
  { name: 'valorar_leccion', route: 'lessons/rate', description: 'Después de probar una lección de la comunidad (de lecciones o de knownFixes al crashear), di si funcionó. Así las buenas suben y las malas bajan para todos.',
    input: S({ id: str('id de la lección'), funciono: bool('true si arregló el problema') }, ['id', 'funciono']), map: (a) => ({ id: a.id, worked: a.funciono }) },
  { name: 'anotar_leccion', route: 'lessons/add', description: 'Guarda lo aprendido (un crash arreglado, una config que funciona, una incompatibilidad, cómo se hace algo en esta versión al construir, worldgen, rendimiento, mecánicas) en .ai/lecciones.md y, si el usuario lo permite, lo comparte anónimamente (sin rutas ni nombres) ligado al crash que resolvió, para que a otros jugadores se les arregle a la primera. Escribe el síntoma con la línea exacta del log o del crash.',
    input: S({ tipo: { type: 'string', enum: ['crash', 'config', 'compatibilidad', 'construccion', 'mundo', 'rendimiento', 'mecanica'] }, titulo: str('Resumen corto'), sintoma: str('Qué se veía o qué se quería hacer (línea clave del log, error de /reload…)'), causa: str('Causa real o lo que no era obvio'), arreglo: str('Qué funcionó'), mods: str('Mods/packs implicados') }, ['tipo', 'titulo', 'sintoma', 'causa', 'arreglo']),
    map: (a) => ({ kind: a.tipo, title: a.titulo, symptom: a.sintoma, cause: a.causa, fix: a.arreglo, mods: a.mods }) },
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
