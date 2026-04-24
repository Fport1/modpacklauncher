import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import * as skinview3d from 'skinview3d'
import * as THREE from 'three'
import { useStore, activeAccount } from '../store'

// ── Types & constants ─────────────────────────────────────────────────────────

type Tool = 'pencil' | 'eraser' | 'fill' | 'eyedropper' | 'rotate'
type SkinModel = 'classic' | 'slim'

const SW = 64
const SH = 64

// SVG cursor: thin precision crosshair
const CURSOR_PAINT = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Cline x1='10' y1='0' x2='10' y2='7' stroke='white' stroke-width='2.5'/%3E%3Cline x1='10' y1='13' x2='10' y2='20' stroke='white' stroke-width='2.5'/%3E%3Cline x1='0' y1='10' x2='7' y2='10' stroke='white' stroke-width='2.5'/%3E%3Cline x1='13' y1='10' x2='20' y2='10' stroke='white' stroke-width='2.5'/%3E%3Cline x1='10' y1='0' x2='10' y2='7' stroke='black' stroke-width='1'/%3E%3Cline x1='10' y1='13' x2='10' y2='20' stroke='black' stroke-width='1'/%3E%3Cline x1='0' y1='10' x2='7' y2='10' stroke='black' stroke-width='1'/%3E%3Cline x1='13' y1='10' x2='20' y2='10' stroke='black' stroke-width='1'/%3E%3Ccircle cx='10' cy='10' r='1.5' fill='white'/%3E%3Ccircle cx='10' cy='10' r='0.8' fill='black'/%3E%3C/svg%3E") 10 10, crosshair`

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
  rightLegOver: { x: 4,  y: 36, w: 4, h: 12, label: 'Pantalón D.', color: '#a78bfa' },
  leftLeg:      { x: 20, y: 52, w: 4, h: 12, label: 'Pierna I.',    color: '#8b5cf6' },
  leftLegOver:  { x: 4,  y: 52, w: 4, h: 12, label: 'Pantalón I.', color: '#a78bfa' },
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 255]
}

