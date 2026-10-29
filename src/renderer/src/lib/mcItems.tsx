import { useEffect, useState } from 'react'
import type { ItemRender, RenderFace, RenderPart } from '../../../shared/types'
import { type Compound, listItems, getStr, getNum, readText } from './nbtBuild'
import { parseCodes, type McSegment } from './mcText'
import { McIcon } from './mcTextures'

// Objetos de Minecraft como en el inventario del juego: el icono (plano, o el
// bloque en 3D), su nombre en el idioma del launcher y la tarjetita con su
// información al pasar el ratón (nombre, encantamientos, durabilidad,
// contenido de shulkers y sacos).

// ── Textos del juego ────────────────────────────────────────────────────────

let langMap: Record<string, string> | null = null
let langPromise: Promise<Record<string, string>> | null = null

/** Las traducciones del juego (se piden una vez). */
export function useLang(): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>(langMap ?? {})
  useEffect(() => {
    if (langMap) return
    langPromise ??= window.api.mc.lang().catch(() => ({}))
    langPromise.then((m) => { langMap = m; setMap(m) })
  }, [])
  return map
}

/** Un texto del juego con sus %s rellenados. */
export function tr(lang: Record<string, string>, key: string, fallback: string, ...args: (string | number)[]): string {
  let s = lang[key] ?? fallback
  let i = 0
  s = s.replace(/%(\d+\$)?s/g, (_m, pos?: string) => String(args[pos ? Number(pos.slice(0, -1)) - 1 : i++] ?? ''))
  return s
}

const plainId = (id: string): string => id.replace(/^minecraft:/, '')
export const prettyId = (id: string): string =>
  plainId(id).split(/[_/]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

/** Nombre de un objeto (item o bloque) como en el juego. */
export function itemName(lang: Record<string, string>, id: string): string {
  const [ns, path] = id.includes(':') ? id.split(':') : ['minecraft', id]
  return lang[`item.${ns}.${path}`] ?? lang[`block.${ns}.${path}`] ?? prettyId(id)
}

/** Nombre de cualquier cosa con id (bioma, criatura, objeto…) para los criterios de logros. */
export function anyName(lang: Record<string, string>, id: string): string {
  const [ns, path] = id.includes(':') ? id.split(':') : ['minecraft', id]
  for (const kind of ['biome', 'entity', 'item', 'block', 'effect', 'enchantment']) {
    const v = lang[`${kind}.${ns}.${path.replace(/\//g, '.')}`]
    if (v) return v
  }
  return prettyId(id)
}

// ── Dibujo ──────────────────────────────────────────────────────────────────

const SIZE = 64
const rendered = new Map<string, string | null>()
let pending = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null
const waiters = new Set<() => void>()
const imgCache = new Map<string, Promise<HTMLImageElement>>()

function loadImg(url: string): Promise<HTMLImageElement> {
  let p = imgCache.get(url)
  if (!p) {
    p = new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url })
    imgCache.set(url, p)
  }
  return p
}

/** Dibuja las partes (con su tinte) en un lienzo de w×h. */
async function paint(parts: RenderPart[], w: number, h: number, shade = 0): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  for (const p of parts) {
    const img = await loadImg(p.url)
    const layer = document.createElement('canvas')
    layer.width = w; layer.height = h
    const lg = layer.getContext('2d')!
    lg.imageSmoothingEnabled = false
    if (p.flipY) { lg.translate(0, (p.dy * 2 + p.dh) * h); lg.scale(1, -1) }
    lg.drawImage(img, p.sx, p.sy, p.sw, p.sh, p.dx * w, p.dy * h, p.dw * w, p.dh * h)
    lg.setTransform(1, 0, 0, 1, 0, 0)
    if (p.tint) {
      // Tinte como en el juego: multiplica el color y conserva la transparencia
      lg.globalCompositeOperation = 'multiply'
      lg.fillStyle = p.tint
      lg.fillRect(0, 0, w, h)
      lg.globalCompositeOperation = 'destination-in'
      lg.drawImage(img, p.sx, p.sy, p.sw, p.sh, p.dx * w, p.dy * h, p.dw * w, p.dh * h)
    }
    g.drawImage(layer, 0, 0)
  }
  if (shade > 0) {
    g.globalCompositeOperation = 'source-atop'
    g.fillStyle = `rgba(0,0,0,${shade})`
    g.fillRect(0, 0, w, h)
  }
  return c
}

