import fs from 'fs-extra'
import path from 'path'
import type AdmZip from 'adm-zip'
import { openJar } from './mcTextures'
import { getSharedDir } from './instances'
import type { ItemRender, RenderFace, RenderPart, AdvancementDef } from '../shared/types'

// Cómo se ve cada objeto, los textos del juego y los logros, sacados del .jar
// de la versión más nueva que el launcher ya tiene (como las texturas: nada se
// baja de internet y todo coincide con el juego).
//
// Los objetos se resuelven como hace el juego: assets/minecraft/items/<id>.json
// apunta a un modelo, el modelo hereda de sus padres, y al final o es un icono
// plano (item/generated) o un bloque con caras. Los «especiales» (cofres,
// shulkers, escudos, cabezas) se dibujan con su textura de entidad.

// ── Utilidades del .jar ─────────────────────────────────────────────────────

function readJson<T = Record<string, unknown>>(zip: AdmZip, rel: string): T | null {
  const e = zip.getEntry(rel)
  if (!e) return null
  try { return JSON.parse(e.getData().toString('utf8')) as T } catch { return null }
}

const images = new Map<string, { url: string; w: number; h: number } | null>()

/** Textura (ruta dentro de textures/, sin .png) con su tamaño, leído de la cabecera PNG. */
function texture(zip: AdmZip, rel: string): { url: string; w: number; h: number } | null {
  rel = rel.replace(/^minecraft:/, '')
  if (images.has(rel)) return images.get(rel)!
  const e = zip.getEntry(`assets/minecraft/textures/${rel}.png`)
  let out: { url: string; w: number; h: number } | null = null
  if (e) {
    const buf = e.getData()
    out = { url: `data:image/png;base64,${buf.toString('base64')}`, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  images.set(rel, out)
  return out
}

/** Una textura entera (el primer fotograma si es una tira animada) en el rectángulo de destino. */
function fullPart(zip: AdmZip, rel: string, tint?: string, dest: [number, number, number, number] = [0, 0, 1, 1]): RenderPart | null {
  const t = texture(zip, rel)
  if (!t) return null
  const side = Math.min(t.w, t.h)
  return { url: t.url, iw: t.w, ih: t.h, sx: 0, sy: 0, sw: t.w, sh: t.h > t.w ? side : t.h, dx: dest[0], dy: dest[1], dw: dest[2], dh: dest[3], tint }
}

function cropPart(t: { url: string; w: number; h: number }, sx: number, sy: number, sw: number, sh: number, dest: [number, number, number, number] = [0, 0, 1, 1], tint?: string): RenderPart {
  return { url: t.url, iw: t.w, ih: t.h, sx, sy, sw, sh, dx: dest[0], dy: dest[1], dw: dest[2], dh: dest[3], tint }
}

const hex = (n: number): string => `#${((n >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`

// ── Colores de tinte (los del bioma por defecto) ────────────────────────────

const GRASS = '#7cbd6b'
const FOLIAGE: Record<string, string> = { birch_leaves: '#80a755', spruce_leaves: '#619961', mangrove_leaves: '#8db127' }
function blockTint(id: string): string {
  if (id.endsWith('_leaves') || id === 'vine') return FOLIAGE[id] ?? '#48b518'
  if (id === 'lily_pad') return '#208030'
  return GRASS
}

function tintOf(tints: unknown[] | undefined, index: number, id: string): string | undefined {
  const t = tints?.[index] as { type?: string; default?: number; value?: number } | undefined
  if (!t) return undefined
  if (typeof t.default === 'number') return hex(t.default)
  if (typeof t.value === 'number') return hex(t.value)
  if (t.type === 'minecraft:grass') return GRASS
  if (t.type === 'minecraft:foliage') return blockTint(id)
  return undefined
}

// ── Modelos ─────────────────────────────────────────────────────────────────

interface ModelFace { texture: string; uv?: number[]; tintindex?: number }
interface ModelElement { from: number[]; to: number[]; faces: Record<string, ModelFace> }
interface Model { parent?: string; textures?: Record<string, string>; elements?: ModelElement[] }

/** Junta la cadena de padres: texturas (el hijo manda), elementos (los del más cercano) y si es plano. */
function resolveModel(zip: AdmZip, name: string): { textures: Record<string, string>; elements?: ModelElement[]; generated: boolean } | null {
  const textures: Record<string, string> = {}
  let elements: ModelElement[] | undefined
  let generated = false
  let cur: string | undefined = name
  for (let depth = 0; cur && depth < 20; depth++) {
    const clean: string = cur.replace(/^minecraft:/, '')
    if (clean === 'builtin/generated') { generated = true; break }
    if (clean === 'builtin/entity') break
    const m: Model | null = readJson<Model>(zip, `assets/minecraft/models/${clean}.json`)
    if (!m) return depth === 0 ? null : { textures, elements, generated }
    for (const [k, v] of Object.entries(m.textures ?? {})) if (!(k in textures)) textures[k] = v
    if (!elements && m.elements) elements = m.elements
    cur = m.parent
  }
  return { textures, elements, generated }
}

function lookupTexture(textures: Record<string, string>, ref: string): string | null {
  let r = ref
  for (let i = 0; i < 10 && r.startsWith('#'); i++) r = textures[r.slice(1)] ?? ''
  return r && !r.startsWith('#') ? r : null
}

/** Modelo de bloque → cubo con las tres caras que se ven en el inventario. */
function cubeFromElements(zip: AdmZip, id: string, textures: Record<string, string>, elements: ModelElement[], tints?: unknown[]): ItemRender | null {
  if (!elements.length) return null
  const min = [16, 16, 16], max = [0, 0, 0]
  for (const el of elements) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], el.from[i]); max[i] = Math.max(max[i], el.to[i]) }
  const full = elements.filter((el) => el.from.every((v, i) => v === min[i]) && el.to.every((v, i) => v === max[i]))
  const layers = full.length ? full : [elements.reduce((a, b) => vol(b) > vol(a) ? b : a)]
  const face = (dir: string): RenderFace => {
    const parts: RenderPart[] = []
    for (const el of layers) {
      const f = el.faces[dir]
      if (!f) continue
      const rel = lookupTexture(textures, f.texture)
      const t = rel ? texture(zip, rel) : null
      if (!t) continue
      const uv = f.uv ?? defaultUv(dir, el)
      // Las UV van de 0 a 16 sobre el primer fotograma (cuadrado) de la textura
      const s = t.w / 16
      const tint = f.tintindex !== undefined && f.tintindex >= 0 ? tintOf(tints, f.tintindex, id) ?? blockTint(id) : undefined
      parts.push(cropPart(t, Math.min(uv[0], uv[2]) * s, Math.min(uv[1], uv[3]) * s, Math.abs(uv[2] - uv[0]) * s, Math.abs(uv[3] - uv[1]) * s, [0, 0, 1, 1], tint))
    }
    return { parts }
  }
  const sx = (max[0] - min[0]) / 16, sy = (max[1] - min[1]) / 16, sz = (max[2] - min[2]) / 16
  const top = face('up'), left = face('north'), right = face('east')
  if (!top.parts.length && !left.parts.length) return null
  return { kind: 'cube', sx, sy, sz, top, left, right }
}
const vol = (el: ModelElement): number => (el.to[0] - el.from[0]) * (el.to[1] - el.from[1]) * (el.to[2] - el.from[2])
function defaultUv(dir: string, el: ModelElement): number[] {
  const [x1, y1, z1] = el.from, [x2, y2, z2] = el.to
  if (dir === 'up' || dir === 'down') return [x1, z1, x2, z2]
  if (dir === 'north' || dir === 'south') return [x1, 16 - y2, x2, 16 - y1]
  return [z1, 16 - y2, z2, 16 - y1]
}

