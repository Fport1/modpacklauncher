import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, activeAccount } from '../store'
import * as skinview3d from 'skinview3d'
import ZoomableImage from '../components/ZoomableImage'
import SkinCard, { Icon, Svg, Toggle } from '../components/skins/SkinCard'

// ── Types ────────────────────────────────────────────────────────────────────

type PartKey = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg'
interface PartFilter { inner: boolean; outer: boolean }
type Filters = Record<PartKey, PartFilter> & { cape: boolean }
type Tab = 'mine' | 'library' | 'browse'
type SkinModel = 'classic' | 'slim'

interface CapeEntry { id: string; state: string; alias: string; texture: string | null }
interface LibraryEntry { id: string; name: string; model: SkinModel; data: string; addedAt: string }
interface SkindexResult { id: string; name: string; renderUrl: string; textureData?: string | null }

const DEFAULT_FILTERS: Filters = {
  head: { inner: true, outer: true }, body: { inner: true, outer: true },
  rightArm: { inner: true, outer: true }, leftArm: { inner: true, outer: true },
  rightLeg: { inner: true, outer: true }, leftLeg: { inner: true, outer: true },
  cape: true,
}

const PARTS: { key: PartKey; label: string; outerLabel: string }[] = [
  { key: 'head',     label: 'Cabeza',    outerLabel: 'Sombrero'    },
  { key: 'body',     label: 'Cuerpo',    outerLabel: 'Chaqueta'    },
  { key: 'rightArm', label: 'Brazo D.',  outerLabel: 'Manga D.'    },
  { key: 'leftArm',  label: 'Brazo I.',  outerLabel: 'Manga I.'    },
  { key: 'rightLeg', label: 'Pierna D.', outerLabel: 'Pantalón D.' },
  { key: 'leftLeg',  label: 'Pierna I.', outerLabel: 'Pantalón I.' },
]

// ── Small shared components ──────────────────────────────────────────────────