/** El bloque en isométrico, con la luz del inventario: arriba entero, izquierda un poco más oscura, derecha más. */
async function drawCube(r: Extract<ItemRender, { kind: 'cube' }>): Promise<string> {
  const out = document.createElement('canvas')
  out.width = SIZE; out.height = SIZE
  const g = out.getContext('2d')!
  g.imageSmoothingEnabled = false
  const a = SIZE * 0.47
  const cos = Math.cos(Math.PI / 6), sin = Math.sin(Math.PI / 6)
  const x0 = (1 - r.sx) / 2, z0 = (1 - r.sz) / 2, h = r.sy
  // Proyección: x hacia abajo a la derecha, z hacia abajo a la izquierda, y hacia arriba
  const total = a * (r.sx * sin + r.sz * sin) + a * h
  const base = (SIZE - total) / 2 + a * h - a * (x0 + z0) * sin
  const P = (x: number, y: number, z: number): [number, number] => [SIZE / 2 + (x - z) * a * cos, base + (x + z) * a * sin - y * a]
  const face = async (f: RenderFace, o: [number, number, number], u: [number, number, number], v: [number, number, number], shade: number): Promise<void> => {
    if (!f.parts.length) return
    const res = 32
    const tex = await paint(f.parts, res, res, shade)
    const [ox, oy] = P(...o)
    const [ux, uy] = P(o[0] + u[0], o[1] + u[1], o[2] + u[2])
    const [vx, vy] = P(o[0] + v[0], o[1] + v[1], o[2] + v[2])
    g.setTransform((ux - ox) / res, (uy - oy) / res, (vx - ox) / res, (vy - oy) / res, ox, oy)
    // Un pelín más grande para que no se vean rendijas entre caras
    g.drawImage(tex, -0.3, -0.3, res + 0.6, res + 0.6)
    g.setTransform(1, 0, 0, 1, 0, 0)
  }
  const x1 = x0 + r.sx, z1 = z0 + r.sz
  await face(r.left, [x0, h, z1], [r.sx, 0, 0], [0, -h, 0], 0.2)
  await face(r.right, [x1, h, z1], [0, 0, -r.sz], [0, -h, 0], 0.4)
  await face(r.top, [x0, h, z0], [r.sx, 0, 0], [0, 0, r.sz], 0)
  return out.toDataURL()
}

/** Dibuja un objeto ya resuelto (también lo usan las pruebas). */
export async function draw(r: ItemRender): Promise<string> {
  if (r.kind === 'cube') return drawCube(r)
  return (await paint(r.parts, SIZE, SIZE)).toDataURL()
}

function flush(): void {
  const ids = [...pending]
  pending = new Set()
  timer = null
  window.api.mc.itemRenders(ids).then(async (res) => {
    for (const id of ids) {
      const r = res[id]
      try { rendered.set(id, r ? await draw(r) : null) } catch { rendered.set(id, null) }
    }
    waiters.forEach((w) => w())
  }).catch(() => { for (const id of ids) rendered.set(id, null); waiters.forEach((w) => w()) })
}

function useItemImage(id: string): string | null | undefined {
  const [, force] = useState(0)
  useEffect(() => {
    if (!id || rendered.has(id)) return
    const w = (): void => force((n) => n + 1)
    waiters.add(w)
    if (!pending.has(id)) { pending.add(id); if (!timer) timer = setTimeout(flush, 0) }
    return () => { waiters.delete(w) }
  }, [id])
  return id ? rendered.get(id) : null
}

/** Icono de un objeto como en el inventario (bloques en 3D). */
export function McItem({ id, size = 32, fallback }: { id: string; size?: number; fallback?: React.ReactNode }) {
  const full = id.includes(':') ? id : `minecraft:${id}`
  const url = useItemImage(full)
  if (url === undefined) return <span style={{ width: size, height: size }} className="inline-block" />
  if (!url) return <McIcon k={`item:${full}`} size={size} fallback={fallback} />
  return <img src={url} alt="" draggable={false} style={{ width: size, height: size, imageRendering: 'pixelated' }} />
}

// ── Lo que lleva un objeto ──────────────────────────────────────────────────
//
// Desde la 1.20.5 los datos van en "components"; antes, en "tag". Se leen los dos.

const comp = (item: Compound): Compound => (item.components?.type === 'compound' ? item.components.value as Compound : {})
const tag = (item: Compound): Compound => (item.tag?.type === 'compound' ? item.tag.value as Compound : {})
const sub = (c: Compound, k: string): Compound => (c[k]?.type === 'compound' ? c[k]!.value as Compound : {})
const C = (k: string): string => `minecraft:${k}`

export const itemId = (item: Compound): string => getStr(item, 'id')
export const itemCount = (item: Compound): number => getNum(item, 'count', getNum(item, 'Count', 1))