function fromModel(zip: AdmZip, id: string, model: string, tints?: unknown[]): ItemRender | null {
  const m = resolveModel(zip, model)
  if (!m) return null
  if (m.generated || (!m.elements && m.textures.layer0)) {
    const parts: RenderPart[] = []
    for (let i = 0; i < 5; i++) {
      const rel = m.textures[`layer${i}`]
      if (!rel) continue
      const p = fullPart(zip, rel, tintOf(tints, i, id))
      if (p) parts.push(p)
    }
    return parts.length ? { kind: 'flat', parts } : null
  }
  if (m.elements) return cubeFromElements(zip, id, m.textures, m.elements, tints)
  return null
}

// ── Especiales: se dibujan con la textura de la entidad ─────────────────────

/** Caja con el despliegue de UV de Minecraft: [arriba, frente, lado derecho]. */
function boxUv(u: number, v: number, dx: number, dy: number, dz: number): { top: number[]; front: number[]; right: number[] } {
  return { top: [u + dz, v, dx, dz], front: [u + dz, v + dz, dx, dy], right: [u + dz + dx, v + dz, dz, dy] }
}

function special(zip: AdmZip, spec: { type?: string; texture?: string; kind?: string }): ItemRender | null {
  const type = (spec.type ?? '').replace(/^minecraft:/, '')
  if (type === 'chest') {
    const t = texture(zip, `entity/chest/${(spec.texture ?? 'normal').replace(/^minecraft:/, '')}`)
    if (!t) return null
    // Tapa (5 de alto) y base (10): se ven juntas en el frente y el lado
    const lid = boxUv(0, 0, 14, 5, 14), base = boxUv(0, 19, 14, 10, 14)
    const stack = (a: number[], b: number[]): RenderFace => ({ parts: [
      cropPart(t, a[0], a[1], a[2], a[3], [0, 0, 1, 5 / 15]),
      cropPart(t, b[0], b[1], b[2], b[3], [0, 5 / 15, 1, 10 / 15]),
    ] })
    return { kind: 'cube', sx: 14 / 16, sy: 15 / 16, sz: 14 / 16, top: { parts: [cropPart(t, lid.top[0], lid.top[1], lid.top[2], lid.top[3])] }, left: stack(lid.front, base.front), right: stack(lid.right, base.right) }
  }
  if (type === 'shulker_box') {
    const t = texture(zip, `entity/shulker/${(spec.texture ?? 'shulker').replace(/^minecraft:/, '')}`)
    if (!t) return null
    // La tapa (12 de alto) y la base (8) encajan con dientes: en cada lado va la base
    // abajo y la tapa encima, y por los huecos de los dientes de una se ve la otra.
    const lid = boxUv(0, 0, 16, 12, 16), base = boxUv(0, 28, 16, 8, 16)
    const stack = (a: number[], b: number[]): RenderFace => ({ parts: [
      cropPart(t, b[0], b[1], b[2], b[3], [0, 8 / 16, 1, 8 / 16]),
      cropPart(t, a[0], a[1], a[2], a[3], [0, 0, 1, 12 / 16]),
    ] })
    return { kind: 'cube', sx: 1, sy: 1, sz: 1, top: { parts: [cropPart(t, lid.top[0], lid.top[1], lid.top[2], lid.top[3])] }, left: stack(lid.front, base.front), right: stack(lid.right, base.right) }
  }
  if (type === 'shield') {
    const t = texture(zip, 'entity/shield/shield_base_nopattern') ?? texture(zip, 'entity/shield_base_nopattern')
    if (!t) return null
    // La cara del escudo (12×22) en vertical, centrada
    return { kind: 'flat', parts: [cropPart(t, 1, 1, 12, 22, [(1 - 12 / 22) / 2, 0, 12 / 22, 1])] }
  }
  if (type === 'head' || type === 'player_head') {
    const kind = spec.kind ?? 'player'
    const tex: Record<string, string> = {
      skeleton: 'entity/skeleton/skeleton', wither_skeleton: 'entity/skeleton/wither_skeleton', zombie: 'entity/zombie/zombie',
      creeper: 'entity/creeper/creeper', player: 'entity/player/wide/steve', piglin: 'entity/piglin/piglin',
    }
    const t = texture(zip, type === 'player_head' ? tex.player : tex[kind] ?? tex.player)
    if (!t) return null
    const h = boxUv(0, 0, 8, 8, 8)
    const f = (r: number[]): RenderFace => ({ parts: [cropPart(t, r[0], r[1], r[2], r[3])] })
    // En el inventario las cabezas se ven más grandes que su tamaño real (8 de 16)
    return { kind: 'cube', sx: 0.72, sy: 0.72, sz: 0.72, top: f(h.top), left: f(h.front), right: f(h.right) }
  }
  return null
}

