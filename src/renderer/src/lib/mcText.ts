// Texto con formato de Minecraft.
//
// El juego guarda los nombres de equipos, prefijos, etc. como "componentes de
// texto" en JSON ({"text":"[VIP] ","color":"dark_purple","bold":true}). Para
// editarlos a mano eso es incómodo, así que aquí se pasan a los códigos que
// conoce cualquiera que haya montado un servidor (&5&l[VIP]) y de vuelta.

export interface McSegment {
  text: string
  /** Nombre de color de Minecraft o '#rrggbb'. */
  color?: string
  bold?: boolean
  italic?: boolean
  underlined?: boolean
  strikethrough?: boolean
  obfuscated?: boolean
}

export const MC_COLORS: { name: string; code: string; hex: string; label: string }[] = [
  { name: 'black', code: '0', hex: '#000000', label: 'Negro' },
  { name: 'dark_blue', code: '1', hex: '#0000AA', label: 'Azul oscuro' },
  { name: 'dark_green', code: '2', hex: '#00AA00', label: 'Verde oscuro' },
  { name: 'dark_aqua', code: '3', hex: '#00AAAA', label: 'Turquesa oscuro' },
  { name: 'dark_red', code: '4', hex: '#AA0000', label: 'Rojo oscuro' },
  { name: 'dark_purple', code: '5', hex: '#AA00AA', label: 'Morado' },
  { name: 'gold', code: '6', hex: '#FFAA00', label: 'Dorado' },
  { name: 'gray', code: '7', hex: '#AAAAAA', label: 'Gris' },
  { name: 'dark_gray', code: '8', hex: '#555555', label: 'Gris oscuro' },
  { name: 'blue', code: '9', hex: '#5555FF', label: 'Azul' },
  { name: 'green', code: 'a', hex: '#55FF55', label: 'Verde' },
  { name: 'aqua', code: 'b', hex: '#55FFFF', label: 'Turquesa' },
  { name: 'red', code: 'c', hex: '#FF5555', label: 'Rojo' },
  { name: 'light_purple', code: 'd', hex: '#FF55FF', label: 'Rosa' },
  { name: 'yellow', code: 'e', hex: '#FFFF55', label: 'Amarillo' },
  { name: 'white', code: 'f', hex: '#FFFFFF', label: 'Blanco' }
]

export const MC_STYLES: { key: 'bold' | 'italic' | 'underlined' | 'strikethrough' | 'obfuscated'; code: string; label: string }[] = [
  { key: 'bold', code: 'l', label: 'Negrita' },
  { key: 'italic', code: 'o', label: 'Cursiva' },
  { key: 'underlined', code: 'n', label: 'Subrayado' },
  { key: 'strikethrough', code: 'm', label: 'Tachado' },
  { key: 'obfuscated', code: 'k', label: 'Ofuscado' }
]

const byCode = new Map(MC_COLORS.map((c) => [c.code, c]))
const byName = new Map(MC_COLORS.map((c) => [c.name, c]))

export function colorHex(color?: string): string | undefined {
  if (!color) return undefined
  if (color.startsWith('#')) return color
  return byName.get(color)?.hex
}

type Style = Omit<McSegment, 'text'>
const STYLE_KEYS = ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'] as const

// ── Códigos (&) → segmentos ─────────────────────────────────────────────────

/** "&5&l[VIP] &r&7texto" → segmentos. Acepta también § y &#rrggbb. */
export function parseCodes(input: string): McSegment[] {
  const out: McSegment[] = []
  let style: Style = {}
  let buf = ''
  const flush = (): void => {
    if (!buf) return
    out.push({ text: buf, ...style })
    buf = ''
  }
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if ((ch === '&' || ch === '§') && i + 1 < input.length) {
      const next = input[i + 1].toLowerCase()
      const hex = /^#[0-9a-f]{6}$/i.exec(input.slice(i + 1, i + 8))
      if (hex) {
        flush()
        style = { color: hex[0].toUpperCase() }
        i += 7
        continue
      }
      if (byCode.has(next)) {
        // Un color, como en el juego, quita los estilos anteriores
        flush()
        style = { color: byCode.get(next)!.name }
        i++
        continue
      }
      const st = MC_STYLES.find((s) => s.code === next)
      if (st) {
        flush()
        style = { ...style, [st.key]: true }
        i++
        continue
      }
      if (next === 'r') {
        flush()
        style = {}
        i++
        continue
      }
    }
    buf += ch
  }
  flush()
  return out
}

// ── Componente (JSON) → segmentos ───────────────────────────────────────────

interface Component extends Partial<Style> {
  text?: string
  translate?: string
  extra?: unknown[]
}

