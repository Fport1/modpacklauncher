import { useEffect, useRef, useState } from 'react'
import { useStore, activeAccount } from '../store'
import InstanceCard from '../components/InstanceCard'
import InstanceDetailModal from '../components/InstanceDetailModal'
import RamSlider from '../components/RamSlider'
import ExportModpackModal from '../components/ExportModpackModal'
import type { Instance, Modloader, ModpackManifest } from '../../../shared/types'

type ModalStep = 'choose' | 'modpack' | 'manual'
type EditMode = 'edit'

const MODLOADERS: Modloader[] = ['vanilla', 'forge', 'fabric', 'quilt', 'neoforge']

const RES_PRESETS = [
  { label: 'Por defecto', w: 0, h: 0 },
  { label: '1280 × 720', w: 1280, h: 720 },
  { label: '1920 × 1080', w: 1920, h: 1080 },
  { label: 'Personalizado', w: -1, h: -1 }
]

function javaLabel(mc: string) {
  if (/^\d{2}w\d{2}[a-z]$/i.test(mc)) return 'Java 21'
  const minor = parseInt(mc.split('.')[1] ?? '0')
  const patch = parseInt(mc.split('.')[2] ?? '0')
  if (minor >= 21 || (minor === 20 && patch >= 5)) return 'Java 21'
  if (minor >= 17) return 'Java 17'
  return 'Java 8'
}

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

