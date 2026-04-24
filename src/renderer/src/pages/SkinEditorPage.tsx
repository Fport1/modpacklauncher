import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import * as skinview3d from 'skinview3d'
import * as THREE from 'three'
import { useStore, activeAccount } from '../store'

// Types & constants

type Tool = 'pencil' | 'eraser' | 'fill' | 'eyedropper' | 'rotate' | 'darken' | 'lighten'
type SkinModel = 'classic' | 'slim'
type ModelType = 'default' | 'slim'
type PartKey = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg'
type LimbKey = 'arm' | 'leg'
type LayerKey = 'inner' | 'outer'
interface PartFilter { inner: boolean; outer: boolean }
type Filters = Record<PartKey, PartFilter>
interface Rect { x: number; y: number; w: number; h: number }
interface FaceRect extends Rect { face: 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back' }
interface LimbLayout { key: PartKey; limb: LimbKey; side: 'right' | 'left'; layer: LayerKey; faces: FaceRect[] }
interface Sample { id: string; color: string; pinned: boolean; saved: boolean }

const SW = 64
const SH = 64

const DEFAULT_FILTERS: Filters = {
  head: { inner: true, outer: true },
  body: { inner: true, outer: true },
  rightArm: { inner: true, outer: true },
  leftArm: { inner: true, outer: true },
  rightLeg: { inner: true, outer: true },
  leftLeg: { inner: true, outer: true },
}

const PARTS: { key: PartKey; label: string; outerLabel: string }[] = [
  { key: 'head',     label: 'Cabeza',    outerLabel: 'Casco' },
  { key: 'body',     label: 'Cuerpo',    outerLabel: 'Chaqueta' },
  { key: 'rightArm', label: 'Brazo D.',  outerLabel: 'Manga D.' },
  { key: 'leftArm',  label: 'Brazo I.',  outerLabel: 'Manga I.' },
  { key: 'rightLeg', label: 'Pierna D.', outerLabel: 'Pantalon D.' },
  { key: 'leftLeg',  label: 'Pierna I.', outerLabel: 'Pantalon I.' },
]

const BASE_UV_RECTS = [
  { x: 0,  y: 0,  w: 32, h: 16 }, // head
  { x: 16, y: 16, w: 24, h: 16 }, // body
  { x: 40, y: 16, w: 16, h: 16 }, // right arm
  { x: 0,  y: 16, w: 16, h: 16 }, // right leg
  { x: 32, y: 48, w: 16, h: 16 }, // left arm
  { x: 16, y: 48, w: 16, h: 16 }, // left leg
]

function boxFaces(u: number, v: number, w: number, h: number, d: number): FaceRect[] {
  return [
    { face: 'top',    x: u + d,         y: v,     w,     h: d },
    { face: 'bottom', x: u + d + w,     y: v,     w,     h: d },
    { face: 'right',  x: u,             y: v + d, w: d,  h },
    { face: 'front',  x: u + d,         y: v + d, w,     h },
    { face: 'left',   x: u + d + w,     y: v + d, w: d,  h },
    { face: 'back',   x: u + d + w + d, y: v + d, w: d,  h },
  ]
}

function getLimbLayouts(model: SkinModel): LimbLayout[] {
  const armW = model === 'slim' ? 3 : 4
  return [
    { key: 'rightArm', limb: 'arm', side: 'right', layer: 'inner', faces: boxFaces(40, 16, armW, 12, 4) },
    { key: 'leftArm',  limb: 'arm', side: 'left',  layer: 'inner', faces: boxFaces(32, 48, armW, 12, 4) },
    { key: 'rightArm', limb: 'arm', side: 'right', layer: 'outer', faces: boxFaces(40, 32, armW, 12, 4) },
    { key: 'leftArm',  limb: 'arm', side: 'left',  layer: 'outer', faces: boxFaces(48, 48, armW, 12, 4) },
    { key: 'rightLeg', limb: 'leg', side: 'right', layer: 'inner', faces: boxFaces(0, 16, 4, 12, 4) },
    { key: 'leftLeg',  limb: 'leg', side: 'left',  layer: 'inner', faces: boxFaces(16, 48, 4, 12, 4) },
    { key: 'rightLeg', limb: 'leg', side: 'right', layer: 'outer', faces: boxFaces(0, 32, 4, 12, 4) },
    { key: 'leftLeg',  limb: 'leg', side: 'left',  layer: 'outer', faces: boxFaces(0, 48, 4, 12, 4) },
  ]
}

function modelToSkinview(model: SkinModel): ModelType {
  return model === 'slim' ? 'slim' : 'default'
}

// SVG cursor: thin precision crosshair
const CURSOR_PAINT = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Cline x1='10' y1='0' x2='10' y2='7' stroke='white' stroke-width='2.5'/%3E%3Cline x1='10' y1='13' x2='10' y2='20' stroke='white' stroke-width='2.5'/%3E%3Cline x1='0' y1='10' x2='7' y2='10' stroke='white' stroke-width='2.5'/%3E%3Cline x1='13' y1='10' x2='20' y2='10' stroke='white' stroke-width='2.5'/%3E%3Cline x1='10' y1='0' x2='10' y2='7' stroke='black' stroke-width='1'/%3E%3Cline x1='10' y1='13' x2='10' y2='20' stroke='black' stroke-width='1'/%3E%3Cline x1='0' y1='10' x2='7' y2='10' stroke='black' stroke-width='1'/%3E%3Cline x1='13' y1='10' x2='20' y2='10' stroke='black' stroke-width='1'/%3E%3Ccircle cx='10' cy='10' r='1.5' fill='white'/%3E%3Ccircle cx='10' cy='10' r='0.8' fill='black'/%3E%3C/svg%3E") 10 10, crosshair`

const CURSOR_EYEDROPPER = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Cline x1='3' y1='17' x2='14' y2='6' stroke='white' stroke-width='3.5' stroke-linecap='round'/%3E%3Cline x1='3' y1='17' x2='14' y2='6' stroke='black' stroke-width='1.5' stroke-linecap='round'/%3E%3Cpath d='M12 4 L16 2 L18 4 L16 8z' fill='white' stroke='black' stroke-width='1'/%3E%3Ccircle cx='3' cy='17' r='2' fill='none' stroke='white' stroke-width='1.5'/%3E%3C/svg%3E") 3 17, crosshair`

// UV regions for reference panel
const UV_PARTS: Record<string, { x: number; y: number; w: number; h: number; label: string; color: string }> = {
  head:         { x: 8,  y: 8,  w: 8, h: 8,  label: 'Cabeza',      color: '#f59e0b' },
  headOverlay:  { x: 40, y: 8,  w: 8, h: 8,  label: 'Casco',        color: '#fbbf24' },
  body:         { x: 20, y: 20, w: 8, h: 12, label: 'Cuerpo',       color: '#3b82f6' },
  bodyOverlay:  { x: 20, y: 36, w: 8, h: 12, label: 'Chaqueta',     color: '#60a5fa' },
  rightArm:     { x: 44, y: 20, w: 4, h: 12, label: 'Brazo D.',     color: '#10b981' },
  rightArmOver: { x: 44, y: 36, w: 4, h: 12, label: 'Manga D.',     color: '#34d399' },
  leftArm:      { x: 36, y: 52, w: 4, h: 12, label: 'Brazo I.',     color: '#10b981' },
  leftArmOver:  { x: 52, y: 52, w: 4, h: 12, label: 'Manga I.',     color: '#34d399' },
  rightLeg:     { x: 4,  y: 20, w: 4, h: 12, label: 'Pierna D.',    color: '#8b5cf6' },
  rightLegOver: { x: 4,  y: 36, w: 4, h: 12, label: 'Pantalon D.', color: '#a78bfa' },
  leftLeg:      { x: 20, y: 52, w: 4, h: 12, label: 'Pierna I.',    color: '#8b5cf6' },
  leftLegOver:  { x: 4,  y: 52, w: 4, h: 12, label: 'Pantalon I.', color: '#a78bfa' },
}

// Pure helpers

function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 255]
}

