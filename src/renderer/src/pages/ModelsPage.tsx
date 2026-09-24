import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUrlState } from '../lib/urlState'
import ModelEditor, { type EditorSelection } from '../components/ModelEditor'
import type { BoneHandles } from '../lib/bedrockGeo'
import {
  applyBoneOverrides, applyGeoOverride, cubeKey, effectiveOverride, hasBundledOverride, pruneOverride,
  type GeoOverride, type OverrideFile
} from '../lib/modelOverrides'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { AssetEntry, AssetSource } from '@shared/types'
import {
  resolveModel,
  buildBlockModel,
  buildItemComposite,
  makeTextureLoader,
  loadImage,
  imageToTexture,
  b64ToText,
  parseAnimMeta,
  animFrameAt,
  type TextureAnim,
  type AssetReader,
  type ResolvedModel,
} from '../lib/mcmodel'
import {
  loadVanillaGeometries,
  findGeometry,
  geometryCandidatesForTexture,
  buildBedrockModel,
  parseGeoJson,
  type Geometry,
} from '../lib/bedrockGeo'
import { isJemModel, buildJemModel } from '../lib/jemModel'
import { loadVanillaAnims, animsForMob, tickerFor, isPoseAnim, type AnimSet, type BedrockAnim } from '../lib/bedrockAnim'

// ─── 3D viewer ───────────────────────────────────────────────────────────────

export interface ViewerGizmo {
  target: THREE.Object3D
  mode: 'translate' | 'rotate'
  /** Al empezar a arrastrar: momento de anotar desde dónde se parte. */
  onStart: () => void
  /** Al soltar las flechas, con el objeto ya movido. */
  onCommit: () => void
}

function ModelViewer({ object, autoRotate, frameKey, gizmo }: {
  object: THREE.Object3D | null
  autoRotate: boolean
  /** Solo se reencuadra la cámara cuando cambia. Sin él, en cada objeto nuevo. */
  frameKey?: string
  /** Flechas para mover o girar una pieza con el ratón, en el editor. */
  gizmo?: ViewerGizmo | null
}) {
  const lastFrameKey = useRef<string | undefined>(undefined)
  // Encuadre del sujeto actual. Se calcula una vez por mob y se reutiliza al
  // reconstruirlo: si se recalculara con cada ajuste del editor, recentrar y
  // reescalar compensaría el propio movimiento y parecería que nada se mueve.
  const fitRef = useRef<{ s: number; center: THREE.Vector3; gridY: number } | null>(null)
  const gizmoRef = useRef<ViewerGizmo | null | undefined>(gizmo)
  // Mientras se arrastra, el animador no toca los huesos: en cada fotograma
  // los devuelve a su pose y desharía el arrastre antes de pintarlo.
  const draggingRef = useRef(false)
  gizmoRef.current = gizmo
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    transform: TransformControls
    holder: THREE.Group
    grid: THREE.GridHelper
  } | null>(null)
  const animRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    // updateStyle=false keeps the canvas sized by CSS (w-full/h-full) so it
    // follows the container when the window is resized or maximized
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    renderer.setClearColor('#14141f', 1)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 100)
    // Models (blocks and mobs) face north (−z), so the camera looks from the front
    camera.position.set(1.9, 1.5, -2.5)

    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 1
    controls.maxDistance = 12
    controls.autoRotateSpeed = 2.5

    // Mostly-flat lighting like in-game entity rendering (soft directional accent)
    scene.add(new THREE.AmbientLight(0xffffff, 1.15))
    const dir = new THREE.DirectionalLight(0xffffff, 0.45)
    dir.position.set(3, 5, 2)
    scene.add(dir)
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.25)
    dir2.position.set(-3, 2, -4)
    scene.add(dir2)

    const grid = new THREE.GridHelper(6, 12, 0x444466, 0x2c2c48)
    grid.position.y = -0.75
    scene.add(grid)

    const holder = new THREE.Group()
    scene.add(holder)

    const transform = new TransformControls(camera, canvas)
    transform.setSize(0.9)
    // Mientras se arrastran las flechas, la cámara no debe girar
    transform.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value
      controls.enabled = !dragging
      draggingRef.current = dragging
      if (dragging) gizmoRef.current?.onStart()
      else gizmoRef.current?.onCommit()
    })
    scene.add(transform)

    stateRef.current = { renderer, scene, camera, controls, transform, holder, grid }

    const animate = () => {
      animRef.current = requestAnimationFrame(animate)
      controls.update()
      const now = performance.now()
      // Bone animations (mob walk/idle) — ticker attached by the mobs tab
      if (!draggingRef.current) {
        for (const child of holder.children) {
          const tick = child.userData.tick as ((nowMs: number) => void) | undefined
          tick?.(now)
        }
      }
      // Advance animated textures (fire, water, magma… via .mcmeta)
      holder.traverse(o => {
        const mesh = o as THREE.Mesh
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
        for (const m of mats) {
          const map = (m as THREE.MeshLambertMaterial).map
          const anim = map?.userData?.anim as TextureAnim | undefined
          if (map && anim) map.offset.y = 1 - (animFrameAt(anim, now) + 1) * anim.frameHNorm
        }
      })
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(canvas.parentElement ?? canvas)

    return () => {
      cancelAnimationFrame(animRef.current)
      ro.disconnect()
      transform.dispose()
      controls.dispose()
      renderer.dispose()
      stateRef.current = null
    }
  }, [])

  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    // Reencuadrar solo con un sujeto nuevo: al editar, el mismo mob se
    // reconstruye en cada ajuste y perder el ángulo de vista cada vez hace
    // imposible afinar nada.
    const newSubject = frameKey === undefined || frameKey !== lastFrameKey.current
    lastFrameKey.current = frameKey
    if (newSubject) {
      st.camera.position.set(1.9, 1.5, -2.5)
      st.controls.target.set(0, 0, 0)
      st.controls.update()
      fitRef.current = null
    }
    // Las flechas se sueltan antes de retirar el modelo al que están enganchadas
    st.transform.detach()
    // remove + dispose previous object
    for (const child of [...st.holder.children]) {
      st.holder.remove(child)
      child.traverse(o => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
        mats.forEach(m => { (m as THREE.MeshLambertMaterial).map?.dispose(); m.dispose() })
      })
    }
    if (!object) return

    // Fit to a ~1.5 unit box centered at origin — una vez por sujeto
    if (!fitRef.current) {
      const box = new THREE.Box3().setFromObject(object)
      const size = new THREE.Vector3()
      const center = new THREE.Vector3()
      box.getSize(size)
      box.getCenter(center)
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      const s = 1.5 / maxDim
      fitRef.current = { s, center, gridY: (box.min.y - center.y) * s - 0.02 }
    }
    const { s, center, gridY } = fitRef.current
    // multiply (not set): bone-hierarchy models carry their own 1/16 root scale
    object.scale.multiplyScalar(s)
    object.position.set(-center.x * s, -center.y * s, -center.z * s)
    st.grid.position.y = gridY
    st.holder.add(object)
  }, [object])

  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    if (gizmo) {
      st.transform.attach(gizmo.target)
      st.transform.setMode(gizmo.mode)
      // Al girar, ejes propios de la pieza: en ejes del mundo un giro sobre uno
      // solo acaba repartido entre los tres ángulos del hueso
      st.transform.setSpace(gizmo.mode === 'rotate' ? 'local' : 'world')
    } else {
      st.transform.detach()
    }
  }, [gizmo?.target, gizmo?.mode])

  useEffect(() => {
    const st = stateRef.current
    if (st) st.controls.autoRotate = autoRotate
  }, [autoRotate])

  return <canvas ref={canvasRef} className="w-full h-full block" />
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const QUICK_LINKS = [
  { label: 'Raíz', dir: 'assets' },
  { label: 'Bloques', dir: 'assets/minecraft/models/block' },
  { label: 'Items', dir: 'assets/minecraft/models/item' },
  { label: 'Texturas bloque', dir: 'assets/minecraft/textures/block' },
  { label: 'Texturas item', dir: 'assets/minecraft/textures/item' },
  { label: 'Entidades', dir: 'assets/minecraft/textures/entity' },
]