/** Aplana un componente con sus hijos heredando el estilo, como hace el juego. */
function walk(node: unknown, inherited: Style, out: McSegment[]): void {
  if (node == null) return
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    // Los § sueltos dentro del texto también cuentan
    for (const seg of parseCodes(String(node))) out.push({ ...inherited, ...seg, color: seg.color ?? inherited.color })
    return
  }
  if (Array.isArray(node)) {
    // Un array es: el primero es el padre, el resto sus hijos
    if (node.length === 0) return
    const [first, ...rest] = node
    walk({ ...(typeof first === 'object' ? first : { text: String(first) }), extra: rest }, inherited, out)
    return
  }
  const c = node as Component
  const style: Style = { ...inherited }
  if (typeof c.color === 'string') style.color = c.color
  for (const k of STYLE_KEYS) if (typeof c[k] === 'boolean') style[k] = c[k]
  const text = c.text ?? c.translate ?? ''
  if (text) {
    for (const seg of parseCodes(text)) {
      // Un § dentro del texto manda sobre el estilo del componente
      const hasOwn = seg.color !== undefined || STYLE_KEYS.some((k) => seg[k])
      out.push(hasOwn ? { ...style, ...seg } : { ...style, text: seg.text })
    }
  }
  for (const child of c.extra ?? []) walk(child, style, out)
}

/**
 * Lo que venga (JSON en texto, un objeto ya leído o texto plano) → segmentos.
 * Nunca falla: si no se entiende, se trata como texto plano.
 */
export function componentToSegments(value: unknown): McSegment[] {
  let node = value
  if (typeof value === 'string') {
    const t = value.trim()
    if (t.startsWith('{') || t.startsWith('[') || t.startsWith('"')) {
      try { node = JSON.parse(t) } catch { node = value }
    }
  }
  const out: McSegment[] = []
  walk(node, {}, out)
  return merge(out)
}

function sameStyle(a: Style, b: Style): boolean {
  return a.color === b.color && STYLE_KEYS.every((k) => !!a[k] === !!b[k])
}

function merge(segs: McSegment[]): McSegment[] {
  const out: McSegment[] = []
  for (const s of segs) {
    if (!s.text) continue
    const last = out[out.length - 1]
    if (last && sameStyle(last, s)) last.text += s.text
    else out.push({ ...s })
  }
  return out
}

// ── Segmentos → códigos y → JSON ────────────────────────────────────────────

export function segmentsToCodes(segs: McSegment[]): string {
  let out = ''
  let cur: Style = {}
  for (const s of segs) {
    if (!sameStyle(cur, s)) {
      // Quitar un estilo solo se puede reiniciando (un color también reinicia):
      // entonces se escribe todo de nuevo; si solo se añade algo, basta con eso
      const lost = STYLE_KEYS.some((k) => cur[k] && !s[k]) || (!!cur.color && !s.color)
      const restart = lost || cur.color !== s.color
      if (restart) {
        if (s.color) out += s.color.startsWith('#') ? `&${s.color}` : `&${byName.get(s.color)?.code ?? 'f'}`
        else out += '&r'
      }
      for (const st of MC_STYLES) if (s[st.key] && (restart || !cur[st.key])) out += `&${st.code}`
      cur = { ...s }
    }
    out += s.text
  }
  return out
}

export function componentToCodes(value: unknown): string {
  return segmentsToCodes(componentToSegments(value))
}

/** Segmentos → componente con la forma más simple posible. */
export function segmentsToComponent(segs: McSegment[]): Component {
  const clean = merge(segs).map((s) => {
    const c: Component = { text: s.text }
    if (s.color) c.color = s.color
    for (const k of STYLE_KEYS) if (s[k]) c[k] = true
    return c
  })
  if (clean.length === 0) return { text: '' }
  if (clean.length === 1) return clean[0]
  return { text: '', extra: clean }
}

/** "&5&l[VIP] " → '{"text":"[VIP] ","color":"dark_purple","bold":true}' */
export function codesToJson(codes: string): string {
  return JSON.stringify(segmentsToComponent(parseCodes(codes)))
}

/** Texto sin formato, para buscar y ordenar. */
export function plainText(value: unknown): string {
  return componentToSegments(value).map((s) => s.text).join('')
}

// ── Texto con eventos: al pasar el ratón y al hacer clic ────────────────────
//
// Hasta la 1.21.4 (JSON): hoverEvent {action, contents} y clickEvent {action, value}.
// Desde la 1.21.5 (NBT): hover_event {action, value} y click_event con un campo
// según la acción (url, command, value, page). Se leen los dos y se escribe en
// el que toque.

