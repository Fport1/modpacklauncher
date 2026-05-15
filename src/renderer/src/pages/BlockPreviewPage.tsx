import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

type FaceMode = 'single' | 'top-side' | 'top-bottom-side' | 'six'
type EditorTool = 'pencil' | 'eraser' | 'fill' | 'eyedropper'

interface FaceTextures {
  top: string | null
  bottom: string | null
  north: string | null
  south: string | null
  east: string | null
  west: string | null
}

interface SlotTextures extends FaceTextures {
  side: string | null
}

const FACE_LABELS: Record<keyof FaceTextures, string> = {
  top: 'Arriba', bottom: 'Abajo',
  north: 'Norte', south: 'Sur',
  east: 'Este', west: 'Oeste'
}

const FACE_ORDER: (keyof FaceTextures)[] = ['east', 'west', 'top', 'bottom', 'south', 'north']

const MODE_OPTIONS: { key: FaceMode; label: string; desc: string }[] = [
  { key: 'single',          label: '1 textura',            desc: 'Todas las caras iguales' },
  { key: 'top-side',        label: 'Arriba + Lados',       desc: 'Top distinto, lados iguales' },
  { key: 'top-bottom-side', label: 'Top + Bottom + Lados', desc: 'Como el bloque de césped' },
  { key: 'six',             label: '6 texturas',           desc: 'Cada cara independiente' },
]

function facesForMode(mode: FaceMode, s: SlotTextures): FaceTextures {
  const { top, bottom, side, north, south, east, west } = s
  switch (mode) {
    case 'single':
      return { top, bottom: top, north: top, south: top, east: top, west: top }
    case 'top-side':
      return { top, bottom: side ?? top, north: side ?? top, south: side ?? top, east: side ?? top, west: side ?? top }
    case 'top-bottom-side':
      return { top, bottom: bottom ?? side ?? top, north: side ?? top, south: side ?? top, east: side ?? top, west: side ?? top }
    case 'six':
      return { top, bottom, north, south, east, west }
  }
}

const MODE_SLOTS: Record<FaceMode, { key: string; label: string }[]> = {
  'single':          [{ key: 'top',    label: 'Textura' }],
  'top-side':        [{ key: 'top',    label: 'Arriba' }, { key: 'side', label: 'Lados' }],
  'top-bottom-side': [{ key: 'top',    label: 'Arriba' }, { key: 'bottom', label: 'Abajo' }, { key: 'side', label: 'Lados' }],
  'six':             FACE_ORDER.map(k => ({ key: k, label: FACE_LABELS[k] })),
}

const EDITOR_SIZES = [8, 16, 32, 64]

const DEFAULT_PALETTE = [
  '#ffffff','#000000','#7b4a2d','#4a7b2d','#2d4a7b',
  '#7b2d4a','#7b7b2d','#2d7b7b','#888888','#555555',
  '#ff5555','#55ff55','#5555ff','#ffff55','#ff55ff',
]

function hexToRgba(hex: string): [number,number,number,number] {
  const h = hex.replace('#','')
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('')
}

