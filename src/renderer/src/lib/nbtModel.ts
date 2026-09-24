import type { NbtTag, NbtTagType } from '../../../shared/types'

// Árbol NBT en la forma de prismarine-nbt: rutas, lectura y cambios.
// Lo usa el modo avanzado de los archivos NBT (components/ftp/NbtTree).

export type Key = string | number
export type Path = Key[]

export const TYPE_BADGE: Record<string, { text: string; cls: string; label: string }> = {
  byte: { text: 'B', cls: 'bg-orange-500/20 text-orange-300', label: 'Byte' },
  short: { text: 'S', cls: 'bg-orange-500/20 text-orange-300', label: 'Short' },
  int: { text: 'I', cls: 'bg-sky-500/20 text-sky-300', label: 'Int' },
  long: { text: 'L', cls: 'bg-sky-500/20 text-sky-300', label: 'Long' },
  float: { text: 'F', cls: 'bg-emerald-500/20 text-emerald-300', label: 'Float' },
  double: { text: 'D', cls: 'bg-emerald-500/20 text-emerald-300', label: 'Double' },
  string: { text: '"', cls: 'bg-amber-500/20 text-amber-300', label: 'String' },
  list: { text: '[ ]', cls: 'bg-purple-500/20 text-purple-300', label: 'List' },
  compound: { text: '{ }', cls: 'bg-pink-500/20 text-pink-300', label: 'Compound' },
  byteArray: { text: '[B]', cls: 'bg-orange-500/20 text-orange-300', label: 'Byte array' },
  shortArray: { text: '[S]', cls: 'bg-orange-500/20 text-orange-300', label: 'Short array' },
  intArray: { text: '[I]', cls: 'bg-sky-500/20 text-sky-300', label: 'Int array' },
  longArray: { text: '[L]', cls: 'bg-sky-500/20 text-sky-300', label: 'Long array' },
  end: { text: '∅', cls: 'bg-bg-hover text-text-muted', label: 'Vacía' }
}

export const ADDABLE: NbtTagType[] = ['byte', 'short', 'int', 'long', 'float', 'double', 'string', 'compound', 'list', 'byteArray', 'intArray', 'longArray']

export const ARRAY_ELEMENT: Record<string, NbtTagType> = { byteArray: 'byte', shortArray: 'short', intArray: 'int', longArray: 'long' }
export const isContainer = (t: string): boolean => t === 'compound' || t === 'list' || t in ARRAY_ELEMENT

/** Valor inicial de una etiqueta nueva de cada tipo. */
export function defaultValue(type: string): unknown {
  switch (type) {
    case 'long': return [0, 0]
    case 'string': return ''
    case 'list': return { type: 'end', value: [] }
    case 'compound': return {}
    case 'byteArray': case 'shortArray': case 'intArray': case 'longArray': return []
    default: return 0
  }
}

/** Hijos de un contenedor como etiquetas virtuales que apuntan a los datos reales. */
export function childrenOf(node: NbtTag): [Key, NbtTag][] {
  if (node.type === 'compound') {
    return Object.entries(node.value as Record<string, NbtTag | undefined>).filter((e): e is [string, NbtTag] => !!e[1])
  }
  if (node.type === 'list') {
    const { type, value } = node.value as { type: NbtTagType; value: unknown[] }
    return value.map((raw, i) => [i, { type, value: raw }])
  }
  const el = ARRAY_ELEMENT[node.type]
  if (el) return (node.value as unknown[]).map((n, i) => [i, { type: el, value: n }])
  return []
}

export function resolve(root: NbtTag, path: Path): NbtTag {
  let node = root
  for (const key of path) {
    const next = childrenOf(node).find(([k]) => k === key)
    if (!next) throw new Error('Ruta no encontrada')
    node = next[1]
  }
  return node
}

export function setRaw(root: NbtTag, path: Path, raw: unknown): void {
  const parent = resolve(root, path.slice(0, -1))
  const key = path[path.length - 1]
  if (parent.type === 'compound') (parent.value[key] as NbtTag).value = raw
  else if (parent.type === 'list') parent.value.value[key as number] = raw
  else parent.value[key as number] = raw
}

export function removeAt(root: NbtTag, path: Path): void {
  const parent = resolve(root, path.slice(0, -1))
  const key = path[path.length - 1]
  if (parent.type === 'compound') delete parent.value[key]
  else if (parent.type === 'list') {
    parent.value.value.splice(key as number, 1)
    if (parent.value.value.length === 0) parent.value.type = 'end'
  } else parent.value.splice(key as number, 1)
}