// ── Del json de items al dibujo ─────────────────────────────────────────────

interface ItemNode {
  type?: string; model?: string | ItemNode; base?: string; tints?: unknown[]
  on_false?: ItemNode; fallback?: ItemNode; cases?: { when: unknown; model: ItemNode }[]
  entries?: { model: ItemNode }[]; models?: ItemNode[]; property?: string
}

function fromNode(zip: AdmZip, id: string, node: ItemNode | undefined, depth = 0): ItemRender | null {
  if (!node || depth > 10) return null
  const type = (node.type ?? '').replace(/^minecraft:/, '')
  switch (type) {
    case 'model': return typeof node.model === 'string' ? fromModel(zip, id, node.model, node.tints) : null
    case 'condition': return fromNode(zip, id, node.on_false, depth + 1)
    case 'select': {
      // Lo que se ve en el inventario: el caso «gui» si es un modelo normal; si no, el de siempre
      if ((node.property ?? '').endsWith('display_context')) {
        const gui = node.cases?.find((c) => (Array.isArray(c.when) ? c.when : [c.when]).includes('gui'))
        if (gui && (gui.model.type ?? '').endsWith('model')) return fromNode(zip, id, gui.model, depth + 1)
      }
      return fromNode(zip, id, node.fallback ?? node.cases?.[0]?.model, depth + 1)
    }
    case 'range_dispatch': return fromNode(zip, id, node.fallback ?? node.entries?.[0]?.model, depth + 1)
    case 'composite': return fromNode(zip, id, node.models?.[0], depth + 1)
    case 'special': return special(zip, node.model as { type?: string }) ?? (node.base ? fromModel(zip, id, node.base) : null)
    default: return null
  }
}