function Checkbox({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors mx-auto ${active ? 'bg-accent border-accent' : 'border-border hover:border-accent/50'}`}>
      {active && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
    </button>
  )
}

// Renders the player face (front face of head) from a skin PNG, no external requests
function SkinHeadCanvas({ skin, size = 80 }: { skin: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, size, size)
      ctx.imageSmoothingEnabled = false
      // Head base layer front face: x=8, y=8, w=8, h=8 in 64x64 skin
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size)
      // Head outer layer front face: x=40, y=8, w=8, h=8
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size)
    }
    img.src = skin
  }, [skin, size])
  return <canvas ref={canvasRef} width={size} height={size} style={{ imageRendering: 'pixelated' }} className="w-full h-full" />
}

function CapePreviewCanvas({ texture, width = 50, height = 80 }: { texture: string; width?: number; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, width, height)
      ctx.imageSmoothingEnabled = false
      // Cape back face is at x=1, y=1, w=10, h=16 in the 64x32 texture
      ctx.drawImage(img, 1, 1, 10, 16, 0, 0, width, height)
    }
    img.src = texture
  }, [texture, width, height])
  return <canvas ref={canvasRef} width={width} height={height} style={{ imageRendering: 'pixelated' }} className="rounded" />
}

function SkinViewer3D({ skin, cape, width = 160, height = 220, autoRotate = true, interactive = false, model = 'classic' }: {
  skin: string; cape?: string | null; width?: number; height?: number; autoRotate?: boolean; interactive?: boolean; model?: SkinModel
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<skinview3d.SkinViewer | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    viewerRef.current?.dispose()
    const v = new skinview3d.SkinViewer({
      canvas: canvasRef.current, width, height, skin,
      model: model === 'slim' ? 'slim' : 'default',
      ...(cape ? { cape } : {}),
    })
    v.autoRotate = autoRotate
    v.autoRotateSpeed = 0.6
    v.globalLight.intensity = 3
    v.cameraLight.intensity = 1
    v.controls.enableZoom = interactive
    v.controls.enablePan = interactive
    v.controls.enableRotate = interactive
    const sk = v.playerObject.skin
    for (const key of ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const) {
      sk[key].innerLayer.visible = true
      sk[key].outerLayer.visible = true
    }
    viewerRef.current = v
    return () => { v.dispose(); viewerRef.current = null }
  }, [skin, cape, width, height, interactive, model]) // eslint-disable-line react-hooks/exhaustive-deps

  // Girar o parar sin recrear el visor (cada visor es un contexto WebGL); al parar, vuelve a mirar de frente
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    v.autoRotate = autoRotate
    if (!autoRotate) v.playerObject.rotation.y = 0
  }, [autoRotate])

  return <canvas ref={canvasRef} className={`rounded-xl ${interactive ? '' : 'pointer-events-none'}`} />
}

// ── Apply skin modal ─────────────────────────────────────────────────────────

function ApplySkinModal({ skinData, onApply, onClose }: {
  skinData: string
  onApply: (skinBase64: string, model: SkinModel) => Promise<void>
  onClose: () => void
}) {
  const [model, setModel] = useState<SkinModel>('classic')
  const [status, setStatus] = useState<'idle' | 'applying' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function confirm() {
    setStatus('applying')
    setErrorMsg('')
    try {
      await onApply(skinData, model)
      setStatus('success')
      setTimeout(onClose, 1500)
    } catch (e: any) {
      setStatus('error')
      const raw: string = e?.message ?? ''
      setErrorMsg(raw.includes('401') ? 'Sesión expirada. Reinicia la app e intenta de nuevo.' : raw.includes('HTTP') ? `Error de servidor (${raw.match(/HTTP \d+/)?.[0] ?? 'desconocido'})` : 'No se pudo aplicar el skin.')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={status === 'applying' ? undefined : onClose}>
      <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl p-6 flex flex-col items-center gap-5 w-[320px]"
        onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-text-primary self-start">Aplicar skin</h3>
        <SkinViewer3D skin={skinData} width={140} height={200} model={model} />
        <div className="flex gap-2 w-full">
          {(['classic', 'slim'] as SkinModel[]).map(m => (
            <button key={m} onClick={() => setModel(m)} disabled={status === 'applying' || status === 'success'}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${model === m ? 'bg-accent/15 border-accent/60 text-accent' : 'border-border text-text-secondary hover:border-accent/40'} disabled:opacity-50`}>
              {m === 'classic' ? 'Brazos gruesos' : 'Brazos delgados'}
            </button>
          ))}
        </div>
        {status === 'error' && (
          <div className="w-full px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 text-center">
            {errorMsg || 'No se pudo aplicar el skin. ¿Token expirado?'}
          </div>
        )}
        {status === 'success' && (
          <div className="w-full px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg text-xs text-green-400 text-center flex items-center justify-center gap-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            ¡Skin aplicado correctamente!
          </div>
        )}
        <div className="flex gap-3 w-full">
          <button onClick={onClose} disabled={status === 'applying'}
            className="flex-1 py-2 text-sm border border-border hover:border-accent/40 rounded-lg text-text-secondary transition-colors disabled:opacity-40">
            Cancelar
          </button>
          <button onClick={confirm} disabled={status === 'applying' || status === 'success'}
            className="flex-1 py-2 text-sm bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {status === 'applying' && <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>}
            {status === 'applying' ? 'Aplicando...' : status === 'success' ? '¡Aplicado!' : 'Aplicar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── New skin modal (Librería) ────────────────────────────────────────────────

function NewSkinModal({ onSave, onClose }: {
  onSave: (entry: { name: string; model: SkinModel; data: string }) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('unnamed skin')
  const [model, setModel] = useState<SkinModel>('classic')
  const [skinData, setSkinData] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function pickFile() {
    const data = await window.api.skins.pickFile()
    if (data) setSkinData(data)
  }

  async function handleSave() {
    if (!skinData) return
    setSaving(true)
    try { await onSave({ name: name.trim() || 'unnamed skin', model, data: skinData }) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[580px] flex overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Left: 3D preview */}
        <div className="w-[190px] flex-shrink-0 bg-bg-card/50 flex items-center justify-center p-4 border-r border-border">
          {skinData
            ? <SkinViewer3D skin={skinData} width={155} height={215} autoRotate model={model} />
            : (
              <div className="w-[155px] h-[215px] rounded-xl bg-bg-hover/50 flex flex-col items-center justify-center gap-2 text-text-muted/30">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
                <p className="text-[10px]">Sin skin</p>
              </div>
            )}
        </div>

        {/* Right: form */}
        <div className="flex-1 p-6 flex flex-col gap-5">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-widest">Nueva skin</h3>

          {/* Name */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5 block">Nombre</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-bg-card border border-border focus:border-accent/50 rounded-lg px-3 py-2 text-sm text-text-primary outline-none transition-colors"
              placeholder="unnamed skin" />
          </div>

          {/* Model */}
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

          {/* Skin file */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 block">Archivo de skin</label>
            <button onClick={pickFile}
              className="flex items-center gap-2 px-4 py-2 border border-border hover:border-accent/40 rounded-lg text-sm text-text-secondary hover:text-text-primary transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Seleccionar PNG
            </button>
            {skinData && (
              <p className="text-xs text-accent mt-1.5 flex items-center gap-1">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                Skin cargada correctamente
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-auto pt-1">
            <button onClick={onClose}
              className="flex-1 py-2 border border-border hover:border-accent/40 rounded-lg text-sm text-text-secondary transition-colors">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={!skinData || saving}
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

// ── Main page ────────────────────────────────────────────────────────────────

function EditLibrarySkinModal({ entry, onSave, onEditSkin, onClose }: {
  entry: LibraryEntry
  onSave: (entry: LibraryEntry) => Promise<LibraryEntry>
  onEditSkin: (entry: LibraryEntry) => void
  onClose: () => void
}) {
  const [name, setName] = useState(entry.name)
  const [model, setModel] = useState<SkinModel>(entry.model)
  const [saving, setSaving] = useState(false)

  async function saveChanges() {
    setSaving(true)
    try {
      return await onSave({ ...entry, name: name.trim() || 'unnamed skin', model })
    } finally { setSaving(false) }
  }

  async function handleSave() {
    await saveChanges()
    onClose()
  }

  async function handleEditSkin() {
    const updated = await saveChanges()
    onEditSkin(updated)
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[580px] flex overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="w-[190px] flex-shrink-0 bg-bg-card/50 flex items-center justify-center p-4 border-r border-border">
          <SkinViewer3D skin={entry.data} width={155} height={215} autoRotate model={model} />
        </div>
        <div className="flex-1 p-6 flex flex-col gap-5">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-widest">Editar skin</h3>
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
            <p className="text-xs text-accent mt-1.5 flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              Skin guardada en libreria
            </p>
          </div>
          <div className="flex gap-3 mt-auto pt-1">
            <button onClick={onClose}
              className="flex-1 py-2 border border-border hover:border-accent/40 rounded-lg text-sm text-text-secondary transition-colors">
              Cancelar
            </button>
            <button onClick={handleEditSkin} disabled={saving}
              className="flex-1 py-2 border border-accent/50 hover:border-accent text-accent rounded-lg text-sm transition-colors disabled:opacity-40">
              Editar skin
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

export default function SkinsPage() {
  const navigate = useNavigate()
  const account = useStore(activeAccount)
  const [tab, setTab] = useState<Tab>('mine')

  // ── My Skin state ──
  const [skinData, setSkinData] = useState<{ skin: string; cape: string | null; model: SkinModel } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [elytra, setElytra] = useState(false)
  const [skinLightbox, setSkinLightbox] = useState(false)
  const [capeSelector, setCapeSelector] = useState(false)
  const [allCapes, setAllCapes] = useState<CapeEntry[]>([])
  const [loadingCapes, setLoadingCapes] = useState(false)
  const [selectedCapeId, setSelectedCapeId] = useState<string | null>(null)
  const [equipping, setEquipping] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<skinview3d.SkinViewer | null>(null)

  // ── Library state ──
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [libLoading, setLibLoading] = useState(false)
  const [editingLibrarySkin, setEditingLibrarySkin] = useState<LibraryEntry | null>(null)
  const [defaultSkins, setDefaultSkins] = useState<{ name: string; model: SkinModel; data: string }[]>([])
  const [defaultsLoading, setDefaultsLoading] = useState(false)

  // ── Browse state ──
  const [searchQuery, setSearchQuery] = useState('')
  const [searchPage, setSearchPage] = useState(1)
  const [searchResults, setSearchResults] = useState<SkindexResult[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [selectedBrowseSkin, setSelectedBrowseSkin] = useState<SkindexResult | null>(null)
  const [browseSaveStatus, setBrowseSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  // ── Shared apply modal ──
  const [applyModal, setApplyModal] = useState<string | null>(null) // base64 of skin to apply
  const [newSkinModal, setNewSkinModal] = useState(false)

  // ── Load current skin ──
  function loadSkin() {
    if (!account || account.type !== 'microsoft') return
    setLoading(true)
    setError('')
    window.api.skin.getTexture(account.uuid)
      .then(data => { if (data) setSkinData(data as any); else setError('No se pudo obtener la skin') })
      .catch(() => setError('Error al cargar la skin'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadSkin() }, [account?.uuid])

  // ── Load library when tab changes ──
  useEffect(() => {
    if (tab !== 'library') return
    setLibLoading(true)
    window.api.skins.listLibrary().then(setLibrary).finally(() => setLibLoading(false))
    if (defaultSkins.length === 0) {
      setDefaultsLoading(true)
      window.api.skins.getDefaults().then(setDefaultSkins).finally(() => setDefaultsLoading(false))
    }
  }, [tab])

  // ── 3D viewer (Mi Skin tab) ──
  useEffect(() => {
    if (tab !== 'mine') return
    if (!skinData || !canvasRef.current) return
    viewerRef.current?.dispose()
    const viewer = new skinview3d.SkinViewer({
      canvas: canvasRef.current, width: 340, height: 470,
      skin: skinData.skin,
      model: skinData.model === 'slim' ? 'slim' : 'default',
      ...(skinData.cape ? { cape: skinData.cape } : {}),
    })
    viewer.controls.enableZoom = true
    viewer.controls.enableRotate = true
    viewer.controls.enablePan = true
    viewer.autoRotate = false
    viewer.globalLight.intensity = 3
    viewer.cameraLight.intensity = 1
    viewer.controls.saveState()
    viewerRef.current = viewer
    applyFilters(viewer, filters, elytra)
    return () => { viewer.dispose(); viewerRef.current = null }
  }, [skinData, tab])

  function applyFilters(viewer: skinview3d.SkinViewer, f: Filters, isElytra: boolean) {
    const skin = viewer.playerObject.skin
    for (const { key } of PARTS) {
      const part = skin[key]
      part.innerLayer.visible = f[key].inner
      part.outerLayer.visible = f[key].outer
      part.visible = f[key].inner || f[key].outer
    }
    viewer.playerObject.backEquipment = f.cape ? (isElytra ? 'elytra' : 'cape') : null
  }

  useEffect(() => {
    const v = viewerRef.current
    if (v) applyFilters(v, filters, elytra)
  }, [filters, elytra])

  // ── Helpers ──
  function toggleInner(key: PartKey) { setFilters(f => ({ ...f, [key]: { ...f[key], inner: !f[key].inner } })) }
  function toggleOuter(key: PartKey) { setFilters(f => ({ ...f, [key]: { ...f[key], outer: !f[key].outer } })) }
  function toggleCape() { setFilters(f => ({ ...f, cape: !f.cape })) }
  function toggleElytra() { setElytra(e => !e) }
  function resetCamera() { viewerRef.current?.controls.reset() }

  function downloadSkin() {
    if (!skinData) return
    const a = document.createElement('a')
    a.href = skinData.skin
    a.download = `${account?.username ?? 'skin'}.png`
    a.click()
  }

  async function openCapeSelector() {
    if (!account) return
    const activeCape = allCapes.find(c => c.state === 'ACTIVE')
    setSelectedCapeId(activeCape?.id ?? null)
    setCapeSelector(true)
    if (allCapes.length > 0) return
    setLoadingCapes(true)
    try {
      let token = account.accessToken
      if (account.type === 'microsoft') {
        try { token = (await window.api.auth.refresh(account)).accessToken } catch { /* use current */ }
      }
      const capes = await window.api.skin.getProfileCapes(token)
      setAllCapes(capes)
      setSelectedCapeId(capes.find(c => c.state === 'ACTIVE')?.id ?? null)
    } catch { /* ignore */ }
    finally { setLoadingCapes(false) }
  }

  async function equipCape() {
    if (!account?.accessToken) return
    setEquipping(true)
    try {
      if (selectedCapeId) await window.api.skin.equipCape(account.accessToken, selectedCapeId)
      else await window.api.skin.removeCape(account.accessToken)
      const data = await window.api.skin.getTexture(account.uuid)
      if (data) setSkinData(data)
      setCapeSelector(false)
    } catch { /* ignore */ }
    finally { setEquipping(false) }
  }

  async function applySkin(skinBase64: string, model: SkinModel) {
    if (!account?.id) throw new Error('No account')
    await window.api.skins.apply(account.id, skinBase64, model)
    window.api.skin.getTexture(account.uuid).then(data => { if (data) setSkinData(data) }).catch(() => {})
  }

  // ── Library actions ──
  async function addToLibrary(entry: { name: string; model: SkinModel; data: string }) {
    const saved = await window.api.skins.saveToLibrary(entry)
    setLibrary(prev => [...prev, saved])
    setNewSkinModal(false)
  }

  async function saveCurrentToLibrary() {
    if (!skinData) return
    const name = account?.username ?? 'Mi skin'
    await window.api.skins.saveToLibrary({ name, model: skinData.model, data: skinData.skin })
    if (tab === 'library') {
      const updated = await window.api.skins.listLibrary()
      setLibrary(updated)
    }
  }

  async function deleteFromLibrary(id: string) {
    await window.api.skins.deleteFromLibrary(id)
    setLibrary(prev => prev.filter(e => e.id !== id))
  }

  async function updateLibraryEntry(entry: LibraryEntry) {
    const updated = await window.api.skins.updateLibrary({
      id: entry.id,
      name: entry.name,
      model: entry.model,
      data: entry.data
    })
    setLibrary(prev => prev.map(e => e.id === updated.id ? updated : e))
    setEditingLibrarySkin(updated)
    return updated
  }

  function editSkinInEditor(entry: LibraryEntry) {
    setEditingLibrarySkin(null)
    navigate('/skin-editor', { state: { skinData: entry.data, skinName: entry.name, skinModel: entry.model } })
  }

  // ── Browse actions ──
  const doSearch = useCallback(async (q: string) => {
    setSearching(true)
    setHasSearched(true)
    setSearchError('')
    setSelectedBrowseSkin(null)
    try {
      const results = await window.api.skins.searchSkindex(q, 1)
      setSearchResults(results)
      if (results.length === 0) setSearchError('No se encontraron resultados.')
    } catch (e: any) {
      setSearchError(e?.message ?? 'Error desconocido')
      setSearchResults([])
    } finally { setSearching(false) }
  }, [])

  async function fetchAndSave(skinId: string, name: string, renderUrl: string) {
    const data = await window.api.skins.fetchSkinPng(skinId, renderUrl)
    const saved = await window.api.skins.saveToLibrary({ name, model: 'classic', data })
    setLibrary(prev => [...prev, saved])
  }

  async function fetchAndApply(skinId: string, renderUrl: string) {
    const data = await window.api.skins.fetchSkinPng(skinId, renderUrl)
    setApplyModal(data)
  }

  const hasCape = !!skinData?.cape

  if (!account || account.type !== 'microsoft') {
    return (
      <div className="h-full flex items-center justify-center p-8" style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(99,102,241,0.14), transparent 60%)' }}>
        <div className="max-w-md text-center">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-accent/15 text-accent flex items-center justify-center mb-5">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="7" y="2" width="10" height="9" rx="1" /><path d="M7 11h10v7H7zM4 11h3v6H4zM17 11h3v6h-3zM8 18h3v4H8zM13 18h3v4h-3z" /></svg>
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Tus skins</h1>
          <p className="text-sm text-text-secondary mt-2">Para ver y cambiar la skin y la capa de tu personaje hace falta una cuenta de Microsoft (Minecraft Premium). Con ella también tendrás tu librería de skins y podrás explorar las de otros.</p>
          <div className="flex items-center justify-center gap-2 mt-6">
            <button onClick={() => navigate('/settings')} className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold">Añadir cuenta de Microsoft</button>
            <button onClick={() => navigate('/skin-editor')} className="px-5 py-2.5 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover">Abrir el editor de skins</button>
          </div>
        </div>
      </div>
    )
  }

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'mine',    label: 'Mi skin',  icon: '🧍' },
    { key: 'library', label: 'Librería', icon: '📚' },
    { key: 'browse',  label: 'Explorar', icon: '🔎' },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Cabecera: tu personaje, pestañas y crear */}
      <div className="relative overflow-hidden border-b border-border flex-shrink-0" style={{ background: 'linear-gradient(115deg, rgba(99,102,241,0.20), rgba(34,197,94,0.08) 55%, transparent 90%)' }}>
        <div className="px-8 pt-6 pb-0 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl overflow-hidden bg-black/20 border border-white/10 flex items-center justify-center flex-shrink-0">
            {skinData ? <SkinHeadCanvas skin={skinData.skin} size={56} /> : <div className="w-full h-full animate-pulse bg-bg-hover" />}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-text-primary">Skins</h1>
            <p className="text-sm text-text-secondary truncate">{account.username}{skinData ? ` · modelo ${skinData.model === 'slim' ? 'fino (Alex)' : 'clásico (Steve)'}${skinData.cape ? ' · con capa' : ''}` : ''}</p>
          </div>
          <button onClick={() => navigate('/skin-editor')}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm rounded-xl font-semibold transition-colors shadow-lg shadow-accent/20">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            Crear skin
          </button>
        </div>
        <div className="px-8 mt-4 flex items-center gap-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
              <span className="mr-1.5">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-8 py-6 overflow-y-auto">

      {/* ── Tab: Mi skin ── */}
      {tab === 'mine' && (
        <>
          {loading && (
            <div className="flex items-center gap-2 text-text-muted text-sm py-6">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
              Cargando tu skin…
            </div>
          )}
          {error && !loading && (
            <div className="max-w-lg p-5 rounded-2xl border border-red-500/30 bg-red-500/10 flex items-start gap-4">
              <span className="text-2xl leading-none">⚠️</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-red-200">{error}</p>
                <p className="text-xs text-red-200/70 mt-1">Puede que la sesión de Microsoft haya caducado o que no haya conexión. Prueba otra vez o vuelve a iniciar sesión en Ajustes › Cuentas.</p>
                <div className="flex gap-2 mt-3">
                  <button onClick={loadSkin} className="h-9 px-4 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-100 text-sm font-bold">Reintentar</button>
                  <button onClick={() => navigate('/settings')} className="h-9 px-4 rounded-xl border border-red-500/30 text-red-100/80 text-sm font-semibold hover:bg-red-500/10">Ir a Cuentas</button>
                </div>
              </div>
            </div>
          )}

          {skinData && !loading && (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-6 items-start">
              {/* Visor 3D */}
              <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
                <div className="flex items-center justify-center" style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(99,102,241,0.22), transparent 70%)' }}>
                  <canvas ref={canvasRef} />
                </div>
                <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
                  <button onClick={resetCamera}
                    className="h-9 px-3 flex items-center gap-2 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors">
                    <Svg size={15}>{Icon.reset}</Svg>Restablecer vista
                  </button>
                  {hasCape && (
                    <button onClick={toggleElytra}
                      className={`h-9 px-3 rounded-xl text-sm font-semibold transition-colors ${elytra ? 'bg-accent/15 text-accent border border-accent/40' : 'border border-border text-text-secondary hover:text-text-primary hover:border-accent/50'}`}>
                      {elytra ? 'Ver como capa' : 'Ver como elytra'}
                    </button>
                  )}
                  <span className="ml-auto text-[11px] text-text-muted">Arrastra para girar · rueda: zoom</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 content-start">
                {/* Skin */}
                <div className="rounded-2xl bg-bg-card border border-border p-4 flex gap-4">
                  <button onClick={() => setSkinLightbox(true)} title="Ver la textura en grande"
                    className="w-28 h-28 shrink-0 rounded-xl bg-bg-primary border border-border hover:border-accent/50 p-2 transition-colors">
                    <img src={skinData.skin} alt="skin" draggable={false} style={{ imageRendering: 'pixelated' }} className="w-full h-full" />
                  </button>
                  <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <div>
                      <p className="text-sm font-bold text-text-primary">Tu skin</p>
                      <p className="text-[11px] text-text-muted">{skinData.model === 'slim' ? 'Brazos finos (Alex)' : 'Brazos clásicos (Steve)'}</p>
                    </div>
                    <button onClick={downloadSkin} className="h-9 px-3 flex items-center gap-2 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors">
                      <Svg size={15}>{Icon.download}</Svg>Descargar PNG
                    </button>
                    <button onClick={saveCurrentToLibrary} className="h-9 px-3 flex items-center gap-2 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors">
                      <Svg size={15}>{Icon.save}</Svg>Guardar en la librería
                    </button>
                    <button onClick={loadSkin} disabled={loading} className="h-9 px-3 flex items-center gap-2 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors disabled:opacity-50">
                      <Svg size={15} className={loading ? 'animate-spin' : ''}>{Icon.refresh}</Svg>Recargar
                    </button>
                  </div>
                </div>

                {/* Capa */}
                <div className="rounded-2xl bg-bg-card border border-border p-4 flex gap-4">
                  <div className="w-28 h-28 shrink-0 rounded-xl bg-bg-primary border border-border flex items-center justify-center">
                    {skinData.cape ? <CapePreviewCanvas texture={skinData.cape} width={56} height={90} /> : <span className="text-[11px] text-text-muted text-center px-2">Sin capa</span>}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <div>
                      <p className="text-sm font-bold text-text-primary">Capa</p>
                      <p className="text-[11px] text-text-muted">{skinData.cape ? 'Equipada' : 'No llevas ninguna puesta'}</p>
                    </div>
                    <button onClick={openCapeSelector} className="h-9 px-3 flex items-center gap-2 rounded-xl bg-accent/15 hover:bg-accent/25 text-accent text-sm font-bold transition-colors">
                      Cambiar capa
                    </button>
                    {hasCape && (
                      <label className="flex items-center justify-between gap-2 text-sm text-text-secondary mt-1">
                        Mostrar la capa
                        <Toggle on={filters.cape} onClick={toggleCape} />
                      </label>
                    )}
                  </div>
                </div>

                {/* Partes visibles */}
                <div className="col-span-2 rounded-2xl bg-bg-card border border-border overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div>
                      <p className="text-sm font-bold text-text-primary">Partes visibles en la vista</p>
                      <p className="text-[11px] text-text-muted">Solo cambia lo que ves aquí, no tu skin.</p>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setFilters(f => ({ ...f, ...Object.fromEntries(PARTS.map(p => [p.key, { inner: true, outer: true }])) }))}
                        className="h-8 px-3 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary">Todo</button>
                      <button onClick={() => setFilters(f => ({ ...f, ...Object.fromEntries(PARTS.map(p => [p.key, { inner: true, outer: false }])) }))}
                        className="h-8 px-3 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary">Sin capa exterior</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_auto] gap-x-8 px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    <span>Parte</span><span>Base</span><span>Exterior</span>
                  </div>
                  <div className="divide-y divide-border/40">
                    {PARTS.map(({ key, label, outerLabel }) => (
                      <div key={key} className="grid grid-cols-[1fr_auto_auto] gap-x-8 items-center px-4 py-2.5">
                        <div>
                          <p className="text-sm font-semibold text-text-primary">{label}</p>
                          <p className="text-[11px] text-text-muted">Exterior: {outerLabel.toLowerCase()}</p>
                        </div>
                        <Toggle on={filters[key].inner} onClick={() => toggleInner(key)} />
                        <Toggle on={filters[key].outer} onClick={() => toggleOuter(key)} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Tab: Librería ── */}
      {tab === 'library' && (
        <div className="flex-1">
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-bold text-text-primary">Tus skins guardadas {library.length > 0 && <span className="text-text-muted font-medium">· {library.length}</span>}</h2>
              <p className="text-xs text-text-muted mt-0.5">Pásale el ratón por encima para verla girar. «Aplicar» la pone en tu cuenta.</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {skinData && (
                <button onClick={saveCurrentToLibrary}
                  className="h-10 px-4 flex items-center gap-2 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors">
                  <Svg>{Icon.save}</Svg>Guardar la actual
                </button>
              )}
              <button onClick={() => setNewSkinModal(true)}
                className="h-10 px-4 flex items-center gap-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-bold transition-colors shadow-lg shadow-accent/20">
                <Svg>{Icon.upload}</Svg>Añadir skin
              </button>
            </div>
          </div>

          {libLoading && (
            <div className="flex items-center gap-2 text-text-muted text-sm py-6">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
              Cargando…
            </div>
          )}

          {!libLoading && library.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 rounded-2xl border border-dashed border-border text-center gap-2 mb-8">
              <p className="text-sm font-semibold text-text-secondary">No tienes skins guardadas</p>
              <p className="text-xs text-text-muted">Añade una desde un PNG, guarda la que llevas puesta o busca la de otro jugador en «Explorar».</p>
            </div>
          )}

          {!libLoading && library.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4 mb-10">
              {library.map(entry => (
                <SkinCard key={entry.id} name={entry.name} model={entry.model}
                  viewer={(rotating) => <SkinViewer3D skin={entry.data} width={130} height={175} autoRotate={rotating} model={entry.model} />}
                  onApply={() => setApplyModal(entry.data)}
                  actions={[
                    { icon: Icon.edit, label: 'Editar', onClick: () => setEditingLibrarySkin(entry) },
                    { icon: Icon.download, label: 'Guardar PNG en el equipo', onClick: () => { const a = document.createElement('a'); a.href = entry.data; a.download = `${entry.name}.png`; a.click() } },
                    { icon: Icon.trash, label: 'Eliminar', danger: true, onClick: () => deleteFromLibrary(entry.id) },
                  ]} />
              ))}
            </div>
          )}

          {/* ── Skins por defecto de Minecraft ── */}
          <div className="mb-6">
            <h2 className="text-base font-bold text-text-primary">Skins de Minecraft</h2>
            <p className="text-xs text-text-muted mt-0.5 mb-4">Las que trae el juego. Puedes aplicarlas directamente o guardarlas en tu librería.</p>
            {defaultsLoading ? (
              <div className="flex items-center gap-2 text-text-muted text-sm">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                Cargando…
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                {defaultSkins.map(skin => (
                  <SkinCard key={skin.name} name={skin.name} model={skin.model}
                    viewer={(rotating) => <SkinViewer3D skin={skin.data} width={130} height={175} autoRotate={rotating} model={skin.model} />}
                    onApply={() => setApplyModal(skin.data)}
                    actions={[{ icon: Icon.save, label: 'Guardar en la librería', onClick: () => { window.api.skins.saveToLibrary({ name: skin.name, model: skin.model, data: skin.data }).then(e => setLibrary(prev => [...prev, e])) } }]} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Explorar ── */}
      {tab === 'browse' && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Search bar */}
          <form className="flex gap-2 mb-4 flex-shrink-0"
            onSubmit={e => { e.preventDefault(); doSearch(searchQuery) }}>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Nombre de jugador de Minecraft..."
              className="flex-1 h-11 bg-bg-card border border-border focus:border-accent/60 rounded-xl px-4 text-sm text-text-primary outline-none placeholder:text-text-muted transition-colors" />
            <button type="submit" disabled={searching}
              className="h-11 px-5 bg-accent hover:bg-accent-hover text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2">
              {searching
                ? <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
              Buscar
            </button>
            <button type="button" onClick={() => { setSearchQuery(''); doSearch('') }}
              className="h-11 px-4 border border-border hover:border-accent/50 text-text-secondary hover:text-text-primary text-sm font-semibold rounded-xl transition-colors">
              Populares
            </button>
          </form>

          <div className="flex-1 overflow-y-auto">
            {!hasSearched && !searching && (
              <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-3">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-30">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
                <p className="text-sm">Busca por nombre de jugador o carga los populares</p>
              </div>
            )}

            {hasSearched && !searching && searchError && (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <p className="text-sm text-red-400">{searchError}</p>
                <p className="text-xs text-text-muted">Verifica el nombre del jugador e intenta de nuevo</p>
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
                {searchResults.map(skin => (
                  <button key={skin.id}
                    onClick={() => { setSelectedBrowseSkin(skin); setBrowseSaveStatus('idle') }}
                    className={`bg-bg-card border rounded-2xl overflow-hidden flex flex-col items-center hover:border-accent/50 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/30 transition-all ${selectedBrowseSkin?.id === skin.id ? 'border-accent/60' : 'border-border'}`}>
                    <div className="w-full aspect-square flex items-center justify-center overflow-hidden p-4" style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(99,102,241,0.18), transparent 70%)' }}>
                      {skin.textureData
                        ? <SkinHeadCanvas skin={skin.textureData} size={96} />
                        : <div className="w-full h-full bg-bg-hover/40 rounded" />}
                    </div>
                    <p className="text-sm text-text-primary px-3 py-2.5 w-full text-center truncate font-bold border-t border-border">{skin.name}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Skin lightbox ── */}
      {skinLightbox && skinData && (
        <ZoomableImage src={skinData.skin} alt="Skin" onClose={() => setSkinLightbox(false)} />
      )}

      {/* ── New skin modal ── */}
      {newSkinModal && (
        <NewSkinModal onSave={addToLibrary} onClose={() => setNewSkinModal(false)} />
      )}

      {/* ── Browse skin preview modal ── */}
      {editingLibrarySkin && (
        <EditLibrarySkinModal
          entry={editingLibrarySkin}
          onSave={updateLibraryEntry}
          onEditSkin={editSkinInEditor}
          onClose={() => setEditingLibrarySkin(null)}
        />
      )}

      {selectedBrowseSkin && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => { setSelectedBrowseSkin(null); setBrowseSaveStatus('idle') }}>
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl p-6 flex gap-5 items-start"
            onClick={e => e.stopPropagation()}>
            {selectedBrowseSkin.textureData && (
              <SkinViewer3D skin={selectedBrowseSkin.textureData} width={160} height={230} autoRotate interactive />
            )}
            <div className="flex flex-col gap-4 pt-2 min-w-[160px]">
              <div>
                <p className="text-lg font-bold text-text-primary">{selectedBrowseSkin.name}</p>
                <p className="text-xs text-text-muted mt-0.5">Jugador de Minecraft</p>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => { if (selectedBrowseSkin.textureData) setApplyModal(selectedBrowseSkin.textureData); setSelectedBrowseSkin(null); setBrowseSaveStatus('idle') }}
                  disabled={!selectedBrowseSkin.textureData}
                  className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors disabled:opacity-40 font-medium">
                  Aplicar skin
                </button>

                {browseSaveStatus === 'success' ? (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-green-500/10 border border-green-500/30 rounded-lg">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400 flex-shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
                      <p className="text-xs text-green-400 font-medium">Guardada en librería</p>
                    </div>
                    <button onClick={() => { setSelectedBrowseSkin(null); setBrowseSaveStatus('idle'); setTab('library') }}
                      className="px-5 py-2.5 border border-accent/50 hover:border-accent text-accent text-sm rounded-lg transition-colors font-medium">
                      Ir a librería →
                    </button>
                  </>
                ) : browseSaveStatus === 'error' ? (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-red-400 flex-shrink-0"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      <p className="text-xs text-red-400 font-medium">Error al guardar</p>
                    </div>
                    <button onClick={async () => {
                      if (!selectedBrowseSkin.textureData) return
                      setBrowseSaveStatus('saving')
                      try {
                        const saved = await window.api.skins.saveToLibrary({ name: selectedBrowseSkin.name, model: 'classic', data: selectedBrowseSkin.textureData })
                        setLibrary(prev => [...prev, saved])
                        setBrowseSaveStatus('success')
                      } catch { setBrowseSaveStatus('error') }
                    }} className="px-5 py-2.5 border border-border hover:border-accent/40 text-text-secondary text-sm rounded-lg transition-colors">
                      Reintentar
                    </button>
                  </>
                ) : (
                  <button
                    onClick={async () => {
                      if (!selectedBrowseSkin.textureData) return
                      setBrowseSaveStatus('saving')
                      try {
                        const saved = await window.api.skins.saveToLibrary({ name: selectedBrowseSkin.name, model: 'classic', data: selectedBrowseSkin.textureData })
                        setLibrary(prev => [...prev, saved])
                        setBrowseSaveStatus('success')
                      } catch { setBrowseSaveStatus('error') }
                    }}
                    disabled={!selectedBrowseSkin.textureData || browseSaveStatus === 'saving'}
                    className="px-5 py-2.5 border border-border hover:border-accent/40 text-text-secondary hover:text-text-primary text-sm rounded-lg transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
                    {browseSaveStatus === 'saving' && <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>}
                    {browseSaveStatus === 'saving' ? 'Guardando...' : 'Guardar en librería'}
                  </button>
                )}

                <button onClick={() => { setSelectedBrowseSkin(null); setBrowseSaveStatus('idle') }}
                  className="px-5 py-2 text-xs text-text-muted hover:text-text-secondary transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Apply modal ── */}
      {applyModal && (
        <ApplySkinModal
          skinData={applyModal}
          onApply={applySkin}
          onClose={() => setApplyModal(null)} />
      )}

      {/* ── Cape selector modal ── */}
      {capeSelector && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setCapeSelector(false)}>
          <div className="bg-bg-secondary border border-border rounded-2xl w-[680px] max-h-[80vh] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <h2 className="text-base font-bold text-text-primary">Tus capas</h2>
              <button onClick={() => setCapeSelector(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="flex flex-1 overflow-hidden min-h-0">
              {/* Left: cape shape preview */}
              <div className="w-[200px] flex-shrink-0 flex flex-col items-center justify-center gap-3 p-4 border-r border-border bg-bg-card/40">
                {(() => {
                  const cape = selectedCapeId ? allCapes.find(c => c.id === selectedCapeId) : null
                  return cape?.texture
                    ? <CapePreviewCanvas texture={cape.texture} width={120} height={192} />
                    : <div className="w-[120px] h-[192px] rounded-xl bg-bg-hover/40 flex items-center justify-center text-text-muted/30 text-xs">Sin capa</div>
                })()}
                <p className="text-sm font-medium text-text-primary text-center leading-tight">
                  {selectedCapeId ? (allCapes.find(c => c.id === selectedCapeId)?.alias || 'Capa') : 'Sin capa'}
                </p>
              </div>
              {/* Right: cape grid */}
              <div className="flex-1 overflow-y-auto p-4">
                {loadingCapes ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-text-muted text-sm">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                    Cargando capas...
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <button onClick={() => setSelectedCapeId(null)}
                      className={`bg-bg-card border rounded-xl p-3 flex flex-col items-center gap-2 transition-colors hover:border-accent/40 ${selectedCapeId === null ? 'border-accent/60 bg-accent/5' : 'border-border'}`}>
                      <div className="w-16 h-16 rounded bg-bg-hover flex items-center justify-center">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted/50">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </div>
                      <p className="text-xs text-text-primary">Sin capa</p>
                    </button>
                    {allCapes.map(cape => (
                      <button key={cape.id} onClick={() => setSelectedCapeId(cape.id)}
                        className={`bg-bg-card border rounded-xl p-3 flex flex-col items-center gap-2 transition-colors hover:border-accent/40 ${selectedCapeId === cape.id ? 'border-accent/60 bg-accent/5' : 'border-border'}`}>
                        {cape.texture
                          ? <CapePreviewCanvas texture={cape.texture} width={50} height={80} />
                          : <div className="w-[50px] h-[80px] rounded bg-bg-hover flex items-center justify-center text-text-muted/40 text-xs">?</div>}
                        <p className="text-xs text-text-primary text-center leading-tight">{cape.alias || cape.id.slice(0, 8)}</p>
                        {cape.state === 'ACTIVE' && <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded-full">Activa</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-border flex-shrink-0">
              <button onClick={() => setCapeSelector(false)}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary border border-border hover:border-accent/40 rounded-lg transition-colors">
                Cancelar
              </button>
              <button onClick={equipCape} disabled={equipping}
                className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
                {equipping && <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>}
                {equipping ? 'Aplicando...' : 'Aceptar'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

// ── Skin browse card ─────────────────────────────────────────────────────────

function SkinBrowseCard({ skin, onApply, onSave }: {
  skin: SkindexResult
  onApply: () => void
  onSave: () => void
}) {
  const [loadingAction, setLoadingAction] = useState<'apply' | 'save' | null>(null)

  async function handle(type: 'apply' | 'save', fn: () => void) {
    setLoadingAction(type)
    try { await fn() } finally { setLoadingAction(null) }
  }

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden flex flex-col hover:border-accent/40 transition-colors group">
      <div className="relative aspect-square flex items-center justify-center bg-bg-secondary overflow-hidden">
        <img src={skin.renderUrl} alt={skin.name} draggable={false}
          className="w-full h-full object-contain"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
          <button onClick={() => handle('apply', onApply)} disabled={loadingAction !== null}
            className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-[11px] font-medium rounded-lg transition-colors disabled:opacity-50 w-[90%]">
            {loadingAction === 'apply' ? '...' : 'Aplicar'}
          </button>
          <button onClick={() => handle('save', onSave)} disabled={loadingAction !== null}
            className="px-3 py-1.5 bg-bg-secondary/90 hover:bg-bg-secondary text-text-primary text-[11px] rounded-lg transition-colors disabled:opacity-50 w-[90%]">
            {loadingAction === 'save' ? '...' : 'Guardar'}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-text-primary px-2 py-1.5 truncate">{skin.name}</p>
    </div>
  )
}