// ── Source picker: instance first, then pack/mod with Modrinth icon + name ──

export interface ProjectInfo { name: string | null; iconUrl: string | null }

const srcInstanceId = (s: AssetSource) => s.id.split(':')[1]
const srcFilename = (s: AssetSource) => s.id.split(':').slice(2).join(':')

function SourcePicker({ title, emptyLabel, sources, instances, value, onChange, loadInfo }: {
  title: string
  emptyLabel: string
  sources: AssetSource[]
  instances: { id: string; name: string }[]
  value: string
  onChange: (id: string) => void
  loadInfo: (instanceId: string) => Promise<Record<string, ProjectInfo>>
}) {
  const [open, setOpen] = useState(false)
  const [instId, setInstId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [info, setInfo] = useState<Record<string, ProjectInfo> | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)

  const withItems = instances.filter(i => sources.some(s => srcInstanceId(s) === i.id))
  const current = sources.find(s => s.id === value)
  const currentName = current ? (info?.[srcFilename(current)]?.name ?? current.label) : emptyLabel

  async function enterInstance(id: string) {
    setInstId(id)
    setQ('')
    setInfo(null)
    setLoadingInfo(true)
    try { setInfo(await loadInfo(id)) } catch { setInfo({}) }
    setLoadingInfo(false)
  }

  function openPanel() {
    setOpen(o => !o)
    setInstId(null)
    setQ('')
    // single instance → skip straight to its items
    if (!open && withItems.length === 1) void enterInstance(withItems[0].id)
  }

  const pick = (id: string) => { onChange(id); setOpen(false) }

  const items = instId ? sources.filter(s => srcInstanceId(s) === instId) : []
  const query = q.trim().toLowerCase()
  const shown = items.filter(s => {
    if (!query) return true
    const name = info?.[srcFilename(s)]?.name ?? ''
    return s.label.toLowerCase().includes(query) || name.toLowerCase().includes(query)
  })

  return (
    <div className="relative">
      <button onClick={openPanel}
        className="bg-bg-secondary border border-border rounded-md px-2 py-1 text-text-primary max-w-[180px] truncate text-left hover:border-accent/60 transition-colors">
        <span className="text-text-muted">{title}:</span> {currentName}
        <span className="text-text-muted ml-1">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-80 max-h-96 flex flex-col bg-bg-secondary border border-border rounded-xl shadow-2xl overflow-hidden">
            {instId === null ? (
              <>
                <div className="px-3 py-2 border-b border-border text-[11px] font-semibold text-text-primary">Elige una instancia</div>
                <div className="flex-1 overflow-y-auto p-1 text-xs">
                  {value !== '' && (
                    <button onClick={() => pick('')}
                      className="w-full text-left px-2 py-1.5 rounded text-text-muted hover:bg-bg-primary">
                      ✕ Quitar selección ({emptyLabel})
                    </button>
                  )}
                  {withItems.length === 0 && <div className="px-2 py-3 text-text-muted">Ninguna instancia tiene {title.toLowerCase()}s</div>}
                  {withItems.map(i => (
                    <button key={i.id} onClick={() => enterInstance(i.id)}
                      className="w-full text-left px-2 py-1.5 rounded text-text-primary hover:bg-bg-primary flex items-center justify-between gap-2">
                      <span className="truncate">{i.name}</span>
                      <span className="text-text-muted shrink-0">
                        {sources.filter(s => srcInstanceId(s) === i.id).length} ›
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="p-2 border-b border-border space-y-2">
                  <div className="flex items-center gap-2 text-[11px]">
                    <button onClick={() => setInstId(null)} className="text-text-muted hover:text-accent">‹ Instancias</button>
                    <span className="text-text-primary font-medium truncate">{instances.find(i => i.id === instId)?.name}</span>
                  </div>
                  <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={`Buscar ${title.toLowerCase()}...`}
                    className="w-full bg-bg-primary border border-border rounded-md px-2 py-1 text-xs text-text-primary placeholder:text-text-muted/50 outline-none focus:border-accent/60" />
                </div>
                <div className="flex-1 overflow-y-auto p-1 text-xs">
                  {loadingInfo && <div className="px-2 py-1.5 text-[10px] text-text-muted">Buscando nombres e iconos en Modrinth…</div>}
                  {shown.length === 0 && !loadingInfo && <div className="px-2 py-3 text-text-muted">Sin resultados</div>}
                  {shown.map(s => {
                    const meta = info?.[srcFilename(s)]
                    return (
                      <button key={s.id} onClick={() => pick(s.id)}
                        className={`w-full text-left px-2 py-1 rounded flex items-center gap-2 ${value === s.id ? 'bg-accent/20 text-accent' : 'text-text-primary hover:bg-bg-primary'}`}>
                        {meta?.iconUrl
                          ? <img src={meta.iconUrl} alt="" className="w-6 h-6 rounded shrink-0 object-cover" style={{ imageRendering: 'pixelated' }} />
                          : <span className="w-6 h-6 rounded shrink-0 bg-bg-primary border border-border flex items-center justify-center text-[10px] text-text-muted">?</span>}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{meta?.name ?? s.label}</span>
                          {meta?.name && <span className="block truncate text-[10px] text-text-muted">{s.label}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** 'assets/minecraft/models/block' + 'stone.json' → 'minecraft:block/stone' */
function dirFileToModelRef(dir: string, filename: string): string | null {
  const m = dir.match(/^assets\/([^/]+)\/models(?:\/(.*))?$/)
  if (!m) return null
  const ns = m[1]
  const sub = m[2] ? `${m[2]}/` : ''
  return `${ns}:${sub}${filename.replace(/\.json$/i, '')}`
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/** Version labels like "1.21.4" are releases; snapshots/pre/rc/loader ids are not */
const isReleaseVersion = (label: string) => /^\d+\.\d+(\.\d+)?$/.test(label)

/** Geometries in the dataset that aren't mobs (items, projectiles, overlay parts…) */
const NON_MOB_GEOS = /^(bed|arrow|bow.*|crossbow.*|fishing_hook|experience_orb|fireball|fireworks_rocket|llama_?spit|shulker_bullet|evocation_fang|wither_skull|dragon_head|player_head|skull.*|banner.*|shield.*|trident.*|elytra|lead_knot|leash_knot|breeze_wind.*|happy_ghast_ropes|.*_eyes|spyglass|cape|humanoid.*|quadruped|item_sprite|mob_head|tripod_camera|harness|spear|wind_charge|lavaslime|nautilus_saddle)$/

/** Dataset keys → canonical Java names (drives texture lookup and display) */
const GEO_RENAMES: Record<string, string> = {
  pigzombie: 'zombified_piglin',
  villagerzombie: 'zombie_villager',
  irongolem: 'iron_golem',
  snowgolem: 'snow_golem',
  witherBoss: 'wither',
  skeleton_stray: 'stray',
  skeleton_bogged: 'bogged',
  skeleton_wither: 'wither_skeleton',
  zombie_husk: 'husk',
  zombie_drowned: 'drowned',
  donkeymule: 'donkey',
  tropicalfish_a: 'tropical_a',
  tropicalfish_b: 'tropical_b',
  villager_witch: 'witch',
}

/** Extra texture folders under textures/entity/ to search per canonical name */
const TEXTURE_DIR_ALIASES: Record<string, string[]> = {
  cod: ['fish'], salmon: ['fish'], tropical_a: ['fish'], tropical_b: ['fish'],
  pufferfish_large: ['fish'], pufferfish_mid: ['fish'], pufferfish_small: ['fish'],
  evoker: ['illager'], pillager: ['illager'], vindicator: ['illager'], vex: ['illager'], ravager: ['illager'], illusioner: ['illager'],
  magma_cube: ['slime'],
  mooshroom: ['cow'],
  donkey: ['horse'], mule: ['horse'],
  husk: ['zombie'], drowned: ['zombie'],
  stray: ['skeleton'], bogged: ['skeleton'], wither_skeleton: ['skeleton'], parched: ['skeleton'],
  zombified_piglin: ['piglin'],
  dragon: ['enderdragon'],
  ender_crystal: ['end_crystal'],
  polarbear: ['bear'],
  ocelot: ['cat'],
  happy_ghast: ['ghast'],
}

const mobLabel = (n: string): string => {
  const baby = n.endsWith('_baby')
  let base = n.replace(/_baby$/, '').replace(/_v\d+$/, '')
  base = (GEO_RENAMES[base] ?? base).replace(/_/g, ' ')
  return baby ? `${base} (bebé)` : base
}

/** Human labels for known villager-style overlay folders */
const GROUP_LABELS: Record<string, string> = {
  type: 'Bioma',
  profession: 'Profesión',
  profession_level: 'Nivel (insignia)',
  markings: 'Marcas',
}

const LIST_PAGE_SIZE = 400

type Preview =
  | { kind: 'none' }
  | { kind: 'loading'; path: string }
  | { kind: 'model3d'; path: string; group: THREE.Group; model: ResolvedModel; missing: string[] }
  | { kind: 'item2d'; path: string; dataUrl: string; size: number; layers: string[] }
  | { kind: 'image'; path: string; dataUrl: string; w: number; h: number; anim?: TextureAnim | null }
  | { kind: 'entity3d'; path: string; group: THREE.Group; geoName: string; dataUrl: string; w: number; h: number; flat: boolean; emissive?: string | null }
  | { kind: 'geo3d'; path: string; group: THREE.Group; geoName: string; textured: boolean }
  | { kind: 'text'; path: string; text: string }
  | { kind: 'error'; path: string; message: string }

/** Flat texture preview with a play button when the texture is an animated strip. */
function TexturePreview({ dataUrl, w, h, anim }: { dataUrl: string; w: number; h: number; anim?: TextureAnim | null }) {
  const [playing, setPlaying] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => { setPlaying(false) }, [dataUrl])

  useEffect(() => {
    if (!playing || !anim) return
    const img = new Image()
    img.src = dataUrl
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      if (!canvas || !img.complete) return
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      const frame = animFrameAt(anim, performance.now())
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      // Frames are stacked vertically, each w×w px
      ctx.drawImage(img, 0, frame * w, w, w, 0, 0, canvas.width, canvas.height)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [playing, anim, dataUrl, w])

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 overflow-auto">
      {playing && anim ? (
        <canvas ref={canvasRef} width={256} height={256}
          className="border border-border rounded" style={{ imageRendering: 'pixelated', width: 256, height: 256 }} />
      ) : (
        <img src={dataUrl} alt=""
          className="max-w-[70%] max-h-[60vh] object-contain border border-border rounded"
          style={{ imageRendering: 'pixelated', minWidth: 128 }} />
      )}
      {anim && (
        <button onClick={() => setPlaying(p => !p)}
          className="px-3 py-1 rounded-md border border-border text-xs text-text-primary hover:border-accent/60 hover:text-accent transition-colors">
          {playing ? '⏸ Pausar' : '▶ Reproducir animación'}
        </button>
      )}
      <div className="text-[11px] text-text-muted">
        {w}×{h}px{anim ? ` · ${anim.frameCount} frames · ${anim.frametime} ticks/frame` : ''}
      </div>
    </div>
  )
}

/** Composites texture layers (base + overlays like villager biome/profession) onto one canvas. */
async function compositeLayers(
  readAsset: AssetReader,
  paths: string[]
): Promise<{ tex: THREE.Texture; w: number; h: number; dataUrl: string } | null> {
  const imgs: HTMLImageElement[] = []
  for (const p of paths) {
    const b64 = await readAsset(p)
    if (!b64) continue
    try { imgs.push(await loadImage(b64)) } catch { /* skip broken */ }
  }
  if (imgs.length === 0) return null
  const w = Math.max(...imgs.map(i => i.width))
  const h = Math.max(...imgs.map(i => i.height))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  for (const img of imgs) ctx.drawImage(img, 0, 0, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  return { tex, w, h, dataUrl: canvas.toDataURL() }
}

const TEXT_EXTS = ['.json', '.mcmeta', '.txt', '.properties', '.lang', '.vsh', '.fsh', '.glsl']

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ModelsPage() {
  // En la URL para que las flechas del raton recorran las pestañas
  const [tab, setTab] = useUrlState<'explorer' | 'mobs'>('tab', 'explorer')
  const [sources, setSources] = useState<{ versions: AssetSource[]; packs: AssetSource[]; mods: AssetSource[] }>({ versions: [], packs: [], mods: [] })
  const [selVersion, setSelVersion] = useState('')
  const [selPack, setSelPack] = useState('')
  const [autoRotate, setAutoRotate] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [instances, setInstances] = useState<{ id: string; name: string }[]>([])
  const infoCache = useRef(new Map<string, Record<string, ProjectInfo>>())

  // Explorer state
  const [dir, setDir] = useUrlState<string>('dir', 'assets/minecraft/models/block', 'replace')
  const [entries, setEntries] = useState<AssetEntry[]>([])
  const [filter, setFilter] = useState('')
  const [loadingList, setLoadingList] = useState(false)
  const [maxShown, setMaxShown] = useState(LIST_PAGE_SIZE)
  const [preview, setPreview] = useState<Preview>({ kind: 'none' })

  // Mobs state
  const [geoData, setGeoData] = useState<Record<string, Geometry> | null>(null)
  const [mobSearch, setMobSearch] = useState('')
  const [selMobName, setSelMobName] = useUrlState<string>('mob', 'creeper', 'replace')
  // base: root textures (radio, one active) · groups: subdirs like villager type/profession (single-choice selects)
  // emissive: *_eyes.png / *_e.png overlays rendered fullbright ('' = off)
  const [mobTex, setMobTex] = useState<{
    base: string[]
    sel: string
    groups: { dir: string; options: string[]; sel: string }[]
    emissive: string[]
    emissiveSel: string
  }>({ base: [], sel: '', groups: [], emissive: [], emissiveSel: '' })
  const [mobGroup, setMobGroup] = useState<THREE.Group | null>(null)
  // Ingredientes del modelo, separados del modelo en sí: al editar se
  // reconstruye en cada ajuste y no hace falta volver a leer las texturas.
  const [mobBuild, setMobBuild] = useState<{
    name: string
    geo: Geometry
    comp: { tex: THREE.Texture; w: number; h: number; dataUrl: string } | null
    em: { tex: THREE.Texture } | null
  } | null>(null)
  const [editing, setEditing] = useState(false)
  const [editSel, setEditSel] = useState<EditorSelection | null>(null)
  const [userOverrides, setUserOverrides] = useState<OverrideFile>({})
  const [savingOverrides, setSavingOverrides] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>('translate')
  // Deshacer/rehacer del editor: cada cambio guarda cómo estaba todo antes
  const [history, setHistory] = useState<{ past: OverrideFile[]; future: OverrideFile[] }>({ past: [], future: [] })
  const [mobError, setMobError] = useState<string | null>(null)
  // Animations (bedrock keyframes + molang)
  const [animData, setAnimData] = useState<AnimSet | null>(null)
  const [selAnim, setSelAnim] = useState('')
  const [animPlaying, setAnimPlaying] = useState(false)

  // ── Sources ──
  useEffect(() => {
    window.api.assets.sources().then(s => {
      setSources(s)
      // Default to the newest release; fall back to whatever is first
      const firstRelease = s.versions.find(v => isReleaseVersion(v.label))
      if (s.versions.length > 0) setSelVersion(prev => prev || (firstRelease ?? s.versions[0]).id)
    }).catch(() => {})
    window.api.instances.list().then(list =>
      setInstances(list.map(i => ({ id: i.id, name: i.name })))
    ).catch(() => {})
  }, [])

  /** Modrinth name+icon per file, cached per instance for the session */
  const loadInfoFor = useCallback((type: 'pack' | 'mod') => async (instanceId: string) => {
    const key = `${type}:${instanceId}`
    const cached = infoCache.current.get(key)
    if (cached) return cached
    const rec = await window.api.modrinth.getInstalledInfo(
      instanceId,
      type === 'pack' ? 'resourcepacks' : 'mods',
      type === 'pack' ? ['.zip'] : ['.jar']
    )
    infoCache.current.set(key, rec)
    return rec
  }, [])

  /** Reads with resource-pack priority and vanilla fallback. */
  const readAsset = useCallback<AssetReader>(async (path: string) => {
    if (selPack) {
      const fromPack = await window.api.assets.read(selPack, path)
      if (fromPack !== null) return fromPack
    }
    if (selVersion) return window.api.assets.read(selVersion, path)
    return null
  }, [selPack, selVersion])

  /** Lists a directory merging pack + vanilla entries. */
  const listUnion = useCallback(async (dirPath: string): Promise<AssetEntry[]> => {
    const [fromPack, fromJar] = await Promise.all([
      selPack ? window.api.assets.list(selPack, dirPath).catch(() => []) : Promise.resolve([] as AssetEntry[]),
      selVersion ? window.api.assets.list(selVersion, dirPath).catch(() => []) : Promise.resolve([] as AssetEntry[]),
    ])
    const map = new Map<string, AssetEntry>()
    for (const e of [...fromPack, ...fromJar]) if (!map.has(e.name)) map.set(e.name, e)
    return [...map.values()].sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)))
  }, [selPack, selVersion])

  // ── Directory listing (union of pack + vanilla) ──
  useEffect(() => {
    if (!selVersion && !selPack) return
    let alive = true
    setLoadingList(true)
    setMaxShown(LIST_PAGE_SIZE)
    ;(async () => {
      const [fromPack, fromJar] = await Promise.all([
        selPack ? window.api.assets.list(selPack, dir).catch(() => []) : Promise.resolve([] as AssetEntry[]),
        selVersion ? window.api.assets.list(selVersion, dir).catch(() => []) : Promise.resolve([] as AssetEntry[]),
      ])
      if (!alive) return
      const map = new Map<string, AssetEntry>()
      for (const e of [...fromPack, ...fromJar]) if (!map.has(e.name)) map.set(e.name, e)
      const merged = [...map.values()].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setEntries(merged)
      setLoadingList(false)
    })()
    return () => { alive = false }
  }, [dir, selVersion, selPack])

  // ── File preview ──
  async function openFile(name: string) {
    const filePath = `${dir}/${name}`
    setPreview({ kind: 'loading', path: filePath })
    try {
      const lower = name.toLowerCase()

      // OptiFine CEM models from resource packs (assets/minecraft/optifine/cem/*.jem)
      if (lower.endsWith('.jem') || lower.endsWith('.jpm')) {
        const b64 = await readAsset(filePath)
        if (!b64) throw new Error('No se pudo leer el archivo')
        const jem = JSON.parse(b64ToText(b64))
        if (isJemModel(jem)) {
          const stem = name.replace(/\.(jem|jpm)$/i, '')
          // Texture: the jem's own "texture" field, or the vanilla entity texture by name
          let comp: Awaited<ReturnType<typeof compositeLayers>> = null
          const texCands: string[] = []
          if (typeof jem.texture === 'string') {
            const t = jem.texture.replace(/^\.\//, '').replace(/\.png$/, '')
            texCands.push(`${dir}/${t}.png`, `assets/minecraft/${t.replace(/^minecraft[:/]/, '')}.png`)
          }
          texCands.push(
            `assets/minecraft/textures/entity/${stem}/${stem}.png`,
            `assets/minecraft/textures/entity/${stem}.png`
          )
          for (const cand of texCands) {
            comp = await compositeLayers(readAsset, [cand])
            if (comp) break
          }
          const group = buildJemModel(jem, comp?.tex ?? null, comp?.w, comp?.h)
          setPreview({ kind: 'geo3d', path: filePath, group, geoName: `${stem} (CEM)`, textured: !!comp })
          return
        }
      }

      // GeckoLib/bedrock geometry files inside mod jars (assets/<ns>/geo/*.geo.json)
      if (lower.endsWith('.geo.json')) {
        const b64 = await readAsset(filePath)
        if (!b64) throw new Error('No se pudo leer el archivo')
        const parsed = parseGeoJson(JSON.parse(b64ToText(b64)))
        const names = Object.keys(parsed)
        if (names.length > 0) {
          const geoName = names[0]
          // GeckoLib convention: texture usually mirrors the geo filename
          const ns = filePath.match(/^assets\/([^/]+)\//)?.[1] ?? 'minecraft'
          const stem = name.replace(/\.geo\.json$/i, '')
          let comp: Awaited<ReturnType<typeof compositeLayers>> = null
          for (const cand of [
            `assets/${ns}/textures/entity/${stem}.png`,
            `assets/${ns}/textures/entity/${geoName}.png`,
            `assets/${ns}/textures/${stem}.png`,
          ]) {
            comp = await compositeLayers(readAsset, [cand])
            if (comp) break
          }
          const group = buildBedrockModel(parsed[geoName], comp?.tex ?? null, comp?.w, comp?.h)
          setPreview({ kind: 'geo3d', path: filePath, group, geoName, textured: !!comp })
          return
        }
      }

      if (lower.endsWith('.json') && /\/models(\/|$)/.test(dir)) {
        const ref = dirFileToModelRef(dir, name)
        if (ref) {
          const model = await resolveModel(readAsset, ref)
          if (model.isGenerated || (model.elements.length === 0 && Object.keys(model.textures).length > 0)) {
            const comp = await buildItemComposite(readAsset, model)
            if (comp) {
              setPreview({ kind: 'item2d', path: filePath, dataUrl: comp.dataUrl, size: comp.width, layers: comp.layers })
              return
            }
          }
          if (model.elements.length > 0) {
            const { group, missingTextures } = await buildBlockModel(model, makeTextureLoader(readAsset))
            setPreview({ kind: 'model3d', path: filePath, group, model, missing: missingTextures })
            return
          }
          if (model.isEntityBuiltin) {
            setPreview({ kind: 'error', path: filePath, message: 'Este modelo usa geometría integrada en el juego (builtin/entity): cofres, carteles, cabezas… No hay JSON de geometría que renderizar.' })
            return
          }
        }
      }

      if (lower.endsWith('.png')) {
        const b64 = await readAsset(filePath)
        if (!b64) throw new Error('No se pudo leer la textura')
        const img = await loadImage(b64)
        const dataUrl = `data:image/png;base64,${b64}`
        // Animation metadata (fire, water, magma…)
        let anim: TextureAnim | null = null
        const metaB64 = await readAsset(`${filePath}.mcmeta`).catch(() => null)
        if (metaB64) {
          try { anim = parseAnimMeta(JSON.parse(b64ToText(metaB64)), img.width, img.height) } catch { /* bad mcmeta */ }
        }
        // Entity textures render as the in-game model when we know the geometry
        if (/textures\/entity\//.test(filePath)) {
          try {
            const data = geoData ?? await loadVanillaGeometries()
            if (!geoData) setGeoData(data)
            for (const cand of geometryCandidatesForTexture(filePath)) {
              const found = findGeometry(data, cand)
              if (found) {
                // Auto-detect the matching emissive overlay (enderman_eyes, _e.png…)
                let emissiveTex: THREE.Texture | null = null
                let emissiveName: string | null = null
                const stemPath = filePath.replace(/\.png$/, '')
                for (const emPath of [`${stemPath}_eyes.png`, `${stemPath}_e.png`]) {
                  const emB64 = await readAsset(emPath).catch(() => null)
                  if (emB64) {
                    try {
                      emissiveTex = imageToTexture(await loadImage(emB64))
                      emissiveName = emPath.split('/').pop()!
                      break
                    } catch { /* skip broken */ }
                  }
                }
                const group = buildBedrockModel(found.geo, imageToTexture(img, anim), img.width, img.height, emissiveTex)
                setPreview({ kind: 'entity3d', path: filePath, group, geoName: found.name, dataUrl, w: img.width, h: img.height, flat: false, emissive: emissiveName })
                return
              }
            }
          } catch { /* fall back to flat preview */ }
        }
        setPreview({ kind: 'image', path: filePath, dataUrl, w: img.width, h: img.height, anim })
        return
      }

      if (TEXT_EXTS.some(ext => lower.endsWith(ext))) {
        const b64 = await readAsset(filePath)
        if (b64 === null) throw new Error('No se pudo leer el archivo')
        setPreview({ kind: 'text', path: filePath, text: b64ToText(b64) })
        return
      }

      setPreview({ kind: 'error', path: filePath, message: 'Este tipo de archivo no tiene previsualización.' })
    } catch (e) {
      setPreview({ kind: 'error', path: filePath, message: (e as Error).message })
    }
  }

  // ── Mobs: dataset + texture discovery + build ──
  useEffect(() => {
    if (tab !== 'mobs' || geoData) return
    loadVanillaGeometries().then(setGeoData).catch(() => setMobError('No se pudo cargar la geometría'))
    loadVanillaAnims().then(setAnimData).catch(() => {})
  }, [tab, geoData])

  // Reset animation selection when switching mob
  useEffect(() => {
    setSelAnim('')
    setAnimPlaying(false)
  }, [selMobName])

  // Attach the animation ticker: pose animations always applied + the selected one
  useEffect(() => {
    if (!mobGroup) return
    const available = animData ? animsForMob(animData, selMobName) : {}
    const anims: BedrockAnim[] = []
    for (const [name, a] of Object.entries(available)) {
      if (isPoseAnim(name) && name !== selAnim) anims.push(a)
    }
    if (selAnim && available[selAnim]) anims.push(available[selAnim])
    mobGroup.userData.tick = tickerFor(mobGroup, anims, animPlaying)
  }, [mobGroup, animData, selMobName, selAnim, animPlaying])

  // Discover available textures for the selected mob (variants, biomes, professions…)
  useEffect(() => {
    if (tab !== 'mobs' || (!selVersion && !selPack)) return
    let alive = true
    ;(async () => {
      const isBaby = /_baby$/.test(selMobName)
      const rawCore = selMobName.replace(/_baby$/, '').replace(/_v\d+$/, '')
      const core = GEO_RENAMES[rawCore] ?? rawCore
      const segs = core.split('_')
      // Prefix chains (sulfur_cube_small → sulfur_cube → sulfur) + segment heuristics + aliases
      const prefixes = segs.map((_, i) => segs.slice(0, i + 1).join('_')).reverse()
      const dirCands = [...new Set([
        core,
        ...(TEXTURE_DIR_ALIASES[core] ?? []),
        ...prefixes,
        segs.length > 1 ? segs[segs.length - 1] : '',
        segs.length > 1 ? [...segs].reverse().join('_') : '',
      ].filter(Boolean))]

      const base: string[] = []
      const emissive: string[] = []
      const groups: { dir: string; options: string[]; sel: string }[] = []
      const isEmissiveFile = (f: string) => /_eyes\.png$|_e\.png$|_armor\.png$|_wind\.png$/.test(f)
      for (const d of dirCands) {
        const root = `assets/minecraft/textures/entity/${d}`
        const top = await listUnion(root)
        if (top.length === 0) continue
        for (const e of top) {
          if (!e.isDir && e.name.endsWith('.png')) {
            ;(isEmissiveFile(e.name) ? emissive : base).push(`${root}/${e.name}`)
          }
          if (e.isDir) {
            const sub = await listUnion(`${root}/${e.name}`)
            const options = sub.filter(s => !s.isDir && s.name.endsWith('.png')).map(s => `${root}/${e.name}/${s.name}`)
            if (options.length > 0) groups.push({ dir: e.name, options, sel: '' })
          }
        }
        if (base.length > 0 || groups.length > 0) break
      }
      // Root-level file (chicken.png, armadillo.png…)
      if (base.length === 0 && groups.length === 0) {
        for (const f of [core, ...dirCands]) {
          const p = `assets/minecraft/textures/entity/${f}.png`
          if (await readAsset(p)) { base.push(p); break }
        }
      }
      if (!alive) return

      // Horse-style markings share the folder with the base colors — split them
      // into their own single-choice overlay group
      const markings = base.filter(p => /_markings/.test(p))
      if (markings.length > 0) {
        for (const m of markings) base.splice(base.indexOf(m), 1)
        groups.push({ dir: 'markings', options: markings, sel: '' })
      }

      // Overlay order as in game: biome type first, then profession, then badge
      const groupOrder = (dir: string) => dir === 'type' ? 0 : dir === 'profession' ? 1 : dir === 'profession_level' ? 2 : 3
      groups.sort((a, b) => groupOrder(a.dir) - groupOrder(b.dir))

      // Best default base texture (babies prefer *_baby.png, adults avoid it).
      // Comparison ignores underscores so magma_cube ↔ magmacube match.
      const norm = (s: string) => s.replace(/_/g, '')
      const nCore = norm(core)
      const score = (p: string) => {
        const f = p.split('/').pop()!.replace('.png', '')
        const nf = norm(f)
        let s = 10
        if (nf === nCore || f === selMobName) s -= 10
        else if (nf === norm(`temperate_${core}`)) s -= 8
        else if (nf === norm([...segs].reverse().join('_'))) s -= 8
        else if (nf.includes(nCore) || nCore.includes(nf)) s -= 4
        const hasBaby = f.includes('baby')
        if (hasBaby !== isBaby) s += 20
        else if (isBaby) s -= 6
        return s
      }
      const sorted = [...base].sort((a, b) => score(a) - score(b))
      // Emissive default: pick the overlay matching the mob name (on by default, like in-game)
      const emSorted = [...emissive].sort((a, b) => {
        const fa = a.split('/').pop()!
        const fb = b.split('/').pop()!
        return (fa.startsWith(core) ? 0 : 1) - (fb.startsWith(core) ? 0 : 1)
      })
      setMobTex({ base, sel: sorted[0] ?? '', groups, emissive, emissiveSel: emSorted[0] ?? '' })
    })()
    return () => { alive = false }
  }, [tab, selMobName, listUnion, readAsset, selVersion, selPack])

  // Build the mob model from geometry + base texture + selected overlays
  useEffect(() => {
    if (tab !== 'mobs' || !geoData) return
    let alive = true
    setMobError(null)
    ;(async () => {
      try {
        const found = findGeometry(geoData, selMobName)
        if (!found) { setMobError('Geometría no encontrada'); setMobGroup(null); setMobBuild(null); return }
        const paths = [mobTex.sel, ...mobTex.groups.map(g => g.sel)].filter(Boolean)
        const [comp, em] = await Promise.all([
          paths.length > 0 ? compositeLayers(readAsset, paths) : Promise.resolve(null),
          mobTex.emissiveSel ? compositeLayers(readAsset, [mobTex.emissiveSel]) : Promise.resolve(null),
        ])
        if (!alive) return
        if (!comp) setMobError('Textura no encontrada para este mob en la versión seleccionada')
        setMobBuild({ name: found.name, geo: found.geo, comp, em })
      } catch (e) {
        if (alive) setMobError((e as Error).message)
      }
    })()
    return () => { alive = false }
  }, [tab, geoData, selMobName, mobTex, readAsset])

  // Ajustes guardados del usuario
  useEffect(() => {
    window.api.modelOverrides.get()
      .then((data) => setUserOverrides(data as OverrideFile))
      .catch(() => {})
  }, [])

  // Al cambiar de mob, la selección del editor ya no aplica
  useEffect(() => { setEditSel(null) }, [selMobName])

  // Modelo final: geometría + ajustes + resaltado del editor
  useEffect(() => {
    if (!mobBuild) return
    const ov = effectiveOverride(userOverrides, mobBuild.name)
    let highlight: Set<string> | undefined
    if (editing && editSel) {
      const bone = mobBuild.geo.bones.find((b) => b.name === editSel.bone)
      highlight = new Set(
        editSel.kind === 'cube'
          ? [cubeKey(editSel.bone, editSel.index)]
          : (bone?.cubes ?? []).map((_, i) => cubeKey(editSel.bone, i))
      )
    }
    const group = buildBedrockModel(
      applyGeoOverride(mobBuild.geo, ov),
      mobBuild.comp?.tex ?? null, mobBuild.comp?.w, mobBuild.comp?.h,
      mobBuild.em?.tex ?? null, highlight
    )
    applyBoneOverrides(group, ov)
    setMobGroup(group)
  }, [mobBuild, userOverrides, editing, editSel])

  /** Guarda con un pequeño retraso: un clic en "+" no debe escribir a disco cada vez. */
  function persistOverrides(next: OverrideFile): void {
    setUserOverrides(next)
    setSavingOverrides(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.api.modelOverrides.set(next as Record<string, unknown>)
        .finally(() => setSavingOverrides(false))
    }, 400)
  }

  /** Guarda un estado nuevo apuntando el anterior para poder deshacerlo. */
  function commitOverrides(next: OverrideFile): void {
    setHistory((h) => ({ past: [...h.past.slice(-99), userOverrides], future: [] }))
    persistOverrides(next)
  }

  function undoOverride(): void {
    const prev = history.past[history.past.length - 1]
    if (!prev) return
    setHistory((h) => ({ past: h.past.slice(0, -1), future: [...h.future, userOverrides] }))
    persistOverrides(prev)
  }

  function redoOverride(): void {
    const next = history.future[history.future.length - 1]
    if (!next) return
    setHistory((h) => ({ past: [...h.past, userOverrides], future: h.future.slice(0, -1) }))
    persistOverrides(next)
  }

  function updateMobOverride(next: GeoOverride): void {
    if (!mobBuild) return
    const copy = { ...userOverrides }
    // Sin nada que ajustar se guarda un objeto vacío, no se borra la clave:
    // borrarla haría reaparecer los ajustes de la app para este mob.
    copy[mobBuild.name] = pruneOverride(next) ?? {}
    commitOverrides(copy)
  }

  function resetMobOverride(): void {
    if (!mobBuild) return
    const copy = { ...userOverrides }
    delete copy[mobBuild.name]
    commitOverrides(copy)
  }

  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undoOverride() }
      else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redoOverride() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Lo más reciente, para leerlo desde el callback de las flechas sin que se
  // quede con una versión vieja entre reconstrucciones
  const latest = useRef({ userOverrides, updateMobOverride })
  latest.current = { userOverrides, updateMobOverride }

  /** Medio píxel en posición y grado entero en giro: como se construyen los modelos. */
  const snapPx = (v: number): number => Math.round(v * 2) / 2
  const snapDeg = (v: number): number => Math.round(v)

  const gizmo = useMemo<ViewerGizmo | null>(() => {
    if (!editing || !editSel || !mobGroup || !mobBuild) return null
    const geoName = mobBuild.name
    const current = (): GeoOverride => effectiveOverride(latest.current.userOverrides, geoName)

    if (editSel.kind === 'bone') {
      const bones = mobGroup.userData.bones as Map<string, BoneHandles> | undefined
      const h = bones?.get(editSel.bone.toLowerCase())
      if (!h) return null
      const startPos = new THREE.Vector3()
      const startRot = new THREE.Euler()
      return {
        target: h.outer,
        mode: gizmoMode,
        onStart: () => {
          startPos.copy(h.outer.position)
          startRot.copy(h.outer.rotation)
        },
        onCommit: () => {
          const ov = current()
          const prev = ov.bones?.[editSel.bone] ?? {}
          const next = { ...prev }
          if (gizmoMode === 'translate') {
            const d = h.outer.position.clone().sub(startPos)
            const o = prev.offset ?? [0, 0, 0]
            next.offset = [snapPx(o[0] + d.x), snapPx(o[1] + d.y), snapPx(o[2] + d.z)]
          } else {
            const r = prev.rotation ?? [0, 0, 0]
            const DEG = 180 / Math.PI
            next.rotation = [
              snapDeg(r[0] + (h.outer.rotation.x - startRot.x) * DEG),
              snapDeg(r[1] + (h.outer.rotation.y - startRot.y) * DEG),
              snapDeg(r[2] + (h.outer.rotation.z - startRot.z) * DEG)
            ]
          }
          latest.current.updateMobOverride({ ...ov, bones: { ...ov.bones, [editSel.bone]: next } })
        }
      }
    }

    // Cubo: solo mover. Sus vértices van fundidos en la malla del hueso, así
    // que las flechas mueven un asa en su centro y al soltar se reconstruye.
    const handles = mobGroup.userData.cubeHandles as Map<string, THREE.Group> | undefined
    const key = cubeKey(editSel.bone, editSel.index)
    const handle = handles?.get(key)
    if (!handle) return null
    const start = new THREE.Vector3()
    return {
      target: handle,
      mode: 'translate',
      onStart: () => { start.copy(handle.position) },
      onCommit: () => {
        const ov = current()
        const prev = ov.cubes?.[key] ?? {}
        const d = handle.position.clone().sub(start)
        const o = prev.offset ?? [0, 0, 0]
        latest.current.updateMobOverride({
          ...ov,
          cubes: { ...ov.cubes, [key]: { ...prev, offset: [snapPx(o[0] + d.x), snapPx(o[1] + d.y), snapPx(o[2] + d.z)] } }
        })
      }
    }
  }, [mobGroup, editing, editSel, gizmoMode, mobBuild])

  // ── Render ──
  const crumbs = dir.split('/').filter(Boolean)
  const filtered = filter.trim()
    ? entries.filter(e => e.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : entries
  const shownEntries = filtered.slice(0, maxShown)
  const remaining = filtered.length - shownEntries.length
  const releases = sources.versions.filter(v => isReleaseVersion(v.label))
  const versionOptions = showSnapshots || releases.length === 0
    ? sources.versions
    : sources.versions.filter(v => isReleaseVersion(v.label) || v.id === selVersion)
  const noSources = sources.versions.length === 0 && sources.packs.length === 0
  const mobAnimNames = animData ? Object.keys(animsForMob(animData, selMobName)).sort() : []
  const mobQuery = mobSearch.trim().toLowerCase()
  const mobNames = geoData
    ? Object.keys(geoData)
        .filter(n => !geoData[`${n}_v2`]) // hide the old revision when a _v2 exists
        .filter(n => !NON_MOB_GEOS.test(n))
        .filter(n => !mobQuery || n.includes(mobQuery) || mobLabel(n).includes(mobQuery))
        .sort((a, b) => {
          // babies right after their adult
          const ka = a.replace(/_baby$/, '')
          const kb = b.replace(/_baby$/, '')
          if (ka !== kb) return ka.localeCompare(kb)
          return a.endsWith('_baby') ? 1 : -1
        })
    : []

  return (
    <div className="h-full flex flex-col p-5 gap-3 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-text-primary">Modelos</h1>
        <div className="flex rounded-lg overflow-hidden border border-border">
          {([['explorer', 'Explorador'], ['mobs', 'Mobs']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-1 text-xs transition-colors ${tab === id ? 'bg-accent text-white' : 'bg-bg-secondary text-text-muted hover:text-text-primary'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto text-xs">
          <label className="text-text-muted">Versión</label>
          <select value={selVersion} onChange={e => setSelVersion(e.target.value)}
            className="bg-bg-secondary border border-border rounded-md px-2 py-1 text-text-primary max-w-[150px]">
            {versionOptions.length === 0 && <option value="">—</option>}
            {versionOptions.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <label className="flex items-center gap-1 text-text-muted cursor-pointer select-none" title="Mostrar snapshots y versiones de modloader">
            <input type="checkbox" checked={showSnapshots} onChange={e => setShowSnapshots(e.target.checked)} className="accent-accent" />
            Snapshots
          </label>
          <SourcePicker title="Pack" emptyLabel="Vanilla"
            sources={sources.packs} instances={instances}
            value={selPack.startsWith('pack:') ? selPack : ''}
            onChange={id => setSelPack(id)}
            loadInfo={loadInfoFor('pack')} />
          <SourcePicker title="Mod" emptyLabel="Ninguno"
            sources={sources.mods} instances={instances}
            value={selPack.startsWith('mod:') ? selPack : ''}
            onChange={id => {
              setSelPack(id)
              // Mods live under their own namespace — jump to the assets root to reveal it
              if (id.startsWith('mod:')) { setDir('assets'); setPreview({ kind: 'none' }) }
            }}
            loadInfo={loadInfoFor('mod')} />
          <label className="flex items-center gap-1.5 ml-3 text-text-muted cursor-pointer select-none">
            <input type="checkbox" checked={autoRotate} onChange={e => setAutoRotate(e.target.checked)} className="accent-accent" />
            Rotar
          </label>
        </div>
      </div>

      {noSources && (
        <div className="flex-1 flex items-center justify-center text-center text-text-muted text-sm">
          <div>
            <p className="mb-1">No hay ninguna versión de Minecraft instalada todavía.</p>
            <p>Instala una versión (o lanza una instancia) y su .jar aparecerá aquí como fuente de assets.</p>
          </div>
        </div>
      )}

      {!noSources && tab === 'explorer' && (
        <div className="flex-1 flex gap-3 min-h-0">
          {/* File explorer */}
          <div className="w-72 shrink-0 flex flex-col bg-bg-secondary border border-border rounded-xl overflow-hidden">
            <div className="p-2 border-b border-border space-y-2">
              <div className="flex flex-wrap gap-1">
                {QUICK_LINKS.map(q => (
                  <button key={q.dir} onClick={() => { setDir(q.dir); setFilter('') }}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${dir === q.dir ? 'bg-accent/20 border-accent/60 text-accent' : 'border-border text-text-muted hover:text-text-primary'}`}>
                    {q.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-text-muted flex-wrap leading-tight">
                {crumbs.map((c, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="opacity-40">/</span>}
                    <button className="hover:text-accent" onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))}>{c}</button>
                  </span>
                ))}
              </div>
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar..."
                className="w-full bg-bg-primary border border-border rounded-md px-2 py-1 text-xs text-text-primary placeholder:text-text-muted/50 outline-none focus:border-accent/60" />
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              {crumbs.length > 1 && (
                <button onClick={() => setDir(crumbs.slice(0, -1).join('/'))}
                  className="w-full text-left px-2 py-1 rounded text-xs text-text-muted hover:bg-bg-primary flex items-center gap-2">
                  <span>↩</span> ..
                </button>
              )}
              {loadingList && <div className="px-2 py-3 text-xs text-text-muted">Cargando…</div>}
              {!loadingList && filtered.length === 0 && (
                <div className="px-2 py-3 text-xs text-text-muted">Carpeta vacía</div>
              )}
              {!loadingList && shownEntries.map(e => (
                <button key={e.name}
                  onClick={() => e.isDir ? (setDir(`${dir}/${e.name}`), setFilter('')) : openFile(e.name)}
                  className={`w-full text-left px-2 py-1 rounded text-xs flex items-center gap-2 hover:bg-bg-primary transition-colors ${!e.isDir && preview.kind !== 'none' && 'path' in preview && preview.path === `${dir}/${e.name}` ? 'bg-accent/15 text-accent' : 'text-text-primary'}`}>
                  <span className="shrink-0 opacity-80">
                    {e.isDir ? '📁' : e.name.endsWith('.png') ? '🖼️' : e.name.endsWith('.json') ? '🧊' : '📄'}
                  </span>
                  <span className="truncate flex-1">{e.name}</span>
                  {!e.isDir && <span className="text-[10px] text-text-muted shrink-0">{formatSize(e.size)}</span>}
                </button>
              ))}
              {!loadingList && remaining > 0 && (
                <button onClick={() => setMaxShown(m => m + LIST_PAGE_SIZE)}
                  className="w-full text-center px-2 py-1.5 rounded text-xs text-accent hover:bg-bg-primary">
                  Mostrar más ({remaining.toLocaleString()} restantes)
                </button>
              )}
            </div>
          </div>

          {/* Preview */}
          <div className="flex-1 min-w-0 bg-bg-secondary border border-border rounded-xl overflow-hidden flex flex-col">
            {preview.kind === 'none' && (
              <div className="flex-1 flex items-center justify-center text-text-muted text-sm text-center px-8">
                Elige un archivo para previsualizarlo.<br />
                Los modelos de <span className="text-text-primary">models/block</span> se ven en 3D con sus relieves; las texturas PNG se ven pixel-perfect.
              </div>
            )}
            {preview.kind === 'loading' && (
              <div className="flex-1 flex items-center justify-center text-text-muted text-sm">Cargando {preview.path.split('/').pop()}…</div>
            )}
            {preview.kind === 'error' && (
              <div className="flex-1 flex items-center justify-center text-sm text-red-400/90 px-10 text-center">{preview.message}</div>
            )}
            {preview.kind === 'model3d' && (
              <>
                <div className="flex-1 min-h-0"><ModelViewer object={preview.group} autoRotate={autoRotate} /></div>
                <div className="border-t border-border px-3 py-2 text-[11px] text-text-muted flex flex-wrap gap-x-4 gap-y-1">
                  <span className="text-text-primary font-medium">{preview.path.split('/').pop()}</span>
                  <span>Elementos: {preview.model.elements.length}</span>
                  <span className="truncate">Herencia: {preview.model.parentChain.map(p => p.split('/').pop()).join(' → ')}</span>
                  {preview.missing.length > 0 && <span className="text-amber-400">Texturas no encontradas: {preview.missing.join(', ')}</span>}
                </div>
              </>
            )}
            {preview.kind === 'item2d' && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
                <img src={preview.dataUrl} alt="" className="w-56 h-56 object-contain" style={{ imageRendering: 'pixelated' }} />
                <div className="text-[11px] text-text-muted text-center">
                  <div className="text-text-primary font-medium mb-0.5">{preview.path.split('/').pop()}</div>
                  Item plano (builtin/generated) · {preview.size}×{preview.size} · capas: {preview.layers.join(', ')}
                </div>
              </div>
            )}
            {preview.kind === 'image' && (
              <div className="flex-1 min-h-0 flex flex-col">
                <TexturePreview dataUrl={preview.dataUrl} w={preview.w} h={preview.h} anim={preview.anim} />
                <div className="border-t border-border px-3 py-2 text-[11px] text-text-muted">
                  <span className="text-text-primary font-medium">{preview.path.split('/').pop()}</span>
                  {preview.anim && <span className="ml-2 text-accent">animada</span>}
                </div>
              </div>
            )}
            {preview.kind === 'entity3d' && (
              <>
                {preview.flat ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 overflow-auto">
                    <img src={preview.dataUrl} alt=""
                      className="max-w-[70%] max-h-[70%] object-contain border border-border rounded"
                      style={{ imageRendering: 'pixelated', minWidth: 128 }} />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0"><ModelViewer object={preview.group} autoRotate={autoRotate} /></div>
                )}
                <div className="border-t border-border px-3 py-2 text-[11px] text-text-muted flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="text-text-primary font-medium">{preview.path.split('/').pop()}</span>
                  <span>Modelo: {preview.geoName}</span>
                  <span>{preview.w}×{preview.h}px</span>
                  {preview.emissive && <span className="text-accent">+ emisivo ({preview.emissive})</span>}
                  <button onClick={() => setPreview({ ...preview, flat: !preview.flat })}
                    className="ml-auto px-2 py-0.5 rounded border border-border text-text-muted hover:text-accent hover:border-accent/60 transition-colors">
                    {preview.flat ? 'Ver en 3D' : 'Ver PNG'}
                  </button>
                </div>
              </>
            )}
            {preview.kind === 'geo3d' && (
              <>
                <div className="flex-1 min-h-0"><ModelViewer object={preview.group} autoRotate={autoRotate} /></div>
                <div className="border-t border-border px-3 py-2 text-[11px] text-text-muted flex flex-wrap gap-x-4 gap-y-1">
                  <span className="text-text-primary font-medium">{preview.path.split('/').pop()}</span>
                  <span>Geometría: {preview.geoName}</span>
                  {!preview.textured && <span className="text-amber-400">Sin textura (no se encontró por convención de nombre)</span>}
                </div>
              </>
            )}
            {preview.kind === 'text' && (
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="px-3 py-2 border-b border-border text-[11px] text-text-primary font-medium">{preview.path.split('/').pop()}</div>
                <pre className="flex-1 overflow-auto p-3 text-[11px] leading-relaxed text-text-primary/90 font-mono whitespace-pre-wrap">{preview.text}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {!noSources && tab === 'mobs' && (
        <div className="flex-1 flex gap-3 min-h-0">
          {/* Mob list */}
          <div className="w-56 shrink-0 flex flex-col bg-bg-secondary border border-border rounded-xl overflow-hidden">
            <div className="p-2 border-b border-border">
              <input value={mobSearch} onChange={e => setMobSearch(e.target.value)} placeholder="Buscar mob..."
                className="w-full bg-bg-primary border border-border rounded-md px-2 py-1 text-xs text-text-primary placeholder:text-text-muted/50 outline-none focus:border-accent/60" />
            </div>
            <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
              {!geoData && <div className="px-2 py-3 text-xs text-text-muted">Cargando geometrías…</div>}
              {mobNames.map(n => (
                <button key={n} onClick={() => setSelMobName(n)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors capitalize ${selMobName === n ? 'bg-accent/20 text-accent' : 'text-text-primary hover:bg-bg-primary'}`}>
                  {mobLabel(n)}
                </button>
              ))}
              {geoData && mobNames.length === 0 && <div className="px-2 py-3 text-xs text-text-muted">Sin resultados</div>}
            </div>
            <p className="text-[10px] text-text-muted px-3 py-2 border-t border-border leading-snug">
              Geometría oficial de Mojang (bedrock-samples). Las texturas salen de tu versión/pack.
            </p>
          </div>

          {/* Viewer */}
          <div className="flex-1 min-w-0 bg-bg-secondary border border-border rounded-xl overflow-hidden flex flex-col">
            <div className="flex-1 min-h-0 relative">
              <ModelViewer object={mobGroup} autoRotate={autoRotate} frameKey={selMobName} gizmo={gizmo} />
              {editing && (
                <div className="absolute top-2 left-2 flex items-center gap-1 bg-bg-secondary/90 border border-border rounded-lg p-1 text-[11px]">
                  {editSel ? (
                    <>
                      <button onClick={() => setGizmoMode('translate')}
                        className={`px-2 py-1 rounded ${gizmoMode === 'translate' || editSel.kind === 'cube' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary'}`}>
                        ✥ Mover
                      </button>
                      {editSel.kind === 'bone' && (
                        <button onClick={() => setGizmoMode('rotate')}
                          className={`px-2 py-1 rounded ${gizmoMode === 'rotate' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary'}`}>
                          ⟲ Girar
                        </button>
                      )}
                      <span className="px-2 text-text-muted">Arrastra las flechas de la pieza</span>
                    </>
                  ) : (
                    <span className="px-2 py-1 text-text-muted">Elige un hueso o un cubo en el panel de la derecha</span>
                  )}
                  <span className="w-px h-4 bg-border mx-1" />
                  <button onClick={undoOverride} disabled={history.past.length === 0} title="Deshacer (Ctrl+Z)"
                    className="px-2 py-1 rounded text-text-muted hover:text-text-primary disabled:opacity-30">↶</button>
                  <button onClick={redoOverride} disabled={history.future.length === 0} title="Rehacer (Ctrl+Y)"
                    className="px-2 py-1 rounded text-text-muted hover:text-text-primary disabled:opacity-30">↷</button>
                </div>
              )}
            </div>
            <div className="border-t border-border px-3 py-2 text-[11px] text-text-muted flex items-center gap-3 flex-wrap">
              <span className="text-text-primary font-medium capitalize">{mobLabel(selMobName)}</span>
              <span className="truncate max-w-[30%]">
                {[mobTex.sel, ...mobTex.groups.map(g => g.sel)].filter(Boolean).map(p => p.split('/').pop()).join(' + ') || 'sin textura'}
              </span>
              {mobAnimNames.length > 0 && (
                <span className="flex items-center gap-1.5 ml-auto">
                  <span className="text-text-muted">Animación</span>
                  <select value={selAnim} onChange={e => setSelAnim(e.target.value)}
                    className="bg-bg-primary border border-border rounded-md px-1.5 py-0.5 text-[11px] text-text-primary max-w-[160px]">
                    <option value="">— pose base —</option>
                    {mobAnimNames.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
                  </select>
                  <button onClick={() => setAnimPlaying(p => !p)} disabled={!selAnim && !mobAnimNames.some(isPoseAnim)}
                    className={`px-2 py-0.5 rounded border transition-colors ${animPlaying ? 'border-accent/60 text-accent' : 'border-border text-text-muted hover:text-accent hover:border-accent/60'}`}>
                    {animPlaying ? '⏸' : '▶'}
                  </button>
                </span>
              )}
              {mobError && <span className="text-amber-400">{mobError}</span>}
              <button
                onClick={() => setEditing((e) => !e)}
                disabled={!mobBuild}
                className={`${mobAnimNames.length > 0 ? '' : 'ml-auto'} px-2 py-0.5 rounded border transition-colors disabled:opacity-40 ${
                  editing ? 'border-accent/60 bg-accent/15 text-accent' : 'border-border text-text-muted hover:text-accent hover:border-accent/60'
                }`}>
                ✎ {editing ? 'Editando' : 'Editar'}
              </button>
            </div>
          </div>

          {editing && mobBuild && (
            <ModelEditor
              geo={mobBuild.geo}
              geoName={mobBuild.name}
              override={effectiveOverride(userOverrides, mobBuild.name)}
              onChange={updateMobOverride}
              selection={editSel}
              onSelect={setEditSel}
              texture={mobBuild.comp ? { dataUrl: mobBuild.comp.dataUrl, w: mobBuild.comp.w, h: mobBuild.comp.h } : null}
              onReset={resetMobOverride}
              hasBundled={hasBundledOverride(mobBuild.name)}
              saving={savingOverrides}
            />
          )}

          {/* Texture variants: one base texture + one choice per overlay group */}
          {!editing && (mobTex.base.length > 1 || mobTex.groups.length > 0 || mobTex.emissive.length > 0) && (
            <div className="w-64 shrink-0 flex flex-col bg-bg-secondary border border-border rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-border text-[11px] font-semibold text-text-primary">Textura</div>
              <div className="flex-1 overflow-y-auto p-1">
                {mobTex.base.map(p => (
                  <label key={p} className="flex items-center gap-2 px-2 py-1 rounded text-[11px] text-text-primary hover:bg-bg-primary cursor-pointer">
                    <input type="radio" name="mob-base-tex" checked={mobTex.sel === p} className="accent-accent shrink-0"
                      onChange={() => setMobTex(t => ({ ...t, sel: p }))} />
                    <span className="truncate">{p.split('/').pop()}</span>
                  </label>
                ))}
                {mobTex.groups.map((g, gi) => (
                  <div key={g.dir} className="px-2 pt-2">
                    <div className="text-[10px] uppercase tracking-wide text-text-muted/70 font-semibold mb-1">
                      {GROUP_LABELS[g.dir] ?? g.dir}
                    </div>
                    <select value={g.sel}
                      onChange={e => setMobTex(t => ({
                        ...t,
                        groups: t.groups.map((x, j) => j === gi ? { ...x, sel: e.target.value } : x),
                      }))}
                      className="w-full bg-bg-primary border border-border rounded-md px-2 py-1 text-[11px] text-text-primary">
                      <option value="">— Ninguno —</option>
                      {g.options.map(o => (
                        <option key={o} value={o}>{o.split('/').pop()!.replace('.png', '')}</option>
                      ))}
                    </select>
                  </div>
                ))}
                {mobTex.emissive.length > 0 && (
                  <div className="px-2 pt-2">
                    <div className="text-[10px] uppercase tracking-wide text-text-muted/70 font-semibold mb-1">
                      Capa emisiva (brilla en la oscuridad)
                    </div>
                    <label className="flex items-center gap-2 px-0.5 py-1 text-[11px] text-text-primary cursor-pointer">
                      <input type="checkbox" checked={!!mobTex.emissiveSel} className="accent-accent shrink-0"
                        onChange={e => setMobTex(t => ({ ...t, emissiveSel: e.target.checked ? t.emissive[0] : '' }))} />
                      <span className="truncate">Activa</span>
                    </label>
                    {mobTex.emissive.length > 1 && mobTex.emissiveSel && (
                      <select value={mobTex.emissiveSel}
                        onChange={e => setMobTex(t => ({ ...t, emissiveSel: e.target.value }))}
                        className="w-full bg-bg-primary border border-border rounded-md px-2 py-1 text-[11px] text-text-primary">
                        {mobTex.emissive.map(o => (
                          <option key={o} value={o}>{o.split('/').pop()!.replace('.png', '')}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