const renders = new Map<string, ItemRender | null>()

/** Cómo dibujar cada objeto (null si no se sabe; el icono plano de siempre queda de respaldo). */
export async function getItemRenders(ids: string[]): Promise<Record<string, ItemRender | null>> {
  const zip = await openJar()
  const out: Record<string, ItemRender | null> = {}
  for (const raw of ids) {
    const id = raw.replace(/^minecraft:/, '')
    if (renders.has(id)) { out[raw] = renders.get(id)!; continue }
    let r: ItemRender | null = null
    if (zip && /^[a-z0-9_./-]+$/.test(id)) {
      try {
        const def = readJson<{ model?: ItemNode }>(zip, `assets/minecraft/items/${id}.json`)
        r = def ? fromNode(zip, id, def.model) : fromModel(zip, id, `item/${id}`)
        if (!r) {
          // Último recurso: la textura del objeto o del bloque, plana
          for (const rel of [`item/${id}`, `block/${id}`, `block/${id}_front`, `block/${id}_side`, `block/${id}_top`]) {
            const p = fullPart(zip, rel)
            if (p) { r = { kind: 'flat', parts: [p] }; break }
          }
        }
      } catch (e) {
        console.warn(`[mcAssets] No se pudo resolver ${id}:`, (e as Error).message)
      }
    }
    renders.set(id, r)
    out[raw] = r
  }
  return out
}

// ── Textos del juego (es_es encima de en_us) ────────────────────────────────

let lang: { code: string; map: Record<string, string> } | null = null

/** Las traducciones del juego. en_us viene en el .jar; el resto, en los assets descargados. */
export async function getLang(code: 'es_es' | 'en_us' = 'es_es'): Promise<Record<string, string>> {
  if (lang?.code === code) return lang.map
  const zip = await openJar()
  const map: Record<string, string> = { ...(zip ? readJson<Record<string, string>>(zip, 'assets/minecraft/lang/en_us.json') ?? {} : {}) }
  if (code !== 'en_us') {
    try {
      const shared = getSharedDir()
      const versions = (await fs.readdir(path.join(shared, 'versions'))).filter((n) => /^\d+\.\d+(\.\d+)?$/.test(n))
      versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      for (const v of versions) {
        const json = await fs.readJson(path.join(shared, 'versions', v, `${v}.json`)).catch(() => null) as { assetIndex?: { id: string } } | null
        if (!json?.assetIndex) continue
        const index = await fs.readJson(path.join(shared, 'assets', 'indexes', `${json.assetIndex.id}.json`)).catch(() => null) as { objects?: Record<string, { hash: string }> } | null
        const hash = index?.objects?.[`minecraft/lang/${code}.json`]?.hash
        if (!hash) continue
        const tr = await fs.readJson(path.join(shared, 'assets', 'objects', hash.slice(0, 2), hash)).catch(() => null)
        if (tr) { Object.assign(map, tr); break }
      }
    } catch { /* sin traducción: en inglés */ }
  }
  lang = { code, map }
  return map
}

// ── Logros ──────────────────────────────────────────────────────────────────

let advancements: AdvancementDef[] | null = null

/** Los logros del juego con su pestaña, padre, icono, textos y criterios (sin los de recetas). */
export async function getAdvancementDefs(): Promise<AdvancementDef[]> {
  if (advancements) return advancements
  const zip = await openJar()
  const out: AdvancementDef[] = []
  if (zip) {
    for (const e of zip.getEntries()) {
      const m = /^data\/minecraft\/advancements?\/(.+)\.json$/.exec(e.entryName)
      if (!m || m[1].startsWith('recipes/')) continue
      try {
        const j = JSON.parse(e.getData().toString('utf8')) as {
          parent?: string; criteria?: Record<string, unknown>; requirements?: string[][]
          display?: { icon?: { id?: string; item?: string }; title?: unknown; description?: unknown; frame?: string; background?: string; hidden?: boolean }
        }
        out.push({
          id: `minecraft:${m[1]}`,
          tab: m[1].split('/')[0],
          parent: j.parent,
          criteria: Object.keys(j.criteria ?? {}),
          requirements: j.requirements,
          display: j.display ? {
            icon: j.display.icon?.id ?? j.display.icon?.item ?? 'minecraft:stone',
            title: j.display.title,
            description: j.display.description,
            frame: (j.display.frame as 'task' | 'goal' | 'challenge') ?? 'task',
            background: j.display.background,
            hidden: !!j.display.hidden,
          } : undefined,
        })
      } catch { /* json raro: se salta */ }
    }
  }
  advancements = out
  return out
}
