import fs from 'fs-extra'
import path from 'path'
import zlib from 'zlib'
import AdmZip from 'adm-zip'
import nbt from 'prismarine-nbt'
import { getMappings, memberName } from './deobf'

// Leer CUALQUIER archivo del juego para la IA, entendiendo su formato:
// texto (UTF-8, UTF-16, Latin-1), JSON, NBT (.dat, .nbt, .schem, .litematic…)
// en SNBT, regiones .mca (resumen o un chunk concreto), archivos comprimidos
// (.zip, .jar, .mrpack, .fpack, .rar; también uno dentro de otro con «!/»),
// clases Java (.class, con nombres reales si el juego está ofuscado), imágenes
// y sonidos (tamaño), y análisis de modelos y esquemáticas.

const MAX_TEXT = 60_000
type Tag = { type: string; value: any; name?: string }

// ── Utilidades ──────────────────────────────────────────────────────────────

function decodeText(buf: Buffer): { text: string; encoding: string } {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), encoding: 'utf-8 (BOM)' }
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le'), encoding: 'utf-16le' }
  if (buf[0] === 0xfe && buf[1] === 0xff) { const s = Buffer.from(buf.subarray(2)); s.swap16(); return { text: s.toString('utf16le'), encoding: 'utf-16be' } }
  const utf8 = buf.toString('utf8')
  // Si hay caracteres de reemplazo, probablemente es Latin-1 (configs viejas, .properties)
  if (utf8.includes('�')) return { text: buf.toString('latin1'), encoding: 'latin-1' }
  return { text: utf8, encoding: 'utf-8' }
}

function isProbablyText(buf: Buffer): boolean {
  // UTF-16 con marca (BOM) lleva ceros entre letras: es texto
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) return true
  const n = Math.min(buf.length, 4096)
  let bad = 0
  for (let i = 0; i < n; i++) { const c = buf[i]; if (c === 0) return false; if (c < 9 || (c > 13 && c < 32)) bad++ }
  return bad / Math.max(1, n) < 0.05
}

function inflateMaybe(buf: Buffer): { data: Buffer; compression: string } {
  if (buf[0] === 0x1f && buf[1] === 0x8b) return { data: zlib.gunzipSync(buf), compression: 'gzip' }
  if (buf[0] === 0x78 && ((buf[0] << 8) | buf[1]) % 31 === 0) { try { return { data: zlib.inflateSync(buf), compression: 'zlib' } } catch { /* no era zlib */ } }
  return { data: buf, compression: 'ninguna' }
}

async function parseNbt(buf: Buffer): Promise<{ root: Tag; compression: string; format: string }> {
  const { data, compression } = inflateMaybe(buf)
  const r = await nbt.parse(data)
  return { root: r.parsed as unknown as Tag, compression, format: r.type }
}

const longOf = (v: [number, number] | bigint | number): bigint => typeof v === 'bigint' ? v : Array.isArray(v) ? (BigInt(v[0]) << 32n) | (BigInt(v[1]) & 0xffffffffn) : BigInt(v)

/** NBT → SNBT (el formato de los comandos: {Health:20.0f,Inventory:[…]}), recortado. */
export function toSnbt(tag: Tag, max = MAX_TEXT, indent = ''): string {
  let used = 0
  const walk = (t: Tag, ind: string): string => {
    if (used > max) return '…'
    const v = t.value
    let s: string
    switch (t.type) {
      case 'byte': s = `${v}b`; break
      case 'short': s = `${v}s`; break
      case 'int': s = `${v}`; break
      case 'long': s = `${longOf(v)}L`; break
      case 'float': s = `${+Number(v).toFixed(4)}f`; break
      case 'double': s = `${+Number(v).toFixed(6)}d`; break
      case 'string': s = JSON.stringify(v); break
      case 'byteArray': s = `[B;${(v as number[]).slice(0, 64).join('b,')}${v.length ? 'b' : ''}${v.length > 64 ? `,…(${v.length})` : ''}]`; break
      case 'intArray': s = `[I;${(v as number[]).slice(0, 64).join(',')}${v.length > 64 ? `,…(${v.length})` : ''}]`; break
      case 'longArray': s = `[L;${(v as any[]).slice(0, 32).map((x) => `${longOf(x)}L`).join(',')}${v.length > 32 ? `,…(${v.length})` : ''}]`; break
      case 'list': {
        const items = (v.value ?? []) as any[]
        const shown = items.slice(0, 200).map((x) => walk({ type: v.type, value: x }, ind + '  '))
        s = shown.length && shown.join('').length > 80 ? `[\n${ind}  ${shown.join(`,\n${ind}  `)}${items.length > 200 ? `,\n${ind}  …(${items.length})` : ''}\n${ind}]` : `[${shown.join(',')}]`
        break
      }
      case 'compound': {
        const keys = Object.keys(v)
        const parts = keys.map((k) => `${/^[A-Za-z0-9_.+-]+$/.test(k) ? k : JSON.stringify(k)}:${walk(v[k], ind + '  ')}`)
        s = parts.join('').length > 80 ? `{\n${ind}  ${parts.join(`,\n${ind}  `)}\n${ind}}` : `{${parts.join(',')}}`
        break
      }
      default: s = JSON.stringify(v)
    }
    used += s.length
    return s
  }
  return walk(tag, indent)
}