/* ── Duplicate name dialog ─────────────────────────────────── */
function DuplicateModal({
  sourceName,
  suggestedName,
  onConfirm,
  onClose,
  duplicating = false
}: {
  sourceName: string
  suggestedName: string
  onConfirm: (name: string) => void
  onClose: () => void
  duplicating?: boolean
}) {
  const [name, setName] = useState(suggestedName)
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
      <div className="relative bg-bg-secondary border border-border rounded-2xl p-6 w-[400px] shadow-2xl">
        <CloseBtn onClick={onClose} />
        <h2 className="text-base font-bold text-text-primary mb-1">Duplicar instancia</h2>
        <p className="text-xs text-text-muted mb-4">Copia de <span className="font-medium text-text-secondary">{sourceName}</span></p>
        <label className="block text-xs text-text-muted mb-1.5">Nombre de la nueva instancia</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent mb-4"
          autoFocus
          disabled={duplicating}
          onKeyDown={e => e.key === 'Enter' && name.trim() && !duplicating && onConfirm(name.trim())}
        />
        <div className="flex gap-3">
          <button onClick={onClose} disabled={duplicating} className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors disabled:opacity-50">Cancelar</button>
          <button
            onClick={() => name.trim() && onConfirm(name.trim())}
            disabled={!name.trim() || duplicating}
            className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {duplicating ? (
              <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>Duplicando...</>
            ) : 'Duplicar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Duplicate name conflict dialog ────────────────────────── */
function NameConflictModal({
  name,
  suggestedName,
  onKeep,
  onRename,
  onClose
}: {
  name: string
  suggestedName: string
  onKeep: () => void
  onRename: (n: string) => void
  onClose: () => void
}) {
  const [newName, setNewName] = useState(suggestedName)
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
      <div className="relative bg-bg-secondary border border-border rounded-2xl p-6 w-[420px] shadow-2xl">
        <CloseBtn onClick={onClose} />
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <h2 className="text-base font-bold text-text-primary">Nombre en uso</h2>
            <p className="text-xs text-text-muted mt-0.5">Ya existe una instancia llamada <span className="font-medium text-text-secondary">"{name}"</span>.</p>
          </div>
        </div>
        <div className="space-y-2 mb-4">
          <label className="block text-xs text-text-muted mb-1">Nuevo nombre</label>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">Cancelar</button>
          <button onClick={onKeep} className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">
            Usar "{suggestedName}"
          </button>
          <button
            onClick={() => newName.trim() && onRename(newName.trim())}
            disabled={!newName.trim()}
            className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Usar este nombre
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Icon picker dialog ────────────────────────────────────── */
function IconPickerModal({
  instance,
  onClose,
  onUpdated,
  onPreviewPick
}: {
  instance?: Instance
  onClose: () => void
  onUpdated?: (inst: Instance) => void
  onPreviewPick?: (icon: { filePath: string; base64: string }) => void
}) {
  const [defaultIcons, setDefaultIcons] = useState<Array<{ name: string; base64: string; filePath: string }>>([])
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    window.api.instances.listDefaultIcons().then(icons => {
      setDefaultIcons(icons)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function pickCustom() {
    setPicking(true)
    try {
      if (instance && onUpdated) {
        const updated = await window.api.instances.pickIcon(instance.id)
        if (updated) { onUpdated(updated); onClose() }
      } else if (onPreviewPick) {
        const result = await window.api.instances.pickIconPreview()
        if (result) { onPreviewPick(result); onClose() }
      }
    } finally { setPicking(false) }
  }

  async function applyDefault(ic: { filePath: string; base64: string; name: string }) {
    if (instance && onUpdated) {
      try {
        await window.api.instances.applyPendingIcon(instance.id, ic.filePath)
        const updated = await window.api.instances.list().then(list => list.find(i => i.id === instance.id))
        if (updated) { onUpdated(updated); onClose() }
      } catch { /* ignore */ }
    } else if (onPreviewPick) {
      onPreviewPick({ filePath: ic.filePath, base64: ic.base64 })
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
      <div className="relative bg-bg-secondary border border-border rounded-2xl p-6 w-[480px] shadow-2xl">
        <CloseBtn onClick={onClose} />
        <h2 className="text-base font-bold text-text-primary mb-1">Cambiar icono</h2>
        {instance && <p className="text-xs text-text-muted mb-4">{instance.name}</p>}

        <button
          onClick={pickCustom}
          disabled={picking}
          className="w-full flex items-center gap-3 px-4 py-3 bg-bg-card border border-border hover:border-accent/50 rounded-xl text-sm text-text-secondary hover:text-text-primary transition-colors mb-4"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          {picking ? 'Abriendo...' : 'Elegir imagen desde el explorador…'}
        </button>

        {loading ? (
          <p className="text-xs text-text-muted text-center py-4">Cargando iconos predeterminados...</p>
        ) : defaultIcons.length > 0 ? (
          <>
            <p className="text-xs text-text-muted mb-2">Iconos predeterminados</p>
            <div className="grid grid-cols-6 gap-2">
              {defaultIcons.map(ic => (
                <button
                  key={ic.name}
                  title={ic.name}
                  onClick={() => applyDefault(ic)}
                  className="w-full aspect-square rounded-lg overflow-hidden border border-border hover:border-accent/60 transition-colors"
                >
                  <img src={ic.base64} alt={ic.name} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="bg-bg-card border border-border rounded-xl p-3 text-xs text-text-muted">
            <p className="font-medium text-text-secondary mb-1">Iconos predeterminados</p>
            <p>Coloca archivos PNG en:</p>
            <code className="block mt-1 bg-bg-primary px-2 py-1 rounded text-[11px] break-all">%APPDATA%\modpack-launcher\icons\</code>
            <p className="mt-1">Tamaño recomendado: <span className="font-medium">64 × 64 px</span></p>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

/* ─── Main component ───────────────────────────────────────── */
export default function InstancesPage() {
  const { instances, setInstances, addInstance, updateInstance, removeInstance } = useStore()
  const account = useStore(activeAccount)
  const runningInstances = useStore(s => s.runningInstances)
  const openDetailInstanceId = useStore(s => s.openDetailInstanceId)
  const setOpenDetailInstanceId = useStore(s => s.setOpenDetailInstanceId)

  const [modalStep, setModalStep] = useState<ModalStep | EditMode | null>(null)
  const [editing, setEditing] = useState<Instance | null>(null)
  const [detailInstance, setDetailInstance] = useState<Instance | null>(null)
  const [fullDetailInstance, setFullDetailInstance] = useState<Instance | null>(null)
  const [exportInstance, setExportInstance] = useState<Instance | null>(null)
  const [duplicateSource, setDuplicateSource] = useState<Instance | null>(null)
  const [iconPickInstance, setIconPickInstance] = useState<Instance | null>(null)
  const [nameConflict, setNameConflict] = useState<{ pending: () => void; name: string; suggested: string } | null>(null)
  const [launching, setLaunching] = useState<string | null>(null)
  const [systemRam, setSystemRam] = useState(8192)

  // Non-blocking toasts
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'info'|'success'|'error' }[]>([])
  function addToast(message: string, type: 'info'|'success'|'error' = 'info', duration = 3500) {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }

  // Group right-click edit
  const [groupCtxMenu, setGroupCtxMenu] = useState<{ name: string; x: number; y: number } | null>(null)
  const [editingGroup, setEditingGroup] = useState<{ originalName: string; name: string; color: string } | null>(null)

  const [mcVersions, setMcVersions] = useState<Array<{ id: string; type: string }>>([])
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [loaderVersions, setLoaderVersions] = useState<string[]>([])
  const [loadingMc, setLoadingMc] = useState(false)
  const [loadingLoader, setLoadingLoader] = useState(false)
  const loaderFetchKey = useRef(0)

  const [displays, setDisplays] = useState<{ id: number; label: string; bounds: { x: number; y: number; width: number; height: number }; isPrimary: boolean }[]>([])

  // Local groups (from localStorage, merged with groups from instances)
  const [localGroups, setLocalGroups] = useState<{ name: string; color: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('ml-groups') ?? '[]') } catch { return [] }
  })
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [groupModalName, setGroupModalName] = useState('')
  const [groupModalColor, setGroupModalColor] = useState('#6366f1')

  function saveLocalGroups(groups: { name: string; color: string }[]) {
    setLocalGroups(groups)
    localStorage.setItem('ml-groups', JSON.stringify(groups))
  }

  function addLocalGroup() {
    const name = groupModalName.trim()
    if (!name) return
    if (!localGroups.find(g => g.name === name)) {
      saveLocalGroups([...localGroups, { name, color: groupModalColor }])
    }
    setGroupModalName('')
    setGroupModalColor('#6366f1')
    setShowGroupModal(false)
  }

  function deleteLocalGroup(name: string) {
    saveLocalGroups(localGroups.filter(g => g.name !== name))
  }

  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  function toggleGroup(key: string) {
    setCollapsedGroups(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  // Custom drag-and-drop order, persisted in localStorage
  const [dragOrder, setDragOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ml-instance-order') ?? '[]') } catch { return [] }
  })
  const dragIdRef = useRef<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null)

  function sortByDragOrder(list: Instance[]): Instance[] {
    if (dragOrder.length === 0) return list
    return [...list].sort((a, b) => {
      const ai = dragOrder.indexOf(a.id)
      const bi = dragOrder.indexOf(b.id)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }

  function handleDrop(targetId: string) {
    const draggedId = dragIdRef.current
    if (!draggedId || draggedId === targetId) return
    const allIds = instances.map(i => i.id)
    const current = [...new Set([...dragOrder.filter(id => allIds.includes(id)), ...allIds])]
    const fromIdx = current.indexOf(draggedId)
    const toIdx = current.indexOf(targetId)
    current.splice(fromIdx, 1)
    current.splice(toIdx, 0, draggedId)
    setDragOrder(current)
    localStorage.setItem('ml-instance-order', JSON.stringify(current))
    setDragOverId(null)
    dragIdRef.current = null
  }

  async function handleDropToGroup(groupName: string | null) {
    const draggedId = dragIdRef.current
    if (!draggedId) { setDragOverGroup(null); return }
    const inst = instances.find(i => i.id === draggedId)
    if (!inst || inst.group === (groupName ?? undefined)) { setDragOverGroup(null); dragIdRef.current = null; return }
    const groupColor = groupName ? (localGroups.find(g => g.name === groupName)?.color ?? inst.groupColor) : undefined
    const updated = { ...inst, group: groupName ?? undefined, groupColor }
    await window.api.instances.update(updated)
    updateInstance(updated)
    setDragOverGroup(null)
    dragIdRef.current = null
  }

  const [form, setForm] = useState({
    name: '',
    minecraft: '1.20.1',
    modloader: 'vanilla' as Modloader,
    modloaderVersion: '',
    description: '',
    maxMemory: 4096,
    minMemory: 512,
    javaPath: '',
    width: 0,
    height: 0,
    resPreset: 0,
    jvmArgs: '',
    displayId: 0,
    group: '',
    groupColor: ''
  })
  const [pendingIcon, setPendingIcon] = useState<{ filePath: string; base64: string } | null>(null)
  const [formIconBase64, setFormIconBase64] = useState<string | null>(null)
  const [showFormIconPicker, setShowFormIconPicker] = useState(false)
  const [defaultIconBase64, setDefaultIconBase64] = useState<string | null>(null)
  const [javaStatus, setJavaStatus] = useState<{ found: boolean; required: number } | null>(null)
  const [formError, setFormError] = useState('')
  const [savingForm, setSavingForm] = useState(false)

  const [modpackUrl, setModpackUrl] = useState('')
  const [modpackManifest, setModpackManifest] = useState<ModpackManifest | null>(null)
  const [modpackName, setModpackName] = useState('')
  const [modpackLoading, setModpackLoading] = useState(false)
  const [modpackError, setModpackError] = useState('')

  useEffect(() => {
    window.api.instances.list().then(setInstances)
    window.api.system.getRam().then(setSystemRam)
    window.api.instances.getDefaultIcon().then(setDefaultIconBase64).catch(() => {})
    window.api.system.getDisplays().then(setDisplays).catch(() => {})
  }, [])

  useEffect(() => {
    if (!openDetailInstanceId) return
    const inst = instances.find(i => i.id === openDetailInstanceId)
    if (inst) {
      setFullDetailInstance(inst)
      setOpenDetailInstanceId(null)
    }
  }, [openDetailInstanceId, instances])

  useEffect(() => {
    if (modalStep !== 'manual' && modalStep !== 'edit') return
    if (mcVersions.length > 0) return
    setLoadingMc(true)
    window.api.launcher.getMcVersions()
      .then(setMcVersions)
      .finally(() => setLoadingMc(false))
  }, [modalStep])

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

  useEffect(() => {
    if (modalStep !== 'manual' && modalStep !== 'edit') return
    let cancelled = false
    setJavaStatus(null)
    window.api.java.check(form.minecraft).then(s => {
      if (!cancelled) setJavaStatus(s)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [form.minecraft, modalStep])

  function openChoose() {
    setModpackUrl(''); setModpackManifest(null); setModpackName(''); setModpackError('')
    setFormError('')
    setEditing(null)
    setModalStep('choose')
  }

  function openManual() {
    setForm({ name: '', minecraft: mcVersions[0]?.id ?? '1.20.1', modloader: 'vanilla', modloaderVersion: '', description: '', maxMemory: 4096, minMemory: 512, javaPath: '', width: 0, height: 0, resPreset: 0, jvmArgs: '', displayId: 0, group: '', groupColor: '' })
    setPendingIcon(null)
    setFormIconBase64(null)
    setFormError('')
    setModalStep('manual')
  }

  function openEdit(inst: Instance) {
    const w = inst.width ?? 0
    const h = inst.height ?? 0
    let resPreset = 0
    if (w && h) {
      const idx = RES_PRESETS.findIndex(p => p.w === w && p.h === h)
      resPreset = idx >= 0 ? idx : 3
    }
    setForm({
      name: inst.name,
      minecraft: inst.minecraft,
      modloader: inst.modloader,
      modloaderVersion: inst.modloaderVersion ?? '',
      description: inst.description ?? '',
      maxMemory: inst.maxMemory ?? 4096,
      minMemory: inst.minMemory ?? 512,
      javaPath: inst.javaPath ?? '',
      width: w,
      height: h,
      resPreset,
      jvmArgs: inst.jvmArgs ?? '',
      displayId: inst.displayId ?? 0,
      group: inst.group ?? '',
      groupColor: inst.groupColor ?? ''
    })
    setPendingIcon(null)
    setFormIconBase64(null)
    window.api.instances.getIcon(inst.id).then(setFormIconBase64).catch(() => {})
    setEditing(inst)
    setFormError('')
    setModalStep('edit')
  }

  function cancelModal() {
    window.api.cancel()
    setModalStep(null)
    setEditing(null)
    setSavingForm(false)
    setModpackLoading(false)
    setShowFormIconPicker(false)
  }

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
      await window.api.modpacks.install(inst.id, modpackManifest)
      cancelModal()
    } catch (e: unknown) {
      setModpackError(e instanceof Error ? e.message : 'Error al crear instancia')
    } finally {
      setModpackLoading(false)
    }
  }

  function getResolutionValues(): { width?: number; height?: number } {
    const preset = RES_PRESETS[form.resPreset]
    if (!preset || preset.w === 0) return {}
    if (preset.w === -1) return form.width && form.height ? { width: form.width, height: form.height } : {}
    return { width: preset.w, height: preset.h }
  }

  async function doSaveManual(overrideName?: string) {
    const name = (overrideName ?? form.name).trim()
    if (!name) { setFormError('El nombre es requerido'); return }
    setFormError('')

    // Check duplicate name (only for new instances)
    if (modalStep !== 'edit') {
      const exists = await window.api.instances.checkName(name, undefined)
      if (exists) {
        // Auto-generate "(1)", "(2)" suffix
        let suggested = `${name} (1)`
        let n = 2
        while (await window.api.instances.checkName(suggested, undefined)) {
          suggested = `${name} (${n++})`
        }
        setNameConflict({
          name,
          suggested,
          pending: () => doSaveManual(suggested)
        })
        return
      }
    }

    const res = getResolutionValues()
    setSavingForm(true)
    try {
      if (modalStep === 'edit' && editing) {
        const updated: Instance = {
          ...editing,
          name,
          minecraft: form.minecraft,
          modloader: form.modloader,
          modloaderVersion: form.modloaderVersion || undefined,
          description: form.description || undefined,
          maxMemory: form.maxMemory,
          minMemory: form.minMemory,
          javaPath: form.javaPath.trim() || undefined,
          width: res.width,
          height: res.height,
          jvmArgs: form.jvmArgs.trim() || undefined,
          displayId: form.displayId || undefined,
          group: form.group.trim() || undefined,
          groupColor: form.groupColor.trim() || undefined
        }
        await window.api.instances.update(updated)
        if (pendingIcon) {
          await window.api.instances.applyPendingIcon(updated.id, pendingIcon.filePath)
          updateInstance({ ...updated, icon: `icon.png?v=${Date.now()}` })
        } else {
          updateInstance(updated)
        }
      } else {
        const inst = await window.api.instances.create({
          name,
          minecraft: form.minecraft,
          modloader: form.modloader,
          modloaderVersion: form.modloaderVersion || undefined,
          description: form.description || undefined,
          maxMemory: form.maxMemory,
          minMemory: form.minMemory,
          javaPath: form.javaPath.trim() || undefined,
          width: res.width,
          height: res.height,
          jvmArgs: form.jvmArgs.trim() || undefined,
          displayId: form.displayId || undefined,
          group: form.group.trim() || undefined,
          groupColor: form.groupColor.trim() || undefined
        })
        if (pendingIcon) {
          await window.api.instances.applyPendingIcon(inst.id, pendingIcon.filePath)
          addInstance({ ...inst, icon: 'icon.png' })
        } else {
          addInstance(inst)
        }
      }
      cancelModal()
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSavingForm(false)
    }
  }

  function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta instancia? Los archivos del juego se borrarán permanentemente.')) return
    // Close UI immediately so the user can continue
    if (fullDetailInstance?.id === id) setFullDetailInstance(null)
    if (detailInstance?.id === id) setDetailInstance(null)
    removeInstance(id)
    addToast('Eliminando instancia...', 'info', 8000)
    window.api.instances.delete(id).catch(e =>
      addToast(`Error al eliminar: ${e?.message ?? 'Error desconocido'}`, 'error')
    )
  }

  async function handleEditGroup(originalName: string, newName: string, newColor: string) {
    saveLocalGroups(localGroups.map(g => g.name === originalName ? { name: newName, color: newColor } : g))
    const affected = instances.filter(i => i.group === originalName)
    for (const inst of affected) {
      const updated = { ...inst, group: newName || undefined, groupColor: newColor }
      await window.api.instances.update(updated)
      updateInstance(updated)
    }
    setEditingGroup(null)
  }

  async function handlePlay(id: string) {
    if (!account) { alert('Selecciona una cuenta en Ajustes primero.'); return }
    if (runningInstances.size > 0 && !runningInstances.has(id)) {
      const ok = confirm('Ya hay una instancia de Minecraft en ejecución. ¿Abrir otra de todas formas?')
      if (!ok) return
    }

    const inst = instances.find((i) => i.id === id)
    if (inst?.modpackUrl) {
      try {
        const result = await window.api.modpacks.checkUpdate(id, inst.modpackUrl)
        if (result.hasUpdate) {
          const ok = confirm(`Hay una actualización del modpack disponible (v${result.manifest.version}). ¿Actualizar antes de jugar?`)
          if (ok) {
            setLaunching(id)
            await window.api.modpacks.update(id, inst.modpackUrl)
            updateInstance({ ...inst, modpackVersion: result.manifest.version })
          }
        }
      } catch { /* ignore */ }
    }

    setLaunching(id)
    try { await window.api.launcher.launch(id) }
    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error al lanzar') }
    finally { setLaunching(null) }
  }

  async function handleDuplicate(inst: Instance, newName: string) {
    // Check name conflict synchronously before closing the dialog
    const exists = await window.api.instances.checkName(newName, undefined)
    if (exists) {
      let suggested = `${newName} (1)`
      let n = 2
      while (await window.api.instances.checkName(suggested, undefined)) {
        suggested = `${newName} (${n++})`
      }
      setNameConflict({
        name: newName,
        suggested,
        pending: () => handleDuplicate(inst, suggested)
      })
      return
    }
    // Close dialog immediately and run in background
    setDuplicateSource(null)
    addToast(`Duplicando "${inst.name}"...`, 'info', 10000)
    window.api.instances.duplicate(inst.id, newName)
      .then(dup => { addInstance(dup); addToast(`"${newName}" creado`, 'success') })
      .catch(e => addToast(`Error al duplicar: ${e?.message ?? 'Error'}`, 'error'))
  }

  function suggestDuplicateName(name: string): string {
    return `${name} (copia)`
  }

  const visibleMcVersions = mcVersions.filter(v => showSnapshots || v.type === 'release')
  const customRes = form.resPreset === 3

  const allKnownGroups = [
    ...localGroups,
    ...instances
      .filter(i => i.group && !localGroups.find(g => g.name === i.group))
      .map(i => ({ name: i.group!, color: i.groupColor || '#6366f1' }))
  ]

  return (
    <div className={fullDetailInstance ? 'h-full flex flex-col overflow-hidden' : 'p-6'}>

      {/* ── Full-page instance detail (from sidebar) ── */}
      {fullDetailInstance && (
        <InstanceDetailModal
          instance={fullDetailInstance}
          fullPage
          onClose={() => setFullDetailInstance(null)}
          onPlay={() => { setFullDetailInstance(null); handlePlay(fullDetailInstance.id) }}
          onEdit={() => { setFullDetailInstance(null); openEdit(fullDetailInstance) }}
          onExport={() => { setExportInstance(fullDetailInstance) }}
          onDuplicate={() => { setDuplicateSource(fullDetailInstance) }}
          onChangeIcon={() => { setIconPickInstance(fullDetailInstance) }}
          onDelete={() => handleDelete(fullDetailInstance.id)}
        />
      )}

      {!fullDetailInstance && <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-text-primary">Instancias</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGroupModal(true)}
            className="flex items-center gap-2 px-3 py-2 border border-border text-text-secondary hover:text-text-primary hover:border-border/80 text-sm font-medium rounded-lg transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
            Crear Grupo
          </button>
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
      </div>

      {instances.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-xl">
          <p className="text-text-muted mb-4">No hay instancias todavía</p>
          <button onClick={openChoose} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">
            Crear Instancia
          </button>
        </div>
      ) : (() => {
        // Merge localGroups (including empty ones) with groups derived from instances
        const groupMap = new Map<string, { group: string; color: string; items: typeof instances }>()
        for (const g of localGroups) {
          groupMap.set(g.name, { group: g.name, color: g.color, items: [] })
        }
        const ungrouped: typeof instances = []
        for (const inst of instances) {
          if (inst.group) {
            if (!groupMap.has(inst.group)) {
              groupMap.set(inst.group, { group: inst.group, color: inst.groupColor || '#6366f1', items: [] })
            }
            groupMap.get(inst.group)!.items.push(inst)
          } else {
            ungrouped.push(inst)
          }
        }
        const grouped = [...groupMap.values()]
        const renderCards = (list: typeof instances) => (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            {sortByDragOrder(list).map(inst => (
              <div
                key={inst.id}
                draggable
                onDragStart={() => { dragIdRef.current = inst.id }}
                onDragOver={e => { e.preventDefault(); setDragOverId(inst.id) }}
                onDragLeave={() => setDragOverId(prev => prev === inst.id ? null : prev)}
                onDrop={() => handleDrop(inst.id)}
                onDragEnd={() => { dragIdRef.current = null; setDragOverId(null) }}
                className={`transition-all duration-100 rounded-xl ${dragOverId === inst.id && dragIdRef.current !== inst.id ? 'ring-2 ring-accent/60 scale-[1.02]' : ''}`}
              >
                <InstanceCard
                  instance={inst}
                  onPlay={() => handlePlay(inst.id)}
                  onKill={() => window.api.launcher.kill(inst.id)}
                  onLaunchExtra={() => window.api.launcher.launchExtra(inst.id)}
                  onEdit={() => openEdit(inst)}
                  onDelete={() => handleDelete(inst.id)}
                  onOpenFolder={() => window.api.instances.openFolder(inst.id)}
                  onDetails={() => setDetailInstance(inst)}
                  onExport={() => setExportInstance(inst)}
                  onDuplicate={() => setDuplicateSource(inst)}
                  onChangeIcon={() => setIconPickInstance(inst)}
                  isLaunching={launching === inst.id}
                  isRunning={runningInstances.has(inst.id)}
                />
              </div>
            ))}
          </div>
        )
        const showUngroupedHeader = grouped.length > 0 || localGroups.length > 0
        const ungroupedCollapsed = collapsedGroups.includes('__ungrouped__')
        return (
          <div className="space-y-6">
            {grouped.map(g => {
              const isCollapsed = collapsedGroups.includes(g.group)
              const isDropTarget = dragOverGroup === g.group
              return (
                <div key={g.group}>
                  <div
                    onDragOver={e => { e.preventDefault(); setDragOverGroup(g.group) }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverGroup(null) }}
                    onDrop={() => handleDropToGroup(g.group)}
                    onContextMenu={e => { e.preventDefault(); setGroupCtxMenu({ name: g.group, x: e.clientX, y: e.clientY }) }}
                    className={`flex items-center gap-2 mb-3 rounded-lg px-1 py-0.5 transition-colors ${isDropTarget ? 'bg-accent/10 ring-2 ring-accent/40' : ''}`}
                  >
                    <button
                      onClick={() => toggleGroup(g.group)}
                      className="flex items-center gap-2 flex-1 text-left group/hdr"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                        className={`text-text-muted transition-transform flex-shrink-0 ${isCollapsed ? '-rotate-90' : ''}`}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: g.color }} />
                      <span className={`text-sm font-semibold transition-colors ${isDropTarget ? 'text-accent' : 'text-text-primary group-hover/hdr:text-accent'}`}>{g.group}</span>
                      <span className="text-xs text-text-muted">({g.items.length})</span>
                      <div className="flex-1 h-px bg-border/40" />
                      {isDropTarget && <span className="text-[10px] text-accent flex-shrink-0">Soltar aquí</span>}
                    </button>
                  </div>
                  {!isCollapsed && renderCards(g.items)}
                </div>
              )
            })}
            {ungrouped.length > 0 && (
              <div>
                {showUngroupedHeader ? (
                  <>
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOverGroup('__ungrouped__') }}
                      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverGroup(null) }}
                      onDrop={() => handleDropToGroup(null)}
                      className={`flex items-center gap-2 mb-3 rounded-lg px-1 py-0.5 transition-colors ${dragOverGroup === '__ungrouped__' ? 'bg-accent/10 ring-2 ring-accent/40' : ''}`}
                    >
                      <button
                        onClick={() => toggleGroup('__ungrouped__')}
                        className="flex items-center gap-2 flex-1 text-left group/hdr"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                          className={`text-text-muted transition-transform flex-shrink-0 ${ungroupedCollapsed ? '-rotate-90' : ''}`}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                        <span className={`text-sm font-semibold transition-colors ${dragOverGroup === '__ungrouped__' ? 'text-accent' : 'text-text-muted group-hover/hdr:text-text-primary'}`}>Sin grupo</span>
                        <span className="text-xs text-text-muted">({ungrouped.length})</span>
                        <div className="flex-1 h-px bg-border/40" />
                        {dragOverGroup === '__ungrouped__' && <span className="text-[10px] text-accent flex-shrink-0">Soltar aquí</span>}
                      </button>
                    </div>
                    {!ungroupedCollapsed && renderCards(ungrouped)}
                  </>
                ) : (
                  renderCards(ungrouped)
                )}
              </div>
            )}
          </div>
        )
      })()}

      </>}

      {/* ── Instance detail modal ── */}
      {detailInstance && (
        <InstanceDetailModal
          instance={detailInstance}
          onClose={() => setDetailInstance(null)}
          onPlay={() => { setDetailInstance(null); handlePlay(detailInstance.id) }}
        />
      )}

      {/* ── Export modpack modal ── */}
      {exportInstance && (
        <ExportModpackModal
          instance={exportInstance}
          onClose={() => setExportInstance(null)}
        />
      )}

      {/* ── Duplicate modal ── */}
      {duplicateSource && (
        <DuplicateModal
          sourceName={duplicateSource.name}
          suggestedName={suggestDuplicateName(duplicateSource.name)}
          onConfirm={name => handleDuplicate(duplicateSource, name)}
          onClose={() => setDuplicateSource(null)}
        />
      )}

      {/* ── Name conflict modal ── */}
      {nameConflict && (
        <NameConflictModal
          name={nameConflict.name}
          suggestedName={nameConflict.suggested}
          onKeep={() => { const fn = nameConflict.pending; setNameConflict(null); fn() }}
          onRename={n => { setNameConflict(null); doSaveManual(n) }}
          onClose={() => setNameConflict(null)}
        />
      )}

      {/* ── Icon picker modal (existing instance) ── */}
      {iconPickInstance && (
        <IconPickerModal
          instance={iconPickInstance}
          onClose={() => setIconPickInstance(null)}
          onUpdated={updated => { updateInstance(updated); setIconPickInstance(null) }}
        />
      )}

      {/* ── Icon picker modal (form / create) ── */}
      {showFormIconPicker && (
        <IconPickerModal
          onClose={() => setShowFormIconPicker(false)}
          onPreviewPick={icon => { setPendingIcon(icon); setShowFormIconPicker(false) }}
        />
      )}

      {/* ── Create group modal ── */}
      {showGroupModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="relative bg-bg-secondary border border-border rounded-2xl p-6 w-[420px] shadow-2xl">
            <CloseBtn onClick={() => { setShowGroupModal(false); setGroupModalName(''); setGroupModalColor('#6366f1') }} />
            <h2 className="text-base font-bold text-text-primary mb-1">Crear Grupo</h2>
            <p className="text-xs text-text-muted mb-4">Los grupos te permiten organizar tus instancias.</p>

            <label className="block text-xs text-text-muted mb-1.5">Nombre del grupo</label>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={groupModalName}
                onChange={e => setGroupModalName(e.target.value)}
                placeholder="Ej: Survival, Modded, Testing…"
                className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && groupModalName.trim() && addLocalGroup()}
              />
              <input
                type="color"
                value={groupModalColor}
                onChange={e => setGroupModalColor(e.target.value)}
                title="Color del grupo"
                className="w-10 h-9 p-0.5 bg-bg-primary border border-border rounded-lg cursor-pointer"
              />
            </div>

            {localGroups.length > 0 && (
              <>
                <p className="text-xs text-text-muted mb-2">Grupos existentes</p>
                <div className="space-y-1 mb-4 max-h-40 overflow-y-auto">
                  {localGroups.map(g => (
                    <div key={g.name} className="flex items-center gap-2 px-3 py-2 bg-bg-card border border-border rounded-lg">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: g.color }} />
                      <span className="flex-1 text-sm text-text-primary truncate">{g.name}</span>
                      <button
                        onClick={() => deleteLocalGroup(g.name)}
                        title="Eliminar grupo"
                        className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowGroupModal(false); setGroupModalName(''); setGroupModalColor('#6366f1') }}
                className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors"
              >
                Cerrar
              </button>
              <button
                onClick={addLocalGroup}
                disabled={!groupModalName.trim()}
                className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Crear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create/Edit modal overlay ── */}
      {modalStep && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">

          {/* ── STEP: choose ─────────────────────────────────────── */}
          {modalStep === 'choose' && (
            <div className="relative bg-bg-secondary border border-border rounded-2xl p-6 w-[480px] shadow-2xl">
              <CloseBtn onClick={cancelModal} />
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
              <CloseBtn onClick={cancelModal} />
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
                  <button onClick={cancelModal} className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">
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
              <CloseBtn onClick={cancelModal} />

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
                {/* Icon preview */}
                <div className="flex justify-center">
                  <button
                    type="button"
                    title="Haz clic para cambiar el icono"
                    onClick={() => setShowFormIconPicker(true)}
                    className="w-16 h-16 rounded-xl overflow-hidden border-2 border-border hover:border-accent/60 transition-colors relative group"
                  >
                    {(pendingIcon?.base64 || formIconBase64 || defaultIconBase64) && (
                      <img
                        src={pendingIcon?.base64 ?? formIconBase64 ?? defaultIconBase64!}
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </div>
                  </button>
                </div>

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

                {/* MC version */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-text-muted">Versión de Minecraft</label>
                    <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
                      <input type="checkbox" checked={showSnapshots} onChange={e => setShowSnapshots(e.target.checked)} className="w-3 h-3 accent-accent" />
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
                        <option key={v.id} value={v.id}>{v.id}{v.type !== 'release' ? ` (${v.type})` : ''}</option>
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
                          form.modloader === ml ? 'bg-accent text-white' : 'bg-bg-card border border-border text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {ml}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Modloader version */}
                {form.modloader !== 'vanilla' && (
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5 capitalize">Versión de {form.modloader}</label>
                    {loadingLoader ? (
                      <div className="flex items-center gap-2 text-xs text-text-muted bg-bg-primary border border-border rounded-lg px-3 py-2">
                        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9" /></svg>
                        Cargando versiones...
                      </div>
                    ) : loaderVersions.length === 0 ? (
                      <p className="text-xs text-amber-400 bg-amber-500/10 px-3 py-2 rounded-lg">No hay versiones disponibles para MC {form.minecraft}</p>
                    ) : (
                      <select
                        value={form.modloaderVersion}
                        onChange={e => setForm({ ...form, modloaderVersion: e.target.value })}
                        className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                      >
                        {loaderVersions.map(v => <option key={v} value={v}>{v}</option>)}
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
                    <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9" /></svg>Verificando Java...</>
                  ) : javaStatus.found ? (
                    <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>{javaLabel(form.minecraft)} detectado</>
                  ) : (
                    <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>{javaLabel(form.minecraft)} no instalado — se instalará solo al jugar</>
                  )}
                </div>

                {/* Java path */}
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Java personalizado <span className="text-text-muted/60">(opcional)</span></label>
                  <input type="text" value={form.javaPath} onChange={e => setForm({ ...form, javaPath: e.target.value })}
                    placeholder="Dejar vacío para detectar automáticamente"
                    className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
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

                {/* Window resolution */}
                <div>
                  <label className="block text-xs text-text-muted mb-2">Resolución de ventana</label>
                  <div className="flex gap-1.5 flex-wrap mb-2">
                    {RES_PRESETS.map((p, i) => (
                      <button
                        key={i}
                        onClick={() => setForm({ ...form, resPreset: i, width: p.w > 0 ? p.w : form.width, height: p.h > 0 ? p.h : form.height })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          form.resPreset === i ? 'bg-accent text-white' : 'bg-bg-card border border-border text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  {customRes && (
                    <div className="flex gap-2 items-center">
                      <input type="number" value={form.width || ''} onChange={e => setForm({ ...form, width: parseInt(e.target.value) || 0 })}
                        placeholder="Ancho" min={320} max={7680}
                        className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
                      <span className="text-text-muted text-xs">×</span>
                      <input type="number" value={form.height || ''} onChange={e => setForm({ ...form, height: parseInt(e.target.value) || 0 })}
                        placeholder="Alto" min={240} max={4320}
                        className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
                    </div>
                  )}
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Descripción <span className="text-text-muted">(opcional)</span></label>
                  <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                    rows={2}
                    className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent resize-none" />
                </div>

                {/* JVM Arguments */}
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">
                    Argumentos JVM <span className="text-text-muted/60">(opcional, uno por línea)</span>
                  </label>
                  <textarea
                    value={form.jvmArgs}
                    onChange={e => setForm({ ...form, jvmArgs: e.target.value })}
                    rows={3}
                    spellCheck={false}
                    placeholder={'-XX:+UseG1GC\n-XX:MaxGCPauseMillis=50\n-Dfml.readTimeout=90'}
                    className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:border-accent resize-none placeholder:text-text-muted/40"
                  />
                </div>

                {/* Display selector */}
                {displays.length > 1 && (
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">Pantalla <span className="text-text-muted/60">(opcional)</span></label>
                    <select
                      value={form.displayId}
                      onChange={e => setForm({ ...form, displayId: Number(e.target.value) })}
                      className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                    >
                      <option value={0}>Por defecto</option>
                      {displays.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.label || `Pantalla ${d.id}`} — {d.bounds.width}×{d.bounds.height}{d.isPrimary ? ' (principal)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Group */}
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Grupo <span className="text-text-muted/60">(opcional)</span></label>
                  {allKnownGroups.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={form.group}
                        onChange={e => {
                          const g = allKnownGroups.find(g => g.name === e.target.value)
                          setForm({ ...form, group: e.target.value, groupColor: g?.color || form.groupColor || '#6366f1' })
                        }}
                        className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                      >
                        <option value="">Sin grupo</option>
                        {allKnownGroups.map(g => (
                          <option key={g.name} value={g.name}>{g.name}</option>
                        ))}
                      </select>
                      {form.group && (
                        <div
                          className="w-4 h-4 rounded-full flex-shrink-0 border border-border"
                          style={{ background: allKnownGroups.find(g => g.name === form.group)?.color || '#6366f1' }}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={form.group}
                        onChange={e => setForm({ ...form, group: e.target.value })}
                        placeholder="Ej: Survival, Modded, Testing…"
                        className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                      />
                      <input
                        type="color"
                        value={form.groupColor || '#6366f1'}
                        onChange={e => setForm({ ...form, groupColor: e.target.value })}
                        title="Color del grupo"
                        className="w-10 h-9 p-0.5 bg-bg-primary border border-border rounded-lg cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              </div>

              {formError && <p className="mt-3 text-sm text-red-400">{formError}</p>}

              <div className="flex gap-3 mt-5">
                <button onClick={cancelModal} className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">
                  Cancelar
                </button>
                <button onClick={() => doSaveManual()} disabled={savingForm} className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium transition-colors">
                  {savingForm ? 'Guardando...' : modalStep === 'edit' ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Group context menu ── */}
      {groupCtxMenu && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setGroupCtxMenu(null)} />
          <div className="fixed z-[71] bg-bg-secondary border border-border rounded-xl shadow-2xl py-1 w-40"
            style={{ left: groupCtxMenu.x, top: groupCtxMenu.y }}>
            <button
              onClick={() => {
                const g = allKnownGroups.find(g => g.name === groupCtxMenu.name)
                setEditingGroup({ originalName: groupCtxMenu.name, name: groupCtxMenu.name, color: g?.color ?? '#6366f1' })
                setGroupCtxMenu(null)
              }}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors text-left w-full">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Editar grupo
            </button>
          </div>
        </>
      )}

      {/* ── Edit group modal ── */}
      {editingGroup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[72]" onClick={() => setEditingGroup(null)}>
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-80 p-5 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-text-primary">Editar grupo</p>
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Nombre</label>
              <input value={editingGroup.name} onChange={e => setEditingGroup({ ...editingGroup, name: e.target.value })}
                className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                onKeyDown={e => e.key === 'Enter' && editingGroup.name.trim() && handleEditGroup(editingGroup.originalName, editingGroup.name.trim(), editingGroup.color)} />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={editingGroup.color} onChange={e => setEditingGroup({ ...editingGroup, color: e.target.value })}
                  className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent" />
                <span className="text-sm font-mono text-text-secondary">{editingGroup.color}</span>
                <div className="flex gap-1.5 ml-auto">
                  {['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#8b5cf6','#06b6d4'].map(c => (
                    <button key={c} onClick={() => setEditingGroup({ ...editingGroup, color: c })}
                      className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                      style={{ background: c, borderColor: editingGroup.color === c ? 'white' : 'transparent' }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingGroup(null)} className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">Cancelar</button>
              <button onClick={() => editingGroup.name.trim() && handleEditGroup(editingGroup.originalName, editingGroup.name.trim(), editingGroup.color)}
                className="flex-1 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toasts ── */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-[80] pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-2.5 rounded-xl border shadow-lg text-sm font-medium backdrop-blur-sm transition-all ${
            t.type === 'error' ? 'bg-red-500/20 border-red-500/30 text-red-300' :
            t.type === 'success' ? 'bg-green-500/20 border-green-500/30 text-green-300' :
            'bg-bg-secondary/90 border-border text-text-primary'
          }`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