function rgbaToHex(r: number, g: number, b: number): string {
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('')
}

function hexToRgb(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgba(hex)
  return [r, g, b]
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [Math.round(h), Math.round(max === 0 ? 0 : (d / max) * 100), Math.round(max * 100)]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const ss = Math.max(0, Math.min(100, s)) / 100
  const vv = Math.max(0, Math.min(100, v)) / 100
  const c = vv * ss
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = vv - c
  let rr = 0, gg = 0, bb = 0
  if (h < 60) [rr, gg, bb] = [c, x, 0]
  else if (h < 120) [rr, gg, bb] = [x, c, 0]
  else if (h < 180) [rr, gg, bb] = [0, c, x]
  else if (h < 240) [rr, gg, bb] = [0, x, c]
  else if (h < 300) [rr, gg, bb] = [x, 0, c]
  else [rr, gg, bb] = [c, 0, x]
  return [Math.round((rr + m) * 255), Math.round((gg + m) * 255), Math.round((bb + m) * 255)]
}

function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(((h % 360) + 360) % 360, s, v)
  return rgbaToHex(r, g, b)
}

function getPixel(d: Uint8ClampedArray, x: number, y: number): [number,number,number,number] {
  const i = (y * SW + x) * 4
  return [d[i], d[i+1], d[i+2], d[i+3]]
}

function setPixelData(d: Uint8ClampedArray, x: number, y: number, c: [number,number,number,number]) {
  if (x < 0 || x >= SW || y < 0 || y >= SH) return
  const i = (y * SW + x) * 4
  d[i]=c[0]; d[i+1]=c[1]; d[i+2]=c[2]; d[i+3]=c[3]
}

function getEditableRects(model: SkinModel): Rect[] {
  const armW = model === 'slim' ? 15 : 16
  return [
    ...BASE_UV_RECTS,
    { x: 32, y: 0,  w: 32, h: 16 }, // head overlay
    { x: 16, y: 32, w: 24, h: 16 }, // body overlay
    { x: 40, y: 32, w: armW, h: 16 }, // right arm overlay
    { x: 0,  y: 32, w: 16,   h: 16 }, // right leg overlay
    { x: 32, y: 48, w: armW, h: 16 }, // left arm
    { x: 48, y: 48, w: armW, h: 16 }, // left arm overlay
    { x: 0,  y: 48, w: 16,   h: 16 }, // left leg overlay
  ]
}

function isEditablePixel(x: number, y: number, model: SkinModel): boolean {
  return getEditableRects(model).some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
}

function findFace(layout: LimbLayout, x: number, y: number): FaceRect | null {
  return layout.faces.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) ?? null
}

function mirrorFaceName(face: FaceRect['face']): FaceRect['face'] {
  if (face === 'right') return 'left'
  if (face === 'left') return 'right'
  return face
}

function isMirrorLayerVisible(layout: LimbLayout, filters: Filters): boolean {
  const a = layout.limb === 'arm' ? ['rightArm', 'leftArm'] as const : ['rightLeg', 'leftLeg'] as const
  return filters[a[0]][layout.layer] && filters[a[1]][layout.layer]
}

function mirrorPixel(x: number, y: number, model: SkinModel, filters: Filters): { x: number; y: number } | null {
  const layouts = getLimbLayouts(model)
  for (const source of layouts) {
    const sourceFace = findFace(source, x, y)
    if (!sourceFace || !isMirrorLayerVisible(source, filters)) continue
    const target = layouts.find(l => l.limb === source.limb && l.layer === source.layer && l.side !== source.side)
    if (!target) return null
    const targetFace = target.faces.find(f => f.face === mirrorFaceName(sourceFace.face))
    if (!targetFace) return null
    const lx = x - sourceFace.x
    const ly = y - sourceFace.y
    return {
      x: targetFace.x + Math.max(0, Math.min(targetFace.w - 1, targetFace.w - 1 - lx)),
      y: targetFace.y + Math.max(0, Math.min(targetFace.h - 1, ly)),
    }
  }
  return null
}

function createBlankSkin(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SW * SH * 4)
  for (const r of BASE_UV_RECTS) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        setPixelData(data, x, y, [255, 255, 255, 255])
      }
    }
  }
  return data
}

function colorsEq(a: [number,number,number,number], b: [number,number,number,number]) {
  return a[0]===b[0] && a[1]===b[1] && a[2]===b[2] && a[3]===b[3]
}

function floodFill(d: Uint8ClampedArray, sx: number, sy: number, fill: [number,number,number,number], model: SkinModel): { x: number; y: number }[] {
  if (!isEditablePixel(sx, sy, model)) return []
  const target = getPixel(d, sx, sy)
  if (colorsEq(target, fill)) return []
  const changed: { x: number; y: number }[] = []
  const stack: [number,number][] = [[sx, sy]]
  const visited = new Uint8Array(SW * SH)
  while (stack.length) {
    const [x, y] = stack.pop()!
    if (x<0||x>=SW||y<0||y>=SH||visited[y*SW+x]) continue
    if (!isEditablePixel(x, y, model)) continue
    if (!colorsEq(getPixel(d, x, y), target)) continue
    visited[y*SW+x] = 1
    setPixelData(d, x, y, fill)
    changed.push({ x, y })
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1])
  }
  return changed
}

function drawLine(x0: number, y0: number, x1: number, y1: number, fn: (x:number,y:number)=>void) {
  const dx=Math.abs(x1-x0), dy=Math.abs(y1-y0)
  const sx=x0<x1?1:-1, sy=y0<y1?1:-1
  let err=dx-dy
  for (;;) {
    fn(x0, y0)
    if (x0===x1&&y0===y1) break
    const e2=2*err
    if (e2>-dy){err-=dy;x0+=sx}
    if (e2<dx) {err+=dx;y0+=sy}
  }
}

function pixelsToCanvas(data: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width=SW; c.height=SH
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), SW, SH), 0, 0)
  return c
}

function pixelsToDisplayCanvas(data: Uint8ClampedArray, model: SkinModel, showGrid: boolean): HTMLCanvasElement {
  if (!showGrid) return pixelsToCanvas(data)
  const scale = 8
  const c = document.createElement('canvas')
  c.width = SW * scale
  c.height = SH * scale
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(pixelsToCanvas(data), 0, 0, c.width, c.height)
  ctx.lineWidth = 1
  for (const r of getEditableRects(model)) {
    ctx.strokeStyle = 'rgba(0,0,0,0.38)'
    for (let x = r.x; x <= r.x + r.w; x++) {
      ctx.beginPath()
      ctx.moveTo(x * scale + 0.5, r.y * scale)
      ctx.lineTo(x * scale + 0.5, (r.y + r.h) * scale)
      ctx.stroke()
    }
    for (let y = r.y; y <= r.y + r.h; y++) {
      ctx.beginPath()
      ctx.moveTo(r.x * scale, y * scale + 0.5)
      ctx.lineTo((r.x + r.w) * scale, y * scale + 0.5)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.strokeRect(r.x * scale + 0.5, r.y * scale + 0.5, r.w * scale - 1, r.h * scale - 1)
  }
  return c
}

function pixelsToBase64(data: Uint8ClampedArray): string {
  return pixelsToCanvas(data).toDataURL('image/png')
}

function base64ToPixels(src: string, cb: (d: Uint8ClampedArray)=>void) {
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas'); c.width=SW; c.height=SH
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0, SW, SH)
    cb(new Uint8ClampedArray(ctx.getImageData(0, 0, SW, SH).data))
  }
  img.src = src
}

