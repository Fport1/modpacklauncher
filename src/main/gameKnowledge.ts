import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import AdmZip from 'adm-zip'
import nbt from 'prismarine-nbt'
import { getInstanceGameDir, getSharedDir, listMods } from './instances'
import { nbtReadLocal, nbtWriteLocal } from './nbt'
import { safeJoin } from './paths'
import { describeModel, inspectFile } from './fileInspect'
import type { Instance } from '../shared/types'

// Lo que la IA necesita saber del juego para CONSTRUIR (mods, datapacks,
// resource packs, shaders, mundos) y no inventarse nada:
//
// - Registro: todos los recursos que existen en ESTA instancia — ítems,
//   bloques, entidades, biomas, dimensiones, estructuras, features, recetas,
//   loot tables, encantamientos, tags, texturas, modelos, sonidos… — sacados
//   del jar de la versión exacta de Minecraft, de cada mod activo y de los
//   datapacks de un mundo. Con nombre visible (lang) cuando lo hay.
// - Recursos: el contenido real de cualquiera de ellos (p. ej. el JSON de un
//   bioma vanilla para copiarlo y crear uno nuevo, o la textura de un bloque).
// - Mundos: modo, dificultad, reglas, dimensiones (también las de mods), cómo
//   se genera cada una, estadísticas del jugador (mobs matados, muertes…).
// - Proyectos: esqueleto correcto para la versión (pack_format y carpetas) y
//   validación antes de probar en el juego.

export interface RegEntry { id: string; src: string; path: string; name?: string }
type Registry = Record<string, RegEntry[]>

// Carpetas de data/ que en 1.21 pasaron de plural a singular
const SINGULAR: Record<string, string> = {
  recipes: 'recipe', loot_tables: 'loot_table', advancements: 'advancement', functions: 'function', structures: 'structure',
  predicates: 'predicate', item_modifiers: 'item_modifier',
}

/** Tipo e id de un archivo de un jar/pack: data/<ns>/<tipo…>/<id>.<ext> o assets/<ns>/<tipo…>/<id>.<ext>. */
function classify(entry: string): { type: string; id: string } | null {
  const m = /^(data|assets)\/([a-z0-9_.-]+)\/(.+)\.(json|mcfunction|nbt|png|ogg|fsh|vsh|glsl|mcmeta|properties|txt)$/.exec(entry)
  if (!m) return null
  const [, root, ns, rest, ext] = m
  if (ext === 'mcmeta') return null
  // Datapacks integrados dentro del jar (bundle, trade_rebalance…): no son contenido activo
  if (root === 'data' && rest.startsWith('datapacks/')) return null
  const seg = rest.split('/')
  let typeLen = 1
  if (root === 'data') {
    if (seg[0] === 'worldgen' || seg[0] === 'neoforge' || seg[0] === 'fabric' || seg[0] === 'forge') typeLen = 2
    else if (seg[0] === 'tags') typeLen = seg[1] === 'worldgen' ? 3 : 2
  } else {
    // assets: textures/<carpeta>, models/<carpeta>; el resto (blockstates, items, lang, sounds, shaders…) de un nivel
    if ((seg[0] === 'textures' || seg[0] === 'models') && seg.length > 2) typeLen = 2
  }
  if (seg.length <= typeLen) return null
  let type = seg.slice(0, typeLen).join('/')
  if (root === 'data') type = SINGULAR[type] ?? type
  if (root === 'assets') type = `assets:${type}`
  if (type === 'assets:lang') return null
  return { type, id: `${ns}:${seg.slice(typeLen).join('/')}` }
}

function addZip(reg: Registry, zipPath: string, src: string, names: Record<string, string>): void {
  let zip: AdmZip
  try { zip = new AdmZip(zipPath) } catch { return }
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue
    const c = classify(e.entryName)
    if (c) (reg[c.type] ??= []).push({ id: c.id, src, path: e.entryName })
    const lang = /^assets\/[^/]+\/lang\/(en_us|es_es)\.json$/.exec(e.entryName)
    if (lang) {
      try {
        const obj = JSON.parse(e.getData().toString('utf8')) as Record<string, string>
        for (const [k, v] of Object.entries(obj)) if (!names[k] || lang[1] === 'es_es') names[k] = v
      } catch { /* lang en otro formato */ }
    }
  }
}

function addFolder(reg: Registry, dir: string, src: string): void {
  const walk = (d: string, rel: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(d, e.name), r)
      else { const c = classify(r); if (c) (reg[c.type] ??= []).push({ id: c.id, src, path: r }) }
    }
  }
  try { walk(dir, '') } catch { /* carpeta ilegible */ }
}