export default function BlockPreviewPage() {
  // --- Three.js refs ---
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const animFrameRef = useRef<number>(0)

  // --- Preview state ---
  const [mode, setMode] = useState<FaceMode>('single')
  const [slots, setSlots] = useState<Record<string, string | null>>({
    top: null, bottom: null, side: null,
    north: null, south: null, east: null, west: null
  })
  const [activeSlot, setActiveSlot] = useState<string | null>(null)
  const [autoRotate, setAutoRotate] = useState(false)
  const [bgColor, setBgColor] = useState('#1a1a2e')
  const [wireframe, setWireframe] = useState(false)
  const [pixelated, setPixelated] = useState(true)
  const [saveMsg, setSaveMsg] = useState<'ok' | 'empty' | null>(null)

  // --- Editor state ---
  const [editingSlot, setEditingSlot] = useState<string | null>(null)
  const [editSize, setEditSize] = useState(16)
  const [editorTool, setEditorTool] = useState<EditorTool>('pencil')
  const [editorColor, setEditorColor] = useState('#7b4a2d')
  const [palette, setPalette] = useState<string[]>(DEFAULT_PALETTE)
  const editorCanvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawingRef = useRef(false)
  const lastPxRef = useRef<{x:number,y:number}|null>(null)

  // ---- Three.js init ----
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100)
    camera.position.set(2.5, 2, 2.5)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 1.5
    controls.maxDistance = 10
    controlsRef.current = controls

    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(3, 5, 3)
    scene.add(dir)

    const grid = new THREE.GridHelper(10, 10, 0x444466, 0x333355)
    grid.position.y = -0.5
    scene.add(grid)

    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mats = Array(6).fill(null).map(() => new THREE.MeshLambertMaterial({ color: 0x888888 }))
    const mesh = new THREE.Mesh(geo, mats)
    scene.add(mesh)
    meshRef.current = mesh

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(canvas)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      ro.disconnect()
      renderer.dispose()
    }
  }, [])

  // Paste listener
  useEffect(() => {
    const slotRef = { current: activeSlot }
    slotRef.current = activeSlot
    function onPaste(e: ClipboardEvent) {
      const slot = slotRef.current
      if (!slot) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            const reader = new FileReader()
            reader.onload = ev => setSlots(prev => ({ ...prev, [slot]: ev.target?.result as string ?? null }))
            reader.readAsDataURL(file)
          }
          break
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [activeSlot])

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate
      controlsRef.current.autoRotateSpeed = 2
    }
  }, [autoRotate])

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.setClearColor(bgColor, 1)
  }, [bgColor])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    mats.forEach((m: any) => { m.wireframe = wireframe })
  }, [wireframe])

  // Rebuild materials
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const resolved = facesForMode(mode, slots as SlotTextures)
    const loader = new THREE.TextureLoader()
    const oldMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const newMats: THREE.MeshLambertMaterial[] = FACE_ORDER.map(face => {
      const url = resolved[face]
      if (!url) return new THREE.MeshLambertMaterial({ color: 0x888888, wireframe })
      const tex = loader.load(url)
      tex.colorSpace = THREE.SRGBColorSpace
      if (pixelated) {
        tex.magFilter = THREE.NearestFilter
        tex.minFilter = THREE.NearestFilter
      } else {
        tex.magFilter = THREE.LinearFilter
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.generateMipmaps = true
      }
      return new THREE.MeshLambertMaterial({ map: tex, wireframe })
    })
    mesh.material = newMats
    oldMats.forEach((m: any) => m.dispose())
  }, [slots, mode, wireframe, pixelated])

  // Load texture into editor canvas when entering edit mode
  useEffect(() => {
    if (!editingSlot) return
    const canvas = editorCanvasRef.current
    if (!canvas) return
    canvas.width = editSize
    canvas.height = editSize
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, editSize, editSize)
    const url = (slots as Record<string, string | null>)[editingSlot]
    if (url) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, editSize, editSize)
      img.src = url
    }
  }, [editingSlot, editSize])

  // ---- File helpers ----
  function loadFile(slotKey: string, file: File) {
    const reader = new FileReader()
    reader.onload = e => setSlots(prev => ({ ...prev, [slotKey]: e.target?.result as string ?? null }))
    reader.readAsDataURL(file)
  }
  function handleDrop(slotKey: string, e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) loadFile(slotKey, file)
  }
  function handlePick(slotKey: string) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => { const f = input.files?.[0]; if (f) loadFile(slotKey, f) }
    input.click()
  }
  function resetSlot(slotKey: string) {
    setSlots(prev => ({ ...prev, [slotKey]: null }))
  }

  // ---- Editor helpers ----
  function getEditorPx(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = editorCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(editSize - 1, Math.floor((e.clientX - rect.left) * (editSize / rect.width)))),
      y: Math.max(0, Math.min(editSize - 1, Math.floor((e.clientY - rect.top) * (editSize / rect.height)))),
    }
  }

  function applyEditorTool(x: number, y: number) {
    const canvas = editorCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    if (editorTool === 'pencil') {
      ctx.fillStyle = editorColor
      ctx.fillRect(x, y, 1, 1)
    } else if (editorTool === 'eraser') {
      ctx.clearRect(x, y, 1, 1)
    } else if (editorTool === 'eyedropper') {
      const d = ctx.getImageData(x, y, 1, 1).data
      if (d[3] > 0) {
        const hex = rgbToHex(d[0], d[1], d[2])
        setEditorColor(hex)
        addToPalette(hex)
      }
      setEditorTool('pencil')
    }
  }

  function floodFill(startX: number, startY: number) {
    const canvas = editorCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const w = canvas.width, h = canvas.height
    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data
    const idx = (x: number, y: number) => (y * w + x) * 4
    const si = idx(startX, startY)
    const tr = data[si], tg = data[si+1], tb = data[si+2], ta = data[si+3]
    const [fr, fg, fb, fa] = hexToRgba(editorColor)
    if (tr === fr && tg === fg && tb === fb && ta === fa) return
    const matches = (x: number, y: number) => {
      const i = idx(x, y)
      return data[i]===tr && data[i+1]===tg && data[i+2]===tb && data[i+3]===ta
    }
    const fill = (x: number, y: number) => {
      const i = idx(x, y)
      data[i]=fr; data[i+1]=fg; data[i+2]=fb; data[i+3]=fa
    }
    const stack: [number,number][] = [[startX, startY]]
    fill(startX, startY)
    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!
      for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]] as [number,number][]) {
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && matches(nx, ny)) {
          fill(nx, ny); stack.push([nx, ny])
        }
      }
    }
    ctx.putImageData(imageData, 0, 0)
  }

  function bresenhamDraw(ax: number, ay: number, bx: number, by: number) {
    const dx = Math.abs(bx-ax), dy = Math.abs(by-ay)
    const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1
    let err = dx - dy, cx = ax, cy = ay
    while (true) {
      applyEditorTool(cx, cy)
      if (cx === bx && cy === by) break
      const e2 = 2 * err
      if (e2 > -dy) { err -= dy; cx += sx }
      if (e2 < dx) { err += dx; cy += sy }
    }
  }

  function handleEditorMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    isDrawingRef.current = true
    lastPxRef.current = null
    const { x, y } = getEditorPx(e)
    if (editorTool === 'fill') { floodFill(x, y); commitEditorToSlot(); return }
    applyEditorTool(x, y)
    lastPxRef.current = { x, y }
  }

  function handleEditorMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current || editorTool === 'fill' || editorTool === 'eyedropper') return
    const { x, y } = getEditorPx(e)
    const last = lastPxRef.current
    if (last && (last.x !== x || last.y !== y)) {
      bresenhamDraw(last.x, last.y, x, y)
    } else {
      applyEditorTool(x, y)
    }
    lastPxRef.current = { x, y }
  }

  function handleEditorMouseUp() {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    lastPxRef.current = null
    commitEditorToSlot()
  }

  function commitEditorToSlot() {
    const canvas = editorCanvasRef.current
    if (canvas && editingSlot) {
      setSlots(prev => ({ ...prev, [editingSlot]: canvas.toDataURL('image/png') }))
    }
  }

  function doneEditing() {
    commitEditorToSlot()
    setEditingSlot(null)
    isDrawingRef.current = false
    lastPxRef.current = null
  }

  function addToPalette(hex: string) {
    setPalette(prev => [hex, ...prev.filter(c => c !== hex)].slice(0, 30))
  }

  // ---- Save to folder ----
  async function saveTexturesToFolder() {
    const slotRec = slots as Record<string, string | null>
    const files: { name: string; dataUrl: string }[] = []
    for (const slot of MODE_SLOTS[mode]) {
      const url = slotRec[slot.key]
      if (url) files.push({ name: `${slot.key}.png`, dataUrl: url })
    }
    if (files.length === 0) { setSaveMsg('empty'); setTimeout(() => setSaveMsg(null), 2000); return }
    const folder = await window.api.textures.saveToFolder(files)
    if (folder) { setSaveMsg('ok'); setTimeout(() => setSaveMsg(null), 2500) }
  }

  const slotRec = slots as Record<string, string | null>

  // ======================== JSX ========================
  const editorDisplayPx = Math.min(512, editSize * Math.max(4, Math.floor(480 / editSize)))
  const currentSlotLabel = editingSlot
    ? (MODE_SLOTS[mode].find(s => s.key === editingSlot)?.label ?? editingSlot)
    : ''

  const TOOL_BTNS: { key: EditorTool; icon: React.ReactNode; title: string }[] = [
    {
      key: 'pencil', title: 'Lápiz (P)',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
    },
    {
      key: 'eraser', title: 'Borrador (E)',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 20H7L3 16l13-13 6 6-2 2"/></svg>
    },
    {
      key: 'fill', title: 'Relleno (F)',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2H5a2 2 0 00-2 2v2"/></svg>
    },
    {
      key: 'eyedropper', title: 'Cuentagotas (I)',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21l4-4"/><path d="M14.5 4.5l5 5-10 10-5-5 10-10z"/></svg>
    },
  ]

  return (
    <div className="flex h-full overflow-hidden bg-bg-primary">

      {/* ===== LEFT PANEL (switches between preview controls and editor tools) ===== */}
      {editingSlot ? (
        /* Editor tools panel */
        <div className="w-52 flex-shrink-0 border-r border-border flex flex-col overflow-y-auto bg-bg-secondary">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <button onClick={doneEditing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/80 transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Listo
            </button>
            <button onClick={() => setEditingSlot(null)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:text-text-primary transition-colors">
              Cancelar
            </button>
          </div>

          <div className="p-3 border-b border-border">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Cara: {currentSlotLabel}</p>
            <div className="flex flex-wrap gap-1">
              {MODE_SLOTS[mode].map(s => (
                <button key={s.key} onClick={() => setEditingSlot(s.key)}
                  className={`text-[10px] px-2 py-1 rounded border transition-colors ${editingSlot === s.key ? 'bg-accent/20 border-accent/40 text-accent' : 'border-border text-text-secondary hover:border-accent/30'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 border-b border-border">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Herramientas</p>
            <div className="grid grid-cols-4 gap-1">
              {TOOL_BTNS.map(t => (
                <button key={t.key} title={t.title} onClick={() => setEditorTool(t.key)}
                  className={`flex items-center justify-center h-8 rounded border transition-colors ${editorTool === t.key ? 'bg-accent/20 border-accent/40 text-accent' : 'border-border text-text-secondary hover:border-accent/30 hover:text-text-primary'}`}>
                  {t.icon}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 border-b border-border">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Color</p>
            <div className="flex items-center gap-2 mb-2">
              <input type="color" value={editorColor}
                onChange={e => { setEditorColor(e.target.value); addToPalette(e.target.value) }}
                className="w-8 h-8 rounded cursor-pointer border border-border bg-transparent flex-shrink-0" />
              <input type="text" value={editorColor}
                onChange={e => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { setEditorColor(e.target.value); addToPalette(e.target.value) } }}
                className="flex-1 text-xs bg-bg-card border border-border rounded px-2 py-1 text-text-primary font-mono" />
            </div>
            <div className="grid grid-cols-5 gap-1">
              {palette.map((c, i) => (
                <button key={i} title={c} onClick={() => setEditorColor(c)}
                  className={`w-7 h-7 rounded border-2 transition-colors ${editorColor === c ? 'border-accent' : 'border-transparent hover:border-border'}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>

          <div className="p-3 border-b border-border">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Tamaño canvas</p>
            <div className="flex gap-1 flex-wrap">
              {EDITOR_SIZES.map(s => (
                <button key={s} onClick={() => setEditSize(s)}
                  className={`text-[10px] px-2 py-1 rounded border transition-colors ${editSize === s ? 'bg-accent/20 border-accent/40 text-accent' : 'border-border text-text-secondary hover:border-accent/30'}`}>
                  {s}px
                </button>
              ))}
            </div>
          </div>

          <div className="p-3">
            <p className="text-[10px] text-text-muted/60">P lápiz · E borrador · F relleno · I cuentagotas</p>
          </div>
        </div>
      ) : (
        /* Preview left panel */
        <div className="w-64 flex-shrink-0 border-r border-border flex flex-col overflow-y-auto">
          <div className="p-4 border-b border-border">
            <h1 className="text-base font-bold text-text-primary">Vista previa de bloque</h1>
            <p className="text-xs text-text-muted mt-0.5">Previsualiza y edita texturas en 3D</p>
          </div>

          {/* Mode selector */}
          <div className="p-4 border-b border-border">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Modo de caras</p>
            <div className="flex flex-col gap-1.5">
              {MODE_OPTIONS.map(o => (
                <button key={o.key} onClick={() => setMode(o.key)}
                  className={`flex flex-col text-left px-3 py-2 rounded-xl border transition-colors ${mode === o.key ? 'bg-accent/10 border-accent/40 text-accent' : 'border-border text-text-secondary hover:border-border/80 hover:bg-bg-hover'}`}>
                  <span className="text-xs font-semibold">{o.label}</span>
                  <span className="text-[10px] text-text-muted mt-0.5">{o.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Texture slots */}
          <div className="p-4 border-b border-border">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-3">Texturas</p>
            <div className="flex flex-col gap-3">
              {MODE_SLOTS[mode].map(slot => {
                const url = slotRec[slot.key]
                const isActive = activeSlot === slot.key
                return (
                  <div key={slot.key}>
                    <p className="text-[10px] text-text-muted mb-1 flex items-center gap-1.5">
                      {slot.label}
                      {isActive && <span className="text-accent/70 text-[9px] font-medium">● activo</span>}
                    </p>
                    <div
                      tabIndex={0}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleDrop(slot.key, e)}
                      onClick={() => { setActiveSlot(slot.key); if (!url) handlePick(slot.key) }}
                      onFocus={() => setActiveSlot(slot.key)}
                      className={`relative w-full h-16 rounded-xl border-2 border-dashed transition-colors flex items-center justify-center overflow-hidden cursor-pointer outline-none ${
                        isActive ? 'border-accent/70' : url ? 'border-border hover:border-accent/30' : 'border-border/50 hover:border-accent/40 bg-bg-card'
                      }`}
                      style={{ imageRendering: 'pixelated' }}
                    >
                      {url ? (
                          <>
                            <img src={url} alt="" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                            <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 hover:opacity-100 transition-opacity bg-black/50">
                              <button onClick={e => { e.stopPropagation(); setEditingSlot(slot.key) }}
                                className="text-[10px] px-2 py-1 bg-accent/20 rounded border border-accent/40 text-accent">
                                Editar
                              </button>
                              <button onClick={e => { e.stopPropagation(); handlePick(slot.key) }}
                                className="text-[10px] px-2 py-1 bg-bg-card rounded border border-border text-text-primary">
                                Cambiar
                              </button>
                              <button onClick={e => { e.stopPropagation(); resetSlot(slot.key) }}
                                className="text-[10px] px-2 py-1 bg-red-500/20 rounded border border-red-500/30 text-red-400">
                                Quitar
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center gap-1 pointer-events-none">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                              className={isActive ? 'text-accent/60' : 'text-text-muted/50'}>
                              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                            </svg>
                            {isActive
                              ? <span className="text-[10px] text-accent/70">Ctrl+V · Click o arrastra</span>
                              : <span className="text-[10px] text-text-muted/50">Click o arrastra</span>
                            }
                          </div>
                        )}
                      </div>
                      {!url && (
                        <button onClick={() => setEditingSlot(slot.key)}
                          className="mt-1 w-full text-[10px] py-1 rounded border border-border/50 text-text-muted hover:border-accent/30 hover:text-accent transition-colors">
                          + Crear nueva textura
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Options */}
            <div className="p-4 flex flex-col gap-3 border-b border-border">
              <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Opciones</p>
              {[
                { label: 'Auto-rotar', val: autoRotate, set: setAutoRotate },
                { label: 'Pixelado', val: pixelated, set: setPixelated },
                { label: 'Wireframe', val: wireframe, set: setWireframe },
              ].map(({ label, val, set }) => (
                <label key={label} className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs text-text-secondary">{label}</span>
                  <div onClick={() => set(p => !p)}
                    className={`w-9 h-5 rounded-full transition-colors relative ${val ? 'bg-accent' : 'bg-border'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${val ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </label>
              ))}
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">Fondo</span>
                <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                  className="w-8 h-6 rounded cursor-pointer border border-border bg-transparent" />
              </div>
            </div>

            {/* Save */}
            <div className="p-4">
              <button onClick={saveTexturesToFolder}
                className="w-full py-2 rounded-xl bg-accent/10 border border-accent/30 text-accent text-xs font-semibold hover:bg-accent/20 transition-colors flex items-center justify-center gap-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Guardar texturas
              </button>
              {saveMsg === 'ok' && <p className="text-[10px] text-green-400 text-center mt-1">Guardado correctamente</p>}
              {saveMsg === 'empty' && <p className="text-[10px] text-amber-400 text-center mt-1">No hay texturas para guardar</p>}
            </div>
          </div>
      )}

      {/* ===== PIXEL ART CANVAS (editor mode center) ===== */}
      {editingSlot && (
        <div className="flex-1 flex items-center justify-center overflow-auto"
          style={{ background: '#0d0d1a', backgroundImage: 'repeating-conic-gradient(#1a1a2e 0% 25%, #141428 0% 50%) 0 0 / 20px 20px' }}>
          <canvas
            ref={editorCanvasRef}
            width={editSize}
            height={editSize}
            style={{
              width: editorDisplayPx,
              height: editorDisplayPx,
              imageRendering: 'pixelated',
              cursor: 'crosshair',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.1)',
            }}
            onMouseDown={handleEditorMouseDown}
            onMouseMove={handleEditorMouseMove}
            onMouseUp={handleEditorMouseUp}
            onMouseLeave={handleEditorMouseUp}
          />
        </div>
      )}

      {/* ===== 3D CANVAS — always mounted, size changes with mode ===== */}
      <div className={editingSlot
        ? 'w-56 flex-shrink-0 border-l border-border flex flex-col'
        : 'flex-1 relative overflow-hidden'
      }>
        {editingSlot && (
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest p-2 border-b border-border flex-shrink-0">
            Vista previa
          </p>
        )}
        <div className="flex-1 relative overflow-hidden">
          <canvas ref={canvasRef} className="w-full h-full block" />
          {!editingSlot && (
            <div className="absolute bottom-3 right-3 text-[10px] text-text-muted/50 select-none">
              Click + arrastrar para rotar · Scroll para zoom · Click derecho para mover
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
