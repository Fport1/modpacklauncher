import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, activeAccount } from '../store'
import * as skinview3d from 'skinview3d'
import ZoomableImage from '../components/ZoomableImage'

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
  }, [skin, cape, width, height, autoRotate, interactive, model])

  return <canvas ref={canvasRef} className={`rounded-xl ${interactive ? '' : 'pointer-events-none'}`} />
}

// ── Apply skin modal ─────────────────────────────────────────────────────────

function ApplySkinModal({ skinData, onApply, onClose }: {
  skinData: string
  onApply: (model: SkinModel) => Promise<void>
  onClose: () => void
}) {
  const [model, setModel] = useState<SkinModel>('classic')
  const [status, setStatus] = useState<'idle' | 'applying' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function confirm() {
    setStatus('applying')
    setErrorMsg('')
    try {
      await onApply(model)
      setStatus('success')
      setTimeout(onClose, 1500)
    } catch (e: any) {
      setStatus('error')
      setErrorMsg(e?.message ?? 'Error desconocido')
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
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
      canvas: canvasRef.current, width: 300, height: 420,
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
    if (!account?.accessToken) throw new Error('No access token')
    await window.api.skins.apply(account.accessToken, skinBase64, model)
    const data = await window.api.skin.getTexture(account.uuid)
    if (data) setSkinData(data)
    setApplyModal(null)
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
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        Necesitas una cuenta Microsoft para ver tus skins.
      </div>
    )
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'mine',    label: 'Mi skin'   },
    { key: 'library', label: 'Librería'  },
    { key: 'browse',  label: 'Explorar'  },
  ]

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header + tabs */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-text-primary mb-1">Skins</h1>
        <div className="flex items-center gap-1 mt-3">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}>
              {t.label}
            </button>
          ))}
          <div className="ml-auto">
            <button onClick={() => navigate('/skin-editor')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs rounded-lg font-medium transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              Crear skin
            </button>
            <div className="absolute bottom-full right-0 mb-1.5 px-2 py-1 bg-bg-card border border-border text-text-secondary text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg">
              Próximamente
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab: Mi skin ── */}
      {tab === 'mine' && (
        <>
          {loading && (
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
              Cargando skin...
            </div>
          )}
          {error && !loading && <p className="text-sm text-red-400">{error}</p>}

          {skinData && !loading && (
            <div className="flex gap-5 items-start">
              {/* 3D viewer */}
              <div className="bg-bg-card border border-border rounded-2xl overflow-hidden flex flex-col items-center flex-shrink-0">
                <canvas ref={canvasRef} className="rounded-t-2xl" />
                <div className="flex items-center gap-2 px-4 py-2 border-t border-border w-full justify-center">
                  <button onClick={resetCamera}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-border hover:border-accent/40 rounded-lg transition-colors">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 12a9 9 0 109-9"/><polyline points="3 3 3 9 9 9"/>
                    </svg>
                    Restablecer
                  </button>
                  <span className="text-text-muted/30 text-[11px]">· Rot · Zoom · Pan</span>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                {/* Filters */}
                <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-4 pt-3 pb-2">
                    <p className="text-xs font-semibold text-text-primary uppercase tracking-wider">Partes visibles</p>
                  </div>
                  <div className="grid grid-cols-[1fr_44px_44px] text-[10px] text-text-muted uppercase tracking-wider px-4 pb-1.5 border-b border-border/50">
                    <span>Parte</span><span className="text-center">C1</span><span className="text-center">C2</span>
                  </div>
                  <div className="divide-y divide-border/30">
                    {PARTS.map(({ key, label, outerLabel }) => (
                      <div key={key} className="grid grid-cols-[1fr_44px_44px] items-center px-4 py-2 hover:bg-bg-hover/30 transition-colors">
                        <div>
                          <p className={`text-xs transition-colors ${filters[key].inner ? 'text-text-primary' : 'text-text-muted/40'}`}>{label}</p>
                          <p className={`text-[10px] transition-colors ${filters[key].outer ? 'text-text-muted' : 'text-text-muted/30'}`}>{outerLabel}</p>
                        </div>
                        <Checkbox active={filters[key].inner} onClick={() => toggleInner(key)} />
                        <Checkbox active={filters[key].outer} onClick={() => toggleOuter(key)} />
                      </div>
                    ))}
                  </div>
                  {hasCape && (
                    <div className="border-t border-border/50 px-4 py-2 space-y-1.5">
                      <div className="grid grid-cols-[1fr_44px_44px] items-center">
                        <p className={`text-xs ${filters.cape ? 'text-text-primary' : 'text-text-muted/40'}`}>Capa</p>
                        <Checkbox active={filters.cape} onClick={toggleCape} />
                        <div />
                      </div>
                      <button onClick={toggleElytra}
                        className={`flex items-center gap-1.5 w-full px-2 py-1 rounded-lg text-[11px] transition-colors ${elytra ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'}`}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2C6 2 2 8 2 12s2 6 4 7l6-7 6 7c2-1 4-3 4-7S18 2 12 2z"/></svg>
                        {elytra ? 'Mostrar como capa' : 'Ver como elytra'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Skin PNG + cape */}
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Skin</p>
                  <div className="relative group cursor-pointer" onClick={() => setSkinLightbox(true)}>
                    <div className="bg-bg-card border border-border hover:border-accent/40 rounded-xl p-2 transition-colors">
                      <img src={skinData.skin} alt="skin" draggable={false}
                        style={{ imageRendering: 'pixelated', width: 96, height: 96 }} className="rounded" />
                    </div>
                    <button onClick={e => { e.stopPropagation(); downloadSkin() }} title="Descargar"
                      className="absolute -bottom-2 -right-2 w-7 h-7 rounded-full bg-accent hover:bg-accent-hover text-white flex items-center justify-center shadow-lg transition-colors z-10">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                    </button>
                  </div>

                  {/* Reload skin */}
                  <button onClick={loadSkin} disabled={loading}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] border border-border hover:border-accent/40 rounded-lg text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50">
                    <svg className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                    </svg>
                    Recargar
                  </button>

                  {/* Save to library */}
                  <button onClick={saveCurrentToLibrary}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] border border-border hover:border-accent/40 rounded-lg text-text-secondary hover:text-text-primary transition-colors">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    Guardar en librería
                  </button>

                  {hasCape && (
                    <>
                      <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mt-1">Capa</p>
                      <button onClick={openCapeSelector}
                        className="bg-bg-card border border-border hover:border-accent/40 rounded-xl overflow-hidden transition-colors group relative flex items-center justify-center p-3">
                        {skinData.cape
                          ? <CapePreviewCanvas texture={skinData.cape} width={56} height={90} />
                          : <div className="w-[56px] h-[90px] rounded bg-bg-hover/50" />}
                        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 group-hover:bg-black/40 transition-colors">
                          <span className="text-[10px] text-white font-medium opacity-0 group-hover:opacity-100 transition-opacity">Ver capas</span>
                        </div>
                      </button>
                    </>
                  )}

                  <p className="text-xs text-text-muted mt-1">{account.username}</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Tab: Librería ── */}
      {tab === 'library' && (
        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div />
            <button onClick={() => setNewSkinModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nuevo
            </button>
          </div>

          {/* ── Tus skins guardadas ── */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">Tus skins guardadas</p>
          </div>

          {libLoading && (
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
              Cargando...
            </div>
          )}

          {!libLoading && library.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-text-muted gap-3">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-30">
                <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
              </svg>
              <p className="text-sm">No tienes skins guardadas</p>
              <p className="text-xs">Pulsa "Nuevo" para añadir una skin o guarda la actual desde "Mi skin"</p>
            </div>
          )}

          {!libLoading && library.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4 mb-8">
              {library.map(entry => (
                <div key={entry.id} className="bg-bg-card border border-border rounded-xl overflow-hidden flex flex-col group hover:border-accent/40 transition-colors">
                  <div className="flex items-center justify-center pt-2 bg-bg-hover/20">
                    <SkinViewer3D skin={entry.data} width={110} height={150} autoRotate={false} model={entry.model} />
                  </div>
                  <div className="px-3 pb-3 flex flex-col gap-2">
                    <p className="text-xs font-medium text-text-primary truncate mt-1">{entry.name}</p>
                    <p className="text-[10px] text-text-muted">{entry.model === 'slim' ? 'Brazos delgados' : 'Brazos gruesos'}</p>

                    {confirmDeleteId === entry.id ? (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-[10px] text-red-400 text-center">¿Eliminar permanentemente?</p>
                        <div className="flex gap-1.5">
                          <button onClick={() => setConfirmDeleteId(null)}
                            className="flex-1 py-1.5 text-[11px] border border-border hover:border-accent/40 text-text-secondary rounded-lg transition-colors">
                            Cancelar
                          </button>
                          <button onClick={() => { deleteFromLibrary(entry.id); setConfirmDeleteId(null) }}
                            className="flex-1 py-1.5 text-[11px] bg-red-500/15 hover:bg-red-500/25 text-red-400 rounded-lg transition-colors font-medium">
                            Eliminar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <button onClick={() => setApplyModal(entry.data)}
                          className="flex-1 py-1.5 text-[11px] bg-accent/15 hover:bg-accent/25 text-accent rounded-lg transition-colors font-medium">
                          Aplicar
                        </button>
                        <button onClick={() => setEditingLibrarySkin(entry)}
                          title="Editar skin"
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-border hover:border-accent/40 hover:text-accent text-text-muted transition-colors">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                        </button>
                        <button onClick={() => {
                          const a = document.createElement('a')
                          a.href = entry.data
                          a.download = `${entry.name}.png`
                          a.click()
                        }} title="Guardar PNG en el equipo"
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-border hover:border-accent/40 hover:text-accent text-text-muted transition-colors">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                        </button>
                        <button onClick={() => setConfirmDeleteId(entry.id)} title="Eliminar"
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-border hover:border-red-500/40 hover:text-red-400 text-text-muted transition-colors">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Skins por defecto de Minecraft ── */}
          <div className="mt-8 mb-6">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-3">Skins de Minecraft</p>
            {defaultsLoading ? (
              <div className="flex items-center gap-2 text-text-muted text-sm">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                Cargando...
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
                {defaultSkins.map(skin => (
                  <div key={skin.name} className="bg-bg-card border border-border rounded-xl overflow-hidden flex flex-col hover:border-accent/40 transition-colors">
                    <div className="flex items-center justify-center pt-2 bg-bg-hover/20">
                      <SkinViewer3D skin={skin.data} width={100} height={140} autoRotate={false} model={skin.model} />
                    </div>
                    <div className="px-3 pb-3 flex flex-col gap-2">
                      <p className="text-xs font-medium text-text-primary truncate mt-1">{skin.name}</p>
                      <p className="text-[10px] text-text-muted">{skin.model === 'slim' ? 'Brazos delgados' : 'Brazos gruesos'}</p>
                      <div className="flex gap-1.5">
                        <button onClick={() => setApplyModal(skin.data)}
                          className="flex-1 py-1.5 text-[11px] bg-accent/15 hover:bg-accent/25 text-accent rounded-lg transition-colors font-medium">
                          Aplicar
                        </button>
                        <button onClick={() => window.api.skins.saveToLibrary({ name: skin.name, model: skin.model, data: skin.data }).then(e => setLibrary(prev => [...prev, e]))}
                          title="Guardar en librería"
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-border hover:border-accent/40 hover:text-accent text-text-muted transition-colors">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
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
              className="flex-1 bg-bg-card border border-border focus:border-accent/50 rounded-lg px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted transition-colors" />
            <button type="submit" disabled={searching}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
              {searching
                ? <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
              Buscar
            </button>
            <button type="button" onClick={() => { setSearchQuery(''); doSearch('') }}
              className="px-3 py-2 border border-border hover:border-accent/40 text-text-secondary hover:text-text-primary text-sm rounded-lg transition-colors">
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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
                {searchResults.map(skin => (
                  <button key={skin.id}
                    onClick={() => { setSelectedBrowseSkin(skin); setBrowseSaveStatus('idle') }}
                    className={`bg-bg-card border rounded-xl overflow-hidden flex flex-col items-center hover:border-accent/40 transition-colors ${selectedBrowseSkin?.id === skin.id ? 'border-accent/60' : 'border-border'}`}>
                    <div className="w-full aspect-square bg-bg-secondary flex items-center justify-center overflow-hidden p-2">
                      {skin.textureData
                        ? <SkinHeadCanvas skin={skin.textureData} size={80} />
                        : <div className="w-full h-full bg-bg-hover/40 rounded" />}
                    </div>
                    <p className="text-[11px] text-text-primary px-2 py-1.5 w-full text-center truncate font-medium">{skin.name}</p>
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
