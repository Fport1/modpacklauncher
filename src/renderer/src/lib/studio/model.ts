// Modelos de bloque e ítem de Minecraft (el JSON de vanilla) para el Estudio de modelos.
//
// Se lee todo lo que trae el archivo y se guarda igual: lo que el editor no entiende
// (display, gui_light, claves de Blockbench…) se conserva tal cual, y el JSON sale con la
// misma forma que escriben los scripts de WinterTales (2 espacios y salto de línea final).
// Las «piezas» son los groups de Blockbench: Minecraft los ignora, pero así se guardan.

export type V3 = [number, number, number]
export type Dir = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'
export const DIRS: Dir[] = ['north', 'south', 'east', 'west', 'up', 'down']
export const DIR_NAMES: Record<Dir, string> = { north: 'Norte', south: 'Sur', east: 'Este', west: 'Oeste', up: 'Arriba', down: 'Abajo' }

export interface SFace {
  uv?: [number, number, number, number]
  texture: string
  rotation?: number
  cullface?: string
  tintindex?: number
  /** Lo demás que traiga la cara */
  extra?: Record<string, unknown>
  /** Orden de las claves en el archivo */
  keys?: string[]
}

export interface SRotation { origin: V3; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean; keys?: string[] }

export interface SElement {
  /** Identificador del editor (no se guarda) */
  uid: string
  name?: string
  from: V3
  to: V3
  rotation?: SRotation
  shade?: boolean
  faces: Partial<Record<Dir, SFace>>
  /** Solo en el editor: oculto o bloqueado */
  hidden?: boolean
  locked?: boolean
  extra?: Record<string, unknown>
  keys?: string[]
}

export interface SGroup {
  uid: string
  name: string
  origin: V3
  /** uid de cubos o piezas de dentro */
  children: (string | SGroup)[]
  hidden?: boolean
  locked?: boolean
  extra?: Record<string, unknown>
}

export interface SModel {
  parent?: string
  textures: Record<string, string>
  /** null: el modelo no tiene cubos propios (los hereda del padre) */
  elements: SElement[] | null
  groups: SGroup[] | null
  /** Resto de claves de la raíz, en su orden */
  extra: Record<string, unknown>
  /** Orden de las claves de la raíz, para guardarlas igual */
  order: string[]
}