function rgbaToHex(r: number, g: number, b: number): string {
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('')
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

function colorsEq(a: [number,number,number,number], b: [number,number,number,number]) {
  return a[0]===b[0] && a[1]===b[1] && a[2]===b[2] && a[3]===b[3]
}

function floodFill(d: Uint8ClampedArray, sx: number, sy: number, fill: [number,number,number,number]) {
  const target = getPixel(d, sx, sy)
  if (colorsEq(target, fill)) return
  const stack: [number,number][] = [[sx, sy]]
  const visited = new Uint8Array(SW * SH)
  while (stack.length) {
    const [x, y] = stack.pop()!
    if (x<0||x>=SW||y<0||y>=SH||visited[y*SW+x]) continue
    if (!colorsEq(getPixel(d, x, y), target)) continue
    visited[y*SW+x] = 1
    setPixelData(d, x, y, fill)
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1])
  }
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function SkinEditorPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const account = useStore(activeAccount)

  // 3D viewer (main editing surface)
  const view3DRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<skinview3d.SkinViewer | null>(null)
  const raycaster = useRef(new THREE.Raycaster())

  // Flat UV reference canvas (right panel)
  const flatCanvasRef = useRef<HTMLCanvasElement>(null)

  // Pixel data
  const pixelsRef = useRef(new Uint8ClampedArray(SW * SH * 4))
  const isDrawingRef = useRef(false)
  const lastPxRef = useRef<{x:number;y:number}|null>(null)

  // Undo/redo
  const undoStack = useRef<Uint8ClampedArray[]>([])
  const redoStack = useRef<Uint8ClampedArray[]>([])

  // Refs for stable callbacks
  const toolRef = useRef<Tool>('pencil')
  const colorRef = useRef('#3b82f6')

  const [tool, setToolState] = useState<Tool>('pencil')
  const [color, setColorState] = useState('#3b82f6')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [recentColors, setRecentColors] = useState<string[]>([])
  const [skinName, setSkinName] = useState('Nueva skin')
  const [skinModel, setSkinModel] = useState<SkinModel>('classic')
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [saveMsg, setSaveMsg] = useState<'success'|'error'|null>(null)

  function setTool(t: Tool) {
    toolRef.current = t
    setToolState(t)
    const v = viewerRef.current
    if (!v) return
    v.controls.enableRotate = t === 'rotate'
    v.controls.enableZoom = t === 'rotate'
    v.controls.enablePan = false
  }

  function setColor(c: string) { colorRef.current = c; setColorState(c) }

  // ── Texture update ────────────────────────────────────────────────────────

  const updateTexture = useCallback(() => {
    const v = viewerRef.current
    if (!v) return
    ;(v as any).loadSkin(pixelsToCanvas(pixelsRef.current))
  }, [])

  // ── Flat UV reference render ──────────────────────────────────────────────

  const renderFlat = useCallback(() => {
    const canvas = flatCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const s = canvas.width / SW // scale factor

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

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 0.5
    for (let x=0;x<=SW;x+=4) { ctx.beginPath();ctx.moveTo(x*s,0);ctx.lineTo(x*s,canvas.height);ctx.stroke() }
    for (let y=0;y<=SH;y+=4) { ctx.beginPath();ctx.moveTo(0,y*s);ctx.lineTo(canvas.width,y*s);ctx.stroke() }
  }, [])

  // ── Raycasting helpers ────────────────────────────────────────────────────

  function getMeshes(): THREE.Mesh[] {
    const v = viewerRef.current
    if (!v) return []
    const meshes: THREE.Mesh[] = []
    v.playerObject.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh)
    })
    return meshes
  }

  function uvToPixel(uv: THREE.Vector2): {x:number;y:number} {
    return {
      x: Math.max(0, Math.min(SW-1, Math.floor(uv.x * SW))),
      y: Math.max(0, Math.min(SH-1, Math.floor((1 - uv.y) * SH))),
    }
  }

  function raycastPixel(e: MouseEvent | React.MouseEvent): {x:number;y:number} | null {
    const v = viewerRef.current
    const canvas = view3DRef.current
    if (!v || !canvas) return null
    const rect = canvas.getBoundingClientRect()
    const ndx = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ndy = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.current.setFromCamera({ x: ndx, y: ndy }, v.camera)
    const hits = raycaster.current.intersectObjects(getMeshes(), false)
    if (!hits.length || !hits[0].uv) return null
    return uvToPixel(hits[0].uv)
  }

  // ── Undo/redo ─────────────────────────────────────────────────────────────

  function pushUndo() {
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

  // ── Mouse handlers on 3D canvas ───────────────────────────────────────────

  function addRecentColor(hex: string) {
    setRecentColors(prev => [hex, ...prev.filter(c=>c!==hex)].slice(0, 12))
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    const t = toolRef.current
    if (t === 'rotate') return

    const px = raycastPixel(e)
    if (!px) return

    if (t === 'eyedropper') {
      const [r,g,b,a] = getPixel(pixelsRef.current, px.x, px.y)
      if (a > 0) { const h = rgbaToHex(r,g,b); setColor(h); addRecentColor(h) }
      setTool('pencil')
      return
    }
    if (t === 'fill') {
      pushUndo()
      floodFill(pixelsRef.current, px.x, px.y, hexToRgba(colorRef.current))
      updateTexture(); renderFlat(); addRecentColor(colorRef.current)
      return
    }

    pushUndo()
    isDrawingRef.current = true
    lastPxRef.current = px
    const c: [number,number,number,number] = t==='eraser' ? [0,0,0,0] : hexToRgba(colorRef.current)
    setPixelData(pixelsRef.current, px.x, px.y, c)
    updateTexture(); renderFlat()
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return
    const t = toolRef.current
    if (t === 'rotate' || t === 'fill' || t === 'eyedropper') return

    const px = raycastPixel(e)
    if (!px) return
    const last = lastPxRef.current
    if (!last || (last.x===px.x && last.y===px.y)) return

    const c: [number,number,number,number] = t==='eraser' ? [0,0,0,0] : hexToRgba(colorRef.current)
    drawLine(last.x, last.y, px.x, px.y, (lx,ly) => setPixelData(pixelsRef.current, lx, ly, c))
    lastPxRef.current = px
    updateTexture(); renderFlat()
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (isDrawingRef.current) {
      isDrawingRef.current = false
      lastPxRef.current = null
      addRecentColor(colorRef.current)
    }
    // If rotate and single click (no drag): don't consume
    void e
  }

  // ── Init ──────────────────────────────────────────────────────────────────

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
    v.controls.enableRotate = false
    v.controls.enableZoom = false
    v.controls.enablePan = false
    v.controls.minPolarAngle = 0.2
    v.controls.maxPolarAngle = Math.PI - 0.2
    viewerRef.current = v

    const state = (location.state ?? {}) as {skinData?:string;skinName?:string;skinModel?:SkinModel}
    if (state.skinName) setSkinName(state.skinName)
    if (state.skinModel) setSkinModel(state.skinModel)
    if (state.skinData) {
      base64ToPixels(state.skinData, data => {
        pixelsRef.current = data
        ;(v as any).loadSkin(pixelsToCanvas(data))
        renderFlat()
      })
    } else {
      renderFlat()
    }

    // Resize observer
    const ro = new ResizeObserver(() => {
      const pw = parent.clientWidth, ph = parent.clientHeight
      if (pw > 0 && ph > 0) v.setSize(pw, ph)
    })
    ro.observe(parent)

    return () => { v.dispose(); viewerRef.current = null; ro.disconnect() }
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

  // ── Save / Apply ──────────────────────────────────────────────────────────

  async function saveToLibrary() {
    setSaving(true); setSaveMsg(null)
    try {
      await window.api.skins.saveToLibrary({ name: skinName, model: skinModel, data: pixelsToBase64(pixelsRef.current) })
      setSaveMsg('success')
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
    pixelsRef.current = new Uint8ClampedArray(SW * SH * 4)
    updateTexture(); renderFlat()
  }

  // ── Tool definitions ──────────────────────────────────────────────────────

  const TOOLS: { id: Tool; label: string; shortcut: string; icon: React.ReactNode }[] = [
    { id: 'rotate', label: 'Rotar', shortcut: 'R', icon:
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0115-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 01-15 6.7L3 16"/></svg> },
    { id: 'pencil', label: 'Lápiz', shortcut: 'B', icon:
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> },
    { id: 'eraser', label: 'Borrador', shortcut: 'E', icon:
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 20H7L3 16l11-11 6 6-1.5 1.5"/><path d="M6 11l7 7"/></svg> },
    { id: 'fill', label: 'Relleno', shortcut: 'G', icon:
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 11l-8-8-8.5 8.5a5.5 5.5 0 007.78 7.78L19 11z"/><path d="M19 11l3 3"/><circle cx="21.5" cy="18.5" r="2.5"/></svg> },
    { id: 'eyedropper', label: 'Cuentagotas', shortcut: 'I', icon:
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 22l1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="M15 6l3.4-3.4a2 2 0 012.8 2.8L18 9l.9.9a2 2 0 010 2.8l-1 1a2 2 0 01-2.8 0L9 9"/></svg> },
  ]

  const cursorMap: Record<Tool, string> = {
    rotate: 'grab', pencil: CURSOR_PAINT, eraser: CURSOR_PAINT,
    fill: CURSOR_PAINT, eyedropper: CURSOR_PAINT,
  }

  return (
    <div className="h-full flex flex-col bg-bg-primary overflow-hidden select-none">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-shrink-0 bg-bg-secondary">
        <button onClick={() => navigate('/skins')}
          className="flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors text-sm flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          Volver
        </button>
        <span className="text-border">|</span>
        <input value={skinName} onChange={e => setSkinName(e.target.value)}
          className="bg-transparent text-text-primary font-semibold text-sm outline-none border-b border-transparent focus:border-accent/50 transition-colors px-1 w-36 min-w-0"
          placeholder="Nombre" />
        <select value={skinModel} onChange={e => setSkinModel(e.target.value as SkinModel)}
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
          <button onClick={saveToLibrary} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border hover:border-accent/40 text-text-secondary hover:text-text-primary text-xs rounded-lg transition-colors disabled:opacity-50">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {saving ? 'Guardando...' : 'Guardar en librería'}
          </button>
        </div>
      </div>

      {/* ── Main ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left toolbar */}
        <div className="w-12 flex-shrink-0 bg-bg-secondary border-r border-border flex flex-col items-center py-2 gap-0.5">
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

          <p className="text-[9px] text-text-muted text-center leading-tight px-1">
            {tool === 'rotate' ? 'Arrastra' : 'Pinta en\nel modelo'}
          </p>
        </div>

        {/* Center: 3D canvas fills everything */}
        <div className="flex-1 relative min-h-0 bg-[#0f1117]">
          <canvas
            ref={view3DRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { isDrawingRef.current = false; lastPxRef.current = null }}
            style={{ cursor: cursorMap[tool] }}
            className="w-full h-full block"
          />
          {/* Tool hint overlay */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-sm text-white/60 text-[10px] px-3 py-1 rounded-full pointer-events-none">
            {tool === 'rotate' ? 'R — Arrastra para rotar' : 'R — cambiar a rotar  ·  clic para pintar'}
          </div>
        </div>

        {/* Right panel */}
        <div className="w-48 flex-shrink-0 bg-bg-secondary border-l border-border flex flex-col overflow-y-auto">

          {/* Color picker */}
          <div className="p-3 border-b border-border">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">Color</p>
            <div className="flex items-center gap-2 mb-2">
              <label className="relative cursor-pointer">
                <input type="color" value={color} onChange={e => setColor(e.target.value)}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                <div className="w-8 h-8 rounded-lg border-2 border-border shadow flex-shrink-0" style={{ background: color }} />
              </label>
              <input value={color}
                onChange={e => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setColor(e.target.value) }}
                className="flex-1 min-w-0 bg-bg-card border border-border rounded-lg px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent/50 font-mono"
                maxLength={7} />
            </div>
            {recentColors.length > 0 && (
              <div className="grid grid-cols-6 gap-1">
                {recentColors.map((c,i) => (
                  <button key={i} onClick={() => setColor(c)} title={c}
                    className={`w-6 h-6 rounded border transition-all ${color===c?'border-accent scale-110':'border-border'}`}
                    style={{ background: c }} />
                ))}
              </div>
            )}
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
    </div>
  )
}