/** Idioma vanilla: está en assets/objects (índice de assets de la versión), no en el jar. */
async function vanillaLang(mc: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    const shared = getSharedDir()
    const vjson = await fs.readJson(path.join(shared, 'versions', mc, `${mc}.json`))
    const index = await fs.readJson(path.join(shared, 'assets', 'indexes', `${vjson.assetIndex?.id}.json`))
    for (const lang of ['minecraft/lang/en_us.json', 'minecraft/lang/es_es.json']) {
      const hash = index.objects?.[lang]?.hash
      if (!hash) continue
      Object.assign(out, await fs.readJson(path.join(shared, 'assets', 'objects', hash.slice(0, 2), hash)).catch(() => ({})))
    }
  } catch { /* versión no descargada todavía */ }
  return out
}

interface Built { reg: Registry; names: Record<string, string>; vanilla: boolean }
const memo = new Map<string, Built>()

/** Registro de la instancia (vanilla + mods activos + datapacks del mundo indicado), con caché. */
export async function buildRegistry(inst: Instance, world?: string): Promise<Built> {
  const gameDir = await getInstanceGameDir(inst.id)
  const jar = path.join(getSharedDir(), 'versions', inst.minecraft, `${inst.minecraft}.jar`)
  const mods = (await listMods(inst.id).catch(() => [])).filter((m) => m.enabled && m.filename.endsWith('.jar'))
  const packDirs: { path: string; src: string }[] = []
  if (world) {
    const dp = safeJoin(path.join(gameDir, 'saves'), path.join(world, 'datapacks'))
    for (const n of await fs.readdir(dp).catch(() => [] as string[])) packDirs.push({ path: path.join(dp, n), src: `datapack:${n}` })
  }
  const stamp = async (p: string): Promise<string> => { const st = await fs.stat(p).catch(() => null); return st ? `${p}|${st.size}|${Math.round(st.mtimeMs)}` : p }
  const key = crypto.createHash('sha1').update([
    await stamp(jar), ...(await Promise.all(mods.map((m) => stamp(path.join(gameDir, 'mods', m.filename))))),
    ...(await Promise.all(packDirs.map((p) => stamp(p.path)))),
  ].join('\n')).digest('hex')
  const hit = memo.get(key)
  if (hit) return hit

  const reg: Registry = {}
  const names: Record<string, string> = await vanillaLang(inst.minecraft)
  const vanilla = await fs.pathExists(jar)
  if (vanilla) addZip(reg, jar, 'minecraft', {})
  for (const m of mods) addZip(reg, path.join(gameDir, 'mods', m.filename), `mod:${m.filename}`, names)
  for (const p of packDirs) {
    const st = await fs.stat(p.path).catch(() => null)
    if (st?.isDirectory()) addFolder(reg, p.path, p.src)
    else if (p.path.endsWith('.zip')) addZip(reg, p.path, p.src, names)
  }
  // Tipos que no tienen archivo propio y se sacan del idioma: entidades, efectos, encantamientos (<1.21), reglas del juego.
  // El idioma vanilla es común a varias versiones y trae cosas de versiones más nuevas: lo vanilla solo
  // cuenta si el jar de ESTA versión tiene alguna prueba (loot table, textura, huevo de spawn…).
  // Entidades que aparecen en los tags de entity_type del jar (cubre las que no tienen textura ni botín: marker, displays…)
  const taggedEntities = new Set<string>()
  if (vanilla) {
    try {
      const zip = new AdmZip(jar)
      for (const e of reg['tags/entity_type'] ?? []) {
        if (e.src !== 'minecraft') continue
        const vals = JSON.parse(zip.getEntry(e.path)?.getData().toString('utf8') ?? '{}').values ?? []
        for (const v of vals) if (typeof v === 'string' && !v.startsWith('#')) taggedEntities.add(v.includes(':') ? v : `minecraft:${v}`)
      }
    } catch { /* jar ilegible */ }
  }
  const evidence = (kind: string, id: string): boolean => {
    const [ns, name] = id.split(':')
    if (ns !== 'minecraft' || !vanilla) return true
    const has = (type: string, rid: string): boolean => (reg[type] ?? []).some((e) => e.id === rid)
    if (kind === 'entity') return taggedEntities.has(id) || has('loot_table', `minecraft:entities/${name}`) || has('assets:models/item', `minecraft:${name}_spawn_egg`) || has('assets:items', `minecraft:${name}_spawn_egg`) || (reg['assets:textures/entity'] ?? []).some((e) => e.id.startsWith(`minecraft:${name}`))
    if (kind === 'effect') return (reg['assets:textures/mob_effect'] ?? []).some((e) => e.id === `minecraft:${name}`)
    if (kind === 'enchantment') return !reg['enchantment']?.length || has('enchantment', id)
    if (kind === 'biome') return has('worldgen/biome', id) || !reg['worldgen/biome']?.length
    return true
  }
  // Solo claves «tipo.namespace.id» con un namespace que existe (evita variantes como entity.minecraft.villager.farmer o enchantment.level.1)
  const namespaces = new Set(Object.values(reg).flat().map((e) => e.id.split(':')[0]))
  for (const k of Object.keys(names)) {
    const m = /^(entity|effect|enchantment|biome)\.([a-z0-9_-]+)\.([a-z0-9_/]+)$/.exec(k)
    if (m && namespaces.has(m[2]) && evidence(m[1], `${m[2]}:${m[3]}`)) (reg[`lang:${m[1]}`] ??= []).push({ id: `${m[2]}:${m[3]}`, src: 'lang', path: k, name: names[k] })
    const g = /^gamerule\.([A-Za-z0-9_]+)$/.exec(k)
    if (g) (reg['lang:gamerule'] ??= []).push({ id: g[1], src: 'lang', path: k, name: names[k] })
  }
  // Nombres visibles para ítems y bloques
  for (const [type, list] of Object.entries(reg)) {
    const pre = type === 'assets:blockstates' ? 'block' : type === 'assets:items' || type === 'assets:models/item' ? 'item' : type === 'worldgen/biome' ? 'biome' : null
    if (!pre) continue
    for (const e of list) { const [ns, id] = e.id.split(':'); e.name = names[`${pre}.${ns}.${id}`] ?? names[`block.${ns}.${id}`] }
  }
  const built = { reg, names, vanilla }
  memo.set(key, built)
  if (memo.size > 6) memo.delete(memo.keys().next().value as string)
  return built
}

