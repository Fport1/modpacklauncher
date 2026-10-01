import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import type { Instance, ModpackManifest, DownloadProgress, PublishedModpack } from '../../../shared/types'
import FpackImportModal from '../components/FpackImportModal'
import FpackSaveModal from '../components/FpackSaveModal'
import QRDisplay from '../components/QRDisplay'
import jsQR from 'jsqr'

interface UpdateStatus {
  instanceId: string
  hasUpdate: boolean
  latestVersion?: string
  checking?: boolean
  /** No se pudo comprobar (sin red, enlace roto…) */
  failed?: boolean
}

/* ── QR scanner tab ─────────────────────────────────────────── */
function QRScanTab({ onResult }: { onResult: (url: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mirrored, setMirrored] = useState(false)
  const [camError, setCamError] = useState('')
  const [found, setFound] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const activeRef = useRef(true)
  const rafRef = useRef(0)

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(stream => {
        streamRef.current = stream
        const v = videoRef.current
        if (v) { v.srcObject = stream; v.play() }
      })
      .catch(e => setCamError(e?.message ?? 'Sin acceso a cámara'))
    return () => {
      activeRef.current = false
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  function startScan() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    function tick() {
      if (!activeRef.current) return
      if (video!.readyState >= video!.HAVE_ENOUGH_DATA && video!.videoWidth > 0) {
        canvas!.width = video!.videoWidth
        canvas!.height = video!.videoHeight
        ctx!.drawImage(video!, 0, 0)
        const img = ctx!.getImageData(0, 0, canvas!.width, canvas!.height)
        const code = jsQR(img.data, img.width, img.height)
        if (code?.data) {
          activeRef.current = false
          setFound(code.data)
          return
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  if (found) {
    return (
      <div className="text-center py-6">
        <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <p className="text-sm font-medium text-text-primary mb-1">¡QR detectado!</p>
        <p className="text-xs text-text-muted font-mono mb-4 break-all px-2 max-h-16 overflow-hidden">{found}</p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => { setFound(null); activeRef.current = true; startScan() }}
            className="px-3 py-1.5 border border-border text-text-secondary rounded-lg text-xs hover:text-text-primary transition-colors"
          >
            Reintentar
          </button>
          <button
            onClick={() => onResult(found)}
            className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-medium transition-colors"
          >
            Usar esta URL
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {camError ? (
        <div className="text-center py-8">
          <p className="text-sm text-red-400 mb-2">{camError}</p>
          <p className="text-xs text-text-muted">Asegúrate de permitir el acceso a la cámara.</p>
        </div>
      ) : (
        <>
          <div className="relative rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '16/9' }}>
            <video
              ref={videoRef}
              onPlay={startScan}
              className="w-full h-full object-cover"
              style={{ transform: mirrored ? 'scaleX(-1)' : 'none' }}
              playsInline
              muted
            />
            {/* Corner frame overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-44 h-44">
                <div className="absolute top-0 left-0 w-7 h-7 border-t-2 border-l-2 border-accent rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-7 h-7 border-t-2 border-r-2 border-accent rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-7 h-7 border-b-2 border-l-2 border-accent rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-7 h-7 border-b-2 border-r-2 border-accent rounded-br-lg" />
              </div>
            </div>
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <div className="flex items-center justify-between mt-2.5 px-0.5">
            <p className="text-xs text-text-muted">Apunta al código QR del modpack...</p>
            <button
              onClick={() => setMirrored(v => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-text-muted hover:text-text-primary border border-border rounded-lg transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
              </svg>
              {mirrored ? 'Normal' : 'Espejo'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/* ── QR popup modal ─────────────────────────────────────────── */
function QRModal({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-2xl p-6 w-[320px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-text-primary">Código QR</h2>
            <p className="text-xs text-text-muted truncate max-w-[200px]">{name}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="flex justify-center">
          <QRDisplay url={url} filename={`qr-${name.toLowerCase().replace(/\s+/g, '-')}.png`} size={220} />
        </div>
        <p className="text-[11px] text-text-muted text-center mt-3">Click derecho en el QR o usa el botón para guardar como PNG</p>
      </div>
    </div>
  )
}

/* ── Main page ───────────────────────────────────────────────── */
/** Icono de la instancia del modpack */
function ModpackIcon({ instanceId }: { instanceId: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { window.api.instances.getIcon(instanceId).then(setSrc).catch(() => setSrc(null)) }, [instanceId])
  return src ? <img src={src} alt="" className="w-full h-full object-cover" draggable={false} /> : <div className="w-full h-full bg-bg-hover" />
}

export default function ModpacksPage() {
  const instances = useStore((s) => s.instances)
  const pendingFpackFile = useStore(s => s.pendingFpackFile)
  const { addInstance, updateInstance: updateInstanceStore, setInstances, setPendingFpackFile, setOpenDetailInstanceId } = useStore()
  const navigate = useNavigate()

  const modpackInstances = instances.filter((i) => i.modpackUrl)

  const [urlInput, setUrlInput] = useState('')
  const [instanceName, setInstanceName] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [keyVisible, setKeyVisible] = useState(false)
  const [fetchedManifest, setFetchedManifest] = useState<ModpackManifest | null>(null)
  const [published, setPublished] = useState<PublishedModpack[]>([])
  const [copiedId, setCopiedId] = useState('')
  const [revealedId, setRevealedId] = useState('')
  const [revealedKeyId, setRevealedKeyId] = useState('')
  const [revealedInstId, setRevealedInstId] = useState('')
  const [copiedInstId, setCopiedInstId] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [statuses, setStatuses] = useState<Map<string, UpdateStatus>>(new Map())
  const [modal, setModal] = useState<'addUrl' | 'changelog' | null>(null)
  const [addTab, setAddTab] = useState<0 | 1 | 2>(0)
  const [changelogManifest, setChangelogManifest] = useState<ModpackManifest | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [installProgress, setInstallProgress] = useState<DownloadProgress | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  // QR modal
  const [qrTarget, setQrTarget] = useState<{ url: string; name: string } | null>(null)
  // .fpack import (from browse or OS open)
  const [fpackFile, setFpackFile] = useState<string | null>(null)
  // .fpack save (from modpack instance or published modpack)
  const [fpackSaveState, setFpackSaveState] = useState<{ instance: Instance; path: string; manifest?: ModpackManifest; modpackUrl?: string; accessKey?: string } | null>(null)

  useEffect(() => {
    window.api.instances.list().then(setInstances)
    window.api.modpacks.getPublished().then(setPublished)
  }, [])

  useEffect(() => {
    if (pendingFpackFile) {
      setFpackFile(pendingFpackFile)
      setPendingFpackFile(null)
    }
  }, [pendingFpackFile])

  useEffect(() => {
    if (modpackInstances.length === 0) return
    checkAllUpdates()
  }, [instances.length])

  async function checkAllUpdates() {
    for (const inst of modpackInstances) {
      if (!inst.modpackUrl) continue
      setStatuses((prev) => new Map(prev).set(inst.id, { instanceId: inst.id, hasUpdate: false, checking: true }))
      try {
        const result = await window.api.modpacks.checkUpdate(inst.id, inst.modpackUrl)
        setStatuses((prev) =>
          new Map(prev).set(inst.id, {
            instanceId: inst.id,
            hasUpdate: result.hasUpdate,
            latestVersion: result.manifest.version,
            checking: false
          })
        )
      } catch {
        setStatuses((prev) =>
          new Map(prev).set(inst.id, { instanceId: inst.id, hasUpdate: false, checking: false, failed: true })
        )
      }
    }
  }

  async function fetchManifest() {
    if (!urlInput.trim()) return
    setError('')
    setLoading(true)
    try {
      const manifest = await window.api.modpacks.fetch(urlInput.trim(), keyInput.trim() || undefined)
      setFetchedManifest(manifest)
      setInstanceName(manifest.name)
      setShowKeyInput(false)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to fetch manifest'
      if (msg === 'ENCRYPTED') {
        setShowKeyInput(true)
        setError('Este modpack está protegido con clave. Introdúcela abajo.')
      } else if ((e as { code?: string }).code === 'WRONG_KEY' || msg === 'Clave incorrecta') {
        setError('Clave incorrecta. Inténtalo de nuevo.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleInstall() {
    if (!fetchedManifest) return
    setError('')
    setLoading(true)
    try {
      const newInst = await window.api.instances.create({
        name: instanceName.trim() || fetchedManifest.name,
        minecraft: fetchedManifest.minecraft,
        modloader: fetchedManifest.modloader,
        modloaderVersion: fetchedManifest.modloaderVersion,
        description: fetchedManifest.description,
        modpackUrl: urlInput.trim(),
        modpackVersion: fetchedManifest.version,
        modpackKey: keyInput.trim() || undefined
      })
      closeAddModal()
      window.api.modpacks.install(newInst.id, fetchedManifest)
        .then(() => window.api.instances.list().then(setInstances))
        .catch(() => {})
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al crear la instancia')
      setLoading(false)
    }
  }

  function closeAddModal() {
    setModal(null)
    setFetchedManifest(null)
    setUrlInput('')
    setInstanceName('')
    setKeyInput('')
    setShowKeyInput(false)
    setError('')
    setAddTab(0)
  }

  async function copyInstanceUrl(inst: Instance) {
    if (!inst.modpackUrl) return
    await window.api.clipboard.writeText(inst.modpackUrl)
    setCopiedInstId(inst.id)
    setTimeout(() => setCopiedInstId(''), 2000)
  }

  async function copyPublishedUrl(modpack: PublishedModpack) {
    await window.api.clipboard.writeText(modpack.url)
    setCopiedId(modpack.id)
    setTimeout(() => setCopiedId(''), 2000)
  }

  async function deletePublished(id: string) {
    await window.api.modpacks.deletePublished(id)
    setPublished(prev => prev.filter(m => m.id !== id))
  }

  const [publishedFpackError, setPublishedFpackError] = useState<string | null>(null)

  async function saveFpackForPublished(mp: PublishedModpack) {
    // Find matching local instance: by modpackUrl first, then by name
    const match =
      instances.find(i => i.modpackUrl === mp.url) ??
      instances.find(i => i.name.toLowerCase() === mp.name.toLowerCase()) ??
      instances.find(i =>
        i.name.toLowerCase().includes(mp.name.toLowerCase()) ||
        mp.name.toLowerCase().includes(i.name.toLowerCase())
      )
    if (!match) {
      setPublishedFpackError(`No se encontró ninguna instancia local para "${mp.name}". Instala el modpack primero.`)
      setTimeout(() => setPublishedFpackError(null), 5000)
      return
    }
    // Fetch manifest from the published URL first — do this BEFORE the save dialog
    let manifest: ModpackManifest | undefined
    try {
      manifest = await window.api.modpacks.fetch(mp.url, mp.accessKey ?? undefined)
    } catch (e: any) {
      setPublishedFpackError(`No se pudo obtener el manifiesto: ${e?.message ?? 'Error de red'}`)
      setTimeout(() => setPublishedFpackError(null), 6000)
      return
    }
    const filePath = await window.api.fpack.choosePath(match.id)
    if (!filePath) return
    setFpackSaveState({ instance: match, path: filePath, manifest, modpackUrl: mp.url, accessKey: mp.accessKey ?? undefined })
  }

  async function handleUpdate(inst: Instance) {
    if (!inst.modpackUrl) return
    setStatuses((prev) => new Map(prev).set(inst.id, { instanceId: inst.id, hasUpdate: false, checking: true }))
    try {
      const result = await window.api.modpacks.update(inst.id, inst.modpackUrl)
      if (!result.upToDate) {
        updateInstanceStore({ ...inst, modpackVersion: result.manifest.version })
        setChangelogManifest(result.manifest)
        setModal('changelog')
      }
      setStatuses((prev) =>
        new Map(prev).set(inst.id, { instanceId: inst.id, hasUpdate: false, latestVersion: result.manifest.version, checking: false })
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Update failed')
      setStatuses((prev) => new Map(prev).set(inst.id, { instanceId: inst.id, hasUpdate: false, checking: false }))
    }
  }

  async function saveFpackForInst(inst: Instance) {
    let manifest: ModpackManifest | undefined
    if (inst.modpackUrl) {
      try {
        manifest = await window.api.modpacks.fetch(inst.modpackUrl)
      } catch {
        // fall through — saveFpackLocally will try local .modpack-meta.json
      }
    }
    const filePath = await window.api.fpack.choosePath(inst.id)
    if (filePath) setFpackSaveState({ instance: inst, path: filePath, manifest })
  }

  const ADD_METHODS: { tab: 0 | 1 | 2; title: string; hint: string; icon: JSX.Element }[] = [
    { tab: 0, title: 'Con un enlace', hint: 'Pega la URL que te pasó el creador',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg> },
    { tab: 1, title: 'Con un archivo .fpack', hint: 'El archivo que te enviaron',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg> },
    { tab: 2, title: 'Con un código QR', hint: 'Escanéalo con la cámara',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM17 17h3v3h-3zM14 20h3" /></svg> },
  ]

  return (
    <div className="h-full overflow-y-auto">
      {/* ── Cabecera ── */}
      <div className="relative overflow-hidden border-b border-border" style={{ background: 'linear-gradient(115deg, rgba(168,85,247,0.22), rgba(34,197,94,0.08) 55%, transparent 90%)' }}>
        <div className="px-8 pt-7 pb-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h1 className="text-2xl font-bold text-text-primary">Modpacks</h1>
              <p className="text-sm text-text-secondary mt-0.5">Instala modpacks de otros y se mantienen al día solos. Para compartir el tuyo, usa «Exportar modpack» en una instancia.</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={checkAllUpdates} disabled={modpackInstances.length === 0}
                className="flex items-center gap-1.5 px-3.5 py-2 border border-border bg-black/20 text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors disabled:opacity-40">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
                Buscar actualizaciones
              </button>
              <button onClick={() => navigate('/instances')}
                className="flex items-center gap-1.5 px-3.5 py-2 border border-border bg-black/20 text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" /></svg>
                Compartir el mío
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {ADD_METHODS.map(m => (
              <button key={m.tab} onClick={() => { setModal('addUrl'); setAddTab(m.tab) }}
                className="group flex items-center gap-3 p-3.5 rounded-2xl bg-black/25 border border-white/10 hover:border-[#a855f7]/50 text-left transition-colors">
                <span className="w-10 h-10 rounded-xl bg-[#a855f7]/20 text-[#c084fc] flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105">{m.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-primary">{m.title}</span>
                  <span className="block text-[11px] text-text-muted truncate">{m.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-8 py-6">
      <h2 className="text-sm font-semibold text-text-primary mb-3">Instalados {modpackInstances.length > 0 && <span className="text-text-muted font-normal">· {modpackInstances.length}</span>}</h2>
      {modpackInstances.length === 0 ? (
        <div className="text-center py-14 border border-dashed border-border rounded-2xl">
          <div className="w-14 h-14 rounded-2xl bg-[#a855f7]/15 text-[#c084fc] flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></svg>
          </div>
          <p className="text-text-secondary mb-1">Todavía no tienes modpacks instalados</p>
          <p className="text-xs text-text-muted">Elige arriba cómo te lo han pasado: un enlace, un archivo .fpack o un código QR.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {modpackInstances.map((inst) => {
            const status = statuses.get(inst.id)
            const iconBtn = 'w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors'
            return (
              <div key={inst.id} className={`rounded-2xl bg-bg-card border p-4 transition-colors ${status?.hasUpdate ? 'border-accent/50' : 'border-border hover:border-white/20'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 ring-1 ring-white/10"><ModpackIcon instanceId={inst.id} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-text-primary truncate">{inst.name}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[10px] font-semibold bg-[#a855f7]/15 text-[#d8b4fe] px-1.5 py-0.5 rounded-md">v{inst.modpackVersion ?? '?'}</span>
                      <span className="text-[11px] text-text-muted">MC {inst.minecraft} · {inst.modloader}</span>
                    </div>
                  </div>
                </div>

                <div className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-xl text-xs ${status?.hasUpdate ? 'bg-accent/10 text-accent' : status?.checking || !status ? 'bg-bg-hover text-text-muted' : status.failed ? 'bg-amber-500/10 text-amber-300' : 'bg-green-500/10 text-green-300'}`}>
                  {status?.checking ? (
                    <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9" /></svg>Comprobando…</>
                  ) : status?.hasUpdate ? (
                    <>
                      <span className="flex-1">Nueva versión disponible{status.latestVersion ? `: v${status.latestVersion}` : ''}</span>
                      <button onClick={() => handleUpdate(inst)} className="px-3 py-1 rounded-lg bg-accent hover:bg-accent-hover text-white font-semibold">Actualizar</button>
                    </>
                  ) : status?.failed ? (
                    <>No se pudo comprobar (sin conexión o el enlace ya no existe)</>
                  ) : (
                    <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>{status ? 'Al día' : 'Sin comprobar todavía'}</>
                  )}
                </div>

                <div className="mt-2 flex items-center gap-0.5">
                  <p className="flex-1 min-w-0 text-[11px] text-text-muted truncate font-mono pr-2">
                    {revealedInstId === inst.id ? inst.modpackUrl : '•••••••••••••••••••••••••'}
                  </p>
                  <button onClick={() => setRevealedInstId(prev => prev === inst.id ? '' : inst.id)} className={iconBtn} title={revealedInstId === inst.id ? 'Ocultar enlace' : 'Mostrar enlace'}>
                    {revealedInstId === inst.id
                      ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                      : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>}
                  </button>
                  <button onClick={() => copyInstanceUrl(inst)} className={iconBtn} title="Copiar enlace">
                    {copiedInstId === inst.id
                      ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400"><polyline points="20 6 9 17 4 12" /></svg>
                      : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>}
                  </button>
                  {inst.modpackUrl && (
                    <button onClick={() => setQrTarget({ url: inst.modpackUrl!, name: inst.name })} className={iconBtn} title="Ver QR para compartir">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM17 17h3v3h-3zM14 20h3" /></svg>
                    </button>
                  )}
                  <button onClick={() => saveFpackForInst(inst)} className={iconBtn} title="Guardar como .fpack">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
                  </button>
                  <button onClick={() => { setOpenDetailInstanceId(inst.id); navigate('/instances') }} className={iconBtn} title="Abrir la instancia">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Published modpacks */}
      {published.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Mis modpacks publicados</h2>
          <div className="space-y-3">
            {Object.entries(
              published.reduce<Record<string, PublishedModpack[]>>((acc, mp) => {
                ;(acc[mp.name] ??= []).push(mp)
                return acc
              }, {})
            ).map(([groupName, versions]) => {
              const isCollapsed = !expandedGroups.has(groupName)
              const toggleCollapse = () => setExpandedGroups(prev => {
                const next = new Set(prev)
                next.has(groupName) ? next.delete(groupName) : next.add(groupName)
                return next
              })
              return (
                <div key={groupName} className="bg-bg-card border border-border rounded-xl overflow-hidden">
                  <button onClick={toggleCollapse} className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-bg-hover transition-colors">
                    <p className="text-sm font-semibold text-text-primary">{groupName}</p>
                    <span className="text-[10px] text-text-muted bg-bg-hover px-1.5 py-0.5 rounded-full">{versions.length} versión{versions.length !== 1 ? 'es' : ''}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`ml-auto text-text-muted transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  {!isCollapsed && (
                    <div className="divide-y divide-border/40 border-t border-border/60">
                      {versions.sort((a, b) => b.publishedAt - a.publishedAt).map(mp => (
                        <div key={mp.id} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded-full flex-shrink-0">v{mp.version}</span>
                              <span className="text-xs text-text-muted flex-shrink-0">MC {mp.minecraft} · {mp.modloader}</span>
                            </div>
                            <p className="text-[11px] text-text-muted mt-0.5 truncate font-mono">
                              {revealedId === mp.id ? mp.url : '••••••••••••••••••••••••••••••••••••'}
                            </p>
                            {mp.accessKey && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400 flex-shrink-0">
                                  <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                                </svg>
                                <p className="text-[11px] text-amber-400/80 truncate font-mono flex-1">
                                  {revealedKeyId === mp.id ? mp.accessKey : '••••••••••••••'}
                                </p>
                                <button onClick={() => setRevealedKeyId(prev => prev === mp.id ? '' : mp.id)}
                                  className="flex-shrink-0 p-1 text-amber-400/60 hover:text-amber-400 transition-colors"
                                  title={revealedKeyId === mp.id ? 'Ocultar clave' : 'Ver clave'}>
                                  {revealedKeyId === mp.id
                                    ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                    : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                  }
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {/* Show URL */}
                            <button onClick={() => setRevealedId(prev => prev === mp.id ? '' : mp.id)} className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors" title={revealedId === mp.id ? 'Ocultar' : 'Mostrar URL'}>
                              {revealedId === mp.id
                                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                              }
                            </button>
                            {/* Copy URL */}
                            <button onClick={() => copyPublishedUrl(mp)} className="w-7 h-7 flex items-center justify-center transition-colors" title="Copiar URL">
                              {copiedId === mp.id
                                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400"><polyline points="20 6 9 17 4 12"/></svg>
                                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted hover:text-text-primary"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                              }
                            </button>
                            {/* QR */}
                            <button onClick={() => setQrTarget({ url: mp.url, name: `${mp.name} v${mp.version}` })} className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors" title="Ver QR">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                                <rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none"/>
                                <path d="M14 14h3v3h-3zM17 17h3v3h-3zM14 20h3"/>
                              </svg>
                            </button>
                            {/* Save as .fpack */}
                            <button onClick={() => saveFpackForPublished(mp)} className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors" title="Guardar como .fpack">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                                <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                              </svg>
                            </button>
                            {/* Delete */}
                            <button onClick={() => deletePublished(mp.id)} className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors" title="Eliminar">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Add Modpack Modal ── */}
      {modal === 'addUrl' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-bg-secondary border border-border rounded-2xl w-[520px] shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4">
              <h2 className="text-lg font-bold text-text-primary">Añadir Modpack</h2>
              <button onClick={closeAddModal} className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border px-6">
              {(['URL', 'Archivo .fpack', 'Escanear QR'] as const).map((label, i) => (
                <button
                  key={i}
                  onClick={() => setAddTab(i as 0 | 1 | 2)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${addTab === i ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-secondary'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="p-6">
              {/* Tab 0: URL */}
              {addTab === 0 && (
                <div className="space-y-4">
                  <p className="text-xs text-text-muted">
                    Introduce la URL del archivo JSON del modpack. Puedes obtenerla tras publicar desde la pestaña Instancias.
                  </p>
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">URL del manifiesto</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && fetchManifest()}
                        placeholder="https://ejemplo.com/modpack.json"
                        className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                        autoFocus
                      />
                      <button
                        onClick={fetchManifest}
                        disabled={loading || !urlInput.trim()}
                        className="px-3 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white text-sm rounded-lg transition-colors"
                      >
                        Fetch
                      </button>
                    </div>
                  </div>

                  {showKeyInput && (
                    <div>
                      <label className="block text-xs text-text-muted mb-1.5">🔒 Clave de acceso</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={keyVisible ? 'text' : 'password'}
                            value={keyInput}
                            onChange={(e) => setKeyInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && fetchManifest()}
                            placeholder="Introduce la clave del modpack"
                            autoFocus
                            className="w-full bg-bg-primary border border-amber-500/50 rounded-lg px-3 py-2 pr-9 text-sm text-text-primary focus:outline-none focus:border-amber-500"
                          />
                          <button type="button" onClick={() => setKeyVisible(v => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                            {keyVisible
                              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            }
                          </button>
                        </div>
                        <button
                          onClick={fetchManifest}
                          disabled={loading || !keyInput.trim()}
                          className="px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/40 text-white text-sm rounded-lg transition-colors whitespace-nowrap"
                        >
                          Desbloquear
                        </button>
                      </div>
                    </div>
                  )}

                  {fetchedManifest && (
                    <div className="bg-bg-primary border border-accent/30 rounded-lg p-4">
                      <p className="font-semibold text-text-primary">{fetchedManifest.name}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        v{fetchedManifest.version} · MC {fetchedManifest.minecraft} · {fetchedManifest.modloader}
                      </p>
                      {fetchedManifest.description && (
                        <p className="text-xs text-text-secondary mt-2">{fetchedManifest.description}</p>
                      )}
                      <p className="text-xs text-text-muted mt-2">
                        {fetchedManifest.files?.length ?? fetchedManifest.mods?.length ?? 0} archivos
                      </p>
                    </div>
                  )}

                  {fetchedManifest && (
                    <div>
                      <label className="block text-xs text-text-muted mb-1.5">Nombre de la instancia</label>
                      <input
                        value={instanceName}
                        onChange={(e) => setInstanceName(e.target.value)}
                        placeholder={fetchedManifest.name}
                        className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                      />
                      <p className="text-[11px] text-text-muted mt-1">
                        MC {fetchedManifest.minecraft} · {fetchedManifest.modloader}
                      </p>
                    </div>
                  )}

                  {installProgress && (
                    <div>
                      <div className="flex justify-between items-center text-xs text-text-muted mb-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <svg className="animate-spin w-3 h-3 flex-shrink-0 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                          <span className="truncate">{installProgress.message}</span>
                        </div>
                        <span className="flex-shrink-0 ml-2">
                          {installProgress.total > 0 ? `${Math.round((installProgress.current / installProgress.total) * 100)}%` : ''}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-bg-hover rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full transition-all duration-300"
                          style={{ width: installProgress.total > 0 ? `${Math.round((installProgress.current / installProgress.total) * 100)}%` : '20%' }}
                        />
                      </div>
                    </div>
                  )}

                  {error && <p className="text-sm text-red-400">{error}</p>}

                  <div className="flex gap-3">
                    <button onClick={closeAddModal} disabled={loading} className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary disabled:opacity-40 rounded-lg text-sm transition-colors">
                      Cancelar
                    </button>
                    {fetchedManifest && (
                      <button onClick={handleInstall} disabled={loading} className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium transition-colors">
                        {loading ? 'Instalando...' : 'Instalar Modpack'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 1: .fpack file */}
              {addTab === 1 && (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-4 text-3xl">
                    📦
                  </div>
                  <p className="text-sm font-medium text-text-primary mb-1">Instalar desde archivo .fpack</p>
                  <p className="text-xs text-text-muted mb-6 max-w-xs mx-auto">
                    Selecciona un archivo .fpack que hayas descargado de otro jugador o exportado desde el launcher.
                  </p>
                  <button
                    onClick={async () => {
                      const path = await window.api.fpack.browse()
                      if (path) { closeAddModal(); setFpackFile(path) }
                    }}
                    className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                    </svg>
                    Buscar archivo .fpack...
                  </button>
                  <button onClick={closeAddModal} className="mt-4 text-xs text-text-muted hover:text-text-primary transition-colors">
                    Cancelar
                  </button>
                </div>
              )}

              {/* Tab 2: QR scan */}
              {addTab === 2 && (
                <QRScanTab
                  onResult={url => {
                    setUrlInput(url)
                    setAddTab(0)
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Changelog Modal */}
      {modal === 'changelog' && changelogManifest && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-bg-secondary border border-border rounded-2xl p-6 w-[440px] shadow-2xl">
            <h2 className="text-lg font-bold text-text-primary mb-1">
              Actualizado a v{changelogManifest.version}
            </h2>
            <p className="text-sm text-text-muted mb-4">{changelogManifest.name}</p>
            {changelogManifest.changelog ? (
              <div className="bg-bg-primary rounded-lg p-4 text-sm text-text-secondary whitespace-pre-wrap mb-5 max-h-40 overflow-y-auto">
                {changelogManifest.changelog}
              </div>
            ) : (
              <p className="text-sm text-text-muted mb-5">Sin changelog.</p>
            )}
            <button
              onClick={() => setModal(null)}
              className="w-full py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
            >
              Listo
            </button>
          </div>
        </div>
      )}

      {/* Error toast for published .fpack */}
      {publishedFpackError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] bg-red-500/90 text-white text-sm px-4 py-2.5 rounded-xl shadow-xl max-w-sm text-center">
          {publishedFpackError}
        </div>
      )}

      {/* QR modal */}
      {qrTarget && (
        <QRModal url={qrTarget.url} name={qrTarget.name} onClose={() => setQrTarget(null)} />
      )}

      {/* .fpack import modal */}
      {fpackFile && (
        <FpackImportModal
          filePath={fpackFile}
          onClose={() => setFpackFile(null)}
          onInstalled={inst => {
            addInstance(inst)
            setFpackFile(null)
          }}
        />
      )}

      {/* .fpack save modal */}
      {fpackSaveState && (
        <FpackSaveModal
          instance={fpackSaveState.instance}
          outputPath={fpackSaveState.path}
          manifest={fpackSaveState.manifest}
          modpackUrl={fpackSaveState.modpackUrl}
          accessKey={fpackSaveState.accessKey}
          onClose={() => setFpackSaveState(null)}
        />
      )}
      </div>
    </div>
  )
}