let counter = 0
export const uid = (p = 'c'): string => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`

const num = (v: unknown, d = 0): number => (typeof v === 'number' && isFinite(v) ? v : d)
const v3 = (v: unknown, d: V3 = [0, 0, 0]): V3 => (Array.isArray(v) && v.length === 3 ? [num(v[0]), num(v[1]), num(v[2])] : [...d])
const pick = (o: Record<string, unknown>, known: string[]): Record<string, unknown> | undefined => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (!known.includes(k)) out[k] = v
  return Object.keys(out).length ? out : undefined
}

export function parseModel(text: string): SModel {
  const j = JSON.parse(text) as Record<string, unknown>
  const elements = Array.isArray(j.elements)
    ? (j.elements as Record<string, unknown>[]).map((e): SElement => {
      const faces: Partial<Record<Dir, SFace>> = {}
      for (const [d, f] of Object.entries((e.faces ?? {}) as Record<string, Record<string, unknown>>)) {
        if (!DIRS.includes(d as Dir) || !f) continue
        faces[d as Dir] = {
          uv: Array.isArray(f.uv) && f.uv.length === 4 ? (f.uv.map((x) => num(x)) as SFace['uv']) : undefined,
          texture: typeof f.texture === 'string' ? f.texture : '#missing',
          rotation: typeof f.rotation === 'number' ? f.rotation : undefined,
          cullface: typeof f.cullface === 'string' ? f.cullface : undefined,
          tintindex: typeof f.tintindex === 'number' ? f.tintindex : undefined,
          extra: pick(f, ['uv', 'texture', 'rotation', 'cullface', 'tintindex']),
          keys: Object.keys(f),
        }
      }
      const r = e.rotation as Record<string, unknown> | undefined
      return {
        uid: uid(),
        name: typeof e.name === 'string' ? e.name : undefined,
        from: v3(e.from), to: v3(e.to, [16, 16, 16]),
        rotation: r ? { origin: v3(r.origin, [8, 8, 8]), axis: (['x', 'y', 'z'].includes(r.axis as string) ? r.axis : 'y') as SRotation['axis'], angle: num(r.angle), rescale: r.rescale === true ? true : undefined, keys: Object.keys(r) } : undefined,
        shade: e.shade === false ? false : undefined,
        faces,
        extra: pick(e, ['name', 'from', 'to', 'rotation', 'shade', 'faces']),
        keys: Object.keys(e),
      }
    })
    : null
  // Piezas (groups de Blockbench): los hijos son índices de cubo o más piezas
  const toGroup = (g: Record<string, unknown>): SGroup => ({
    uid: uid('g'),
    name: typeof g.name === 'string' ? g.name : 'pieza',
    origin: v3(g.origin, [8, 8, 8]),
    children: ((g.children ?? []) as unknown[]).map((c) => (typeof c === 'number' ? elements?.[c]?.uid ?? '' : toGroup(c as Record<string, unknown>))).filter((c) => c !== ''),
    extra: pick(g, ['name', 'origin', 'children']),
  })
  const groups = Array.isArray(j.groups) ? (j.groups as unknown[]).filter((g) => g && typeof g === 'object').map((g) => toGroup(g as Record<string, unknown>)) : null
  return {
    parent: typeof j.parent === 'string' ? j.parent : undefined,
    textures: { ...((j.textures ?? {}) as Record<string, string>) },
    elements, groups,
    extra: pick(j, ['parent', 'textures', 'elements', 'groups']) ?? {},
    order: Object.keys(j),
  }
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4
/** Las claves en el orden que tenían en el archivo; las nuevas, al final */
const ordered = (o: Record<string, unknown>, keys?: string[]): Record<string, unknown> => {
  if (!keys) return o
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in o) out[k] = o[k]
  for (const k of Object.keys(o)) if (!(k in out)) out[k] = o[k]
  return out
}

export function serializeModel(m: SModel): string {
  const els = m.elements
  const elementJson = els?.map((e) => {
    const o: Record<string, unknown> = {}
    if (e.name) o.name = e.name
    o.from = e.from.map(round)
    o.to = e.to.map(round)
    if (e.rotation) {
      o.rotation = ordered({ origin: e.rotation.origin.map(round), axis: e.rotation.axis, angle: round(e.rotation.angle), ...(e.rotation.rescale ? { rescale: true } : {}) }, e.rotation.keys)
    }
    if (e.shade === false) o.shade = false
    const faces: Record<string, unknown> = {}
    // En el orden del archivo (las caras nuevas, al final)
    for (const d of Object.keys(e.faces) as Dir[]) {
      const f = e.faces[d]
      if (!f) continue
      faces[d] = ordered({
        ...(f.uv ? { uv: f.uv.map(round) } : {}),
        ...(f.rotation ? { rotation: f.rotation } : {}),
        texture: f.texture,
        ...(f.cullface ? { cullface: f.cullface } : {}),
        ...(f.tintindex !== undefined ? { tintindex: f.tintindex } : {}),
        ...(f.extra ?? {}),
      }, f.keys)
    }
    o.faces = faces
    return ordered({ ...o, ...(e.extra ?? {}) }, e.keys)
  })
  const index = new Map((els ?? []).map((e, i) => [e.uid, i]))
  const groupJson = (g: SGroup): Record<string, unknown> => ({
    name: g.name, origin: g.origin.map(round),
    ...(g.extra ?? {}),
    children: g.children.map((c) => (typeof c === 'string' ? index.get(c) : groupJson(c))).filter((c) => c !== undefined),
  })
  const parts: Record<string, unknown> = {
    ...(m.parent ? { parent: m.parent } : {}),
    ...(Object.keys(m.textures).length || m.order.includes('textures') ? { textures: m.textures } : {}),
    ...(elementJson ? { elements: elementJson } : {}),
    ...(m.groups && m.groups.length ? { groups: m.groups.map(groupJson) } : {}),
    ...m.extra,
  }
  // Mismo orden de claves que tenía el archivo; lo nuevo, al final
  const out: Record<string, unknown> = {}
  for (const k of m.order) if (k in parts) out[k] = parts[k]
  for (const k of Object.keys(parts)) if (!(k in out)) out[k] = parts[k]
  return `${JSON.stringify(out, null, 2)}\n`
}

// ── Operaciones con cubos ───────────────────────────────────────────────────

export const center = (e: SElement): V3 => [(e.from[0] + e.to[0]) / 2, (e.from[1] + e.to[1]) / 2, (e.from[2] + e.to[2]) / 2]
export const size = (e: SElement): V3 => [e.to[0] - e.from[0], e.to[1] - e.from[1], e.to[2] - e.from[2]]

/** UV por defecto de una cara (la que pone el juego si no se indica). */
export function defaultUv(d: Dir, e: SElement): [number, number, number, number] {
  const [x1, y1, z1] = e.from, [x2, y2, z2] = e.to
  switch (d) {
    case 'up': return [x1, z1, x2, z2]
    case 'down': return [x1, 16 - z2, x2, 16 - z1]
    case 'north': return [16 - x2, 16 - y2, 16 - x1, 16 - y1]
    case 'south': return [x1, 16 - y2, x2, 16 - y1]
    case 'west': return [z1, 16 - y2, z2, 16 - y1]
    case 'east': return [16 - z2, 16 - y2, 16 - z1, 16 - y1]
  }
}

export function newCube(texture: string, at: V3 = [8, 0, 8]): SElement {
  const from: V3 = [at[0] - 2, at[1], at[2] - 2]
  const to: V3 = [at[0] + 2, at[1] + 4, at[2] + 2]
  const e: SElement = { uid: uid(), name: 'cubo', from, to, faces: {} }
  for (const d of DIRS) e.faces[d] = { texture, uv: defaultUv(d, e) }
  return e
}

export function cloneElement(e: SElement): SElement {
  return { ...structuredClone(e), uid: uid() }
}

/** Copia en espejo izquierda↔derecha (respecto a la mitad del bloque, x = 8). */
export function mirrorX(e: SElement): SElement {
  const c = cloneElement(e)
  c.from = [16 - e.to[0], e.from[1], e.from[2]]
  c.to = [16 - e.from[0], e.to[1], e.to[2]]
  if (c.rotation) {
    c.rotation.origin = [16 - c.rotation.origin[0], c.rotation.origin[1], c.rotation.origin[2]]
    if (c.rotation.axis !== 'x') c.rotation.angle = -c.rotation.angle
  }
  const east = c.faces.east, west = c.faces.west
  c.faces.east = west
  c.faces.west = east
  // Las caras se ven del revés: la textura también
  for (const d of DIRS) {
    const f = c.faces[d]
    if (f?.uv && d !== 'east' && d !== 'west') f.uv = [f.uv[2], f.uv[1], f.uv[0], f.uv[3]]
  }
  if (c.name) c.name = c.name.replace(/izquierd[oa]|left/gi, (m) => (/left/i.test(m) ? 'right' : m.endsWith('a') ? 'derecha' : 'derecho'))
  return c
}

/** Todos los cubos de una pieza (y de sus piezas de dentro). */
export function cubesOf(g: SGroup): string[] {
  return g.children.flatMap((c) => (typeof c === 'string' ? [c] : cubesOf(c)))
}

export function findGroup(groups: SGroup[] | null, id: string): SGroup | null {
  for (const g of groups ?? []) {
    if (g.uid === id) return g
    const inner = findGroup(g.children.filter((c): c is SGroup => typeof c !== 'string'), id)
    if (inner) return inner
  }
  return null
}

/** Quita un cubo de todas las piezas. */
export function removeFromGroups(groups: SGroup[] | null, cube: string): void {
  for (const g of groups ?? []) {
    g.children = g.children.filter((c) => c !== cube)
    removeFromGroups(g.children.filter((c): c is SGroup => typeof c !== 'string'), cube)
  }
}

/** Referencia «#cara» → textura de verdad, siguiendo #alias. */
export function resolveTex(m: SModel, ref: string): string | null {
  let r = ref
  for (let i = 0; i < 10 && r.startsWith('#'); i++) r = m.textures[r.slice(1)] ?? ''
  if (!r || r.startsWith('#')) return null
  return r.includes(':') ? r : `minecraft:${r}`
}
