import { useEffect, useRef, useState } from 'react'
import { useStore, activeAccount } from '../store'
import InstanceCard from '../components/InstanceCard'
import InstanceDetailModal from '../components/InstanceDetailModal'
import RamSlider from '../components/RamSlider'
import type { Instance, Modloader, ModpackManifest } from '../../../shared/types'

type ModalStep = 'choose' | 'modpack' | 'manual'
type EditMode = 'edit'

const MODLOADERS: Modloader[] = ['vanilla', 'forge', 'fabric', 'quilt', 'neoforge']

function javaLabel(mc: string) {
  if (/^\d{2}w\d{2}[a-z]$/i.test(mc)) return 'Java 21'
  const minor = parseInt(mc.split('.')[1] ?? '0')
  const patch = parseInt(mc.split('.')[2] ?? '0')
  if (minor >= 21 || (minor === 20 && patch >= 5)) return 'Java 21'
  if (minor >= 17) return 'Java 17'
  return 'Java 8'
}

/* ─── Reusable X close button ─────────────────────────────── */
function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  )
}

/* ─── Main component ───────────────────────────────────────── */
export default function InstancesPage() {
  const { instances, setInstances, addInstance, updateInstance, removeInstance } = useStore()
  const account = useStore(activeAccount)
  const runningInstances = useStore(s => s.runningInstances)

  const [modalStep, setModalStep] = useState<ModalStep | EditMode | null>(null)
  const [editing, setEditing] = useState<Instance | null>(null)
  const [detailInstance, setDetailInstance] = useState<Instance | null>(null)
  const [launching, setLaunching] = useState<string | null>(null)
  const [systemRam, setSystemRam] = useState(8192)

  /* ── MC + loader version lists ── */
  const [mcVersions, setMcVersions] = useState<Array<{ id: string; type: string }>>([])
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [loaderVersions, setLoaderVersions] = useState<string[]>([])
  const [loadingMc, setLoadingMc] = useState(false)
  const [loadingLoader, setLoadingLoader] = useState(false)
  const loaderFetchKey = useRef(0) // cancel stale fetches

  /* ── Manual form ── */
  const [form, setForm] = useState({
    name: '',
    minecraft: '1.20.1',
    modloader: 'vanilla' as Modloader,
    modloaderVersion: '',
    description: '',
    maxMemory: 4096,
    minMemory: 512,
    javaPath: ''
  })
  const [javaStatus, setJavaStatus] = useState<{ found: boolean; required: number } | null>(null)
  const [formError, setFormError] = useState('')

  /* ── Modpack flow ── */
  const [modpackUrl, setModpackUrl] = useState('')
  const [modpackManifest, setModpackManifest] = useState<ModpackManifest | null>(null)
  const [modpackName, setModpackName] = useState('')
  const [modpackLoading, setModpackLoading] = useState(false)
  const [modpackError, setModpackError] = useState('')

  useEffect(() => {
    window.api.instances.list().then(setInstances)
    window.api.system.getRam().then(setSystemRam)
  }, [])

  /* ── Load MC versions when manual modal opens ── */
  useEffect(() => {
    if (modalStep !== 'manual' && modalStep !== 'edit') return
    if (mcVersions.length > 0) return
    setLoadingMc(true)
    window.api.launcher.getMcVersions()
      .then(setMcVersions)
      .finally(() => setLoadingMc(false))
  }, [modalStep])

  /* ── Load modloader versions when modloader/MC changes ── */
  useEffect(() => {
    if (modalStep !== 'manual' && modalStep !== 'edit') return
    if (form.modloader === 'vanilla') { setLoaderVersions([]); return }

    const key = ++loaderFetchKey.current
    setLoadingLoader(true)
    setLoaderVersions([])
    setForm(f => ({ ...f, modloaderVersion: '' }))

    const fetch = async (): Promise<string[]> => {
      switch (form.modloader) {
        case 'forge':    return window.api.launcher.getForgeVersions(form.minecraft)
        case 'fabric':   return window.api.launcher.getFabricVersions().then(v => v.map(x => x.version))
        case 'quilt':    return window.api.launcher.getQuiltVersions()
        case 'neoforge': return window.api.launcher.getNeoForgeVersions(form.minecraft)
        default:         return []
      }
    }

    fetch().then(versions => {
      if (loaderFetchKey.current !== key) return
      setLoaderVersions(versions)
      if (versions.length > 0) setForm(f => ({ ...f, modloaderVersion: versions[0] }))
    }).catch(() => {
      if (loaderFetchKey.current !== key) return
      setLoaderVersions([])
    }).finally(() => {
      if (loaderFetchKey.current === key) setLoadingLoader(false)
    })
  }, [form.modloader, form.minecraft, modalStep])

  /* ── Java check when MC version changes ── */
  useEffect(() => {
    if (modalStep !== 'manual' && modalStep !== 'edit') return
    let cancelled = false
    setJavaStatus(null)
    window.api.java.check(form.minecraft).then(s => {
      if (!cancelled) setJavaStatus(s)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [form.minecraft, modalStep])

  /* ── Open handlers ── */
  function openChoose() {
    setModpackUrl(''); setModpackManifest(null); setModpackName(''); setModpackError('')
    setFormError('')
    setEditing(null)
    setModalStep('choose')
  }

  function openManual() {
    setForm({ name: '', minecraft: mcVersions[0]?.id ?? '1.20.1', modloader: 'vanilla', modloaderVersion: '', description: '', maxMemory: 4096, minMemory: 512, javaPath: '' })
    setFormError('')
    setModalStep('manual')
  }

  function openEdit(inst: Instance) {
    setForm({
      name: inst.name,
      minecraft: inst.minecraft,
      modloader: inst.modloader,
      modloaderVersion: inst.modloaderVersion ?? '',
      description: inst.description ?? '',
      maxMemory: inst.maxMemory ?? 4096,
      minMemory: inst.minMemory ?? 512,
      javaPath: inst.javaPath ?? ''
    })
    setEditing(inst)
    setFormError('')
    setModalStep('edit')
  }

  function closeModal() { setModalStep(null); setEditing(null) }

  /* ── Modpack fetch ── */
  async function fetchModpack() {
    if (!modpackUrl.trim()) return
    setModpackLoading(true); setModpackError('')
    try {
      const manifest = await window.api.modpacks.fetch(modpackUrl.trim())
      setModpackManifest(manifest)
      setModpackName(manifest.name)
    } catch (e: unknown) {
      setModpackError(e instanceof Error ? e.message : 'No se pudo obtener el manifiesto')
    } finally {
      setModpackLoading(false)
    }
  }

  async function createFromModpack() {
    if (!modpackManifest || !modpackName.trim()) { setModpackError('Introduce un nombre'); return }
    setModpackLoading(true); setModpackError('')
    try {
      const inst = await window.api.instances.create({
        name: modpackName.trim(),
        minecraft: modpackManifest.minecraft,
        modloader: modpackManifest.modloader,
        modloaderVersion: modpackManifest.modloaderVersion,
        modpackUrl: modpackUrl.trim(),
        modpackVersion: modpackManifest.version,
        maxMemory: 4096, minMemory: 512
      })
      addInstance(inst)
      // Install mods right away
      await window.api.modpacks.install(inst.id, modpackManifest)
      closeModal()
    } catch (e: unknown) {
      setModpackError(e instanceof Error ? e.message : 'Error al crear instancia')
    } finally {
      setModpackLoading(false)
    }
  }

  /* ── Manual save ── */
  async function saveManual() {
    if (!form.name.trim()) { setFormError('El nombre es requerido'); return }
    setFormError('')
    try {
      if (modalStep === 'edit' && editing) {
        const updated: Instance = {
          ...editing,
          name: form.name.trim(),
          minecraft: form.minecraft,
          modloader: form.modloader,
          modloaderVersion: form.modloaderVersion || undefined,
          description: form.description || undefined,
          maxMemory: form.maxMemory,
          minMemory: form.minMemory,
          javaPath: form.javaPath.trim() || undefined
        }
        await window.api.instances.update(updated)
        updateInstance(updated)
      } else {
        const inst = await window.api.instances.create({
          name: form.name.trim(),
          minecraft: form.minecraft,
          modloader: form.modloader,
          modloaderVersion: form.modloaderVersion || undefined,
          description: form.description || undefined,
          maxMemory: form.maxMemory,
          minMemory: form.minMemory,
          javaPath: form.javaPath.trim() || undefined
        })
        addInstance(inst)
      }
      closeModal()
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Error al guardar')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta instancia? Los mods se borrarán, pero las partidas guardadas se mantienen.')) return
    await window.api.instances.delete(id)
    removeInstance(id)
  }

  async function handlePlay(id: string) {
    if (!account) { alert('Selecciona una cuenta en Ajustes primero.'); return }
    if (runningInstances.size > 0 && !runningInstances.has(id)) {
      const ok = confirm('Ya hay una instancia de Minecraft en ejecución. ¿Abrir otra de todas formas?')
      if (!ok) return
    }
    setLaunching(id)
    try { await window.api.launcher.launch(id) }
    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error al lanzar') }
    finally { setLaunching(null) }
  }

  const visibleMcVersions = mcVersions.filter(v => showSnapshots || v.type === 'release')

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-text-primary">Instancias</h1>
        <button
          onClick={openChoose}
          className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nueva Instancia
        </button>
      </div>

      {instances.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-xl">
          <p className="text-text-muted mb-4">No hay instancias todavía</p>
          <button onClick={openChoose} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">
            Crear Instancia
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          {instances.map(inst => (
            <InstanceCard
              key={inst.id} instance={inst}
              onPlay={() => handlePlay(inst.id)}
              onKill={() => window.api.launcher.kill(inst.id)}
              onEdit={() => openEdit(inst)}
              onDelete={() => handleDelete(inst.id)}
              onOpenFolder={() => window.api.instances.openFolder(inst.id)}
              onDetails={() => setDetailInstance(inst)}
              isLaunching={launching === inst.id}
              isRunning={runningInstances.has(inst.id)}
            />
          ))}
        </div>
      )}

      {/* ── Instance detail modal ── */}
      {detailInstance && (
        <InstanceDetailModal
          instance={detailInstance}
          onClose={() => setDetailInstance(null)}
        />
      )}

      {/* ── Create/Edit modal overlay ── */}
      {modalStep && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">

          {/* ── STEP: choose ─────────────────────────────────────── */}
          {modalStep === 'choose' && (
            <div className="relative bg-bg-secondary border border-border rounded-2xl p-6 w-[480px] shadow-2xl">
              <CloseBtn onClick={closeModal} />
              <h2 className="text-lg font-bold text-text-primary mb-1">Nueva Instancia</h2>
              <p className="text-sm text-text-muted mb-6">¿Cómo quieres crear la instancia?</p>

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setModalStep('modpack')}
                  className="group flex flex-col items-center gap-3 p-6 bg-bg-card border border-border rounded-xl hover:border-accent/50 hover:bg-accent/5 transition-all text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-accent/10 group-hover:bg-accent/20 flex items-center justify-center transition-colors">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                      <polyline points="16 16 12 12 8 16" />
                      <line x1="12" y1="12" x2="12" y2="21" />
                      <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-text-primary text-sm">Instalar Modpack</p>
                    <p className="text-xs text-text-muted mt-0.5">Desde URL de manifiesto</p>
                  </div>
                </button>

                <button
                  onClick={openManual}
                  className="group flex flex-col items-center gap-3 p-6 bg-bg-card border border-border rounded-xl hover:border-accent/50 hover:bg-accent/5 transition-all text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-bg-hover group-hover:bg-accent/10 flex items-center justify-center transition-colors">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-secondary group-hover:text-accent transition-colors">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-text-primary text-sm">Instalación Manual</p>
                    <p className="text-xs text-text-muted mt-0.5">Configurar versiones tú mismo</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: modpack ────────────────────────────────────── */}
          {modalStep === 'modpack' && (
            <div className="relative bg-bg-secondary border border-border rounded-2xl p-6 w-[500px] shadow-2xl">
              <CloseBtn onClick={closeModal} />
              <button onClick={() => setModalStep('choose')} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary mb-4 transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                Volver
              </button>

              <h2 className="text-lg font-bold text-text-primary mb-1">Instalar Modpack</h2>
              <p className="text-sm text-text-muted mb-5">Pega la URL del archivo JSON del modpack.</p>

              <div className="space-y-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={modpackUrl}
                    onChange={e => setModpackUrl(e.target.value)}
                    placeholder="https://ejemplo.com/modpack.json"
                    className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                    onKeyDown={e => e.key === 'Enter' && fetchModpack()}
                  />
                  <button
                    onClick={fetchModpack}
                    disabled={modpackLoading || !modpackUrl.trim()}
                    className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {modpackLoading && !modpackManifest ? '...' : 'Obtener'}
                  </button>
                </div>

                {modpackManifest && (
                  <>
                    <div className="bg-bg-primary border border-accent/30 rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                            <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
                            <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
                          </svg>
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <p className="font-semibold text-text-primary">{modpackManifest.name}</p>
                          <p className="text-xs text-text-muted mt-0.5">
                            v{modpackManifest.version} · MC {modpackManifest.minecraft} · {modpackManifest.modloader}
                            {modpackManifest.modloaderVersion && ` ${modpackManifest.modloaderVersion}`}
                          </p>
                          <p className="text-xs text-text-muted mt-0.5">{modpackManifest.mods.length} mods</p>
                          {modpackManifest.description && (
                            <p className="text-xs text-text-secondary mt-1">{modpackManifest.description}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-text-muted mb-1.5">Nombre de la instancia</label>
                      <input
                        type="text"
                        value={modpackName}
                        onChange={e => setModpackName(e.target.value)}
                        className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>
                  </>
                )}

                {modpackError && <p className="text-sm text-red-400">{modpackError}</p>}
              </div>

              {modpackManifest && (
                <div className="flex gap-3 mt-5">
                  <button onClick={closeModal} className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">
                    Cancelar
                  </button>
                  <button
                    onClick={createFromModpack}
                    disabled={modpackLoading}
                    className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {modpackLoading ? 'Instalando...' : 'Crear e instalar'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── STEP: manual / edit ──────────────────────────────── */}
          {(modalStep === 'manual' || modalStep === 'edit') && (
            <div className="relative bg-bg-secondary border border-border rounded-2xl p-6 w-[500px] shadow-2xl max-h-[90vh] overflow-y-auto">
              <CloseBtn onClick={closeModal} />

              {modalStep === 'manual' && (
                <button onClick={() => setModalStep('choose')} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary mb-4 transition-colors">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                  Volver
                </button>
              )}

              <h2 className="text-lg font-bold text-text-primary mb-5">
                {modalStep === 'edit' ? 'Editar Instancia' : 'Instalación Manual'}
              </h2>

              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Nombre *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                    placeholder="Mi Instancia"
                  />
                </div>

                {/* MC version dropdown */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-text-muted">Versión de Minecraft</label>
                    <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showSnapshots}
                        onChange={e => setShowSnapshots(e.target.checked)}
                        className="w-3 h-3 accent-accent"
                      />
                      Mostrar snapshots
                    </label>
                  </div>
                  {loadingMc ? (
                    <div className="flex items-center gap-2 text-xs text-text-muted bg-bg-primary border border-border rounded-lg px-3 py-2">
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9" /></svg>
                      Cargando versiones...
                    </div>
                  ) : (
                    <select
                      value={form.minecraft}
                      onChange={e => setForm({ ...form, minecraft: e.target.value, modloaderVersion: '' })}
                      className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                    >
                      {visibleMcVersions.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.id}{v.type !== 'release' ? ` (${v.type})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Modloader */}
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Modloader</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {MODLOADERS.map(ml => (
                      <button
                        key={ml}
                        onClick={() => setForm({ ...form, modloader: ml, modloaderVersion: '' })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                          form.modloader === ml
                            ? 'bg-accent text-white'
                            : 'bg-bg-card border border-border text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {ml}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Modloader version dropdown */}
                {form.modloader !== 'vanilla' && (
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5 capitalize">
                      Versión de {form.modloader}
                    </label>
                    {loadingLoader ? (
                      <div className="flex items-center gap-2 text-xs text-text-muted bg-bg-primary border border-border rounded-lg px-3 py-2">
                        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9" /></svg>
                        Cargando versiones...
                      </div>
                    ) : loaderVersions.length === 0 ? (
                      <p className="text-xs text-amber-400 bg-amber-500/10 px-3 py-2 rounded-lg">
                        No hay versiones disponibles para MC {form.minecraft}
                      </p>
                    ) : (
                      <select
                        value={form.modloaderVersion}
                        onChange={e => setForm({ ...form, modloaderVersion: e.target.value })}
                        className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                      >
                        {loaderVersions.map(v => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {/* Java status */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                  !javaStatus ? 'bg-bg-hover text-text-muted'
                    : javaStatus.found ? 'bg-green-500/10 text-green-400'
                    : 'bg-amber-500/10 text-amber-400'
                }`}>
                  {!javaStatus ? (
                    <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9" /></svg> Verificando Java...</>
                  ) : javaStatus.found ? (
                    <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>{javaLabel(form.minecraft)} detectado</>
                  ) : (
                    <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>{javaLabel(form.minecraft)} no instalado — se instalará solo al jugar</>
                  )}
                </div>

                {/* Java path override */}
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">
                    Java personalizado <span className="text-text-muted/60">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    value={form.javaPath}
                    onChange={e => setForm({ ...form, javaPath: e.target.value })}
                    placeholder="Dejar vacío para detectar automáticamente"
                    className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>

                {/* RAM */}
                <div>
                  <label className="block text-xs text-text-muted mb-3">RAM máxima</label>
                  <RamSlider value={form.maxMemory} onChange={v => setForm({ ...form, maxMemory: v })} max={systemRam} />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-3">RAM mínima</label>
                  <RamSlider value={form.minMemory} onChange={v => setForm({ ...form, minMemory: v })} max={Math.min(systemRam, form.maxMemory)} />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Descripción <span className="text-text-muted">(opcional)</span></label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    rows={2}
                    className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent resize-none"
                  />
                </div>
              </div>

              {formError && <p className="mt-3 text-sm text-red-400">{formError}</p>}

              <div className="flex gap-3 mt-5">
                <button onClick={closeModal} className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">
                  Cancelar
                </button>
                <button onClick={saveManual} className="flex-1 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors">
                  {modalStep === 'edit' ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