/** Renombra conservando el orden de las claves, que es el que se ve en el juego y en otras herramientas. */
export function renameAt(root: NbtTag, path: Path, to: string): void {
  const parent = resolve(root, path.slice(0, -1))
  const from = path[path.length - 1] as string
  parent.value = Object.fromEntries(Object.entries(parent.value).map(([k, v]) => [k === from ? to : k, v]))
}

export function addChild(root: NbtTag, path: Path, type: NbtTagType, name: string): Key {
  const node = resolve(root, path)
  if (node.type === 'compound') {
    node.value[name] = { type, value: defaultValue(type) }
    return name
  }
  if (node.type === 'list') {
    if (node.value.value.length === 0) node.value.type = type
    node.value.value.push(defaultValue(node.value.type))
    return node.value.value.length - 1
  }
  node.value.push(defaultValue(ARRAY_ELEMENT[node.type]))
  return node.value.length - 1
}

// ── Valores ─────────────────────────────────────────────────────────────────

export function longToString(v: [number, number]): string {
  return BigInt.asIntN(64, (BigInt(v[0]) << 32n) | BigInt(v[1] >>> 0)).toString()
}

export const INT_RANGE: Record<string, [number, number]> = {
  byte: [-128, 127], short: [-32768, 32767], int: [-2147483648, 2147483647]
}

/** Texto → valor del tipo, o un mensaje de por qué no vale. */
export function parseValue(type: string, text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = text.trim()
  if (type === 'string') return { ok: true, value: text }
  if (INT_RANGE[type]) {
    const [min, max] = INT_RANGE[type]
    if (!/^-?\d+$/.test(t)) return { ok: false, error: 'Tiene que ser un número entero' }
    const n = Number(t)
    if (n < min || n > max) return { ok: false, error: `Entre ${min} y ${max}` }
    return { ok: true, value: n }
  }
  if (type === 'long') {
    if (!/^-?\d+$/.test(t)) return { ok: false, error: 'Tiene que ser un número entero' }
    const big = BigInt(t)
    if (big < -(2n ** 63n) || big > 2n ** 63n - 1n) return { ok: false, error: 'Fuera del rango de un long' }
    const u = BigInt.asUintN(64, big)
    return { ok: true, value: [Number(BigInt.asIntN(32, u >> 32n)), Number(BigInt.asIntN(32, u & 0xffffffffn))] }
  }
  if (type === 'float' || type === 'double') {
    const n = Number(t.replace(',', '.'))
    if (t === '' || !Number.isFinite(n)) return { ok: false, error: 'Tiene que ser un número (usa punto para decimales)' }
    return { ok: true, value: type === 'float' ? Math.fround(n) : n }
  }
  return { ok: false, error: 'Este tipo no se edita directamente' }
}

export function displayValue(tag: NbtTag): string {
  switch (tag.type) {
    case 'long': return longToString(tag.value)
    // Los float guardan decimales de más al pasarlos a double: 0.1 → 0.10000000149
    case 'float': return String(Number((tag.value as number).toPrecision(7)))
    case 'string': return tag.value
    default: return String(tag.value)
  }
}

export function containerSummary(tag: NbtTag): string {
  const n = childrenOf(tag).length
  if (tag.type === 'compound') return n === 1 ? '1 entrada' : `${n} entradas`
  return n === 1 ? '1 elemento' : `${n} elementos`
}

/** Los UUID modernos se guardan como 4 enteros; se enseñan también en su forma legible. */
export function uuidHint(tag: NbtTag): string | null {
  if (tag.type !== 'intArray' || tag.value.length !== 4) return null
  return (tag.value as number[]).map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
}

export const pathId = (p: Path): string => JSON.stringify(p)

export interface Row {
  path: Path
  key: Key | null
  tag: NbtTag
  depth: number
  parentType: string | null
}

/** Límite de filas por contenedor: los arrays grandes (mapas de alturas…) se recortan. */
export const MAX_CHILDREN = 1000

export function flatten(root: NbtTag, isOpen: (id: string) => boolean): Row[] {
  const rows: Row[] = []
  const walk = (tag: NbtTag, path: Path, key: Key | null, depth: number, parentType: string | null): void => {
    rows.push({ path, key, tag, depth, parentType })
    if (!isContainer(tag.type) || !isOpen(pathId(path))) return
    for (const [k, child] of childrenOf(tag).slice(0, MAX_CHILDREN)) walk(child, [...path, k], k, depth + 1, tag.type)
  }
  walk(root, [], null, 0, null)
  return rows
}

