import {
  activeLayer, composite, hsvToRgb, inSel, makeLayer, restoreActive, rgbToHsv, snapshot, touch,
  type Rgba, type Sel, type StudioTex, type TexSnap,
} from './textures'

// Herramientas de pintura del Estudio (estilo Photoshop/Illustrator pero en píxeles). Todas
// trabajan sobre la capa activa y, si hay selección, solo dentro de ella. Un «trazo» va de
// pulsar a soltar: guarda cómo estaba todo al empezar (para deshacer y para previsualizar las
// figuras mientras se arrastra).

export type PaintTool =
  | 'pencil' | 'eraser' | 'fill' | 'picker' | 'line' | 'rect' | 'ellipse'
  | 'select' | 'move' | 'lighten' | 'darken' | 'noise' | 'shade'

export interface PaintOpts {
  color: Rgba
  /** Lado del pincel en píxeles (1..4) */
  size: number
  /** Figuras rellenas */
  filled: boolean
  /** Simetría izquierda↔derecha */
  mirror: boolean
  /** Cubo de pintura: todos los píxeles de ese color, no solo los que se tocan */
  global: boolean
  /** Fuerza de aclarar/oscurecer/ruido (0..1) */
  strength: number
}

export interface Stroke {
  tool: PaintTool
  ref: string
  start: [number, number]
  last: [number, number]
  before: TexSnap
  /** Píxeles ya tocados en este trazo (para que aclarar/oscurecer no se acumulen) */
  done: Set<number>
  /** Mover: el trozo que se lleva y de dónde sale */
  carry?: { img: ImageData; from: Sel }
  selBefore: Sel | null
}

// ── Píxeles de la capa activa ──────────────────────────────────────────────