export type ClickAction = 'open_url' | 'run_command' | 'suggest_command' | 'copy_to_clipboard' | 'change_page'

export const CLICK_ACTIONS: { id: ClickAction; label: string; hint: string }[] = [
  { id: 'open_url', label: 'Abrir un enlace', hint: 'https://…' },
  { id: 'run_command', label: 'Ejecutar un comando', hint: '/spawn' },
  { id: 'suggest_command', label: 'Escribir un comando en el chat', hint: '/msg Steve ' },
  { id: 'copy_to_clipboard', label: 'Copiar un texto', hint: 'play.miservidor.com' },
  { id: 'change_page', label: 'Cambiar de página (libros)', hint: '2' }
]

const MODERN_CLICK_FIELD: Record<ClickAction, string> = {
  open_url: 'url', run_command: 'command', suggest_command: 'command', copy_to_clipboard: 'value', change_page: 'page'
}

export interface RichText {
  codes: string
  /** Lo que sale al pasar el ratón, con formato. */
  hover?: string
  click?: { action: ClickAction; value: string }
  /** Cosas del original que el modo sencillo no puede conservar, si las hay. */
  lossy?: string[]
}

type Obj = Record<string, unknown>

function parseNode(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const t = value.trim()
  if (t.startsWith('{') || t.startsWith('[') || t.startsWith('"')) {
    try { return JSON.parse(t) } catch { return value }
  }
  return value
}

function hoverOf(o: Obj): string | undefined {
  const h = (o.hoverEvent ?? o.hover_event) as Obj | undefined
  if (!h || h.action !== 'show_text') return undefined
  return componentToCodes(h.contents ?? h.value)
}

function clickOf(o: Obj): RichText['click'] {
  const c = (o.clickEvent ?? o.click_event) as Obj | undefined
  if (!c || typeof c.action !== 'string') return undefined
  const action = c.action as ClickAction
  if (!MODERN_CLICK_FIELD[action]) return undefined
  const v = c.value ?? c[MODERN_CLICK_FIELD[action]]
  return v === undefined ? undefined : { action, value: String(v) }
}

const UNSUPPORTED = ['score', 'selector', 'keybind', 'nbt', 'insertion', 'font', 'with', 'shadow_color']

export function readRich(value: unknown): RichText {
  const node = parseNode(value)
  const lossy = new Set<string>()
  let hover: string | undefined
  let click: RichText['click']
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const o = node as Obj
    hover = hoverOf(o)
    click = clickOf(o)
    // Formato habitual de otras herramientas: texto vacío y todo en extra con el mismo evento
    const extra = Array.isArray(o.extra) ? (o.extra as unknown[]).filter((x) => x && typeof x === 'object') as Obj[] : []
    if (!hover && extra.length && extra.every((x) => hoverOf(x) === hoverOf(extra[0]))) hover = hoverOf(extra[0])
    if (!click && extra.length && extra.every((x) => JSON.stringify(clickOf(x)) === JSON.stringify(clickOf(extra[0])))) click = clickOf(extra[0])
  }
  // Lo que no se puede representar: eventos distintos por trozos, puntuaciones, selectores…
  const walkCheck = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walkCheck); return }
    const o = n as Obj
    for (const k of UNSUPPORTED) if (k in o) lossy.add(k)
    const h = hoverOf(o)
    if ((o.hoverEvent || o.hover_event) && h !== hover) lossy.add('eventos distintos en cada trozo')
    const c = clickOf(o)
    if ((o.clickEvent || o.click_event) && JSON.stringify(c) !== JSON.stringify(click)) lossy.add('eventos distintos en cada trozo')
    if (Array.isArray(o.extra)) (o.extra as unknown[]).forEach(walkCheck)
  }
  walkCheck(node)
  return { codes: componentToCodes(node), hover, click, lossy: lossy.size ? [...lossy] : undefined }
}

/** Texto enriquecido → componente, en el formato antiguo (JSON) o el nuevo (1.21.5+). */
export function buildRich(rich: RichText, modern: boolean): Obj {
  const base = segmentsToComponent(parseCodes(rich.codes)) as Obj
  if (rich.hover) {
    const contents = segmentsToComponent(parseCodes(rich.hover))
    if (modern) base.hover_event = { action: 'show_text', value: contents }
    else base.hoverEvent = { action: 'show_text', contents }
  }
  if (rich.click && rich.click.value !== '') {
    const { action, value } = rich.click
    if (modern) base.click_event = { action, [MODERN_CLICK_FIELD[action]]: action === 'change_page' ? Number(value) || 1 : value }
    else base.clickEvent = { action, value }
  }
  return base
}