// Tipos con nombres fáciles para la IA
export const TYPE_ALIASES: Record<string, string[]> = {
  item: ['assets:items', 'assets:models/item'],
  block: ['assets:blockstates'],
  entity: ['lang:entity'],
  effect: ['lang:effect', 'mob_effect'],
  biome: ['worldgen/biome'],
  dimension: ['dimension'],
  dimension_type: ['dimension_type'],
  structure: ['worldgen/structure', 'structure'],
  feature: ['worldgen/configured_feature', 'worldgen/placed_feature'],
  noise: ['worldgen/noise_settings', 'worldgen/density_function', 'worldgen/noise'],
  enchantment: ['enchantment', 'lang:enchantment'],
  recipe: ['recipe'],
  loot_table: ['loot_table'],
  advancement: ['advancement'],
  function: ['function'],
  tag: [],
  texture: [],
  model: [],
  sound: ['assets:sounds'],
  geo: ['assets:geo', 'assets:geckolib'],            // modelos GeckoLib / Bedrock de mods
  animation: ['assets:animations', 'assets:animation'],
  particle: ['assets:particles'],
  shader: ['assets:shaders'],
  gamerule: ['lang:gamerule'],
  damage_type: ['damage_type'],
}

function typesFor(reg: Registry, tipo: string): string[] {
  if (tipo === 'tag') return Object.keys(reg).filter((t) => t.startsWith('tags/'))
  if (tipo === 'texture') return Object.keys(reg).filter((t) => t.startsWith('assets:textures'))
  if (tipo === 'model') return Object.keys(reg).filter((t) => t.startsWith('assets:models'))
  return TYPE_ALIASES[tipo] ?? [tipo]
}