function ColorPickerDialog({ color, samples, onPickSample, onAddSample, onDeleteSample, onSaveSample, onPinSample, onMoveSample, onClose, onApply }: {
  color: string
  samples: Sample[]
  onPickSample: (color: string) => void
  onAddSample: (color: string) => void
  onDeleteSample: (id: string) => void
  onSaveSample: (id: string) => void
  onPinSample: (id: string) => void
  onMoveSample: (fromId: string, toId: string) => void
  onClose: () => void
  onApply: (color: string) => void
}) {
  const [h, setH] = useState(() => { const [r, g, b] = hexToRgb(color); return rgbToHsv(r, g, b)[0] })
  const [s, setS] = useState(() => { const [r, g, b] = hexToRgb(color); return rgbToHsv(r, g, b)[1] })
  const [v, setV] = useState(() => { const [r, g, b] = hexToRgb(color); return rgbToHsv(r, g, b)[2] })
  const nextColor = hsvToHex(h, s, v)
  const rgb = hexToRgb(nextColor)
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  // Drag
  const [pos, setPos] = useState(() => ({
    left: Math.max(20, Math.round(window.innerWidth / 2 - 295)),
    top: Math.max(20, Math.round(window.innerHeight / 2 - 210)),
  }))
  const drag = useRef({ active: false, startX: 0, startY: 0, origLeft: 0, origTop: 0 })
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag.current.active) return
      setPos({ left: drag.current.origLeft + e.clientX - drag.current.startX, top: drag.current.origTop + e.clientY - drag.current.startY })
    }
    function onUp() { drag.current.active = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // Close context menu when clicking outside it
  useEffect(() => {
    if (!ctxMenu) return
    function onDown() { setCtxMenu(null) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [ctxMenu])

  const colorSyncMounted = useRef(false)
  useEffect(() => {
    if (!colorSyncMounted.current) { colorSyncMounted.current = true; return }
    const [r, g, b] = hexToRgb(color)
    const [nh, ns, nv] = rgbToHsv(r, g, b)
    setH(nh); setS(ns); setV(nv)
  }, [color])
  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    drag.current = { active: true, startX: e.clientX, startY: e.clientY, origLeft: pos.left, origTop: pos.top }
  }

  function setFromRgb(ch: 0 | 1 | 2, val: number) {
    const next = [...rgb] as [number, number, number]
    next[ch] = Math.max(0, Math.min(255, val))
    const [nh, ns, nv] = rgbToHsv(next[0], next[1], next[2])
    setH(nh); setS(ns); setV(nv)
  }
  function setFromHex(raw: string) {
    const hex = `#${raw.replace('#', '')}`
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      const [r, g, b] = hexToRgb(hex)
      const [nh, ns, nv] = rgbToHsv(r, g, b)
      setH(nh); setS(ns); setV(nv)
    }
  }
  function pickSV(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setS(Math.round(Math.max(0, Math.min(rect.width, e.clientX - rect.left)) / rect.width * 100))
    setV(Math.round(100 - Math.max(0, Math.min(rect.height, e.clientY - rect.top)) / rect.height * 100))
  }
  function pickH(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setH(Math.round(Math.max(0, Math.min(rect.height, e.clientY - rect.top)) / rect.height * 359))
  }

  const inp = "w-[52px] h-[22px] px-1 border border-[#b0b0b0] bg-white text-black text-xs text-right outline-none focus:border-[#5555ff] rounded-sm"
  const btn = "w-full h-[26px] border border-[#b0b0b0] rounded-sm bg-[#e1e1e1] hover:bg-[#d0d0d0] active:bg-[#c0c0c0] text-black text-[11px] whitespace-nowrap transition-colors cursor-pointer px-1"
  const ctxBtn = "block w-full text-left px-3 py-1.5 text-[12px] text-black hover:bg-[#e8e8ff] whitespace-nowrap"

  return (
    <div className="fixed inset-0 z-[600]" style={{ pointerEvents: 'none' }}>
      <div
        style={{ position: 'fixed', left: pos.left, top: pos.top, pointerEvents: 'all' }}
        className="bg-[#ebebeb] border border-[#aaa] shadow-2xl rounded-sm overflow-visible select-none"
        onClick={e => e.stopPropagation()}
      >
        {/* Title bar */}
        <div onMouseDown={startDrag}
          className="flex items-center justify-between bg-[#1e293b] text-white/90 px-3 h-8 cursor-move rounded-t-sm">
          <span className="text-[11px] font-medium tracking-wide">Selector de color (color frontal)</span>
          <button onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/20 text-white text-lg leading-none">
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex gap-3 p-3 pb-2">
          {/* SV square */}
          <div className="relative flex-shrink-0 border border-[#999] cursor-crosshair"
            style={{ width: 220, height: 220, background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${h}, 100%, 50%)` }}
            onMouseDown={pickSV} onMouseMove={e => { if (e.buttons === 1) pickSV(e) }}>
            <div className="absolute w-[13px] h-[13px] rounded-full border-2 border-white shadow-[0_0_0_1px_#333] pointer-events-none"
              style={{ left: `calc(${s}% - 6px)`, top: `calc(${100 - v}% - 6px)` }} />
          </div>

          {/* Hue bar */}
          <div className="relative flex-shrink-0" style={{ width: 16, height: 220 }}>
            <div className="absolute inset-0 border border-[#999] cursor-pointer"
              style={{ background: 'linear-gradient(to bottom, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
              onMouseDown={pickH} onMouseMove={e => { if (e.buttons === 1) pickH(e) }} />
            <div className="absolute pointer-events-none"
              style={{ top: `calc(${(h / 359) * 100}% - 5px)`, right: '100%', marginRight: 1,
                width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: '6px solid #1e293b' }} />
            <div className="absolute pointer-events-none"
              style={{ top: `calc(${(h / 359) * 100}% - 5px)`, left: '100%', marginLeft: 1,
                width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderRight: '6px solid #1e293b' }} />
          </div>

          {/* Color preview nuevo/actual */}
          <div className="flex flex-col flex-shrink-0 items-center gap-0.5" style={{ width: 56 }}>
            <span className="text-[10px] text-[#555]">nuevo</span>
            <div className="border border-[#999] w-full" style={{ height: 44, background: nextColor }} />
            <div className="border-x border-b border-[#999] w-full" style={{ height: 44, background: color }} />
            <span className="text-[10px] text-[#555]">actual</span>
          </div>

          {/* Right: HSB + RGB + hex + buttons */}
          <div className="flex gap-3 flex-shrink-0">
            <div className="flex flex-col justify-start" style={{ paddingTop: 2 }}>
              {[
                { label: 'H:', val: h, min: 0, max: 359, unit: '°', fn: (n: number) => setH(Math.max(0, Math.min(359, n))) },
                { label: 'S:', val: s, min: 0, max: 100, unit: '%', fn: (n: number) => setS(Math.max(0, Math.min(100, n))) },
                { label: 'B:', val: v, min: 0, max: 100, unit: '%', fn: (n: number) => setV(Math.max(0, Math.min(100, n))) },
              ].map(({ label, val, min, max, unit, fn }) => (
                <div key={label} className="flex items-center gap-1 mb-[5px]">
                  <span className="text-[11px] text-[#222] w-6 text-right">{label}</span>
                  <input type="number" value={val} min={min} max={max}
                    onChange={e => fn(Number(e.target.value))} className={inp} />
                  <span className="text-[10px] text-[#666] w-4">{unit}</span>
                </div>
              ))}
              <div className="h-2" />
              {[
                { label: 'R:', val: rgb[0], fn: (n: number) => setFromRgb(0, n) },
                { label: 'G:', val: rgb[1], fn: (n: number) => setFromRgb(1, n) },
                { label: 'B:', val: rgb[2], fn: (n: number) => setFromRgb(2, n) },
              ].map(({ label, val, fn }) => (
                <div key={label} className="flex items-center gap-1 mb-[5px]">
                  <span className="text-[11px] text-[#222] w-6 text-right">{label}</span>
                  <input type="number" value={val} min={0} max={255}
                    onChange={e => fn(Number(e.target.value))} className={inp} />
                  <span className="text-[10px] text-[#666] w-4" />
                </div>
              ))}
              <div className="flex items-center gap-1 mt-1">
                <span className="text-[11px] text-[#222] w-6 text-right">#</span>
                <input value={nextColor.slice(1)} onChange={e => setFromHex(e.target.value)} maxLength={6}
                  className="w-[68px] h-[22px] px-1 border border-[#b0b0b0] bg-white text-black text-xs outline-none focus:border-[#5555ff] rounded-sm font-mono" />
              </div>
            </div>

            <div className="flex flex-col gap-1.5 w-[108px]" style={{ paddingTop: 2 }}>
              <button onClick={() => onApply(nextColor)} className={btn}>OK</button>
              <button onClick={onClose} className={btn}>Cancelar</button>
              <button onClick={() => onAddSample(nextColor)} className={btn}>Añadir a muestras</button>
            </div>
          </div>
        </div>

        {/* Samples */}
        {samples.length > 0 && (
          <div className="px-3 pb-3 pt-1 border-t border-[#d0d0d0]">
            <p className="text-[10px] text-[#666] mb-1.5">
              Muestras
              <span className="ml-1.5 opacity-60">· clic derecho para opciones · arrastra para reordenar</span>
            </p>
            <div className="flex flex-wrap gap-1">
              {samples.map(sample => (
                <div
                  key={sample.id}
                  className="relative cursor-grab active:cursor-grabbing"
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('sampleId', sample.id); e.dataTransfer.effectAllowed = 'move' }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const fromId = e.dataTransfer.getData('sampleId'); if (fromId !== sample.id) onMoveSample(fromId, sample.id) }}
                >
                  <button
                    onClick={() => { onPickSample(sample.color); onApply(sample.color) }}
                    onContextMenu={e => { e.preventDefault(); setCtxMenu({ id: sample.id, x: e.clientX, y: e.clientY }) }}
                    title={sample.color}
                    className="w-5 h-5 border border-[#999] hover:scale-110 transition-transform block"
                    style={{ background: sample.color }}
                  />
                  {sample.pinned && (
                    <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 pointer-events-none border border-white/80" />
                  )}
                  {!sample.pinned && sample.saved && (
                    <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 pointer-events-none border border-white/80" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Context menu */}
        {ctxMenu && (() => {
          const sample = samples.find(s => s.id === ctxMenu.id)
          return (
            <div
              className="fixed bg-white border border-[#ccc] shadow-lg rounded-sm z-[700] py-0.5 min-w-[110px]"
              style={{ left: ctxMenu.x, top: ctxMenu.y, pointerEvents: 'all' }}
              onMouseDown={e => e.stopPropagation()}
            >
              <button className={ctxBtn} onClick={() => { onDeleteSample(ctxMenu.id); setCtxMenu(null) }}>Borrar</button>
              {!sample?.saved && (
                <button className={ctxBtn} onClick={() => { onSaveSample(ctxMenu.id); setCtxMenu(null) }}>Guardar</button>
              )}
              {!sample?.pinned && (
                <button className={ctxBtn} onClick={() => { onPinSample(ctxMenu.id); setCtxMenu(null) }}>Pinear</button>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function SkinSavePreview({ skin, model }: { skin: string; model: SkinModel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<skinview3d.SkinViewer | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    viewerRef.current?.dispose()
    const v = new skinview3d.SkinViewer({
      canvas: canvasRef.current,
      width: 155,
      height: 215,
      skin,
      model: modelToSkinview(model),
    })
    v.autoRotate = true
    v.autoRotateSpeed = 0.6
    v.globalLight.intensity = 3
    v.cameraLight.intensity = 1
    v.controls.enableZoom = false
    v.controls.enablePan = false
    v.controls.enableRotate = false
    viewerRef.current = v
    return () => { v.dispose(); viewerRef.current = null }
  }, [skin, model])

  return <canvas ref={canvasRef} className="rounded-xl pointer-events-none" />
}

function SaveSkinModal({ skinData, initialName, initialModel, saving, onSave, onClose }: {
  skinData: string
  initialName: string
  initialModel: SkinModel
  saving: boolean
  onSave: (entry: { name: string; model: SkinModel }) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(initialName || 'unnamed skin')
  const [model, setModel] = useState<SkinModel>(initialModel)

  async function handleSave() {
    await onSave({ name: name.trim() || 'unnamed skin', model })
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[580px] flex overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="w-[190px] flex-shrink-0 bg-bg-card/50 flex items-center justify-center p-4 border-r border-border">
          <SkinSavePreview skin={skinData} model={model} />
        </div>
        <div className="flex-1 p-6 flex flex-col gap-5">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-widest">Nueva skin</h3>
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5 block">Nombre</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-bg-card border border-border focus:border-accent/50 rounded-lg px-3 py-2 text-sm text-text-primary outline-none transition-colors"
              placeholder="unnamed skin" />
          </div>
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 block">Modelo del jugador</label>
            <div className="flex gap-2">
              {([['classic', 'Ancho'], ['slim', 'Delgado']] as [SkinModel, string][]).map(([m, label]) => (
                <button key={m} onClick={() => setModel(m)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors flex-1 ${model === m ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border text-text-secondary hover:border-accent/30'}`}>
                  <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${model === m ? 'border-accent bg-accent' : 'border-text-muted'}`} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 block">Archivo de skin</label>
            <div className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm text-text-secondary w-fit">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Skin del editor
            </div>
            <p className="text-xs text-accent mt-1.5 flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              Skin cargada correctamente
            </p>
          </div>
          <div className="flex gap-3 mt-auto pt-1">
            <button onClick={onClose}
              className="flex-1 py-2 border border-border hover:border-accent/40 rounded-lg text-sm text-text-secondary transition-colors">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
              {saving && <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>}
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Component

export default function SkinEditorPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const account = useStore(activeAccount)

      {/* Main */}
  const view3DRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<skinview3d.SkinViewer | null>(null)
  const raycaster = useRef(new THREE.Raycaster())

  // Flat UV reference canvas (right panel)
  const flatCanvasRef = useRef<HTMLCanvasElement>(null)

  // Pixel data
  const pixelsRef = useRef(createBlankSkin())
  const isDrawingRef = useRef(false)
  const lastPxRef = useRef<{x:number;y:number;objectId:string}|null>(null)

  // Undo/redo
  const undoStack = useRef<Uint8ClampedArray[]>([])
  const redoStack = useRef<Uint8ClampedArray[]>([])

  // Refs for stable callbacks
  const toolRef = useRef<Tool>('pencil')
  const colorRef = useRef('#3b82f6')
  const skinModelRef = useRef<SkinModel>('classic')
  const filtersRef = useRef<Filters>(DEFAULT_FILTERS)
  const showModelGridRef = useRef(false)
  const mirrorRef = useRef(false)
  const isDirtyRef = useRef(false)

  const [tool, setToolState] = useState<Tool>('pencil')
  const [color, setColorState] = useState('#3b82f6')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [samples, setSamples] = useState<Sample[]>([])
  const [colorDialogOpen, setColorDialogOpen] = useState(false)
  const [skinName, setSkinName] = useState('Nueva skin')
  const [skinModel, setSkinModel] = useState<SkinModel>('classic')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [showModelGrid, setShowModelGrid] = useState(false)
  const [mirror, setMirror] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [saveMsg, setSaveMsg] = useState<'success'|'error'|null>(null)
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false)

  function setTool(t: Tool) {
    toolRef.current = t
    setToolState(t)
  }

  function setColor(c: string) { colorRef.current = c; setColorState(c) }

  function applyDarkenLighten(x: number, y: number, type: 'darken' | 'lighten') {
    const [r, g, b, a] = getPixel(pixelsRef.current, x, y)
    if (a === 0) return
    const [h, s, v] = rgbToHsv(r, g, b)
    const nv = type === 'darken' ? Math.max(0, v - 10) : Math.min(100, v + 10)
    const [nr, ng, nb] = hsvToRgb(h, s, nv)
    paintPixel(x, y, [nr, ng, nb, a])
  }

  function setRgbChannel(channel: 0 | 1 | 2, value: number) {
    const rgb = hexToRgb(colorRef.current)
    rgb[channel] = Math.max(0, Math.min(255, value))
    setColor(rgbaToHex(rgb[0], rgb[1], rgb[2]))
  }

  async function openSkinFile() {
    const data = await window.api.skins.pickFile()
    if (!data) return
    base64ToPixels(data, pixels => {
      pushUndo()
      pixelsRef.current = pixels
      updateTexture()
      renderFlat()
    })
  }

  function toggleModelGrid() {
    const next = !showModelGridRef.current
    showModelGridRef.current = next
    setShowModelGrid(next)
    updateTexture()
    renderFlat()
  }

  function toggleMirror() {
    const next = !mirrorRef.current
    mirrorRef.current = next
    setMirror(next)
  }

  function paintPixel(x: number, y: number, c: [number,number,number,number]) {
    if (!isEditablePixel(x, y, skinModelRef.current)) return
    setPixelData(pixelsRef.current, x, y, c)
    if (!mirrorRef.current) return
    const mirrored = mirrorPixel(x, y, skinModelRef.current, filtersRef.current)
    if (mirrored && isEditablePixel(mirrored.x, mirrored.y, skinModelRef.current)) {
      setPixelData(pixelsRef.current, mirrored.x, mirrored.y, c)
    }
  }

  function setEditorModel(model: SkinModel) {
    skinModelRef.current = model
    setSkinModel(model)
    updateTexture(model)
  }

  function applyFilters(f: Filters) {
    const skin = viewerRef.current?.playerObject.skin
    if (!skin) return
    for (const { key } of PARTS) {
      const part = skin[key]
      part.innerLayer.visible = f[key].inner
      part.outerLayer.visible = f[key].outer
      part.visible = f[key].inner || f[key].outer
    }
  }

  function toggleInner(key: PartKey) {
    setFilters(prev => {
      const next = { ...prev, [key]: { ...prev[key], inner: !prev[key].inner } }
      filtersRef.current = next
      applyFilters(next)
      return next
    })
  }

  function toggleOuter(key: PartKey) {
    setFilters(prev => {
      const next = { ...prev, [key]: { ...prev[key], outer: !prev[key].outer } }
      filtersRef.current = next
      applyFilters(next)
      return next
    })
  }

  // Texture update

  const updateTexture = useCallback((model = skinModelRef.current) => {
    const v = viewerRef.current
    if (!v) return
    let texCanvas: HTMLCanvasElement
    if (showModelGridRef.current) {
      const scale = 4
      const c = document.createElement('canvas')
      c.width = SW * scale; c.height = SH * scale
      const ctx = c.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(pixelsToCanvas(pixelsRef.current), 0, 0, c.width, c.height)
      ctx.lineWidth = 0.5
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      for (let x = 0; x <= SW; x++) { ctx.beginPath(); ctx.moveTo(x*scale, 0); ctx.lineTo(x*scale, c.height); ctx.stroke() }
      for (let y = 0; y <= SH; y++) { ctx.beginPath(); ctx.moveTo(0, y*scale); ctx.lineTo(c.width, y*scale); ctx.stroke() }
      texCanvas = c
    } else {
      texCanvas = pixelsToCanvas(pixelsRef.current)
    }
    ;(v as any).loadSkin(texCanvas, { model: modelToSkinview(model) })
    applyFilters(filtersRef.current)
  }, [])

  // Flat UV reference render

  const renderFlat = useCallback(() => {
    const canvas = flatCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const s = canvas.width / SW

    // Checkerboard
    const cell = Math.max(2, Math.floor(s / 2))
    for (let cy=0;cy<canvas.height;cy+=cell)
      for (let cx=0;cx<canvas.width;cx+=cell) {
        ctx.fillStyle = ((cx/cell+cy/cell)%2===0) ? '#374151' : '#4b5563'
        ctx.fillRect(cx,cy,cell,cell)
      }

    // Pixels
    const off = pixelsToCanvas(pixelsRef.current)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height)

    // Subtle 4px guide lines on UV panel
    ctx.lineWidth = 0.5
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    for (let x=0;x<=SW;x+=4) { ctx.beginPath();ctx.moveTo(x*s,0);ctx.lineTo(x*s,canvas.height);ctx.stroke() }
    for (let y=0;y<=SH;y+=4) { ctx.beginPath();ctx.moveTo(0,y*s);ctx.lineTo(canvas.width,y*s);ctx.stroke() }
  }, [])

  // Raycasting helpers

  function getMeshes(): THREE.Mesh[] {
    const v = viewerRef.current
    if (!v) return []
    const meshes: THREE.Mesh[] = []
    v.playerObject.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh && isVisibleInTree(obj)) meshes.push(obj as THREE.Mesh)
    })
    return meshes
  }

  function isVisibleInTree(obj: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = obj
    while (cur) {
      if (!cur.visible) return false
      cur = cur.parent
    }
    return true
  }

  function uvToPixel(uv: THREE.Vector2): {x:number;y:number} {
    return {
      x: Math.max(0, Math.min(SW-1, Math.floor(uv.x * SW))),
      y: Math.max(0, Math.min(SH-1, Math.floor((1 - uv.y) * SH))),
    }
  }

  function raycastPixel(e: MouseEvent | React.MouseEvent): {x:number;y:number;objectId:string} | null {
    const v = viewerRef.current
    const canvas = view3DRef.current
    if (!v || !canvas) return null
    const rect = canvas.getBoundingClientRect()
    const ndx = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ndy = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.current.setFromCamera({ x: ndx, y: ndy }, v.camera)
    const hits = raycaster.current.intersectObjects(getMeshes(), false)
    if (!hits.length || !hits[0].uv) return null
    return { ...uvToPixel(hits[0].uv), objectId: hits[0].object.uuid }
  }

  // Undo/redo

  function pushUndo() {
    isDirtyRef.current = true
    undoStack.current.push(pixelsRef.current.slice())
    if (undoStack.current.length > 50) undoStack.current.shift()
    redoStack.current = []
    setCanUndo(true); setCanRedo(false)
  }

  const undoRef = useRef(() => {})
  const redoRef = useRef(() => {})

  undoRef.current = () => {
    if (!undoStack.current.length) return
    redoStack.current.push(pixelsRef.current.slice())
    pixelsRef.current = undoStack.current.pop()!
    setCanUndo(undoStack.current.length > 0); setCanRedo(true)
    updateTexture(); renderFlat()
  }

  redoRef.current = () => {
    if (!redoStack.current.length) return
    undoStack.current.push(pixelsRef.current.slice())
    pixelsRef.current = redoStack.current.pop()!
    setCanUndo(true); setCanRedo(redoStack.current.length > 0)
    updateTexture(); renderFlat()
  }

  // Mouse handlers on 3D canvas

  function addSample(hex: string) {
    setSamples(prev => {
      if (prev.some(s => s.color === hex)) return prev
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const item: Sample = { id, color: hex, pinned: false, saved: false }
      const pinned = prev.filter(s => s.pinned)
      const saved = prev.filter(s => !s.pinned && s.saved)
      const temp = [item, ...prev.filter(s => !s.pinned && !s.saved)].slice(0, 12)
      return [...pinned, ...saved, ...temp]
    })
  }

  function addSampleSaved(hex: string) {
    setSamples(prev => {
      const existing = prev.find(s => s.color === hex)
      if (existing) return existing.saved ? prev : prev.map(s => s.id === existing.id ? { ...s, saved: true } : s)
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const item: Sample = { id, color: hex, pinned: false, saved: true }
      const pinned = prev.filter(s => s.pinned)
      const saved = [item, ...prev.filter(s => !s.pinned && s.saved)]
      const temp = prev.filter(s => !s.pinned && !s.saved).slice(0, 12)
      return [...pinned, ...saved, ...temp]
    })
  }

  function deleteSample(id: string) {
    setSamples(prev => prev.filter(s => s.id !== id))
  }

  function saveSample(id: string) {
    setSamples(prev => {
      const item = prev.find(s => s.id === id)
      if (!item) return prev
      const rest = prev.filter(s => s.id !== id)
      const pinned = rest.filter(s => s.pinned)
      const saved = [...rest.filter(s => !s.pinned && s.saved), { ...item, saved: true }]
      const temp = rest.filter(s => !s.pinned && !s.saved)
      return [...pinned, ...saved, ...temp]
    })
  }

  function pinSample(id: string) {
    setSamples(prev => {
      const item = prev.find(s => s.id === id)
      if (!item) return prev
      const rest = prev.filter(s => s.id !== id)
      const pinned = [...rest.filter(s => s.pinned), { ...item, pinned: true, saved: true }]
      const saved = rest.filter(s => !s.pinned && s.saved)
      const temp = rest.filter(s => !s.pinned && !s.saved)
      return [...pinned, ...saved, ...temp]
    })
  }

  function moveSample(fromId: string, toId: string) {
    setSamples(prev => {
      const from = prev.findIndex(s => s.id === fromId)
      const to = prev.findIndex(s => s.id === toId)
      if (from === -1 || to === -1 || from === to) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    if (colorDialogOpen) {
      const px = raycastPixel(e)
      if (px) { const [r,g,b,a] = getPixel(pixelsRef.current, px.x, px.y); if (a > 0) { setColor(rgbaToHex(r,g,b)); addSample(rgbaToHex(r,g,b)) } }
      return
    }
    const t = toolRef.current
    if (t === 'rotate') return

    const px = raycastPixel(e)
    if (!px) return
    if (!isEditablePixel(px.x, px.y, skinModelRef.current)) return

    if (t === 'eyedropper') {
      const [r,g,b,a] = getPixel(pixelsRef.current, px.x, px.y)
      if (a > 0) { const h = rgbaToHex(r,g,b); setColor(h); addSample(h) }
      setTool('pencil')
      return
    }
    if (t === 'darken' || t === 'lighten') {
      pushUndo()
      isDrawingRef.current = true
      lastPxRef.current = px
      applyDarkenLighten(px.x, px.y, t)
      updateTexture(); renderFlat()
      return
    }
    if (t === 'fill') {
      pushUndo()
      const fillColor = hexToRgba(colorRef.current)
      const changed = floodFill(pixelsRef.current, px.x, px.y, fillColor, skinModelRef.current)
      if (mirrorRef.current) {
        for (const p of changed) {
          const mirrored = mirrorPixel(p.x, p.y, skinModelRef.current, filtersRef.current)
          if (mirrored && isEditablePixel(mirrored.x, mirrored.y, skinModelRef.current)) {
            setPixelData(pixelsRef.current, mirrored.x, mirrored.y, fillColor)
          }
        }
      }
      updateTexture(); renderFlat(); addSample(colorRef.current)
      return
    }

    pushUndo()
    isDrawingRef.current = true
    lastPxRef.current = px
    const c: [number,number,number,number] = t==='eraser' ? [0,0,0,0] : hexToRgba(colorRef.current)
    paintPixel(px.x, px.y, c)
    updateTexture(); renderFlat()
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (colorDialogOpen) {
      if (e.buttons !== 1) return
      const px = raycastPixel(e)
      if (px) { const [r,g,b,a] = getPixel(pixelsRef.current, px.x, px.y); if (a > 0) setColor(rgbaToHex(r,g,b)) }
      return
    }
    if (!isDrawingRef.current) return
    const t = toolRef.current
    if (t === 'rotate' || t === 'fill' || t === 'eyedropper') return

    const px = raycastPixel(e)
    if (!px || !isEditablePixel(px.x, px.y, skinModelRef.current)) {
      lastPxRef.current = null
      return
    }
    const last = lastPxRef.current
    if (!last) { lastPxRef.current = px; return }
    if (last.x===px.x && last.y===px.y && last.objectId===px.objectId) return

    if (t === 'darken' || t === 'lighten') {
      if (last.objectId === px.objectId && Math.abs(px.x - last.x) <= 2 && Math.abs(px.y - last.y) <= 2) {
        drawLine(last.x, last.y, px.x, px.y, (lx,ly) => applyDarkenLighten(lx, ly, t))
      } else {
        applyDarkenLighten(px.x, px.y, t)
      }
      lastPxRef.current = px
      updateTexture(); renderFlat()
      return
    }

    const c: [number,number,number,number] = t==='eraser' ? [0,0,0,0] : hexToRgba(colorRef.current)
    if (last.objectId === px.objectId && Math.abs(px.x - last.x) <= 2 && Math.abs(px.y - last.y) <= 2) {
      drawLine(last.x, last.y, px.x, px.y, (lx,ly) => { paintPixel(lx, ly, c) })
    } else {
      paintPixel(px.x, px.y, c)
    }
    lastPxRef.current = px
    updateTexture(); renderFlat()
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (isDrawingRef.current) {
      isDrawingRef.current = false
      lastPxRef.current = null
      addSample(colorRef.current)
    }
    // If rotate and single click (no drag): don't consume
    void e
  }

  // Init

  useEffect(() => {
    const canvas = view3DRef.current
    if (!canvas) return
    const parent = canvas.parentElement!
    const w = parent.clientWidth
    const h = parent.clientHeight

    viewerRef.current?.dispose()
    const v = new skinview3d.SkinViewer({ canvas, width: w, height: h })
    v.autoRotate = false
    v.globalLight.intensity = 3.5
    v.cameraLight.intensity = 1.2
    v.controls.enableRotate = true
    v.controls.enableZoom = true
    v.controls.enablePan = true
    v.controls.minPolarAngle = 0.2
    v.controls.maxPolarAngle = Math.PI - 0.2
    ;(v.controls as any).screenSpacePanning = true
    ;(v.controls as any).mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    }
    viewerRef.current = v
    // Save camera state after skinview3d completes its first render
    requestAnimationFrame(() => { if (v) (v.controls as any).saveState() })

    const state = (location.state ?? {}) as {skinData?:string;skinName?:string;skinModel?:SkinModel}
    if (state.skinName) setSkinName(state.skinName)
    if (state.skinModel) {
      skinModelRef.current = state.skinModel
      setSkinModel(state.skinModel)
    }
    if (state.skinData) {
      base64ToPixels(state.skinData, data => {
        pixelsRef.current = data
        ;(v as any).loadSkin(pixelsToCanvas(data), { model: modelToSkinview(skinModelRef.current) })
        applyFilters(filtersRef.current)
        renderFlat()
      })
    } else {
      pixelsRef.current = createBlankSkin()
      ;(v as any).loadSkin(pixelsToCanvas(pixelsRef.current), { model: modelToSkinview(skinModelRef.current) })
      applyFilters(filtersRef.current)
      renderFlat()
    }

    function syncViewerSize() {
      const pw = parent.clientWidth, ph = parent.clientHeight
      if (pw > 0 && ph > 0) v.setSize(pw, ph)
    }

    // Resize observer
    const ro = new ResizeObserver(syncViewerSize)
    ro.observe(parent)
    window.addEventListener('resize', syncViewerSize)

    return () => { v.dispose(); viewerRef.current = null; ro.disconnect(); window.removeEventListener('resize', syncViewerSize) }
  }, []) // eslint-disable-line

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undoRef.current() }
      if (e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redoRef.current() }
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.key==='b') setTool('pencil')
        if (e.key==='e') setTool('eraser')
        if (e.key==='g') setTool('fill')
        if (e.key==='i') setTool('eyedropper')
        if (e.key==='r') setTool('rotate')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Save / Apply

  async function saveToLibrary(entry: { name: string; model: SkinModel }) {
    setSaving(true); setSaveMsg(null)
    try {
      setSkinName(entry.name)
      setEditorModel(entry.model)
      await window.api.skins.saveToLibrary({ name: entry.name, model: entry.model, data: pixelsToBase64(pixelsRef.current) })
      isDirtyRef.current = false
      setSaveMsg('success')
      setSaveModalOpen(false)
      setTimeout(() => setSaveMsg(null), 3000)
    } catch { setSaveMsg('error') }
    finally { setSaving(false) }
  }

  async function applyToAccount() {
    if (!account?.accessToken) return
    setApplying(true)
    try { await window.api.skins.apply(account.accessToken, pixelsToBase64(pixelsRef.current), skinModel) }
    catch { /* ignore */ }
    finally { setApplying(false) }
  }

  function clearCanvas() {
    pushUndo()
    pixelsRef.current = createBlankSkin()
    updateTexture(); renderFlat()
  }

  // Init

  const TOOLS: { id: Tool; label: string; shortcut: string; icon: React.ReactNode }[] = [
    { id: 'rotate', label: 'Rotar', shortcut: 'R', icon:
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0115-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 01-15 6.7L3 16"/></svg> },
    { id: 'pencil', label: 'Lapiz', shortcut: 'B', icon:
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> },
    { id: 'eraser', label: 'Borrador', shortcut: 'E', icon:
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 20H7L3 16l11-11 6 6-1.5 1.5"/><path d="M6 11l7 7"/></svg> },
    { id: 'fill', label: 'Relleno', shortcut: 'G', icon:
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 11l-8-8-8.5 8.5a5.5 5.5 0 007.78 7.78L19 11z"/><path d="M19 11l3 3"/><circle cx="21.5" cy="18.5" r="2.5"/></svg> },
    { id: 'eyedropper', label: 'Cuentagotas', shortcut: 'I', icon:
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 22l1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="M15 6l3.4-3.4a2 2 0 012.8 2.8L18 9l.9.9a2 2 0 010 2.8l-1 1a2 2 0 01-2.8 0L9 9"/></svg> },
    { id: 'darken', label: 'Oscurecer', shortcut: '+', icon:
      <span className="text-base font-bold leading-none">+</span> },
    { id: 'lighten', label: 'Aclarar', shortcut: '−', icon:
      <span className="text-base font-bold leading-none">−</span> },
  ]

  const cursorMap: Record<Tool, string> = {
    rotate: 'grab', pencil: CURSOR_PAINT, eraser: CURSOR_PAINT,
    fill: CURSOR_PAINT, eyedropper: CURSOR_EYEDROPPER,
    darken: CURSOR_PAINT, lighten: CURSOR_PAINT,
  }

  return (
    <div className="h-full flex flex-col bg-bg-primary overflow-hidden select-none">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-shrink-0 bg-bg-secondary">
        <button onClick={() => isDirtyRef.current ? setConfirmLeaveOpen(true) : navigate('/skins')}
          className="flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors text-sm flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          Volver
        </button>
        <span className="text-border">|</span>
        <input value={skinName} onChange={e => setSkinName(e.target.value)}
          className="bg-transparent text-text-primary font-semibold text-sm outline-none border-b border-transparent focus:border-accent/50 transition-colors px-1 w-36 min-w-0"
          placeholder="Nombre" />
        <select value={skinModel} onChange={e => setEditorModel(e.target.value as SkinModel)}
          className="bg-bg-card border border-border text-text-secondary text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer">
          <option value="classic">Brazos gruesos</option>
          <option value="slim">Brazos delgados</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          {saveMsg==='success' && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              Guardada
            </span>
          )}
          {saveMsg==='error' && <span className="text-xs text-red-400">Error al guardar</span>}
          <button onClick={clearCanvas}
            className="px-3 py-1.5 border border-border hover:border-red-500/40 hover:text-red-400 text-text-muted text-xs rounded-lg transition-colors">
            Limpiar
          </button>
          <button onClick={() => setSaveModalOpen(true)} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border hover:border-accent/40 text-text-secondary hover:text-text-primary text-xs rounded-lg transition-colors disabled:opacity-50">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {saving ? 'Guardando...' : 'Guardar en libreria'}
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left toolbar */}
        <div className="w-12 flex-shrink-0 bg-bg-secondary border-r border-border flex flex-col items-center py-2 gap-0.5">
          <button onClick={openSkinFile}
            title="Abrir skin PNG"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>
          <div className="w-7 h-px bg-border my-1.5" />
          {TOOLS.map(btn => (
            <button key={btn.id} onClick={() => setTool(btn.id)}
              title={`${btn.label} (${btn.shortcut})`}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${tool===btn.id ? 'bg-accent text-white' : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'}`}>
              {btn.icon}
            </button>
          ))}

          <div className="w-7 h-px bg-border my-1.5" />

          <button onClick={() => undoRef.current()} disabled={!canUndo} title="Deshacer (Ctrl+Z)"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-25">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/></svg>
          </button>
          <button onClick={() => redoRef.current()} disabled={!canRedo} title="Rehacer (Ctrl+Y)"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-25">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13"/></svg>
          </button>

          <div className="w-7 h-px bg-border my-1.5" />

          <button
            onClick={() => { const v = viewerRef.current; if (!v) return; (v.controls as any).reset(); v.controls.update() }}
            title="Restablecer vista"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </button>
        </div>

        {/* Center: 3D canvas fills everything */}
        <div className="flex-1 relative min-h-0 min-w-0 overflow-hidden bg-[#0f1117]">
          <canvas
            ref={view3DRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { isDrawingRef.current = false; lastPxRef.current = null }}
            onContextMenu={e => e.preventDefault()}
            style={{ cursor: colorDialogOpen ? CURSOR_EYEDROPPER : cursorMap[tool] }}
            className="w-full h-full block"
          />
          {/* Tool hint overlay */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-sm text-white/60 text-[10px] px-3 py-1 rounded-full pointer-events-none">
            Clic izq · pintar &nbsp;·&nbsp; Clic der · rotar &nbsp;·&nbsp; Rueda · zoom &nbsp;·&nbsp; Rueda presionada · mover
          </div>
        </div>

        {/* Right panel */}
        <div className="w-64 flex-shrink-0 bg-bg-secondary border-l border-border flex flex-col overflow-y-auto">

          {/* Color picker */}
          <div className="p-3 border-b border-border">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">Color</p>
            <div className="flex items-start gap-2 mb-2">
              <button onClick={() => setColorDialogOpen(true)}
                title="Selector de color"
                className="w-12 h-12 border border-white/70 shadow flex-shrink-0"
                style={{ background: color }} />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <input value={color}
                  onChange={e => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setColor(e.target.value) }}
                  className="w-full bg-bg-card border border-border rounded px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent/50 font-mono"
                  maxLength={7} />
                {(['R', 'G', 'B'] as const).map((label, index) => {
                  const rgb = hexToRgb(color)
                  const gradients = [
                    `linear-gradient(to right, rgb(0,${rgb[1]},${rgb[2]}), rgb(255,${rgb[1]},${rgb[2]}))`,
                    `linear-gradient(to right, rgb(${rgb[0]},0,${rgb[2]}), rgb(${rgb[0]},255,${rgb[2]}))`,
                    `linear-gradient(to right, rgb(${rgb[0]},${rgb[1]},0), rgb(${rgb[0]},${rgb[1]},255))`,
                  ]
                  return (
                    <div key={label} className="grid grid-cols-[14px_minmax(70px,1fr)_52px] items-center gap-1.5">
                      <span className="text-[10px] text-text-primary font-mono">{label}</span>
                      <input type="range" min={0} max={255} value={rgb[index]}
                        onChange={e => setRgbChannel(index as 0 | 1 | 2, Number(e.target.value))}
                        className="h-2 appearance-none rounded outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:bg-text-secondary [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/40"
                        style={{ background: gradients[index] }} />
                      <input type="number" min={0} max={255} value={rgb[index]}
                        onChange={e => setRgbChannel(index as 0 | 1 | 2, Number(e.target.value))}
                        className="bg-bg-card border border-border rounded px-1 py-0.5 text-[10px] text-text-primary outline-none focus:border-accent/50 text-right" />
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] font-semibold text-text-muted uppercase tracking-widest">Muestras</p>
                <button onClick={() => setColorDialogOpen(true)}
                  className="text-[10px] text-accent hover:text-accent-hover">
                  Ver todas
                </button>
              </div>
              {samples.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {samples.slice(0, 8).map(s => (
                    <button key={s.id} onClick={() => setColor(s.color)} title={s.color}
                      className={`w-5 h-5 border ${color === s.color ? 'border-white' : 'border-border'}`}
                      style={{ background: s.color }} />
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-text-muted">Sin muestras todavia</p>
              )}
            </div>
          </div>

          <div className="p-3 border-b border-border">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">Espejo</p>
              <button onClick={toggleMirror}
                className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${mirror ? 'border-accent bg-accent/15 text-accent' : 'border-border text-text-muted hover:border-accent/40'}`}
                title="Duplicar entre brazos o piernas visibles">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3v18" />
                  <rect x="4" y="5" width="5" height="14" rx="1" />
                  <path d="M16 5h4v14h-4" strokeDasharray="3 2" />
                </svg>
              </button>
            </div>
          </div>

          <div className="p-3 border-b border-border">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">Cuadricula modelo</p>
              <button onClick={toggleModelGrid}
                className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${showModelGrid ? 'border-accent bg-accent/15 text-accent' : 'border-border text-text-muted hover:border-accent/40'}`}
                title="Mostrar cuadricula sobre el modelo">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>
              </button>
            </div>
          </div>

          {/* Visibility filters */}
          <div className="p-3 border-b border-border">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">Partes</p>
            <div className="grid grid-cols-[1fr_28px_28px] gap-x-1 gap-y-1 items-center">
              <span className="text-[9px] text-text-muted" />
              <span className="text-[9px] text-text-muted text-center">In</span>
              <span className="text-[9px] text-text-muted text-center">Out</span>
              {PARTS.map(part => (
                <div key={part.key} className="contents">
                  <span className="text-[10px] text-text-secondary truncate">{part.label}</span>
                  <button onClick={() => toggleInner(part.key)} title={part.label}
                    className={`w-6 h-6 rounded border flex items-center justify-center transition-colors ${filters[part.key].inner ? 'bg-accent border-accent text-white' : 'border-border text-text-muted hover:border-accent/50'}`}>
                    {filters[part.key].inner && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                  </button>
                  <button onClick={() => toggleOuter(part.key)} title={part.outerLabel}
                    className={`w-6 h-6 rounded border flex items-center justify-center transition-colors ${filters[part.key].outer ? 'bg-accent border-accent text-white' : 'border-border text-text-muted hover:border-accent/50'}`}>
                    {filters[part.key].outer && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Flat UV reference */}
          <div className="p-3 border-b border-border">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">Textura UV</p>
            <canvas ref={flatCanvasRef} width={168} height={168}
              className="w-full rounded border border-border/50"
              style={{ imageRendering: 'pixelated' }} />
          </div>

          {/* Body parts UV navigator */}
          <div className="p-3 flex flex-col gap-0.5">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-1">Regiones UV</p>
            {Object.entries(UV_PARTS).map(([key, part]) => (
              <div key={key} className="flex items-center gap-2 px-1.5 py-1 rounded text-[10px] text-text-muted">
                <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: part.color }} />
                <span>{part.label}</span>
                <span className="ml-auto font-mono opacity-50">{part.x},{part.y}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {confirmLeaveOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setConfirmLeaveOpen(false)}>
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[380px] p-6 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-yellow-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text-primary mb-1">¿Salir sin guardar?</h3>
                <p className="text-xs text-text-secondary leading-relaxed">Tienes cambios sin guardar. Si sales ahora perderás todo el trabajo realizado en esta skin.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmLeaveOpen(false)}
                className="flex-1 py-2 border border-border hover:border-accent/40 rounded-lg text-sm text-text-secondary transition-colors">
                Quedarme
              </button>
              <button onClick={() => navigate('/skins')}
                className="flex-1 py-2 bg-red-500/80 hover:bg-red-500 text-white rounded-lg text-sm transition-colors">
                Salir sin guardar
              </button>
            </div>
          </div>
        </div>
      )}
      {saveModalOpen && (
        <SaveSkinModal
          skinData={pixelsToBase64(pixelsRef.current)}
          initialName={skinName}
          initialModel={skinModel}
          saving={saving}
          onSave={saveToLibrary}
          onClose={() => setSaveModalOpen(false)}
        />
      )}
      {colorDialogOpen && (
        <ColorPickerDialog
          color={color}
          samples={samples}
          onPickSample={setColor}
          onAddSample={addSampleSaved}
          onDeleteSample={deleteSample}
          onSaveSample={saveSample}
          onPinSample={pinSample}
          onMoveSample={moveSample}
          onApply={next => { setColor(next); addSample(next); setColorDialogOpen(false) }}
          onClose={() => setColorDialogOpen(false)}
        />
      )}
    </div>
  )
}
