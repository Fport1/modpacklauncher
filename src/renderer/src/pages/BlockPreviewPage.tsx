import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

type FaceMode = 'single' | 'top-side' | 'top-bottom-side' | 'six'

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

// three.js face order: +X, -X, +Y, -Y, +Z, -Z
const FACE_ORDER: (keyof FaceTextures)[] = ['east', 'west', 'top', 'bottom', 'south', 'north']

const MODE_OPTIONS: { key: FaceMode; label: string; desc: string }[] = [
  { key: 'single',           label: '1 textura',              desc: 'Todas las caras iguales' },
  { key: 'top-side',         label: 'Arriba + Lados',         desc: 'Top distinto, lados iguales' },
  { key: 'top-bottom-side',  label: 'Top + Bottom + Lados',   desc: 'Como el bloque de césped' },
  { key: 'six',              label: '6 texturas',             desc: 'Cada cara independiente' },
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

// Slots needed per mode
const MODE_SLOTS: Record<FaceMode, { key: string; label: string }[]> = {
  'single':          [{ key: 'top',    label: 'Textura' }],
  'top-side':        [{ key: 'top',    label: 'Arriba' }, { key: 'side', label: 'Lados' }],
  'top-bottom-side': [{ key: 'top',    label: 'Arriba' }, { key: 'bottom', label: 'Abajo' }, { key: 'side', label: 'Lados' }],
  'six':             FACE_ORDER.map(k => ({ key: k, label: FACE_LABELS[k] })),
}

export default function BlockPreviewPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const animFrameRef = useRef<number>(0)

  const [mode, setMode] = useState<FaceMode>('single')
  // raw slot textures (dataURLs)
  const [slots, setSlots] = useState<Record<string, string | null>>({
    top: null, bottom: null, side: null,
    north: null, south: null, east: null, west: null
  })
  const [activeSlot, setActiveSlot] = useState<string | null>(null)
  const [autoRotate, setAutoRotate] = useState(false)
  const [bgColor, setBgColor] = useState('#1a1a2e')
  const [wireframe, setWireframe] = useState(false)
  const [pixelated, setPixelated] = useState(true)

  // Init Three.js
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

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.7)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(3, 5, 3)
    scene.add(dir)

    // Grid helper
    const grid = new THREE.GridHelper(10, 10, 0x444466, 0x333355)
    grid.position.y = -0.5
    scene.add(grid)

    // Initial cube (grey placeholder)
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mats = Array(6).fill(null).map(() => new THREE.MeshLambertMaterial({ color: 0x888888, wireframe: false }))
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
      if (!canvas) return
      const w = canvas.clientWidth, h = canvas.clientHeight
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

  // Clipboard paste listener
  useEffect(() => {
    const activeSlotRef = { current: activeSlot }
    activeSlotRef.current = activeSlot

    function onPaste(e: ClipboardEvent) {
      const slot = activeSlotRef.current
      if (!slot) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            const reader = new FileReader()
            reader.onload = ev => {
              setSlots(prev => ({ ...prev, [slot]: ev.target?.result as string ?? null }))
            }
            reader.readAsDataURL(file)
          }
          break
        }
      }
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [activeSlot])

  // Auto-rotate
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate
    if (controlsRef.current) controlsRef.current.autoRotateSpeed = 2
  }, [autoRotate])

  // Background color
  useEffect(() => {
    if (rendererRef.current) rendererRef.current.setClearColor(bgColor, 1)
  }, [bgColor])

  // Wireframe toggle
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    mats.forEach((m: any) => { m.wireframe = wireframe })
  }, [wireframe])

  // Rebuild materials when slots/mode/pixelated change
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

  function loadFile(slotKey: string, file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      setSlots(prev => ({ ...prev, [slotKey]: e.target?.result as string ?? null }))
    }
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
    input.onchange = () => {
      const f = input.files?.[0]
      if (f) loadFile(slotKey, f)
    }
    input.click()
  }

  function resetSlot(slotKey: string) {
    setSlots(prev => ({ ...prev, [slotKey]: null }))
  }

  const slots2 = slots as Record<string, string | null>

  return (
    <div className="flex h-full overflow-hidden bg-bg-primary">
      {/* Left panel */}
      <div className="w-64 flex-shrink-0 border-r border-border flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-border">
          <h1 className="text-base font-bold text-text-primary">Vista previa de bloque</h1>
          <p className="text-xs text-text-muted mt-0.5">Previsualiza texturas en un cubo 3D</p>
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
              const url = slots2[slot.key]
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
                      isActive
                        ? 'border-accent/70 shadow-[0_0_0_2px_rgba(var(--color-accent)/0.15)]'
                        : url
                          ? 'border-border hover:border-accent/30'
                          : 'border-border/50 hover:border-accent/40 bg-bg-card'
                    }`}
                    style={{ imageRendering: 'pixelated' }}
                  >
                    {url ? (
                      <>
                        <img src={url} alt="" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                        <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 hover:opacity-100 transition-opacity bg-black/50">
                          <button onClick={e => { e.stopPropagation(); handlePick(slot.key) }}
                            className="text-[10px] px-2 py-1 bg-bg-card rounded border border-border text-text-primary">
                            Cambiar
                          </button>
                          <button onClick={e => { e.stopPropagation(); resetSlot(slot.key) }}
                            className="text-[10px] px-2 py-1 bg-red-500/20 rounded border border-red-500/30 text-red-400">
                            Quitar
                          </button>
                          {isActive && (
                            <span className="text-[9px] px-2 py-1 bg-accent/20 rounded border border-accent/30 text-accent pointer-events-none">
                              Ctrl+V
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-1 pointer-events-none">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={isActive ? 'text-accent/60' : 'text-text-muted/50'}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        {isActive
                          ? <span className="text-[10px] text-accent/70">Ctrl+V · Click o arrastra</span>
                          : <span className="text-[10px] text-text-muted/50">Click o arrastra</span>
                        }
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Controls */}
        <div className="p-4 flex flex-col gap-3">
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Opciones</p>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-text-secondary">Auto-rotar</span>
            <div onClick={() => setAutoRotate(p => !p)}
              className={`w-9 h-5 rounded-full transition-colors relative ${autoRotate ? 'bg-accent' : 'bg-border'}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoRotate ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-text-secondary">Pixelado</span>
            <div onClick={() => setPixelated(p => !p)}
              className={`w-9 h-5 rounded-full transition-colors relative ${pixelated ? 'bg-accent' : 'bg-border'}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${pixelated ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-text-secondary">Wireframe</span>
            <div onClick={() => setWireframe(p => !p)}
              className={`w-9 h-5 rounded-full transition-colors relative ${wireframe ? 'bg-accent' : 'bg-border'}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${wireframe ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
          </label>

          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Fondo</span>
            <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
              className="w-8 h-6 rounded cursor-pointer border border-border bg-transparent" />
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full block" />
        <div className="absolute bottom-3 right-3 text-[10px] text-text-muted/50 select-none">
          Click + arrastrar para rotar · Scroll para zoom · Click derecho para mover
        </div>
      </div>
    </div>
  )
}