function put(t: StudioTex, x: number, y: number, c: Rgba | null): void {
  if (!inSel(t, x, y)) return
  const l = activeLayer(t)
  if (l.lockAlpha && l.ctx.getImageData(x, y, 1, 1).data[3] === 0) return
  l.ctx.clearRect(x, y, 1, 1)
  if (c && c[3] > 0) {
    l.ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`
    l.ctx.fillRect(x, y, 1, 1)
  }
}
const getL = (t: StudioTex, x: number, y: number): Rgba => {
  const d = activeLayer(t).ctx.getImageData(x, y, 1, 1).data
  return [d[0], d[1], d[2], d[3]]
}

/** Un toque del pincel (cuadrado de «size» píxeles), con simetría si toca. */
function dab(t: StudioTex, x: number, y: number, o: PaintOpts, fn: (x: number, y: number) => void): void {
  const off = Math.floor((o.size - 1) / 2)
  const pts: [number, number][] = []
  for (let dy = 0; dy < o.size; dy++) for (let dx = 0; dx < o.size; dx++) pts.push([x - off + dx, y - off + dy])
  for (const [px, py] of pts) {
    fn(px, py)
    if (o.mirror) fn(t.w - 1 - px, py)
  }
}

function linePts(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = []
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    out.push([x0, y0])
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
  return out
}

function ellipsePts(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)]
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = (bx - ax) / 2 + 0.5, ry = (by - ay) / 2 + 0.5
  const out: [number, number][] = []
  const inside = (x: number, y: number): boolean => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    if (!inside(x, y)) continue
    if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) out.push([x, y])
  }
  return out
}

function rectPts(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)]
  const out: [number, number][] = []
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) if (filled || x === ax || x === bx || y === ay || y === by) out.push([x, y])
  return out
}

/** Aclarar, oscurecer, ruido o sombreado: cambia el píxel que ya hay. */
function adjustPixel(t: StudioTex, x: number, y: number, tool: PaintTool, o: PaintOpts): void {
  if (!inSel(t, x, y)) return
  const c = getL(t, x, y)
  if (c[3] === 0) return
  let [h, s, v] = rgbToHsv(c)
  const k = 0.06 + o.strength * 0.18
  if (tool === 'lighten') v = Math.min(1, v + k)
  else if (tool === 'darken') v = Math.max(0, v - k)
  else if (tool === 'noise') v = Math.min(1, Math.max(0, v + (Math.random() * 2 - 1) * k))
  else if (tool === 'shade') { v = Math.max(0, v - k); h = (h + 8) % 360; s = Math.min(1, s + k / 2) } // sombra con un toque frío, como hacen los pixel artists
  const [r, g, b] = hsvToRgb(h, s, v)
  put(t, x, y, [r, g, b, c[3]])
}

// ── Trazos ─────────────────────────────────────────────────────────────────

export function beginStroke(t: StudioTex, tool: PaintTool, x: number, y: number, o: PaintOpts): Stroke {
  const s: Stroke = { tool, ref: t.ref, start: [x, y], last: [x, y], before: snapshot(t), done: new Set(), selBefore: t.selection ? { ...t.selection } : null }
  if (tool === 'move') {
    const from = t.selection ?? { x: 0, y: 0, w: t.w, h: t.h }
    s.carry = { img: activeLayer(t).ctx.getImageData(from.x, from.y, from.w, from.h), from }
  }
  if (tool === 'fill') floodFill(t, x, y, o)
  else if (tool === 'select') t.selection = null
  else moveStroke(t, s, x, y, o)
  composite(t)
  return s
}

export function moveStroke(t: StudioTex, s: Stroke, x: number, y: number, o: PaintOpts): void {
  const [sx, sy] = s.start
  switch (s.tool) {
    case 'pencil': case 'eraser': case 'lighten': case 'darken': case 'noise': case 'shade': {
      for (const [px, py] of linePts(s.last[0], s.last[1], x, y)) {
        dab(t, px, py, o, (qx, qy) => {
          if (s.tool === 'pencil') put(t, qx, qy, o.color)
          else if (s.tool === 'eraser') put(t, qx, qy, null)
          else {
            const key = qy * t.w + qx
            if (s.done.has(key)) return
            s.done.add(key)
            adjustPixel(t, qx, qy, s.tool, o)
          }
        })
      }
      break
    }
    case 'line': case 'rect': case 'ellipse': {
      restoreActive(t, s.before)
      const pts = s.tool === 'line' ? linePts(sx, sy, x, y) : s.tool === 'rect' ? rectPts(sx, sy, x, y, o.filled) : ellipsePts(sx, sy, x, y, o.filled)
      for (const [px, py] of pts) dab(t, px, py, s.tool === 'line' ? o : { ...o, size: 1 }, (qx, qy) => put(t, qx, qy, o.color))
      break
    }
    case 'select': {
      const ax = Math.max(0, Math.min(sx, x)), ay = Math.max(0, Math.min(sy, y))
      const bx = Math.min(t.w - 1, Math.max(sx, x)), by = Math.min(t.h - 1, Math.max(sy, y))
      t.selection = x === sx && y === sy ? null : { x: ax, y: ay, w: bx - ax + 1, h: by - ay + 1 }
      break
    }
    case 'move': {
      const c = s.carry!
      const dx = x - sx, dy = y - sy
      restoreActive(t, s.before)
      const l = activeLayer(t)
      l.ctx.clearRect(c.from.x, c.from.y, c.from.w, c.from.h)
      // putImageData no mezcla: se pinta en un lienzo aparte y se dibuja encima
      const tmp = document.createElement('canvas')
      tmp.width = c.from.w; tmp.height = c.from.h
      tmp.getContext('2d')!.putImageData(c.img, 0, 0)
      l.ctx.drawImage(tmp, c.from.x + dx, c.from.y + dy)
      if (s.selBefore) t.selection = { ...s.selBefore, x: s.selBefore.x + dx, y: s.selBefore.y + dy }
      break
    }
    default: break
  }
  s.last = [x, y]
  touch(t)
}

/** Termina el trazo; devuelve cómo quedó (para el historial) o null si no cambió nada. */
export function endStroke(t: StudioTex, s: Stroke): TexSnap | null {
  if (s.tool === 'select' || s.tool === 'picker') { t.dirty = t.dirty; return null }
  return snapshot(t)
}

export function floodFill(t: StudioTex, x: number, y: number, o: PaintOpts): void {
  const l = activeLayer(t)
  const img = l.ctx.getImageData(0, 0, t.w, t.h)
  const d = img.data
  const at = (px: number, py: number): number => (py * t.w + px) * 4
  const s0 = at(x, y)
  const target = [d[s0], d[s0 + 1], d[s0 + 2], d[s0 + 3]]
  const fill = o.color
  if (target.every((v, i) => v === fill[i])) return
  const same = (i: number): boolean => d[i] === target[0] && d[i + 1] === target[1] && d[i + 2] === target[2] && d[i + 3] === target[3]
  const paint = (px: number, py: number): void => {
    const i = at(px, py)
    if (l.lockAlpha && d[i + 3] === 0) return
    d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = fill[3]
  }
  if (o.global) {
    for (let py = 0; py < t.h; py++) for (let px = 0; px < t.w; px++) if (inSel(t, px, py) && same(at(px, py))) paint(px, py)
  } else {
    const seen = new Uint8Array(t.w * t.h)
    const stack = [[x, y]]
    while (stack.length) {
      const [px, py] = stack.pop()!
      if (!inSel(t, px, py) || seen[py * t.w + px]) continue
      seen[py * t.w + px] = 1
      if (!same(at(px, py))) continue
      paint(px, py)
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1])
    }
  }
  l.ctx.putImageData(img, 0, 0)
}

// ── Acciones de un golpe (menú «Imagen») ────────────────────────────────────

const area = (t: StudioTex): Sel => t.selection ?? { x: 0, y: 0, w: t.w, h: t.h }

function mapPixels(t: StudioTex, fn: (c: Rgba) => Rgba): void {
  const a = area(t)
  const l = activeLayer(t)
  const img = l.ctx.getImageData(a.x, a.y, a.w, a.h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const c = fn([d[i], d[i + 1], d[i + 2], d[i + 3]])
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3]
  }
  l.ctx.putImageData(img, a.x, a.y)
  touch(t)
}

export function flip(t: StudioTex, dir: 'h' | 'v'): void {
  const a = area(t)
  const l = activeLayer(t)
  const src = l.ctx.getImageData(a.x, a.y, a.w, a.h)
  const out = new ImageData(a.w, a.h)
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const sx = dir === 'h' ? a.w - 1 - x : x, sy = dir === 'v' ? a.h - 1 - y : y
    out.data.set(src.data.subarray((sy * a.w + sx) * 4, (sy * a.w + sx) * 4 + 4), (y * a.w + x) * 4)
  }
  l.ctx.putImageData(out, a.x, a.y)
  touch(t)
}

/** Gira 90° a la derecha (la selección tiene que ser cuadrada; si no, toda la capa si lo es). */
export function rotate90(t: StudioTex): boolean {
  let a = area(t)
  if (a.w !== a.h) { if (t.w !== t.h) return false; a = { x: 0, y: 0, w: t.w, h: t.h } }
  const l = activeLayer(t)
  const src = l.ctx.getImageData(a.x, a.y, a.w, a.h)
  const out = new ImageData(a.w, a.h)
  const n = a.w
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const sx = y, sy = n - 1 - x
    out.data.set(src.data.subarray((sy * n + sx) * 4, (sy * n + sx) * 4 + 4), (y * n + x) * 4)
  }
  l.ctx.putImageData(out, a.x, a.y)
  touch(t)
  return true
}

/** Tono (grados), saturación y brillo (−1..1) sobre una foto previa, para poder previsualizar. */
export function adjustFrom(t: StudioTex, base: TexSnap, hue: number, sat: number, light: number): void {
  restoreActive(t, base)
  mapPixels(t, (c) => {
    let [h, s, v] = rgbToHsv(c)
    h = (h + hue + 360) % 360
    s = Math.min(1, Math.max(0, s * (1 + sat)))
    v = Math.min(1, Math.max(0, v * (1 + light)))
    const [r, g, b] = hsvToRgb(h, s, v)
    return [r, g, b, c[3]]
  })
}
export const grayscale = (t: StudioTex): void => mapPixels(t, (c) => { const v = Math.round(c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11); return [v, v, v, c[3]] })
export const invert = (t: StudioTex): void => mapPixels(t, (c) => [255 - c[0], 255 - c[1], 255 - c[2], c[3]])
export function replaceColor(t: StudioTex, from: Rgba, to: Rgba): number {
  let n = 0
  mapPixels(t, (c) => (c[0] === from[0] && c[1] === from[1] && c[2] === from[2] ? (n++, [to[0], to[1], to[2], c[3]]) : c))
  return n
}
/** Contorno de 1 píxel alrededor de lo dibujado en la capa (por fuera). */
export function outlineLayer(t: StudioTex, c: Rgba): void {
  const l = activeLayer(t)
  const img = l.ctx.getImageData(0, 0, t.w, t.h)
  const d = img.data
  const a = (x: number, y: number): number => (x < 0 || y < 0 || x >= t.w || y >= t.h ? 0 : d[(y * t.w + x) * 4 + 3])
  const add: [number, number][] = []
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    if (a(x, y) === 0 && (a(x + 1, y) || a(x - 1, y) || a(x, y + 1) || a(x, y - 1)) && inSel(t, x, y)) add.push([x, y])
  }
  for (const [x, y] of add) { const i = (y * t.w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] }
  l.ctx.putImageData(img, 0, 0)
  touch(t)
}
export function clearArea(t: StudioTex): void {
  const a = area(t)
  activeLayer(t).ctx.clearRect(a.x, a.y, a.w, a.h)
  touch(t)
}
export function copyArea(t: StudioTex, merged: boolean): { img: ImageData; x: number; y: number } {
  const a = area(t)
  return { img: (merged ? t.ctx : activeLayer(t).ctx).getImageData(a.x, a.y, a.w, a.h), x: a.x, y: a.y }
}
/** Pega como capa nueva, en el mismo sitio, y deja seleccionado lo pegado. */
export function pasteAsLayer(t: StudioTex, clip: { img: ImageData; x: number; y: number }): void {
  const l = makeLayer(t.w, t.h, 'Pegado')
  const x = Math.min(clip.x, Math.max(0, t.w - clip.img.width)), y = Math.min(clip.y, Math.max(0, t.h - clip.img.height))
  l.ctx.putImageData(clip.img, x, y)
  t.layers.splice(t.active + 1, 0, l)
  t.active += 1
  t.selection = { x, y, w: Math.min(clip.img.width, t.w), h: Math.min(clip.img.height, t.h) }
  touch(t)
}

// ── Capas ────────────────────────────────────────────────────────────────────

export function addLayer(t: StudioTex): void {
  t.layers.splice(t.active + 1, 0, makeLayer(t.w, t.h, `Capa ${t.layers.length + 1}`))
  t.active += 1
  touch(t)
}
export function duplicateLayer(t: StudioTex): void {
  const src = activeLayer(t)
  const l = makeLayer(t.w, t.h, `${src.name} copia`)
  Object.assign(l, { visible: src.visible, opacity: src.opacity, blend: src.blend })
  l.ctx.drawImage(src.canvas, 0, 0)
  t.layers.splice(t.active + 1, 0, l)
  t.active += 1
  touch(t)
}
export function deleteLayer(t: StudioTex): boolean {
  if (t.layers.length <= 1) return false
  t.layers.splice(t.active, 1)
  t.active = Math.max(0, t.active - 1)
  touch(t)
  return true
}
export function moveLayer(t: StudioTex, dir: 1 | -1): void {
  const i = t.active, j = i + dir
  if (j < 0 || j >= t.layers.length) return
  ;[t.layers[i], t.layers[j]] = [t.layers[j], t.layers[i]]
  t.active = j
  touch(t)
}
/** Junta la capa activa con la de debajo (con su opacidad y modo). */
export function mergeDown(t: StudioTex): boolean {
  if (t.active === 0) return false
  const top = t.layers[t.active], below = t.layers[t.active - 1]
  below.ctx.globalAlpha = top.visible ? top.opacity : 0
  below.ctx.globalCompositeOperation = top.blend
  below.ctx.drawImage(top.canvas, 0, 0)
  below.ctx.globalAlpha = 1
  below.ctx.globalCompositeOperation = 'source-over'
  t.layers.splice(t.active, 1)
  t.active -= 1
  touch(t)
  return true
}
export function flatten(t: StudioTex): void {
  const l = makeLayer(t.w, t.h, 'Fondo')
  l.ctx.drawImage(t.canvas, 0, 0)
  t.layers = [l]
  t.active = 0
  touch(t)
}
