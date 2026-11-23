import * as THREE from 'three'

// Las texturas abiertas en el Estudio. Cada una tiene capas (como Photoshop): se pinta en la
// capa activa y el lienzo «canvas» es la mezcla de todas las visibles, que es lo que se ve en 3D
// y lo que se guarda en el PNG del mod.

export type Blend = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'lighter' | 'darken' | 'lighten' | 'color' | 'hue'
export const BLENDS: { id: Blend; label: string }[] = [
  { id: 'source-over', label: 'Normal' },
  { id: 'multiply', label: 'Multiplicar (oscurece)' },
  { id: 'screen', label: 'Trama (aclara)' },
  { id: 'overlay', label: 'Superponer' },
  { id: 'darken', label: 'Oscurecer' },
  { id: 'lighten', label: 'Aclarar' },
  { id: 'lighter', label: 'Sumar luz' },
  { id: 'hue', label: 'Tono' },
  { id: 'color', label: 'Color' },
]

export interface Layer {
  id: string
  name: string
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  visible: boolean
  /** 0..1 */
  opacity: number
  blend: Blend
  /** Bloquear los píxeles transparentes: solo se pinta encima de lo que ya hay */
  lockAlpha?: boolean
}

export interface Sel { x: number; y: number; w: number; h: number }

export interface StudioTex {
  ref: string
  /** La mezcla de las capas (lo que se ve y se guarda) */
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  three: THREE.CanvasTexture
  w: number
  h: number
  editable: boolean
  dirty: boolean
  /** Cómo era al abrirla (para «antes y después») */
  original: ImageData
  layers: Layer[]
  active: number
  /** Selección rectangular (en píxeles); las herramientas solo cambian lo de dentro */
  selection: Sel | null
  /** El PNG tal como está en el archivo (base64), para saber si las capas guardadas siguen valiendo */
  fileB64?: string
}

let lid = 0
const newCanvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return [c, c.getContext('2d', { willReadFrequently: true })!]
}
export function makeLayer(w: number, h: number, name: string): Layer {
  const [canvas, ctx] = newCanvas(w, h)
  return { id: `l${Date.now().toString(36)}${lid++}`, name, canvas, ctx, visible: true, opacity: 1, blend: 'source-over' }
}

export async function loadStudioTexture(ref: string): Promise<StudioTex | null> {
  const t = await window.api.studio.readTexture(ref)
  if (!t) return null
  const img = new Image()
  img.src = t.dataUrl
  await img.decode()
  const [canvas, ctx] = newCanvas(img.width, img.height)
  ctx.drawImage(img, 0, 0)
  const base = makeLayer(img.width, img.height, 'Fondo')
  base.ctx.drawImage(img, 0, 0)
  const three = new THREE.CanvasTexture(canvas)
  three.magFilter = THREE.NearestFilter
  three.minFilter = THREE.NearestFilter
  three.generateMipmaps = false
  three.colorSpace = THREE.SRGBColorSpace
  const tex: StudioTex = {
    ref: t.ref, canvas, ctx, three, w: img.width, h: img.height, editable: t.editable, dirty: false,
    original: ctx.getImageData(0, 0, img.width, img.height), layers: [base], active: 0, selection: null,
    fileB64: t.dataUrl.replace(/^data:image\/png;base64,/, ''),
  }
  // Capas guardadas la otra vez (solo si el PNG no ha cambiado desde entonces)
  if (t.editable) {
    const saved = await window.api.studio.layersGet(t.ref).catch(() => null) as { fileB64: string; stack: StackJson } | null
    if (saved && saved.fileB64 === tex.fileB64) await loadStack(tex, saved.stack)
  }
  return tex
}

/** Vuelve a mezclar las capas en el lienzo que se ve. */
export function composite(t: StudioTex): void {
  t.ctx.clearRect(0, 0, t.w, t.h)
  for (const l of t.layers) {
    if (!l.visible || l.opacity <= 0) continue
    t.ctx.globalAlpha = l.opacity
    t.ctx.globalCompositeOperation = l.blend
    t.ctx.drawImage(l.canvas, 0, 0)
  }
  t.ctx.globalAlpha = 1
  t.ctx.globalCompositeOperation = 'source-over'
  t.three.needsUpdate = true
}
export function touch(t: StudioTex): void { t.dirty = true; composite(t) }