const simplify = (t: Tag): any => nbt.simplify(t as unknown as nbt.NBT)

// ── Archivos comprimidos ────────────────────────────────────────────────────

const ZIP_EXT = /\.(zip|jar|mrpack|fpack|mcpack|mcaddon|mcworld)$/i

async function rarList(buf: Buffer): Promise<{ name: string; size: number }[]> {
  const { createExtractorFromData } = await import('node-unrar-js')
  const ex = await createExtractorFromData({ data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer })
  return [...ex.getFileList().fileHeaders].filter((h) => !h.flags.directory).map((h) => ({ name: h.name.replace(/\\/g, '/'), size: h.unpSize }))
}

async function rarRead(buf: Buffer, entry: string): Promise<Buffer | null> {
  const { createExtractorFromData } = await import('node-unrar-js')
  const ex = await createExtractorFromData({ data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer })
  const files = [...ex.extract({ files: (h) => h.name.replace(/\\/g, '/') === entry }).files]
  const f = files[0]?.extraction
  return f ? Buffer.from(f) : null
}

/** Contenido de un archivo, siguiendo «a.jar!/b.jar!/c.json» por dentro de comprimidos. */
async function resolveBytes(full: string, entryPath?: string): Promise<{ buf: Buffer; name: string; chain: string[] }> {
  let buf: Buffer = await fs.readFile(full)
  let name = path.basename(full)
  const chain = [name]
  for (const part of (entryPath ?? '').split('!/').filter(Boolean)) {
    const clean = part.replace(/^\/+/, '')
    let next: Buffer | null = null
    if (/\.rar$/i.test(name)) next = await rarRead(buf, clean)
    else next = new AdmZip(buf).getEntry(clean)?.getData() ?? null
    if (!next) throw new Error(`No existe «${clean}» dentro de ${name}`)
    buf = next
    name = path.basename(clean)
    chain.push(clean)
  }
  return { buf, name, chain }
}