/** Resumen o lista de un tipo del registro. */
export async function queryRegistry(inst: Instance, q: { tipo?: string; buscar?: string; namespace?: string; mundo?: string; limite?: number }): Promise<unknown> {
  const { reg, vanilla } = await buildRegistry(inst, q.mundo)
  if (!q.tipo) {
    const counts = Object.fromEntries(Object.entries(reg).map(([t, l]) => [t, l.length]).sort((a, b) => (b[1] as number) - (a[1] as number)))
    const namespaces = [...new Set(Object.values(reg).flat().map((e) => e.id.split(':')[0]))].sort()
    return { minecraft: inst.minecraft, loader: inst.modloader, vanillaJar: vanilla, tiposFaciles: Object.keys(TYPE_ALIASES), tiposReales: counts, namespaces,
      nota: vanilla ? undefined : 'No está el jar de esta versión de Minecraft: abre el juego una vez desde el launcher para tener también lo vanilla.' }
  }
  const types = typesFor(reg, q.tipo)
  const re = q.buscar ? new RegExp(q.buscar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null
  const seen = new Set<string>()
  const out: { id: string; tipo: string; origen: string; nombre?: string }[] = []
  for (const t of types) for (const e of reg[t] ?? []) {
    if (q.namespace && !e.id.startsWith(q.namespace + ':')) continue
    if (re && !re.test(e.id) && !(e.name && re.test(e.name))) continue
    const k = `${t}|${e.id}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ id: e.id, tipo: t, origen: e.src, nombre: e.name })
  }
  const lim = Math.min(q.limite ?? 300, 2000)
  return { total: out.length, mostrando: Math.min(lim, out.length), resultados: out.slice(0, lim) }
}

/** Contenido de un recurso (texto) o lo extrae a .ai/extraidos si es binario. */
export async function readResource(inst: Instance, q: { tipo?: string; id?: string; ruta?: string; mundo?: string; extraer?: boolean }): Promise<unknown> {
  const { reg } = await buildRegistry(inst, q.mundo)
  const gameDir = await getInstanceGameDir(inst.id)
  let entries: RegEntry[] = []
  if (q.ruta) entries = Object.values(reg).flat().filter((e) => e.path === q.ruta)
  else if (q.tipo && q.id) {
    const id = q.id.includes(':') ? q.id : `minecraft:${q.id}`
    entries = typesFor(reg, q.tipo).flatMap((t) => (reg[t] ?? []).filter((e) => e.id === id))
    // Texturas y modelos se piden como "block/stone": la carpeta forma parte del tipo real
    if (!entries.length && id.includes('/')) {
      const [ns, rest] = id.split(':')
      const [folder, ...name] = rest.split('/')
      entries = typesFor(reg, q.tipo).filter((t) => t.endsWith('/' + folder)).flatMap((t) => (reg[t] ?? []).filter((e) => e.id === `${ns}:${name.join('/')}`))
    }
  }
  entries = entries.filter((e) => e.src !== 'lang')
  if (!entries.length) return { error: 'No encontrado. Busca el id exacto con la herramienta registro.' }
  // Si varios lo definen, el último que carga (mod o datapack) es el que manda
  const e = entries[entries.length - 1]
  let data: Buffer | null = null
  if (e.src === 'minecraft') data = new AdmZip(path.join(getSharedDir(), 'versions', inst.minecraft, `${inst.minecraft}.jar`)).getEntry(e.path)?.getData() ?? null
  else if (e.src.startsWith('mod:')) data = new AdmZip(path.join(gameDir, 'mods', e.src.slice(4))).getEntry(e.path)?.getData() ?? null
  else if (e.src.startsWith('datapack:') && q.mundo) {
    const base = path.join(gameDir, 'saves', q.mundo, 'datapacks', e.src.slice(9))
    data = (await fs.stat(base)).isDirectory() ? await fs.readFile(path.join(base, e.path)) : new AdmZip(base).getEntry(e.path)?.getData() ?? null
  }
  if (!data) return { error: 'No se pudo leer' }
  const binary = /\.(png|ogg|nbt)$/.test(e.path)
  const overrides = entries.length > 1 ? entries.map((x) => x.src) : undefined
  if (binary || q.extraer) {
    const dest = path.join(gameDir, '.ai', 'extraidos', e.path)
    await fs.outputFile(dest, data)
    let size: string | undefined
    if (e.path.endsWith('.png') && data.length > 24) size = `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`
    // Las estructuras .nbt se analizan (tamaño, bloques, entidades) además de extraerse
    const analisis = e.path.endsWith('.nbt') ? ((await inspectFile(dest).catch(() => null)) as Record<string, unknown> | null)?.analisis : undefined
    return { origen: e.src, ruta: e.path, extraidoEn: path.relative(gameDir, dest).replace(/\\/g, '/'), rutaAbsoluta: dest, tamaño: size, bytes: data.length, definidoPor: overrides, analisis }
  }
  const text = data.toString('utf8')
  let analisis: unknown
  if (e.path.endsWith('.json')) { try { analisis = describeModel(JSON.parse(text), e.path) ?? undefined } catch { /* JSON roto */ } }
  return { origen: e.src, ruta: e.path, definidoPor: overrides, analisis, contenido: text.length > 60_000 ? text.slice(0, 60_000) + '\n…(recortado)' : text }
}

// ── Mundos ──────────────────────────────────────────────────────────────────

const simple = (root: unknown): any => nbt.simplify(root as nbt.NBT)

// Desde 26.1 el mundo se reparte en más archivos: reglas en data/minecraft/game_rules.dat,
// generación en world_gen_settings.dat, tiempo y clima en world_clocks.dat / weather.dat,
// jugadores en players/ y cada dimensión en dimensions/<ns>/<id>/. Se leen los dos formatos.
async function readWorldDat(dir: string, name: string): Promise<any> {
  const file = path.join(dir, 'data', 'minecraft', `${name}.dat`)
  if (!(await fs.pathExists(file))) return undefined
  try { const x = simple((await nbtReadLocal(file)).root); return x.data ?? x } catch { return undefined }
}

const firstDir = async (...dirs: string[]): Promise<string> => { for (const d of dirs) if (await fs.pathExists(d)) return d; return dirs[0] }

/** Todo lo útil de un mundo para entender cómo se está comportando el juego. */
export async function worldInfo(inst: Instance, world: string): Promise<unknown> {
  const gameDir = await getInstanceGameDir(inst.id)
  const dir = safeJoin(path.join(gameDir, 'saves'), world)
  const lvl = simple((await nbtReadLocal(path.join(dir, 'level.dat'))).root)
  const d = lvl.Data ?? lvl
  const gameRules = (await readWorldDat(dir, 'game_rules')) ?? d.GameRules ?? d.game_rules ?? {}
  // Dimensiones: las que define el mundo y las que tienen carpeta (exploradas)
  const wgs = (await readWorldDat(dir, 'world_gen_settings')) ?? d.WorldGenSettings ?? {}
  const dims: Record<string, unknown> = {}
  for (const [id, v] of Object.entries((wgs.dimensions ?? {}) as Record<string, any>)) {
    const g = v.generator ?? {}
    const bs = g.biome_source ?? {}
    dims[id] = {
      tipo: v.type, generador: g.type, ajustesRuido: typeof g.settings === 'string' ? g.settings : g.settings ? 'personalizado' : undefined,
      biomas: bs.type ? { fuente: bs.type, preset: bs.preset, lista: Array.isArray(bs.biomes) ? bs.biomes.slice(0, 60).map((b: any) => (typeof b === 'string' ? b : b.biome)) : bs.biome } : undefined,
    }
  }
  const explored: Record<string, number> = {}
  const regionCount = async (p: string): Promise<number> => (await fs.readdir(path.join(p, 'region')).catch(() => [] as string[])).filter((f) => f.endsWith('.mca')).length
  explored['minecraft:overworld'] = await regionCount(dir)
  explored['minecraft:the_nether'] = await regionCount(path.join(dir, 'DIM-1'))
  explored['minecraft:the_end'] = await regionCount(path.join(dir, 'DIM1'))
  const dimRoot = path.join(dir, 'dimensions')
  for (const ns of await fs.readdir(dimRoot).catch(() => [] as string[])) {
    const walk = async (p: string, id: string): Promise<void> => {
      if (await fs.pathExists(path.join(p, 'region'))) { explored[id] = Math.max(explored[id] ?? 0, await regionCount(p)); return }
      for (const sub of await fs.readdir(p).catch(() => [] as string[])) {
        if ((await fs.stat(path.join(p, sub)).catch(() => null))?.isDirectory()) await walk(path.join(p, sub), id.endsWith(':') ? id + sub : `${id}/${sub}`)
      }
    }
    await walk(path.join(dimRoot, ns), `${ns}:`)
  }
  // Estadísticas y logros de los jugadores del mundo (en local)
  const statsDir = await firstDir(path.join(dir, 'players', 'stats'), path.join(dir, 'stats'))
  const stats: Record<string, Record<string, number>> = {}
  for (const f of (await fs.readdir(statsDir).catch(() => [] as string[])).filter((x) => x.endsWith('.json'))) {
    const s = (await fs.readJson(path.join(statsDir, f)).catch(() => ({}))).stats ?? {}
    for (const [cat, vals] of Object.entries(s as Record<string, Record<string, number>>)) {
      const c = (stats[cat.replace('minecraft:', '')] ??= {})
      for (const [k, v] of Object.entries(vals)) c[k] = (c[k] ?? 0) + v
    }
  }
  const topOf = (cat: string, n = 15): Record<string, number> => Object.fromEntries(Object.entries(stats[cat] ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n))
  let advancements = 0
  const advDir = await firstDir(path.join(dir, 'players', 'advancements'), path.join(dir, 'advancements'))
  for (const f of (await fs.readdir(advDir).catch(() => [] as string[])).filter((x) => x.endsWith('.json'))) {
    const a = await fs.readJson(path.join(advDir, f)).catch(() => ({}))
    advancements += Object.entries(a).filter(([k, v]: [string, any]) => !k.startsWith('minecraft:recipes/') && v?.done).length
  }
  // Jugador de un mundo de un jugador: en level.dat (antes) o en players/data/<uuid>.dat (26.1+)
  let player = d.Player
  if (!player && d.singleplayer_uuid) {
    const u = Array.isArray(d.singleplayer_uuid)
      ? d.singleplayer_uuid.map((n: number) => (n >>> 0).toString(16).padStart(8, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
      : String(d.singleplayer_uuid)
    const f = path.join(dir, 'players', 'data', `${u}.dat`)
    if (await fs.pathExists(f)) player = simple((await nbtReadLocal(f).catch(() => null))?.root ?? {})
  }
  const dp = d.DataPacks ?? {}
  const diff = d.difficulty_settings ?? {}
  const difficulty = typeof diff.difficulty === 'string' ? diff.difficulty : ['peaceful', 'easy', 'normal', 'hard'][d.Difficulty ?? 2]
  const weather = (await readWorldDat(dir, 'weather')) ?? {}
  const clocks = (await readWorldDat(dir, 'world_clocks')) ?? {}
  const ticksOf = (v: unknown): number => Array.isArray(v) ? Number(v[1] ?? 0) + Number(v[0] ?? 0) * 2 ** 32 : Number(v ?? 0)
  const dayTime = d.DayTime ?? ticksOf(clocks['minecraft:overworld']?.total_ticks)
  return {
    mundo: world,
    version: d.Version?.Name, dataVersion: d.DataVersion,
    modo: ['supervivencia', 'creativo', 'aventura', 'espectador'][d.GameType ?? 0],
    dificultad: ({ peaceful: 'pacífico', easy: 'fácil', normal: 'normal', hard: 'difícil' } as Record<string, string>)[difficulty] ?? difficulty,
    hardcore: !!(d.hardcore ?? diff.hardcore), trucos: !!d.allowCommands, dificultadBloqueada: !!(d.DifficultyLocked ?? diff.locked),
    conMods: d.WasModded !== undefined ? !!d.WasModded : undefined,
    tiempo: { dia: Math.floor(dayTime / 24000), hora: dayTime % 24000, lluvia: !!(d.raining ?? weather.raining), tormenta: !!(d.thundering ?? weather.thundering) },
    reglas: gameRules,
    dimensiones: dims, regionesExploradasPorDimension: explored,
    datapacks: { activos: dp.Enabled ?? [], desactivados: dp.Disabled ?? [] },
    jugador: player ? { dimension: player.Dimension ?? player.dimension, posicion: (player.Pos ?? player.pos)?.map((n: number) => Math.round(n)), vida: player.Health, comida: player.foodLevel, nivel: player.XpLevel, modo: player.playerGameType } : undefined,
    estadisticas: {
      minutosJugados: Math.round(((stats.custom?.['minecraft:play_time'] ?? stats.custom?.['minecraft:play_one_minute'] ?? 0) / 20) / 60),
      muertes: stats.custom?.['minecraft:deaths'] ?? 0,
      mobsMatados: topOf('killed'), leMataron: topOf('killed_by'), bloquesMinados: topOf('mined', 10), objetosFabricados: topOf('crafted', 10), usados: topOf('used', 10),
    },
    logros: advancements,
  }
}

/** Cambia una regla del juego (con el juego cerrado). Entiende el formato antiguo (level.dat) y el de 26.1+ (game_rules.dat). */
export async function setGameRule(inst: Instance, world: string, rule: string, value: string): Promise<string> {
  const gameDir = await getInstanceGameDir(inst.id)
  const dir = safeJoin(path.join(gameDir, 'saves'), world)
  const typed = (prev: any): any => prev?.type === 'byte' ? { type: 'byte', value: value === 'true' || value === '1' ? 1 : 0 }
    : prev?.type === 'int' || prev?.type === 'long' || prev?.type === 'double' ? { type: prev.type, value: Number(value) }
    : { type: 'string', value: String(value) }
  const newFile = path.join(dir, 'data', 'minecraft', 'game_rules.dat')
  if (await fs.pathExists(newFile)) {
    const doc = await nbtReadLocal(newFile)
    const data = (doc.root as any).value?.data?.value
    if (!data) throw new Error('game_rules.dat sin sección data')
    // En 26.1+ las reglas llevan namespace y van en snake_case: keepInventory → minecraft:keep_inventory
    const snake = rule.replace(/^minecraft:/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    const key = data[rule] ? rule : `minecraft:${snake}`
    if (!data[key]) throw new Error(`La regla ${key} no existe en este mundo. Mira las reglas con la herramienta mundo.`)
    data[key] = typed(data[key])
    await nbtWriteLocal(newFile, doc)
    return key
  }
  const file = path.join(dir, 'level.dat')
  const doc = await nbtReadLocal(file)
  const data = (doc.root as any).value?.Data?.value
  if (!data) throw new Error('level.dat sin sección Data')
  const key = data.GameRules ? 'GameRules' : data.game_rules ? 'game_rules' : 'GameRules'
  const rules = (data[key] ??= { type: 'compound', value: {} })
  rules.value[rule] = typed(rules.value[rule])
  await nbtWriteLocal(file, doc)
  return rule
}

/** Formatos de pack de la versión, del version.json del jar del juego. */
export async function packFormats(mc: string): Promise<{ resource?: number; data?: number; java?: number }> {
  try {
    const jar = path.join(getSharedDir(), 'versions', mc, `${mc}.jar`)
    const entry = new AdmZip(jar).getEntry('version.json')
    if (!entry) return {}
    const v = JSON.parse(entry.getData().toString('utf8'))
    const pv = v.pack_version
    return {
      resource: typeof pv === 'number' ? pv : pv?.resource ?? pv?.resource_major,
      data: typeof pv === 'number' ? pv : pv?.data ?? pv?.data_major,
      java: v.java_version,
    }
  } catch { return {} }
}

// ── Proyectos ───────────────────────────────────────────────────────────────

export interface PackFormats { resource?: number; data?: number; java?: number }

/** Esqueleto de un proyecto con el formato y las carpetas de la versión de la instancia. */
export async function scaffoldProject(inst: Instance, fmt: PackFormats, q: { tipo: string; nombre: string; carpeta: string; namespace?: string; descripcion?: string }): Promise<{ ruta: string; archivos: string[]; siguiente: string }> {
  const ns = (q.namespace ?? q.nombre).toLowerCase().replace(/[^a-z0-9_.-]/g, '_')
  const root = path.join(q.carpeta, q.nombre.replace(/[<>:"/\\|?*]/g, '_'))
  if (await fs.pathExists(root) && (await fs.readdir(root)).length) throw new Error('Esa carpeta ya existe y no está vacía')
  const [maj, min] = inst.minecraft.split('.').map(Number)
  const modern = maj > 1 || (maj === 1 && min >= 21) // carpetas en singular
  const files: Record<string, string> = {}
  const desc = q.descripcion ?? `${q.nombre} para Minecraft ${inst.minecraft}`
  if (q.tipo === 'datapack') {
    files['pack.mcmeta'] = JSON.stringify({ pack: { pack_format: fmt.data ?? 0, description: desc } }, null, 2)
    const fn = modern ? 'function' : 'functions'
    files[`data/${ns}/${fn}/load.mcfunction`] = `tellraw @a {"text":"${q.nombre} cargado","color":"green"}\n`
    files[`data/${ns}/${fn}/tick.mcfunction`] = '# Se ejecuta cada tick (20 veces por segundo)\n'
    files[`data/minecraft/tags/${modern ? 'function' : 'functions'}/load.json`] = JSON.stringify({ values: [`${ns}:load`] }, null, 2)
    files[`data/minecraft/tags/${modern ? 'function' : 'functions'}/tick.json`] = JSON.stringify({ values: [`${ns}:tick`] }, null, 2)
  } else if (q.tipo === 'resourcepack') {
    files['pack.mcmeta'] = JSON.stringify({ pack: { pack_format: fmt.resource ?? 0, description: desc } }, null, 2)
    files[`assets/${ns}/lang/es_es.json`] = '{}\n'
    files['assets/minecraft/textures/block/.gitkeep'] = ''
  } else if (q.tipo === 'shader') {
    files['shaders/shaders.properties'] = '# Opciones del shaderpack (Iris / OptiFine)\n'
    files['shaders/gbuffers_terrain.vsh'] = '#version 330 compatibility\n\nout vec2 texcoord;\nout vec4 glcolor;\n\nvoid main() {\n  gl_Position = ftransform();\n  texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;\n  glcolor = gl_Color;\n}\n'
    files['shaders/gbuffers_terrain.fsh'] = '#version 330 compatibility\n\nuniform sampler2D gtexture;\nin vec2 texcoord;\nin vec4 glcolor;\n\n/* RENDERTARGETS: 0 */\nlayout(location = 0) out vec4 color;\n\nvoid main() {\n  color = texture(gtexture, texcoord) * glcolor;\n}\n'
  } else if (q.tipo === 'mod') {
    files['LEEME-PRIMERO.md'] = [`# ${q.nombre}`, '', `Mod para **Minecraft ${inst.minecraft}** con **${inst.modloader}${inst.modloaderVersion ? ' ' + inst.modloaderVersion : ''}**${fmt.java ? ` (Java ${fmt.java})` : ''}.`, '',
      'Genera la plantilla oficial en esta carpeta (el generador pone las versiones exactas de Gradle y del loader):', '',
      inst.modloader === 'fabric' || inst.modloader === 'quilt' ? '- Fabric: https://fabricmc.net/develop/template/' : '- NeoForge: https://neoforged.net/mod-generator/ (o el MDK de https://github.com/NeoForgeMDKs)',
      `- Mod id: \`${ns}\``, '', 'Para probarlo: `gradlew build` y la herramienta copiar_archivo con el jar de build/libs (sin -sources), luego lanzar_juego.', ''].join('\n')
  } else throw new Error('tipo debe ser datapack, resourcepack, shader o mod')
  for (const [rel, content] of Object.entries(files)) await fs.outputFile(path.join(root, rel), content)
  const next = q.tipo === 'mod' ? 'Genera la plantilla con el enlace de LEEME-PRIMERO.md.'
    : q.tipo === 'datapack' ? 'Enlázalo a un mundo con enlazar_proyecto (tipo datapack) y usa /reload.'
    : q.tipo === 'resourcepack' ? 'Enlázalo con enlazar_proyecto (tipo resourcepack) y actívalo en Opciones › Paquetes de recursos (F3+T recarga).'
    : 'Enlázalo con enlazar_proyecto (tipo shader) y elígelo en Opciones › Shaders (Iris).'
  return { ruta: root, archivos: Object.keys(files), siguiente: next }
}