export const activeLayer = (t: StudioTex): Layer => t.layers[Math.min(t.active, t.layers.length - 1)]

/** Tamaño de un fotograma (las texturas animadas son una tira vertical de cuadrados). */
export const frameH = (t: StudioTex): number => (t.h > t.w && t.h % t.w === 0 ? t.w : t.h)

export type Rgba = [number, number, number, number]

/** Color que se ve (de la mezcla), para el cuentagotas. */
export function getPixel(t: StudioTex, x: number, y: number): Rgba {
  const d = t.ctx.getImageData(x, y, 1, 1).data
  return [d[0], d[1], d[2], d[3]]
}

export const inSel = (t: StudioTex, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < t.w && y < t.h && (!t.selection || (x >= t.selection.x && y >= t.selection.y && x < t.selection.x + t.selection.w && y < t.selection.y + t.selection.h))

// ── Historial: foto de todas las capas ─────────────────────────────────────

export interface LayerSnap { id: string; name: string; visible: boolean; opacity: number; blend: Blend; lockAlpha?: boolean; data: ImageData }
export interface TexSnap { active: number; layers: LayerSnap[] }

export const snapshot = (t: StudioTex): TexSnap => ({
  active: t.active,
  layers: t.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, lockAlpha: l.lockAlpha, data: l.ctx.getImageData(0, 0, t.w, t.h) })),
})
export function restore(t: StudioTex, s: TexSnap): void {
  t.layers = s.layers.map((ls) => {
    const l = makeLayer(t.w, t.h, ls.name)
    Object.assign(l, { id: ls.id, visible: ls.visible, opacity: ls.opacity, blend: ls.blend, lockAlpha: ls.lockAlpha })
    l.ctx.putImageData(ls.data, 0, 0)
    return l
  })
  t.active = Math.min(s.active, t.layers.length - 1)
  touch(t)
}
/** Sustituye solo la capa activa (para previsualizar figuras mientras se arrastra). */
export function restoreActive(t: StudioTex, s: TexSnap): void {
  const l = activeLayer(t)
  const ls = s.layers.find((x) => x.id === l.id)
  if (ls) l.ctx.putImageData(ls.data, 0, 0)
}

// ── Capas guardadas (JSON con PNG por capa) ─────────────────────────────────

export interface StackJson { active: number; layers: { name: string; visible: boolean; opacity: number; blend: Blend; lockAlpha?: boolean; png: string }[] }
export const stackToJson = (t: StudioTex): StackJson => ({
  active: t.active,
  layers: t.layers.map((l) => ({ name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, lockAlpha: l.lockAlpha, png: l.canvas.toDataURL('image/png') })),
})
export async function loadStack(t: StudioTex, s: StackJson): Promise<void> {
  const layers: Layer[] = []
  for (const j of s.layers) {
    const l = makeLayer(t.w, t.h, j.name)
    Object.assign(l, { visible: j.visible, opacity: j.opacity, blend: j.blend, lockAlpha: j.lockAlpha })
    const img = new Image(); img.src = j.png; await img.decode()
    l.ctx.drawImage(img, 0, 0)
    layers.push(l)
  }
  if (!layers.length) return
  t.layers = layers
  t.active = Math.min(s.active, layers.length - 1)
  composite(t)
}

// ── Color ────────────────────────────────────────────────────────────────────

export const toHex = (c: Rgba): string => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
export function fromHex(hex: string, a = 255): Rgba {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a]
}
export function rgbToHsv([r, g, b]: Rgba | [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [((h * 60) + 360) % 360, max ? d / max : 0, max]
}
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

export async function textureToBase64(t: StudioTex): Promise<string> {
  const blob = await new Promise<Blob>((res) => t.canvas.toBlob((b) => res(b!), 'image/png'))
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Paleta: los colores de la textura, más usados primero. */
export function paletteOf(t: StudioTex, max = 24): string[] {
  const d = t.ctx.getImageData(0, 0, t.w, t.h).data
  const count = new Map<string, number>()
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue
    const k = toHex([d[i], d[i + 1], d[i + 2], 255])
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k)
}