async function listArchive(buf: Buffer, name: string, filter?: string): Promise<unknown> {
  const re = filter ? new RegExp(filter.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'), 'i') : null
  const entries = /\.rar$/i.test(name) ? await rarList(buf)
    : new AdmZip(buf).getEntries().filter((e) => !e.isDirectory).map((e) => ({ name: e.entryName, size: e.header.size }))
  const shown = entries.filter((e) => !re || re.test(e.name))
  // Resumen de carpetas de primer y segundo nivel, útil en jars grandes
  const folders: Record<string, number> = {}
  for (const e of entries) { const f = e.name.split('/').slice(0, 2).join('/'); folders[f] = (folders[f] ?? 0) + 1 }
  return {
    tipo: 'archivo comprimido', formato: path.extname(name).slice(1).toLowerCase(), archivos: entries.length,
    carpetas: Object.fromEntries(Object.entries(folders).sort((a, b) => b[1] - a[1]).slice(0, 40)),
    lista: shown.slice(0, 500),
    nota: 'Para leer uno de dentro usa entrada="ruta/dentro" (y «!/» para uno dentro de otro, p. ej. META-INF/jars/lib.jar!/fabric.mod.json).',
  }
}

// ── Clases Java ─────────────────────────────────────────────────────────────

function parseClass(buf: Buffer): { name: string; super: string; interfaces: string[]; fields: { name: string; desc: string; access: number }[]; methods: { name: string; desc: string; access: number }[]; version: number } {
  let o = 8
  const major = buf.readUInt16BE(6)
  const count = buf.readUInt16BE(o); o += 2
  const cp: any[] = new Array(count)
  for (let i = 1; i < count; i++) {
    const tag = buf[o++]
    switch (tag) {
      case 1: { const len = buf.readUInt16BE(o); cp[i] = buf.toString('utf8', o + 2, o + 2 + len); o += 2 + len; break }
      case 7: case 8: case 16: case 19: case 20: cp[i] = { tag, ref: buf.readUInt16BE(o) }; o += 2; break
      case 3: case 4: o += 4; break
      case 5: case 6: o += 8; i++; break
      case 9: case 10: case 11: case 12: case 17: case 18: o += 4; break
      case 15: o += 3; break
      default: throw new Error('Clase Java no válida')
    }
  }
  const cls = (i: number): string => (cp[cp[i]?.ref] ?? '').replace(/\//g, '.')
  o += 2 // access
  const name = cls(buf.readUInt16BE(o)); o += 2
  const sup = cls(buf.readUInt16BE(o)); o += 2
  const ic = buf.readUInt16BE(o); o += 2
  const interfaces: string[] = []
  for (let i = 0; i < ic; i++) { interfaces.push(cls(buf.readUInt16BE(o))); o += 2 }
  const members = (): { name: string; desc: string; access: number }[] => {
    const n = buf.readUInt16BE(o); o += 2
    const out: { name: string; desc: string; access: number }[] = []
    for (let i = 0; i < n; i++) {
      const access = buf.readUInt16BE(o), nm = cp[buf.readUInt16BE(o + 2)], desc = cp[buf.readUInt16BE(o + 4)]
      const ac = buf.readUInt16BE(o + 6); o += 8
      for (let a = 0; a < ac; a++) { const len = buf.readUInt32BE(o + 2); o += 6 + len }
      out.push({ name: nm, desc, access })
    }
    return out
  }
  const fields = members()
  const methods = members()
  return { name, super: sup, interfaces, fields, methods, version: major }
}

/** Descriptor JVM legible: (ILjava/lang/String;)V → (int, String) → void */
function prettyDesc(desc: string, rename: (c: string) => string): string {
  const types: string[] = []
  let i = 0
  const one = (): string => {
    let arr = ''
    while (desc[i] === '[') { arr += '[]'; i++ }
    const c = desc[i++]
    const prim: Record<string, string> = { B: 'byte', C: 'char', D: 'double', F: 'float', I: 'int', J: 'long', S: 'short', Z: 'boolean', V: 'void' }
    if (c === 'L') { const end = desc.indexOf(';', i); const n = desc.slice(i, end).replace(/\//g, '.'); i = end + 1; return rename(n).split('.').pop() + arr }
    return (prim[c] ?? c) + arr
  }
  if (desc[0] === '(') { i = 1; while (desc[i] !== ')') types.push(one()); i++; return `(${types.join(', ')}) → ${one()}` }
  return one()
}

async function describeClass(buf: Buffer, mc?: string): Promise<unknown> {
  const c = parseClass(buf)
  let obf = false
  let rename = (n: string): string => n
  if (mc) {
    try {
      const m = await getMappings(mc)
      if (m.obfuscated) { obf = true; rename = (n) => m.cls.get(n) ?? m.inter.get(n.split('.').pop() ?? '') ?? n }
    } catch { /* sin mapeos */ }
  }
  const owner = c.name
  const mem = async (x: { name: string; desc: string; access: number }): Promise<string> => {
    const real = obf ? await memberName(mc!, owner, x.name, x.desc) : x.name
    const flags = [(x.access & 0x0001) ? 'public' : (x.access & 0x0004) ? 'protected' : (x.access & 0x0002) ? 'private' : '', (x.access & 0x0008) ? 'static' : ''].filter(Boolean).join(' ')
    return `${flags ? flags + ' ' : ''}${real}${real !== x.name ? ` [${x.name}]` : ''} ${prettyDesc(x.desc, rename)}`
  }
  return {
    tipo: 'clase Java', java: c.version - 44,
    clase: rename(c.name) + (obf && rename(c.name) !== c.name ? ` [ofuscada: ${c.name}]` : ''),
    hereda: rename(c.super), interfaces: c.interfaces.map(rename),
    campos: await Promise.all(c.fields.slice(0, 200).map(mem)),
    metodos: await Promise.all(c.methods.slice(0, 300).map(mem)),
    nota: obf ? 'Nombres traducidos con los mapeos oficiales de Mojang (entre corchetes, el ofuscado).' : undefined,
  }
}

// ── Regiones (.mca) ─────────────────────────────────────────────────────────

async function describeRegion(buf: Buffer, chunk?: { x: number; z: number }): Promise<unknown> {
  const present: { x: number; z: number; t: number }[] = []
  for (let i = 0; i < 1024; i++) {
    const loc = buf.readUInt32BE(i * 4)
    if (loc) present.push({ x: i % 32, z: Math.floor(i / 32), t: buf.readUInt32BE(4096 + i * 4) })
  }
  if (!chunk) {
    const last = present.reduce((a, b) => Math.max(a, b.t), 0)
    return { tipo: 'región (32×32 chunks)', chunksGenerados: present.length, ultimaModificacion: last ? new Date(last * 1000).toISOString() : null,
      algunosChunks: present.slice(0, 24).map((c) => `${c.x},${c.z}`),
      nota: 'Para ver un chunk: chunk={x,z} (0–31 dentro de la región, o coordenadas de chunk del mundo). En 1.17+ las entidades están en entities/*.mca.' }
  }
  const lx = ((chunk.x % 32) + 32) % 32, lz = ((chunk.z % 32) + 32) % 32
  const loc = buf.readUInt32BE((lx + lz * 32) * 4)
  if (!loc) return { error: 'Ese chunk no está generado', generados: present.slice(0, 24).map((c) => `${c.x},${c.z}`) }
  const off = (loc >>> 8) * 4096
  const len = buf.readUInt32BE(off)
  const comp = buf[off + 4]
  const raw = buf.subarray(off + 5, off + 4 + len)
  if (comp === 4) return { error: 'Chunk comprimido con LZ4 (opción del servidor): no se puede abrir aquí' }
  const data = comp === 1 ? zlib.gunzipSync(raw) : comp === 2 ? zlib.inflateSync(raw) : raw
  const root = (await nbt.parse(data)).parsed as unknown as Tag
  const s = simplify(root)
  // Resumen: bloques por sección (paleta), biomas y entidades de bloque
  const blocks: Record<string, number> = {}
  const biomes = new Set<string>()
  for (const sec of s.sections ?? s.Level?.Sections ?? []) {
    for (const b of sec.block_states?.palette ?? []) blocks[b.Name] = (blocks[b.Name] ?? 0) + 1
    for (const b of sec.biomes?.palette ?? []) biomes.add(b)
  }
  const be = (s.block_entities ?? s.Level?.TileEntities ?? []).map((b: any) => b.id)
  const ents = (s.Entities ?? s.entities ?? []).map((e: any) => e.id)
  return { tipo: 'chunk', chunk: { x: lx, z: lz }, estado: s.Status, version: s.DataVersion,
    bloquesEnPaleta: Object.keys(blocks).sort(), biomas: [...biomes].sort(), entidadesDeBloque: be, entidades: ents.length ? ents : undefined,
    snbt: toSnbt(root, 20_000) }
}

// ── Modelos ─────────────────────────────────────────────────────────────────

export function describeModel(json: any, name: string): Record<string, unknown> | null {
  // Bedrock / GeckoLib (.geo.json): format_version + minecraft:geometry
  const geos = json['minecraft:geometry'] ?? (json.geometry ? [json.geometry] : null)
  if (Array.isArray(geos)) {
    return {
      tipo: /geo\.json$/i.test(name) || json.format_version ? 'modelo Bedrock / GeckoLib (.geo.json)' : 'geometría Bedrock',
      formato: json.format_version,
      geometrias: geos.map((g: any) => {
        const bones = (g.bones ?? []) as any[]
        return {
          id: g.description?.identifier, textura: `${g.description?.texture_width ?? '?'}×${g.description?.texture_height ?? '?'}`,
          huesos: bones.length, cubos: bones.reduce((a, b) => a + (b.cubes?.length ?? 0), 0),
          jerarquia: bones.slice(0, 80).map((b) => `${b.name}${b.parent ? ` ← ${b.parent}` : ''}${b.cubes?.length ? ` (${b.cubes.length} cubos)` : ''}`),
          localizadores: bones.flatMap((b) => Object.keys(b.locators ?? {})),
        }
      }),
      nota: 'En GeckoLib el modelo va en assets/<modid>/geo/, las animaciones en assets/<modid>/animations/ y la textura en assets/<modid>/textures/; los nombres de huesos deben coincidir con los de las animaciones.',
    }
  }
  // Animaciones Bedrock / GeckoLib
  if (json.animations && typeof json.animations === 'object' && !Array.isArray(json.animations)) {
    return {
      tipo: 'animaciones Bedrock / GeckoLib (.animation.json)', formato: json.format_version,
      animaciones: Object.entries(json.animations).slice(0, 100).map(([k, a]: [string, any]) => ({ nombre: k, duracion: a.animation_length, bucle: a.loop, huesos: Object.keys(a.bones ?? {}), sonidos: a.sound_effects ? Object.keys(a.sound_effects).length : undefined })),
    }
  }
  // Blockbench (.bbmodel)
  if (json.meta?.format_version && (json.elements || json.outliner)) {
    return {
      tipo: 'proyecto de Blockbench (.bbmodel)', formato: json.meta.model_format, version: json.meta.format_version, nombre: json.name,
      elementos: json.elements?.length ?? 0, grupos: (json.groups ?? json.outliner ?? []).length, texturas: (json.textures ?? []).map((t: any) => `${t.name} ${t.width ?? ''}×${t.height ?? ''}`),
      animaciones: (json.animations ?? []).map((a: any) => a.name),
      nota: 'Blockbench exporta a modelo Java (JSON), Bedrock/GeckoLib (.geo.json) u OBJ según el formato del proyecto.',
    }
  }
  // Modelo Java (bloque o ítem)
  if (json.parent || json.elements || json.textures || json.display) {
    const els = (json.elements ?? []) as any[]
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (const e of els) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], e.from?.[i] ?? 0); max[i] = Math.max(max[i], e.to?.[i] ?? 0) }
    return {
      tipo: 'modelo Java (bloque/ítem)', padre: json.parent, texturas: json.textures, elementos: els.length,
      caja: els.length ? { desde: min, hasta: max } : undefined,
      caras: els.reduce((a, e) => a + Object.keys(e.faces ?? {}).length, 0),
      girados: els.filter((e) => e.rotation).length, sombreadoAmbiental: json.ambientocclusion, luzGui: json.gui_light,
      vistas: json.display ? Object.keys(json.display) : undefined,
      nota: 'Las coordenadas van de 0 a 16 (un bloque). Si no hay elementos, los hereda del padre: ábrelo con ver_recurso (tipo model).',
    }
  }
  // Definición de ítem (1.21.4+, assets/<ns>/items/*.json)
  if (json.model && typeof json.model === 'object' && json.model.type) {
    const types = new Set<string>()
    const walk = (m: any): void => { if (!m || typeof m !== 'object') return; if (m.type) types.add(m.type); for (const v of Object.values(m)) if (typeof v === 'object') walk(v) }
    walk(json.model)
    return { tipo: 'definición de ítem (1.21.4+)', tiposDeModelo: [...types], nota: 'Elige qué modelo se ve según componentes, condiciones o rangos; los modelos van en models/.' }
  }
  return null
}

function describeObj(text: string): unknown {
  const count = (re: RegExp): number => (text.match(re) ?? []).length
  return { tipo: 'modelo OBJ', vertices: count(/^v /gm), caras: count(/^f /gm), normales: count(/^vn /gm), uvs: count(/^vt /gm),
    grupos: [...new Set((text.match(/^[go] .+$/gm) ?? []).map((l) => l.slice(2).trim()))].slice(0, 50),
    materiales: (text.match(/^mtllib .+$/gm) ?? []).map((l) => l.slice(7).trim()) }
}

// ── Esquemáticas ────────────────────────────────────────────────────────────

function countTop(map: Record<string, number>, n = 40): Record<string, number> {
  return Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n))
}

