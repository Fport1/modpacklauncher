import type { NbtTag } from '../../../shared/types'
import { componentToCodes, readRich, buildRich, type RichText } from './mcText'

// Atajos para leer y construir etiquetas NBT desde los editores sencillos,
// sin tener que escribir { type, value } a mano en cada sitio.

export type Compound = Record<string, NbtTag | undefined>

export const str = (value: string): NbtTag => ({ type: 'string', value })
export const byte = (value: number | boolean): NbtTag => ({ type: 'byte', value: typeof value === 'boolean' ? (value ? 1 : 0) : value })
export const int = (value: number): NbtTag => ({ type: 'int', value: Math.trunc(value) })
export const float = (value: number): NbtTag => ({ type: 'float', value: Math.fround(value) })
export const double = (value: number): NbtTag => ({ type: 'double', value })
export const compound = (value: Compound): NbtTag => ({ type: 'compound', value })
export function stringList(values: string[]): NbtTag {
  return { type: 'list', value: { type: values.length ? 'string' : 'end', value: values } }
}
export function compoundList(values: Compound[]): NbtTag {
  return { type: 'list', value: { type: values.length ? 'compound' : 'end', value: values } }
}

/** Elementos de una lista (vacía si no existe). Para listas de compounds son los objetos reales. */
export function listItems<T = unknown>(tag: NbtTag | undefined): T[] {
  if (!tag || tag.type !== 'list') return []
  return tag.value.value as T[]
}

export const getStr = (c: Compound | undefined, key: string, def = ''): string => {
  const t = c?.[key]
  return t && t.type === 'string' ? t.value : def
}
export const getNum = (c: Compound | undefined, key: string, def = 0): number => {
  const t = c?.[key]
  return t && typeof t.value === 'number' ? t.value : def
}
export const getBool = (c: Compound | undefined, key: string, def = false): boolean => {
  const t = c?.[key]
  return t && typeof t.value === 'number' ? t.value !== 0 : def
}

// ── Texto con formato guardado en NBT ───────────────────────────────────────
//
// Hasta la 1.21.4 se guarda como JSON en una etiqueta String; desde la 1.21.5,
// como un Compound. Se lee de las dos formas y se escribe como estaba.

const STYLE_KEYS = ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated']

function nbtToComponent(tag: NbtTag): unknown {
  if (tag.type === 'string') return tag.value
  if (tag.type === 'compound') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(tag.value as Compound)) {
      if (!v) continue
      out[k] = STYLE_KEYS.includes(k) && typeof v.value === 'number' ? v.value !== 0 : nbtToComponent(v)
    }
    return out
  }
  if (tag.type === 'list') return (tag.value.value as unknown[]).map((raw) => nbtToComponent({ type: tag.value.type, value: raw }))
  return tag.value
}

/** Componente (objeto JS) → NBT, como lo guarda el juego desde la 1.21.5. */
function componentToNbt(c: unknown): NbtTag {
  if (typeof c === 'string') return str(c)
  if (typeof c === 'boolean') return byte(c)
  if (typeof c === 'number') return int(c)
  if (Array.isArray(c)) return compoundList(c.map((x) => (typeof x === 'string' ? { text: str(x) } : componentToNbt(x).value) as Compound))
  const out: Compound = {}
  for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
    if (v === undefined || v === null) continue
    out[k] = componentToNbt(v)
  }
  return compound(out)
}

/** Texto de una etiqueta (JSON o compound) como códigos &. */
export function readText(tag: NbtTag | undefined): string {
  if (!tag) return ''
  if (tag.type === 'string') return componentToCodes(tag.value)
  return componentToCodes(nbtToComponent(tag))
}

/** Versión de datos desde la que los textos se guardan como NBT y no como JSON (1.21.5). */
export const TEXT_AS_NBT = 4325

/** true si el archivo guarda los textos como NBT (1.21.5 en adelante). */
export const textAsNbt = (root: NbtTag): boolean => getNum(root.value as Compound, 'DataVersion') >= TEXT_AS_NBT

/**
 * Códigos & → etiqueta en el formato del archivo. Hasta la 1.21.4, JSON dentro
 * de un String; desde la 1.21.5, NBT (y un String simple si es texto sin formato:
 * un JSON ahí se vería literalmente, con llaves y todo).
 */
export function writeText(codes: string, modern: boolean): NbtTag {
  return writeRichText({ codes }, modern)
}

/** Texto con sus eventos (ratón encima, clic). */
export function readRichText(tag: NbtTag | undefined): RichText {
  if (!tag) return { codes: '' }
  return readRich(tag.type === 'string' ? tag.value : nbtToComponent(tag))
}

export function writeRichText(rich: RichText, modern: boolean): NbtTag {
  const comp = buildRich(rich, modern)
  if (!modern) return str(JSON.stringify(comp))
  const keys = Object.keys(comp)
  if (keys.length === 1 && keys[0] === 'text') return str(String(comp.text))
  return componentToNbt(comp)
}