/** Revisa un pack antes de probarlo: JSON, pack_format, carpetas de la versión e ids que no existen. */
export async function validatePack(inst: Instance, fmt: PackFormats, dir: string, world?: string): Promise<{ errores: string[]; avisos: string[]; archivos: number }> {
  const errores: string[] = [], avisos: string[] = []
  let archivos = 0
  const mcmetaPath = path.join(dir, 'pack.mcmeta')
  const isShader = await fs.pathExists(path.join(dir, 'shaders'))
  if (!isShader) {
    try {
      const m = await fs.readJson(mcmetaPath)
      const pf = m.pack?.pack_format
      const isData = await fs.pathExists(path.join(dir, 'data'))
      const want = isData ? fmt.data : fmt.resource
      if (typeof pf !== 'number' && !m.pack?.min_format) errores.push('pack.mcmeta no tiene pack_format')
      else if (want && pf !== want && !m.pack?.supported_formats && !m.pack?.min_format) avisos.push(`pack_format ${pf}, pero esta versión usa ${want}`)
    } catch (e) { errores.push(`pack.mcmeta: ${e instanceof Error ? e.message : e}`) }
  }
  const [maj, min] = inst.minecraft.split('.').map(Number)
  const modern = maj > 1 || (maj === 1 && min >= 21)
  const { reg, vanilla } = await buildRegistry(inst, world)
  // Solo se comprueban campos que siempre son un ítem, bloque o entidad (sin dar avisos falsos por tipos de receta, condiciones…)
  const ids = (types: string[]): Set<string> => new Set(types.flatMap((t) => (reg[t] ?? []).map((e) => e.id)))
  const known: Record<string, Set<string>> = { item: ids(['assets:items', 'assets:models/item', 'assets:blockstates']), block: ids(['assets:blockstates']), entity: ids(['lang:entity']) }
  const hasNs = new Set(Object.values(known).flatMap((s) => [...s].map((x) => x.split(':')[0])))
  const walk = async (p: string, rel: string): Promise<void> => {
    for (const e of await fs.readdir(p, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        const seg = r.split('/')
        if (seg[0] === 'data' && seg.length === 3) {
          if (modern && SINGULAR[seg[2]]) errores.push(`${r}: en ${inst.minecraft} la carpeta es "${SINGULAR[seg[2]]}", no "${seg[2]}"`)
          if (!modern && Object.values(SINGULAR).includes(seg[2]) && seg[2] !== 'structure') avisos.push(`${r}: en ${inst.minecraft} la carpeta va en plural`)
        }
        await walk(path.join(p, e.name), r)
        continue
      }
      archivos++
      if (!e.name.endsWith('.json') && !e.name.endsWith('.mcmeta')) continue
      const text = await fs.readFile(path.join(p, e.name), 'utf8')
      try { JSON.parse(text) } catch (err) { errores.push(`${r}: JSON inválido (${err instanceof Error ? err.message : err})`); continue }
      // El resultado de una receta es siempre un ítem: "result": { "id": "ns:x" }
      const scan = text.replace(/"result"\s*:\s*\{\s*"id"/g, '"result": { "item"')
      for (const m of scan.matchAll(/"(item|block|entity|entity_type)"\s*:\s*"([a-z0-9_.-]+):([a-z0-9_/.-]+)"/g)) {
        const kind = m[1] === 'entity_type' ? 'entity' : m[1]
        const id = `${m[2]}:${m[3]}`
        if (m[2] === 'minecraft' && !vanilla) continue
        if (!hasNs.has(m[2])) { if (m[2] !== 'minecraft') avisos.push(`${r}: "${id}" es de un namespace que no está en la instancia (¿falta el mod?)`); continue }
        if (!known[kind].has(id)) avisos.push(`${r}: ${kind} "${id}" no existe en esta instancia`)
      }
    }
  }
  if (await fs.pathExists(dir)) await walk(dir, '')
  else errores.push('La carpeta no existe')
  return { errores: errores.slice(0, 100), avisos: [...new Set(avisos)].slice(0, 100), archivos }
}