/** Un objeto guardado dentro de otro (shulker, saco), en el formato que toque. */
function nested(raw: Compound): Compound {
  return raw.item?.type === 'compound' ? raw.item.value as Compound : raw
}

/** Lo que hay dentro de un shulker o un cofre como objeto: [casilla, objeto]. */
export function containerItems(item: Compound): { slot: number; item: Compound }[] {
  const c = comp(item)
  if (c[C('container')]) return listItems<Compound>(c[C('container')]).map((e) => ({ slot: getNum(e, 'slot'), item: nested(e) }))
  const bet = sub(tag(item), 'BlockEntityTag')
  return listItems<Compound>(bet.Items).map((e) => ({ slot: getNum(e, 'Slot'), item: e }))
}

/** Lo que hay en un saco, en orden. */
export function bundleItems(item: Compound): Compound[] {
  const c = comp(item)
  if (c[C('bundle_contents')]) return listItems<Compound>(c[C('bundle_contents')]).map(nested)
  return listItems<Compound>(tag(item).Items)
}

export const isBundle = (id: string): boolean => /(^|:)([a-z_]+_)?bundle$/.test(id)
export const isShulker = (id: string): boolean => /shulker_box$/.test(id)

/** Cuántos caben en un montón. */
export function maxStack(id: string): number {
  const p = plainId(id)
  if (STACK_16.test(p)) return 16
  if (UNSTACKABLE.test(p)) return 1
  return 64
}
const STACK_16 = /^(ender_pearl|snowball|egg|blue_egg|brown_egg|bucket|honey_bottle|armor_stand|written_book|.*_sign|.*_hanging_sign|.*_banner)$/
const UNSTACKABLE = /(_sword|_pickaxe|_axe|_shovel|_hoe|_helmet|_chestplate|_leggings|_boots|_horse_armor|_spear|^bow|^crossbow|^trident|^mace|^shield|^elytra|^fishing_rod|^shears|^flint_and_steel|_on_a_stick|^brush|^spyglass|_bucket|^potion|^splash_potion|^lingering_potion|^enchanted_book|^writable_book|^totem_of_undying|_shulker_box|^shulker_box|_bed$|^cake|_boat|_raft|_minecart|^minecart|^saddle|^music_disc_.*|^goat_horn|^bundle|_bundle$|^suspicious_stew|_stew$|^rabbit_stew|^beetroot_soup|^knowledge_book|^debug_stick|^wolf_armor|_harness$)/

/** Lo que ocupa un saco por dentro (64 = lleno). */
export function bundleWeight(item: Compound): number {
  let w = 0
  for (const i of bundleItems(item)) {
    const id = itemId(i)
    w += isBundle(id) ? 4 + bundleWeight(i) : (64 / maxStack(id)) * itemCount(i)
  }
  return w
}

const MATERIAL: Record<string, number> = { wooden: 59, stone: 131, iron: 250, golden: 32, diamond: 1561, netherite: 2031, copper: 190 }
const ARMOR_BASE: Record<string, number> = { leather: 5, chainmail: 15, iron: 15, golden: 7, diamond: 33, netherite: 37, turtle: 25, copper: 11 }
const ARMOR_MULT: Record<string, number> = { helmet: 11, chestplate: 16, leggings: 15, boots: 13 }
const FIXED: Record<string, number> = {
  bow: 384, crossbow: 465, trident: 250, shield: 336, elytra: 432, fishing_rod: 64, flint_and_steel: 64, shears: 238,
  carrot_on_a_stick: 25, warped_fungus_on_a_stick: 100, mace: 500, brush: 64, turtle_helmet: 275, wolf_armor: 64,
}

/** Durabilidad máxima (0 si no se gasta). */
export function maxDamage(item: Compound): number {
  const own = getNum(comp(item), C('max_damage'))
  if (own) return own
  const p = plainId(itemId(item))
  if (FIXED[p]) return FIXED[p]
  const tool = /^(wooden|stone|iron|golden|diamond|netherite|copper)_(sword|pickaxe|axe|shovel|hoe|spear)$/.exec(p)
  if (tool) return MATERIAL[tool[1]]
  const armor = /^(leather|chainmail|iron|golden|diamond|netherite|turtle|copper)_(helmet|chestplate|leggings|boots)$/.exec(p)
  if (armor) return ARMOR_BASE[armor[1]] * ARMOR_MULT[armor[2]]
  return 0
}

export function itemDamage(item: Compound): number {
  return getNum(comp(item), C('damage'), getNum(tag(item), 'Damage'))
}