function describeSchematic(root: Tag, name: string): Record<string, unknown> | null {
  const s = simplify(root)
  // Estructura vanilla (bloque de estructuras, .nbt)
  if (Array.isArray(s.size) && (s.palette || s.palettes) && s.blocks) {
    const palette = (s.palette ?? s.palettes?.[0] ?? []) as any[]
    const counts: Record<string, number> = {}
    for (const b of s.blocks as any[]) { const p = palette[b.state]; if (p) counts[p.Name] = (counts[p.Name] ?? 0) + 1 }
    return { tipo: 'estructura vanilla (.nbt)', tamaño: s.size, bloques: (s.blocks as any[]).length, porTipo: countTop(counts),
      entidades: ((s.entities ?? []) as any[]).map((e) => e.nbt?.id).filter(Boolean), version: s.DataVersion,
      nota: 'Se usa en datapacks (data/<ns>/structure/) con /place template o en template pools de estructuras.' }
  }
  // Sponge .schem (v2 en la raíz, v3 dentro de «Schematic»)
  const sp = s.Schematic ?? s
  if (sp.Width !== undefined && (sp.Palette || sp.Blocks?.Palette)) {
    const palette = (sp.Palette ?? sp.Blocks.Palette) as Record<string, number>
    const data: number[] = sp.BlockData ?? sp.Blocks?.Data ?? []
    const byId: Record<number, string> = {}
    for (const [k, v] of Object.entries(palette)) byId[v] = k
    const counts: Record<string, number> = {}
    let i = 0
    while (i < data.length) {
      let v = 0, shift = 0, b: number
      do { b = data[i++] & 0xff; v |= (b & 0x7f) << shift; shift += 7 } while (b & 0x80)
      const id = (byId[v] ?? String(v)).replace(/\[.*$/, '')
      counts[id] = (counts[id] ?? 0) + 1
    }
    return { tipo: `esquemática Sponge (.schem v${sp.Version ?? '?'})`, tamaño: [sp.Width, sp.Height, sp.Length], bloquesEnPaleta: Object.keys(palette).length,
      porTipo: countTop(counts), entidadesDeBloque: (sp.BlockEntities ?? sp.Blocks?.BlockEntities ?? []).length, entidades: (sp.Entities ?? []).length, version: sp.DataVersion,
      nota: 'Se pega con WorldEdit/FAWE (//schem load y //paste) o se convierte a estructura vanilla.' }
  }
  // MCEdit clásico (.schematic, ids numéricos anteriores a 1.13)
  if (s.Width !== undefined && s.Blocks && s.Materials) {
    const counts: Record<string, number> = {}
    for (const b of s.Blocks as number[]) { const k = `id ${b & 0xff}`; counts[k] = (counts[k] ?? 0) + 1 }
    return { tipo: 'esquemática MCEdit (.schematic, formato antiguo)', tamaño: [s.Width, s.Height, s.Length], materiales: s.Materials, porId: countTop(counts),
      nota: 'Usa ids numéricos de antes de 1.13; para versiones nuevas hay que convertirla (WorldEdit la actualiza al cargarla).' }
  }
  // Litematica (.litematic)
  if (s.Regions && s.Metadata) {
    const regions = Object.entries(s.Regions as Record<string, any>).map(([rname, r]) => {
      const palette = (r.BlockStatePalette ?? []) as any[]
      const size = [Math.abs(r.Size?.x ?? 0), Math.abs(r.Size?.y ?? 0), Math.abs(r.Size?.z ?? 0)]
      const total = size[0] * size[1] * size[2]
      const bits = Math.max(2, Math.ceil(Math.log2(Math.max(1, palette.length))))
      const longs = ((r.BlockStates ?? []) as any[]).map((x) => longOf(x))
      const counts: Record<string, number> = {}
      const mask = (1n << BigInt(bits)) - 1n
      for (let i = 0; i < total && longs.length; i++) {
        const bit = BigInt(i * bits), idx = Number(bit >> 6n), off = bit & 63n
        let v = (longs[idx] >> off) & mask
        if (off + BigInt(bits) > 64n && idx + 1 < longs.length) v = ((longs[idx] >> off) | (longs[idx + 1] << (64n - off))) & mask
        const nm = palette[Number(v)]?.Name ?? '?'
        if (nm !== 'minecraft:air') counts[nm] = (counts[nm] ?? 0) + 1
      }
      return { region: rname, tamaño: size, porTipo: countTop(counts, 30), entidades: (r.Entities ?? []).length, entidadesDeBloque: (r.TileEntities ?? []).length }
    })
    return { tipo: 'esquemática Litematica (.litematic)', nombre: s.Metadata.Name, descripcion: s.Metadata.Description, tamañoTotal: s.Metadata.EnclosingSize,
      bloquesTotales: s.Metadata.TotalBlocks, regiones: regions, version: s.MinecraftDataVersion,
      nota: 'Se carga con el mod Litematica (carpeta schematics/ de la instancia).' }
  }
  if (/\.(schem|schematic|litematic)$/i.test(name)) return { tipo: 'esquemática', aviso: 'Formato no reconocido', claves: Object.keys(s).slice(0, 30) }
  return null
}

// ── Entrada principal ───────────────────────────────────────────────────────

export interface InspectOptions { entrada?: string; filtro?: string; chunk?: { x: number; z: number }; mc?: string; crudo?: boolean }

/** Lee y entiende cualquier archivo; `full` es la ruta absoluta ya validada. */
export async function inspectFile(full: string, opt: InspectOptions = {}): Promise<unknown> {
  const st = await fs.stat(full)
  if (st.isDirectory() && !opt.entrada) {
    const names = await fs.readdir(full, { withFileTypes: true })
    return { tipo: 'carpeta', contenido: names.slice(0, 500).map((d) => (d.isDirectory() ? `${d.name}/` : d.name)) }
  }
  const { buf, name, chain } = await resolveBytes(full, opt.entrada)
  const ext = path.extname(name).toLowerCase()
  const base = { archivo: chain.join('!/'), bytes: buf.length }

  if (ZIP_EXT.test(name) || ext === '.rar') {
    if (buf[0] === 0x50 && buf[1] === 0x4b) return { ...base, ...(await listArchive(buf, name, opt.filtro)) as object }
    if (buf.subarray(0, 4).toString('latin1') === 'Rar!') return { ...base, ...(await listArchive(buf, name.replace(/\.[^.]+$/, '.rar'), opt.filtro)) as object }
  }
  if (ext === '.7z') return { ...base, error: 'Los .7z no se pueden abrir aquí; pide al usuario que lo descomprima o lo pase como .zip.' }
  if (ext === '.class' || buf.readUInt32BE(0) === 0xcafebabe) return { ...base, ...(await describeClass(buf, opt.mc)) as object }
  if (ext === '.mca' || ext === '.mcc' || ext === '.mcr') return { ...base, ...(await describeRegion(buf, opt.chunk)) as object }
  if (ext === '.png' && buf.length > 24) return { ...base, tipo: 'imagen PNG', tamaño: `${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}`, nota: 'Para verla, ábrela con tu herramienta de leer imágenes (ruta absoluta).' }
  if (['.ogg', '.wav', '.mp3', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return { ...base, tipo: `binario ${ext.slice(1)}` }

  // NBT: .dat, .dat_old, .nbt, .schem, .schematic, .litematic, o binario con cabecera NBT
  const nbtExt = /\.(dat|dat_old|nbt|schem|schematic|litematic|mcstructure)$/i.test(name)
  if (nbtExt || (!isProbablyText(buf) && (buf[0] === 0x1f || buf[0] === 0x0a))) {
    try {
      const { root, compression, format } = await parseNbt(buf)
      const schematic = describeSchematic(root, name)
      return { ...base, tipo: 'NBT', compresion: compression, formatoNbt: format, ...(schematic ? { analisis: schematic } : {}),
        snbt: toSnbt(root, schematic ? 15_000 : MAX_TEXT),
        nota: 'Para cambiar un valor usa editar_nbt con el camino (p. ej. Data.GameRules.keepInventory o Inventory[0].count) con el juego cerrado.' }
    } catch (e) { if (nbtExt) return { ...base, error: `No es un NBT válido: ${e instanceof Error ? e.message : e}` } }
  }

  if (!isProbablyText(buf)) return { ...base, tipo: 'binario', primerosBytes: buf.subarray(0, 64).toString('hex').replace(/(..)/g, '$1 ').trim() }

  const { text, encoding } = decodeText(buf)
  const out: Record<string, unknown> = { ...base, tipo: 'texto', codificacion: encoding }
  if (ext === '.json' || ext === '.mcmeta' || ext === '.bbmodel' || /^\s*[{[]/.test(text)) {
    try {
      const json = JSON.parse(text.replace(/^﻿/, ''))
      out.tipo = 'JSON'
      const model = opt.crudo ? null : describeModel(json, name)
      if (model) out.analisis = model
    } catch (e) { if (ext === '.json' || ext === '.mcmeta') out.errorJson = e instanceof Error ? e.message : String(e) }
  }
  if (ext === '.obj') out.analisis = describeObj(text)
  out.contenido = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + `\n…(recortado: ${text.length} caracteres)` : text
  return out
}

// ── Editar NBT ──────────────────────────────────────────────────────────────

function parseSnbtValue(raw: string, prev?: Tag): Tag {
  const s = raw.trim()
  if (prev) {
    const num = Number(s.replace(/[bBsSlLfFdD]$/, ''))
    switch (prev.type) {
      case 'byte': return { type: 'byte', value: s === 'true' ? 1 : s === 'false' ? 0 : num }
      case 'short': case 'int': case 'float': case 'double': return { type: prev.type, value: num }
      case 'long': { const b = BigInt(s.replace(/[lL]$/, '')); return { type: 'long', value: [Number((b >> 32n) & 0xffffffffn) | 0, Number(b & 0xffffffffn) | 0] } }
      case 'string': return { type: 'string', value: s.replace(/^"(.*)"$/, '$1') }
    }
  }
  if (/^-?\d+b$/i.test(s) || s === 'true' || s === 'false') return { type: 'byte', value: s === 'true' ? 1 : s === 'false' ? 0 : parseInt(s) }
  if (/^-?\d+s$/i.test(s)) return { type: 'short', value: parseInt(s) }
  if (/^-?\d+l$/i.test(s)) { const b = BigInt(s.slice(0, -1)); return { type: 'long', value: [Number((b >> 32n) & 0xffffffffn) | 0, Number(b & 0xffffffffn) | 0] } }
  if (/^-?[\d.]+f$/i.test(s)) return { type: 'float', value: parseFloat(s) }
  if (/^-?[\d.]+d$/i.test(s) || /^-?\d+\.\d+$/.test(s)) return { type: 'double', value: parseFloat(s) }
  if (/^-?\d+$/.test(s)) return { type: 'int', value: parseInt(s) }
  return { type: 'string', value: s.replace(/^"(.*)"$/, '$1') }
}

/** Cambia un valor de un archivo NBT por su camino (Data.GameRules.keepInventory, Inventory[0].count…). */
export async function editNbt(full: string, camino: string, valor: string): Promise<{ antes: string; despues: string }> {
  const raw = await fs.readFile(full)
  const { data, compression } = inflateMaybe(raw)
  const parsed = await nbt.parse(data)
  const root = parsed.parsed as unknown as Tag
  const parts = camino.match(/[^.[\]]+|\[\d+\]/g) ?? []
  let parent: any = null, key: string | number = ''
  let cur: any = root
  for (const p of parts) {
    parent = cur
    if (p.startsWith('[')) {
      const i = Number(p.slice(1, -1))
      if (cur.type !== 'list') throw new Error(`«${p}»: no es una lista`)
      key = i
      cur = { type: cur.value.type, value: cur.value.value[i] }
      if (cur.value === undefined) throw new Error(`No hay elemento ${i}`)
    } else {
      if (cur.type !== 'compound') throw new Error(`«${p}»: no es un compuesto`)
      key = p
      cur = cur.value[p]
      if (!cur) { cur = undefined; break }
    }
  }
  const before = cur ? toSnbt(cur, 500) : '(no existía)'
  const next = parseSnbtValue(valor, cur)
  if (typeof key === 'number') {
    if (parent.value.type !== next.type) throw new Error(`La lista es de ${parent.value.type}, no de ${next.type}`)
    parent.value.value[key] = next.value
  } else {
    parent.value[key] = next
  }
  const out = nbt.writeUncompressed(root as unknown as nbt.NBT, parsed.type)
  const final = compression === 'gzip' ? zlib.gzipSync(out) : compression === 'zlib' ? zlib.deflateSync(out) : out
  await fs.copy(full, full + '.ia-bak', { overwrite: true })
  await fs.writeFile(full, final)
  return { antes: before, despues: toSnbt(next, 500) }
}