/** Encantamientos: [id, nivel]. Los de los libros (guardados) también. */
export function enchantments(item: Compound): { id: string; level: number }[] {
  const out: { id: string; level: number }[] = []
  const c = comp(item)
  for (const key of ['enchantments', 'stored_enchantments']) {
    const e = sub(c, C(key))
    // 1.20.5 a 1.21.4: { levels: {…} }; desde la 1.21.5, el mapa directo
    const levels = e.levels?.type === 'compound' ? e.levels.value as Compound : e
    for (const [id, v] of Object.entries(levels)) if (v && typeof v.value === 'number') out.push({ id, level: v.value })
  }
  const t = tag(item)
  for (const key of ['Enchantments', 'StoredEnchantments']) {
    for (const e of listItems<Compound>(t[key])) out.push({ id: getStr(e, 'id'), level: getNum(e, 'lvl', 1) })
  }
  return out
}

/** Nombre puesto con el yunque (con colores), si lo tiene. */
export function customName(item: Compound): string | null {
  const c = comp(item)
  if (c[C('custom_name')]) return readText(c[C('custom_name')])
  const disp = sub(tag(item), 'display')
  return disp.Name ? readText(disp.Name) : null
}

export function loreLines(item: Compound): string[] {
  const c = comp(item)
  if (c[C('lore')]) {
    const t = c[C('lore')]!
    return (t.value.value as unknown[]).map((raw) => readText({ type: t.value.type, value: raw }))
  }
  const disp = sub(tag(item), 'display')
  const l = disp.Lore
  return l?.type === 'list' ? (l.value.value as unknown[]).map((raw) => readText({ type: l.value.type, value: raw })) : []
}

function roman(n: number, lang: Record<string, string>): string {
  const k = lang[`enchantment.level.${n}`]
  if (k) return k
  const r: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let s = ''
  for (const [v, l] of r) while (n >= v) { s += l; n -= v }
  return s
}

const CURSES = ['binding_curse', 'vanishing_curse']

/** Las líneas de la tarjetita, con colores del juego. */
export function tooltipLines(item: Compound, lang: Record<string, string>): McSegment[][] {
  const id = itemId(item)
  const ench = enchantments(item)
  const custom = customName(item)
  const lines: McSegment[][] = []
  const name: McSegment[] = custom ? parseCodes(custom).map((s) => ({ ...s, italic: s.italic ?? true })) : [{ text: itemName(lang, id) }]
  // Encantado → nombre en celeste (como la rareza del juego)
  if (ench.length && !name.some((s) => s.color)) name.forEach((s) => { s.color = 'aqua' })
  lines.push(name)
  const potion = sub(comp(item), C('potion_contents'))
  const potionId = getStr(potion, 'potion') || getStr(comp(item), C('potion_contents'))
  if (potionId) lines.push([{ text: tr(lang, `effect.minecraft.${plainId(potionId).replace(/^(long|strong)_/, '')}`, prettyId(potionId)), color: 'blue' }])
  for (const e of ench) {
    const ename = tr(lang, `enchantment.${e.id.replace(':', '.')}`, prettyId(e.id))
    lines.push([{ text: `${ename}${e.level > 1 || !CURSES.includes(plainId(e.id)) ? ` ${roman(e.level, lang)}` : ''}`, color: CURSES.includes(plainId(e.id)) ? 'red' : 'gray' }])
  }
  if (isShulker(id)) {
    const inside = containerItems(item)
    for (const { item: i } of inside.slice(0, 5)) lines.push([{ text: `${itemName(lang, itemId(i))} x${itemCount(i)}`, color: 'white' }])
    if (inside.length > 5) lines.push([{ text: tr(lang, 'item.container.more_items', `y ${inside.length - 5} más…`, inside.length - 5), color: 'white', italic: true }])
  }
  if (isBundle(id)) lines.push([{ text: `${Math.round(bundleWeight(item))}/64`, color: 'gray' }])
  for (const l of loreLines(item)) lines.push(parseCodes(l).map((s) => ({ ...s, color: s.color ?? 'dark_purple', italic: s.italic ?? true })))
  const max = maxDamage(item)
  if (max) {
    const left = max - itemDamage(item)
    lines.push([{ text: tr(lang, 'item.durability', `Durabilidad: ${left} / ${max}`, left, max), color: 'white' }])
  }
  if (getNum(comp(item), C('unbreakable'), -1) !== -1 || comp(item)[C('unbreakable')] || getNum(tag(item), 'Unbreakable')) {
    lines.push([{ text: tr(lang, 'item.unbreakable', 'Irrompible'), color: 'blue' }])
  }
  lines.push([{ text: id, color: 'dark_gray' }])
  return lines
}
