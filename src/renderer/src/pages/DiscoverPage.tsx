import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Instance } from '../../../shared/types'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { socialAuth, socialDb } from '../lib/firebase'
import {
  listPublished as listFport1Published, listVersions as listFport1Versions,
  countDownload as countFport1Download, projectUpdatedMs, versionPublishedMs, type Fport1Project
} from '../lib/fport1Content'
import Fport1Studio from '../components/fport1/Fport1Studio'
import ExploreDetail, { type DetailRef, type DVersion, type DetailTab } from '../components/explore/ExploreDetail'
import { nav } from '../nav'
import { catLabel } from '../lib/categoryNames'

// ── Types ────────────────────────────────────────────────────────────────────

type ContentType = 'modpack' | 'mod' | 'resourcepack' | 'datapack' | 'shader'
type FilterState = 'include' | 'exclude'

interface Hit {
  project_id: string
  title: string
  description: string
  icon_url: string | null
  downloads: number
  follows: number
  display_categories: string[]
  date_modified: string
  client_side: string
  server_side: string
}

interface MVersion {
  id: string
  version_number: string
  name: string
  loaders: string[]
  game_versions: string[]
  date_published: string
  files: { url: string; filename: string; primary: boolean; size: number }[]
  version_type?: 'release' | 'beta' | 'alpha'
  changelog?: string
}

interface Category { name: string; header: string; icon?: string }
interface World { name: string }

/** De dónde salen los proyectos: Modrinth o las creaciones de Fport1. */
interface ContentProvider {
  getVersions: (projectId: string, mc: string, loader: string) => Promise<MVersion[]>
  onInstalled?: (projectId: string, versionId: string) => void
  hideFollows?: boolean
}

const modrinthProvider: ContentProvider = {
  getVersions: (id, mc, loader) => window.api.modrinth.getVersions(id, mc, loader) as Promise<MVersion[]>
}

interface CurseHit {
  id: number
  name: string
  summary: string
  logo?: { thumbnailUrl: string }
  downloadCount: number
  dateModified: string
  latestFilesIndexes: { gameVersion: string; fileId: number; modLoaderType: number; filename?: string }[]
  classId: number
  categories: { id: number; name: string }[]
  links?: { websiteUrl?: string }
}

interface CurseFile {
  id: number
  displayName: string
  fileName: string
  fileDate: string
  fileLength: number
  gameVersions: string[]
  modLoaderType?: number
}

// ── Constants ────────────────────────────────────────────────────────────────

const TABS: { key: ContentType; label: string }[] = [
  { key: 'modpack',      label: 'Modpacks'       },
  { key: 'mod',          label: 'Mods'           },
  { key: 'resourcepack', label: 'Resource Packs' },
  { key: 'datapack',     label: 'Data Packs'     },
  { key: 'shader',       label: 'Shaders'        },
]

const SORT_OPTIONS = [
  { value: 'downloads', label: 'Descargas'  },
  { value: 'relevance', label: 'Relevancia' },
  { value: 'follows',   label: 'Favoritos'  },
  { value: 'newest',    label: 'Más nuevo'  },
  { value: 'updated',   label: 'Actualizado'},
]

const SUBFOLDER: Record<Exclude<ContentType, 'modpack'>, string> = {
  mod:          'mods',
  resourcepack: 'resourcepacks',
  shader:       'shaderpacks',
  datapack:     'datapacks',
}

const TYPE_LOADERS: Partial<Record<ContentType, { id: string; label: string }[]>> = {
  modpack: [
    { id: 'forge',    label: 'Forge'    },
    { id: 'neoforge', label: 'NeoForge' },
    { id: 'fabric',   label: 'Fabric'   },
    { id: 'quilt',    label: 'Quilt'    },
  ],
  mod: [
    { id: 'forge',      label: 'Forge'      },
    { id: 'neoforge',   label: 'NeoForge'   },
    { id: 'fabric',     label: 'Fabric'     },
    { id: 'quilt',      label: 'Quilt'      },
    { id: 'liteloader', label: 'LiteLoader' },
  ],
  shader: [
    { id: 'iris',     label: 'Iris'           },
    { id: 'optifine', label: 'OptiFine'       },
    { id: 'vanilla',  label: 'Vanilla Shader' },
    { id: 'canvas',   label: 'Canvas'         },
  ],
}


const HEADER_INFO: Record<string, { label: string; order: number }> = {
  'category':           { label: 'Categoría',              order: 0 },
  'categories':         { label: 'Categorías',             order: 0 },
  'environment':        { label: 'Entorno',                order: 1 },
  'feature':            { label: 'Característica',         order: 2 },
  'resolution':         { label: 'Resolución',             order: 3 },
  'performance_impact': { label: 'Impacto en rendimiento', order: 4 },
}

const LIMIT = 20

const CF_CLASS_ID: Partial<Record<ContentType, number>> = {
  modpack: 4471, mod: 6, resourcepack: 12, shader: 6552, datapack: 6945,
}
const CF_LOADER_TYPE: Record<string, number> = {
  forge: 1, fabric: 4, quilt: 5, neoforge: 6,
}
const CF_LOADER_NAME: Record<number, string> = {
  1: 'Forge', 4: 'Fabric', 5: 'Quilt', 6: 'NeoForge',
}
const CF_SORT_FIELD: Record<string, number> = {
  downloads: 6, relevance: 2, follows: 2, newest: 3, updated: 3,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDownloads(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}

function timeAgo(dateStr: string) {
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
  if (d === 0)  return 'Hoy'
  if (d === 1)  return 'Ayer'
  if (d < 7)   return `Hace ${d} días`
  if (d < 30)  return `Hace ${Math.floor(d / 7)} sem.`
  if (d < 365) return `Hace ${Math.floor(d / 30)} meses`
  return `Hace ${Math.floor(d / 365)} años`
}


function resolutionNum(name: string): number {
  const m = name.match(/^(\d+)/)
  return m ? parseInt(m[1]) : 9999
}

function sortCats(header: string, cats: string[]): string[] {
  if (header === 'resolution') {
    return [...cats].sort((a, b) => resolutionNum(a) - resolutionNum(b))
  }
  return cats
}

// ── Filter row: [include-btn] [icon] [label] [exclude-btn] ───────────────────

function FilterRow({
  label, icon, state, showIcon = true,
  onInclude, onExclude
}: {
  label: string
  icon?: string
  state?: FilterState
  showIcon?: boolean
  onInclude: () => void
  onExclude: () => void
}) {
  const included = state === 'include'
  const excluded = state === 'exclude'

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors group ${
      included ? 'bg-accent/10' : excluded ? 'bg-red-500/10' : 'hover:bg-bg-hover'
    }`}>
      {/* Include button (left) */}
      <button
        onClick={onInclude}
        title="Incluir"
        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
          included
            ? 'bg-accent border-accent'
            : 'border-border hover:border-accent/60'
        }`}
      >
        {included && (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        )}
      </button>

      {/* Icon (from Modrinth API) */}
      {showIcon && icon && (
        <div
          className={`w-4 h-4 flex-shrink-0 [&>svg]:w-full [&>svg]:h-full transition-colors ${
            included ? 'text-accent' : excluded ? 'text-red-400' : 'text-text-muted/60'
          }`}
          dangerouslySetInnerHTML={{ __html: icon }}
        />
      )}

      {/* Label */}
      <span className={`flex-1 text-sm truncate transition-colors ${
        included ? 'text-accent' : excluded ? 'text-red-400' : 'text-text-secondary'
      }`}>
        {label}
      </span>

      {/* Exclude button (right) — always visible, prominent when active */}
      <button
        onClick={onExclude}
        title="Excluir"
        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
          excluded
            ? 'bg-red-500/20 border-red-500/60'
            : 'border-border opacity-0 group-hover:opacity-100 hover:border-red-400/60'
        }`}
      >
        {excluded ? (
          <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-red-400">
            <circle cx="12" cy="12" r="9"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
        ) : (
          <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-text-muted/40">
            <circle cx="12" cy="12" r="9"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
        )}
      </button>
    </div>
  )
}

// ── Loader radio button ───────────────────────────────────────────────────────

function LoaderButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm transition-colors text-left w-full ${
        active ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      }`}
    >
      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
        active ? 'border-accent' : 'border-border'
      }`}>
        {active && <div className="w-1.5 h-1.5 rounded-full bg-accent" />}
      </div>
      {label}
    </button>
  )
}

// ── Collapsible sidebar section ───────────────────────────────────────────────

function SidebarSection({
  title, children, defaultOpen = true
}: {
  title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full mb-1.5 group"
      >
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-widest">
          {title}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          className={`text-text-muted/50 transition-transform ${open ? '' : '-rotate-180'}`}
        >
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      </button>
      {open && <div className="flex flex-col gap-0.5">{children}</div>}
    </div>
  )
}

// ── Install modal ─────────────────────────────────────────────────────────────

type InstallStep = 'instance' | 'version' | 'world' | 'naming' | 'installing' | 'done' | 'error'

function InstallModal({ project, contentType, instances, onClose, preselectedVersion, provider = modrinthProvider }: {
  project: Hit
  contentType: ContentType
  instances: Instance[]
  onClose: () => void
  preselectedVersion?: MVersion
  provider?: ContentProvider
}) {
  const isModpack  = contentType === 'modpack'
  const isDatapack = contentType === 'datapack'

  const initialStep: InstallStep = preselectedVersion
    ? (isModpack ? 'naming' : 'instance')
    : (isModpack ? 'version' : 'instance')

  const navigate = useNavigate()

  const [step, setStep]                         = useState<InstallStep>(initialStep)
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)
  const [selectedVersion, setSelectedVersion]   = useState<MVersion | null>(preselectedVersion ?? null)
  const [instanceName, setInstanceName]         = useState(project.title)
  const [versions, setVersions]                 = useState<MVersion[]>([])
  const [allVersions, setAllVersions]           = useState<MVersion[]>([])
  const [versionsLoading, setVLoading]          = useState(false)
  const [installVTypeFilter, setInstallVType]   = useState('')
  const [installMcFilter, setInstallMcFilter]   = useState('')
  const [worlds, setWorlds]                     = useState<World[]>([])
  const [worldsLoading, setWLoading]            = useState(false)
  const [errorMsg, setErrorMsg]                 = useState('')
  const [createdInstanceId, setCreatedInstanceId] = useState<string | null>(null)

  // For modpacks: load versions unfiltered; for mods/etc: load all versions for compatibility check
  useEffect(() => {
    if (isModpack && !preselectedVersion) {
      loadVersions()
    } else if (!isModpack) {
      provider.getVersions(project.project_id, '', '').then(vs => {
        setAllVersions(vs.filter(v => v.files.length > 0))
      }).catch(() => {})
    }
  }, [])

  async function loadVersions(inst?: Instance) {
    setVLoading(true)
    try {
      const mc     = inst?.minecraft ?? ''
      // resource packs, data packs and shaders don't filter by modloader
      const loaderRelevant = contentType === 'mod' || contentType === 'modpack'
      const loader = loaderRelevant ? (inst?.modloader ?? '') : ''
      const vs     = await provider.getVersions(project.project_id, mc, loader)
      setVersions(vs.filter(v => v.files.length > 0))
    } catch { setVersions([]) }
    finally  { setVLoading(false) }
  }

  // Filter instances to only show compatible ones for the content type
  const compatibleInstances = instances.filter(inst => {
    if (contentType === 'resourcepack' || contentType === 'datapack') return true
    if (contentType === 'mod' && inst.modloader === 'vanilla') return false
    if (allVersions.length === 0) return true
    return allVersions.some(v =>
      v.game_versions.includes(inst.minecraft) &&
      (contentType !== 'mod' || v.loaders.includes(inst.modloader))
    )
  })

  async function handleSelectInstance(inst: Instance) {
    setSelectedInstance(inst)
    setStep('version')
    await loadVersions(inst)
  }

  async function handleSelectVersion(v: MVersion) {
    setSelectedVersion(v)
    if (isModpack) {
      setStep('naming')
    } else if (isDatapack) {
      setStep('world')
      await loadWorlds()
    } else {
      await doInstall(v, undefined)
    }
  }

  async function loadWorlds() {
    if (!selectedInstance) return
    setWLoading(true)
    try {
      const ws = await window.api.instances.listWorlds(selectedInstance.id) as World[]
      setWorlds(ws)
    } catch { setWorlds([]) }
    finally { setWLoading(false) }
  }

  async function doInstall(v?: MVersion, worldName?: string) {
    const ver     = v ?? selectedVersion!
    const primary = ver.files.find(f => f.primary) ?? ver.files[0]
    if (!primary) { setErrorMsg('No hay archivo de descarga disponible'); setStep('error'); return }

    setStep('installing')
    try {
      if (isModpack && primary.filename.toLowerCase().endsWith('.fpack')) {
        // Modpack en formato del launcher: se descarga y se importa como un .fpack local
        const tmp  = await window.api.social.downloadTemp(primary.url, primary.filename)
        const inst = await window.api.fpack.import(tmp, instanceName.trim() || project.title)
        setCreatedInstanceId(inst.id)
        if (project.icon_url) await window.api.instances.setIconFromUrl(inst.id, project.icon_url).catch(() => {})
      } else if (isModpack) {
        const mc     = ver.game_versions[0] ?? ''
        const loader = ver.loaders[0] ?? 'vanilla'
        const inst   = await window.api.instances.create({
          name: instanceName.trim() || project.title,
          minecraft: mc,
          modloader: loader as Instance['modloader'],
        })
        setCreatedInstanceId(inst.id)
        // Install mrpack first — it returns the exact modloader+MC version from the mrpack manifest
        const meta = await window.api.modrinth.installMrpack(inst.id, primary.url)
        const modloaderVersion = meta?.modloaderVersion
        const mcActual   = meta?.minecraft ?? mc
        const loaderActual = (meta?.modloader ?? loader) as Instance['modloader']
        // Update instance with data from the mrpack manifest (may override what Modrinth API said)
        const updates: Partial<typeof inst> = {}
        if (modloaderVersion)             updates.modloaderVersion = modloaderVersion
        if (mcActual !== mc)              updates.minecraft        = mcActual
        if (loaderActual !== inst.modloader) updates.modloader     = loaderActual
        if (Object.keys(updates).length)  await window.api.instances.update({ ...inst, ...updates })
        await window.api.launcher.installVersion(mcActual, loaderActual !== 'vanilla' ? loaderActual : undefined, modloaderVersion)
        if (project.icon_url) {
          await window.api.instances.setIconFromUrl(inst.id, project.icon_url).catch(() => {})
        }
      } else {
        const subFolder = isDatapack
          ? `saves/${worldName}/datapacks`
          : SUBFOLDER[contentType as Exclude<ContentType, 'modpack'>]
        await window.api.modrinth.installMod(selectedInstance!.id, primary.url, primary.filename, subFolder)
      }
      provider.onInstalled?.(project.project_id, ver.id)
      setStep('done')
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Error desconocido')
      setStep('error')
    }
  }

  const primaryFile = (v: MVersion) => v.files.find(f => f.primary) ?? v.files[0]

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[540px] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          {project.icon_url && (
            <img src={project.icon_url} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-text-primary truncate">{project.title}</p>
            <p className="text-[11px] text-text-muted truncate">{project.description}</p>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">

          {step === 'instance' && (
            <div>
              <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-3">Seleccionar instancia</p>
              {instances.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-10">No tienes instancias creadas. Crea una primero.</p>
              ) : compatibleInstances.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-10">Ninguna instancia compatible. Necesitas una instancia con el modloader y versión MC correctos.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {compatibleInstances.map(inst => (
                    <button key={inst.id} onClick={() => handleSelectInstance(inst)}
                      className="flex items-center gap-3 p-3 bg-bg-card border border-border hover:border-accent/40 rounded-xl transition-colors text-left w-full">
                      <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{inst.name}</p>
                        <p className="text-[11px] text-text-muted">{inst.minecraft} · {inst.modloader}</p>
                      </div>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted flex-shrink-0">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'version' && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                {!isModpack && (
                  <button onClick={() => setStep('instance')} className="text-text-muted hover:text-text-primary transition-colors p-0.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                )}
                <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Seleccionar versión</p>
                {selectedInstance && (
                  <span className="text-[10px] text-text-muted ml-auto">{selectedInstance.minecraft} · {selectedInstance.modloader}</span>
                )}
              </div>
              {versionsLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-text-muted text-sm">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                  Cargando versiones...
                </div>
              ) : versions.length === 0 ? (
                <>
                  <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl mb-3">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400 flex-shrink-0 mt-0.5">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <p className="text-xs text-amber-400">No hay versión compatible con MC {selectedInstance?.minecraft}. Puedes forzar la instalación de otra versión bajo tu propio riesgo.</p>
                  </div>
                  {allVersions.length > 0 && (
                    <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                      {allVersions.slice(0, 50).map(v => {
                        const pf = primaryFile(v)
                        const cl = v.changelog?.replace(/[#*`_\[\]]/g, '').replace(/\n+/g, ' ').trim().slice(0, 120)
                        return (
                          <button key={v.id} onClick={() => handleSelectVersion(v)}
                            className="flex items-center gap-3 p-3 bg-bg-card border border-amber-500/20 hover:border-amber-500/50 rounded-xl transition-colors text-left w-full">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <p className="text-sm font-medium text-text-primary truncate">{v.name || v.version_number}</p>
                                {v.version_type === 'beta'  && <span className="text-[9px] px-1.5 py-px rounded-full bg-amber-500/20 text-amber-400 font-semibold flex-shrink-0">Beta</span>}
                                {v.version_type === 'alpha' && <span className="text-[9px] px-1.5 py-px rounded-full bg-red-500/20 text-red-400 font-semibold flex-shrink-0">Alpha</span>}
                              </div>
                              <p className="text-[11px] text-text-muted">
                                MC {v.game_versions.slice(0, 3).join(', ')}
                                {v.loaders.length > 0 && ` · ${v.loaders.join(', ')}`}
                              </p>
                              {cl && <p className="text-[11px] text-text-muted/70 mt-0.5 line-clamp-2">{cl}</p>}
                            </div>
                            <div className="text-right flex-shrink-0 mr-1">
                              {pf && <p className="text-[10px] text-text-muted">{(pf.size / 1024 / 1024).toFixed(1)} MB</p>}
                              <p className="text-[10px] text-text-muted">{timeAgo(v.date_published)}</p>
                            </div>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted flex-shrink-0">
                              <polyline points="9 18 15 12 9 6"/>
                            </svg>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {(() => {
                    const mcVersions = [...new Set(versions.flatMap(v => v.game_versions))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
                    return (
                      <div className="flex gap-2 mb-2 flex-wrap items-center">
                        {mcVersions.length > 1 && (
                          <select value={installMcFilter} onChange={e => setInstallMcFilter(e.target.value)}
                            className="bg-bg-card border border-border rounded-lg px-2 py-1 text-xs text-text-secondary outline-none cursor-pointer hover:border-accent/40 transition-colors">
                            <option value="">Todas las versiones MC</option>
                            {mcVersions.map(mc => <option key={mc} value={mc}>{mc}</option>)}
                          </select>
                        )}
                        <select value={installVTypeFilter} onChange={e => setInstallVType(e.target.value)}
                          className="bg-bg-card border border-border rounded-lg px-2 py-1 text-xs text-text-secondary outline-none cursor-pointer hover:border-accent/40 transition-colors">
                          <option value="">Todos (Release/Beta/Alpha)</option>
                          <option value="release">Release</option>
                          <option value="beta">Beta</option>
                          <option value="alpha">Alpha</option>
                        </select>
                      </div>
                    )
                  })()}
                <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                  {versions.filter(v =>
                    (!installVTypeFilter || v.version_type === installVTypeFilter) &&
                    (!installMcFilter || v.game_versions.includes(installMcFilter))
                  ).slice(0, 50).map(v => {
                    const pf = primaryFile(v)
                    const cl = v.changelog?.replace(/[#*`_\[\]]/g, '').replace(/\n+/g, ' ').trim().slice(0, 120)
                    return (
                      <button key={v.id} onClick={() => handleSelectVersion(v)}
                        className="flex items-center gap-3 p-3 bg-bg-card border border-border hover:border-accent/40 rounded-xl transition-colors text-left w-full">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <p className="text-sm font-medium text-text-primary truncate">{v.name || v.version_number}</p>
                            {v.version_type === 'beta'  && <span className="text-[9px] px-1.5 py-px rounded-full bg-amber-500/20 text-amber-400 font-semibold flex-shrink-0">Beta</span>}
                            {v.version_type === 'alpha' && <span className="text-[9px] px-1.5 py-px rounded-full bg-red-500/20 text-red-400 font-semibold flex-shrink-0">Alpha</span>}
                          </div>
                          <p className="text-[11px] text-text-muted">
                            MC {v.game_versions.slice(0, 3).join(', ')}
                            {v.loaders.length > 0 && ` · ${v.loaders.join(', ')}`}
                          </p>
                          {cl && <p className="text-[11px] text-text-muted/70 mt-0.5 line-clamp-2">{cl}</p>}
                        </div>
                        <div className="text-right flex-shrink-0 mr-1">
                          {pf && <p className="text-[10px] text-text-muted">{(pf.size / 1024 / 1024).toFixed(1)} MB</p>}
                          <p className="text-[10px] text-text-muted">{timeAgo(v.date_published)}</p>
                        </div>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted flex-shrink-0">
                          <polyline points="9 18 15 12 9 6"/>
                        </svg>
                      </button>
                    )
                  })}
                </div>
                </>
              )}
            </div>
          )}

          {step === 'naming' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <button onClick={() => setStep('version')} className="text-text-muted hover:text-text-primary transition-colors p-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Nombre de instancia</p>
              </div>
              {selectedVersion && (
                <div className="p-3 bg-bg-card border border-border rounded-xl">
                  <p className="text-[10px] text-text-muted mb-0.5">Versión</p>
                  <p className="text-sm font-medium text-text-primary">{selectedVersion.name || selectedVersion.version_number}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    MC {selectedVersion.game_versions.slice(0, 3).join(', ')} · {selectedVersion.loaders.join(', ')}
                  </p>
                </div>
              )}
              <input value={instanceName} onChange={e => setInstanceName(e.target.value)}
                className="w-full bg-bg-card border border-border focus:border-accent/50 rounded-lg px-3 py-2 text-sm text-text-primary outline-none transition-colors"
                placeholder="Nombre de la instancia" />
              <button onClick={() => doInstall()} disabled={!instanceName.trim()}
                className="py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/>
                </svg>
                Instalar modpack
              </button>
            </div>
          )}

          {step === 'world' && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <button onClick={() => setStep('version')} className="text-text-muted hover:text-text-primary transition-colors p-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Seleccionar mundo</p>
              </div>
              {worldsLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-text-muted text-sm">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                  Cargando mundos...
                </div>
              ) : worlds.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-10">No hay mundos en esta instancia. Crea uno primero.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {worlds.map(w => (
                    <button key={w.name} onClick={() => doInstall(undefined, w.name)}
                      className="flex items-center gap-3 p-3 bg-bg-card border border-border hover:border-accent/40 rounded-xl transition-colors text-left w-full">
                      <div className="w-8 h-8 rounded-lg bg-green-500/15 flex items-center justify-center flex-shrink-0">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400">
                          <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/>
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-text-primary flex-1 truncate">{w.name}</p>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted flex-shrink-0">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'installing' && (
            <div className="flex flex-col items-center justify-center py-14 gap-4">
              <svg className="animate-spin w-8 h-8 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 00-9-9"/>
              </svg>
              <p className="text-sm text-text-muted text-center">
                Instalando{isModpack ? ' modpack' : ''}...<br/>
                <span className="text-[11px]">El progreso se muestra en la barra inferior</span>
              </p>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <p className="text-sm font-semibold text-text-primary">¡Instalado correctamente!</p>
              <div className="flex gap-2">
                {isModpack && createdInstanceId && (
                  <button onClick={() => { onClose(); navigate('/instances') }}
                    className="flex items-center gap-1.5 px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    Ir a jugar
                  </button>
                )}
                <button onClick={onClose}
                  className="px-5 py-2 border border-border hover:border-accent/40 text-text-secondary rounded-lg text-sm transition-colors">
                  Cerrar
                </button>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-red-400">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </div>
              <p className="text-sm font-semibold text-text-primary">Error al instalar</p>
              <p className="text-xs text-text-muted text-center px-4 break-words">{errorMsg}</p>
              <button onClick={onClose}
                className="px-6 py-2 border border-border hover:border-accent/40 text-text-secondary rounded-lg text-sm transition-colors">
                Cerrar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Loader label helper ───────────────────────────────────────────────────────

const LOADER_LABELS: Record<string, string> = {
  'forge': 'Forge', 'neoforge': 'NeoForge', 'fabric': 'Fabric',
  'quilt': 'Quilt', 'liteloader': 'LiteLoader', 'iris': 'Iris',
  'optifine': 'OptiFine', 'vanilla': 'Vanilla Shader', 'canvas': 'Canvas',
  'datapack': 'Datapack', 'bukkit': 'Bukkit', 'spigot': 'Spigot',
  'paper': 'Paper', 'folia': 'Folia', 'purpur': 'Purpur',
  'velocity': 'Velocity', 'waterfall': 'Waterfall', 'minecraft': 'Minecraft',
}

function loaderLabel(id: string) { return LOADER_LABELS[id] ?? id }




// ── Tarjetas de resultados ────────────────────────────────────────────────────

const IconDl = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
)
const IconHeartFill = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
)
const IconClockSm = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
)

const LOADER_COLORS: Record<string, string> = {
  forge: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  neoforge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  fabric: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  quilt: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  iris: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  optifine: 'bg-red-500/15 text-red-300 border-red-500/30',
}

function LoaderChip({ id }: { id: string }) {
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-md border font-medium ${LOADER_COLORS[id] ?? 'bg-bg-hover text-text-secondary border-border'}`}>
      {loaderLabel(id)}
    </span>
  )
}

function ProjectIcon({ src, size = 80 }: { src: string | null | undefined; size?: number }) {
  const [err, setErr] = useState(false)
  return (
    <div className="rounded-2xl bg-bg-hover flex-shrink-0 overflow-hidden flex items-center justify-center ring-1 ring-white/5 shadow-md"
      style={{ width: size, height: size }}>
      {src && !err ? (
        <img src={src} alt="" className="w-full h-full object-cover" onError={() => setErr(true)} loading="lazy" />
      ) : (
        <svg width={size * 0.4} height={size * 0.4} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted/30">
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>
        </svg>
      )}
    </div>
  )
}

function InstallButton({ onClick, label = 'Instalar' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-xl font-semibold transition-all shadow-sm shadow-accent/20 hover:shadow-accent/40 active:scale-95"
    >
      <IconDl size={14} />
      {label}
    </button>
  )
}

function ProjectCard({ hit, onInstall, onDetail, contentType, catIcons, extra, hideFollows }: {
  hit: Hit; onInstall: () => void; onDetail: () => void; contentType: ContentType
  catIcons?: Map<string, string>; extra?: React.ReactNode; hideFollows?: boolean
}) {
  return (
    <div
      className="group flex items-start gap-5 p-5 bg-bg-card border border-border hover:border-accent/40 rounded-2xl transition-all duration-150 cursor-pointer hover:-translate-y-0.5 hover:shadow-xl hover:shadow-accent/5"
      onClick={onDetail}
    >
      <ProjectIcon src={hit.icon_url} size={80} />

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-text-primary truncate group-hover:text-accent transition-colors">{hit.title}</p>
            <p className="text-[13px] text-text-secondary mt-1 line-clamp-2 leading-relaxed">{hit.description}</p>
          </div>
          <InstallButton onClick={onInstall} />
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {extra}
          {hit.display_categories.slice(0, 5).map(cat => {
            const svg = catIcons?.get(cat)
            return (
              <span key={cat} className="inline-flex items-center gap-1.5 text-[11px] bg-bg-hover text-text-secondary px-2 py-1 rounded-lg capitalize border border-border/60">
                {svg && <span className="w-3.5 h-3.5 text-text-muted [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} />}
                {catLabel(cat)}
              </span>
            )
          })}
          {(contentType === 'mod' || contentType === 'modpack') && (() => {
            const c = hit.client_side !== 'unsupported' && hit.client_side !== ''
            const sv = hit.server_side !== 'unsupported' && hit.server_side !== ''
            if (!c && !sv) return null
            return (
              <div className="flex items-center gap-1">
                {c && <span title="Funciona en el cliente" className="px-1.5 h-6 flex items-center justify-center rounded-md text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30">Cliente</span>}
                {sv && <span title="Funciona en el servidor" className="px-1.5 h-6 flex items-center justify-center rounded-md text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30">Servidor</span>}
              </div>
            )
          })()}
          <div className="flex items-center gap-4 ml-auto text-xs text-text-muted">
            <span className="flex items-center gap-1.5" title="Descargas"><IconDl /> {fmtDownloads(hit.downloads)}</span>
            {!hideFollows && <span className="flex items-center gap-1.5 text-red-300/80" title="Seguidores"><IconHeartFill /> {fmtDownloads(hit.follows)}</span>}
            <span className="flex items-center gap-1.5" title="Actualizado"><IconClockSm /> {timeAgo(hit.date_modified)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── CurseForge card ───────────────────────────────────────────────────────────

function CurseCard({ hit, onDetail, onInstall }: { hit: CurseHit; onDetail: () => void; onInstall: () => void }) {
  const loaderTypes = [...new Set(hit.latestFilesIndexes.map(f => f.modLoaderType).filter(Boolean))]
  const versions = [...new Set(hit.latestFilesIndexes.map(f => f.gameVersion))].slice(0, 2)
  return (
    <div className="group flex items-start gap-5 p-5 bg-bg-card border border-border rounded-2xl hover:border-[#F16436]/40 transition-all duration-150 cursor-pointer hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#F16436]/5"
      onClick={onDetail}>
      <ProjectIcon src={hit.logo?.thumbnailUrl} size={80} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-text-primary truncate group-hover:text-[#F16436] transition-colors">{hit.name}</p>
            <p className="text-[13px] text-text-secondary mt-1 line-clamp-2 leading-relaxed">{hit.summary}</p>
          </div>
          <InstallButton onClick={onInstall} />
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {loaderTypes.slice(0, 3).map(lt => <LoaderChip key={lt} id={(CF_LOADER_NAME[lt] ?? String(lt)).toLowerCase()} />)}
          {versions.map(v => (
            <span key={v} className="text-[11px] px-2 py-0.5 rounded-md bg-bg-hover text-text-secondary border border-border">{v}</span>
          ))}
          {hit.categories.slice(0, 3).map(c => (
            <span key={c.id} className="text-[11px] px-2 py-1 rounded-lg bg-bg-hover text-text-secondary border border-border/60">{c.name}</span>
          ))}
          <div className="flex items-center gap-4 ml-auto text-xs text-text-muted">
            <span className="flex items-center gap-1.5"><IconDl /> {fmtDownloads(hit.downloadCount)}</span>
            <span className="flex items-center gap-1.5"><IconClockSm /> {timeAgo(hit.dateModified)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── CurseForge install dialog ─────────────────────────────────────────────────

function CurseInstall({ hit, file, contentType, instances, onClose }: {
  hit: CurseHit; file?: CurseFile; contentType: ContentType; instances: Instance[]; onClose: () => void
}) {
  const isModpack = contentType === 'modpack'
  const isDatapack = contentType === 'datapack'
  const navigate = useNavigate()
  const [step, setStep] = useState<'instance' | 'world' | 'naming' | 'installing' | 'done' | 'error'>(isModpack ? 'naming' : 'instance')
  const [instanceName, setInstanceName] = useState(hit.name)
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)
  const [worlds, setWorlds] = useState<World[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [createdInstanceId, setCreatedInstanceId] = useState<string | null>(null)

  // El loader de un archivo de CurseForge va mezclado en gameVersions ("NeoForge", "1.21.1")
  const fileLoader = (f?: CurseFile): string =>
    (f?.gameVersions ?? []).map(v => v.toLowerCase()).find(v => ['forge', 'neoforge', 'fabric', 'quilt'].includes(v)) ?? ''
  const index = hit.latestFilesIndexes[0] as (CurseHit['latestFilesIndexes'][number] & { modLoader?: number }) | undefined
  const gameVersion = file?.gameVersions.find(v => /^\d/.test(v)) ?? index?.gameVersion ?? ''
  const loaderLabel = fileLoader(file) || CF_LOADER_NAME[index?.modLoader ?? index?.modLoaderType ?? 0]?.toLowerCase() || ''

  type CfFile = CurseFile & { dependencies?: { modId: number; relationType: number }[] }

  /** Archivo más nuevo de un proyecto que sirva a la instancia. */
  async function newestFor(modId: number, inst: Instance): Promise<CfFile | null> {
    const loaderType = contentType === 'mod' ? CF_LOADER_TYPE[inst.modloader] : undefined
    const res = await window.api.curseforge.getFiles(modId, inst.minecraft, loaderType) as { data?: CfFile[] }
    return res.data?.[0] ?? null
  }

  /** Archivo a instalar en una instancia: el elegido, o el más nuevo que le sirva. */
  async function fileFor(inst: Instance): Promise<CfFile | null> {
    return (file as CfFile | undefined) ?? newestFor(hit.id, inst)
  }

  /** Dependencias necesarias (relationType 3) que la instancia aún no tiene. */
  async function installRequiredDeps(f: CfFile, inst: Instance): Promise<void> {
    const required = (f.dependencies ?? []).filter(d => d.relationType === 3).map(d => d.modId)
    if (!required.length) return
    const meta = await window.api.modrinth.getInstalledModsMeta(inst.id, inst.minecraft, inst.modloader).catch(() => ({}))
    const have = new Set(Object.values(meta).map(m => m.cfModId).filter(Boolean))
    for (const depId of required) {
      if (have.has(depId)) continue
      const dep = await newestFor(depId, inst).catch(() => null)
      if (dep) await window.api.curseforge.installMod(inst.id, depId, dep.id, 'mods').catch(() => {})
    }
  }

  async function chooseInstance(inst: Instance) {
    setSelectedInstance(inst)
    if (isDatapack) {
      setWorlds(await window.api.instances.listWorlds(inst.id).catch(() => []) as World[])
      setStep('world')
    } else {
      await doInstall(inst)
    }
  }

  async function doInstall(inst?: Instance, world?: string) {
    setStep('installing')
    try {
      if (isModpack) {
        const fileId = file?.id ?? index?.fileId
        if (!fileId) throw new Error('No hay archivo para descargar')
        const created = await window.api.instances.create({
          name: instanceName.trim() || hit.name,
          minecraft: gameVersion,
          modloader: (loaderLabel || 'vanilla') as Instance['modloader'],
        })
        setCreatedInstanceId(created.id)
        await window.api.curseforge.installModpack(created.id, hit.id, fileId)
        if (hit.logo?.thumbnailUrl) await window.api.instances.setIconFromUrl(created.id, hit.logo.thumbnailUrl).catch(() => {})
        // El proceso principal ya dejó la instancia con la versión y el loader del modpack
        const inst2 = (await window.api.instances.list()).find(i => i.id === created.id) ?? created
        await window.api.launcher.installVersion(inst2.minecraft, inst2.modloader !== 'vanilla' ? inst2.modloader : undefined, inst2.modloaderVersion)
      } else {
        const target = inst ?? selectedInstance!
        const chosen = await fileFor(target)
        const fileId = chosen?.id
        if (!chosen || !fileId) throw new Error(`No hay ninguna versión de «${hit.name}» para Minecraft ${target.minecraft}${contentType === 'mod' ? ` con ${target.modloader}` : ''}.`)
        const subFolder = isDatapack ? `saves/${world}/datapacks` : SUBFOLDER[contentType as Exclude<ContentType, 'modpack'>]
        await window.api.curseforge.installMod(target.id, hit.id, fileId, subFolder)
        if (contentType === 'mod') await installRequiredDeps(chosen, target)
      }
      setStep('done')
    } catch (e: any) {
      setErrorMsg((e?.message ?? 'Error desconocido').replace(/^Error invoking remote method [^:]+: (Error: )?/, ''))
      setStep('error')
    }
  }

  const compatible = instances.filter(inst =>
    contentType !== 'mod' || (inst.modloader !== 'vanilla' && (!loaderLabel || !file || inst.modloader === loaderLabel)))

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          {hit.logo?.thumbnailUrl && <img src={hit.logo.thumbnailUrl} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-text-primary truncate">{hit.name}</p>
            <p className="text-[11px] text-text-muted">CurseForge{file ? ` · ${file.displayName}` : ''}{gameVersion && isModpack ? ` · ${gameVersion}` : ''}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto">
          {step === 'naming' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Nombre de la instancia</label>
                <input autoFocus value={instanceName} onChange={e => setInstanceName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') doInstall() }}
                  className="w-full bg-bg-primary border border-border focus:border-[#F16436] rounded-xl px-3 py-2.5 text-sm text-text-primary outline-none" />
              </div>
              <button onClick={() => doInstall()} className="w-full py-2.5 rounded-xl bg-[#F16436] hover:opacity-90 text-white text-sm font-bold">Crear e instalar</button>
            </div>
          )}

          {step === 'instance' && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-2">Elige la instancia</p>
              {compatible.length === 0 && <p className="text-sm text-text-muted text-center py-8">No tienes ninguna instancia compatible{contentType === 'mod' ? ' (hace falta una con loader)' : ''}.</p>}
              {compatible.map(inst => (
                <button key={inst.id} onClick={() => chooseInstance(inst)}
                  className="w-full flex items-center gap-3 p-3 bg-bg-card border border-border hover:border-[#F16436]/50 rounded-xl text-left transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{inst.name}</p>
                    <p className="text-[11px] text-text-muted">{inst.minecraft} · {inst.modloader}</p>
                  </div>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              ))}
            </div>
          )}

          {step === 'world' && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-2">¿En qué mundo?</p>
              {worlds.length === 0 && <p className="text-sm text-text-muted text-center py-8">Esa instancia no tiene mundos todavía. Entra al juego y crea uno.</p>}
              {worlds.map(w => (
                <button key={w.name} onClick={() => doInstall(undefined, w.name)}
                  className="w-full p-3 bg-bg-card border border-border hover:border-[#F16436]/50 rounded-xl text-left text-sm text-text-primary transition-colors">
                  🌍 {w.name}
                </button>
              ))}
            </div>
          )}

          {step === 'installing' && (
            <div className="flex flex-col items-center gap-3 py-10 text-text-muted text-sm">
              <svg className="animate-spin w-7 h-7 text-[#F16436]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
              Instalando…
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center text-green-400 text-2xl">✓</div>
              <p className="text-sm font-semibold text-text-primary">¡Instalado!</p>
              <div className="flex gap-2 mt-2">
                {createdInstanceId && <button onClick={() => { onClose(); navigate('/instances') }} className="px-4 py-2 rounded-xl bg-[#F16436] text-white text-sm font-semibold">Ir a instancias</button>}
                <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border text-sm text-text-secondary">Cerrar</button>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-red-300">{errorMsg}</p>
              <button onClick={() => setStep(isModpack ? 'naming' : 'instance')} className="px-4 py-2 rounded-xl border border-border text-sm text-text-secondary">Volver</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Fuente Fport1 ─────────────────────────────────────────────────────────────

function fport1ToHit(p: Fport1Project): Hit {
  return {
    project_id: p.id,
    title: p.title,
    description: p.summary,
    icon_url: p.iconUrl,
    downloads: p.downloads,
    follows: 0,
    display_categories: p.categories,
    date_modified: new Date(projectUpdatedMs(p) || Date.now()).toISOString(),
    client_side: p.clientSide,
    server_side: p.serverSide,
  }
}

function fport1Provider(): ContentProvider {
  return {
    hideFollows: true,
    async getVersions(id, mc, loader) {
      const vs = await listFport1Versions(id)
      return vs
        .filter(v => (!mc || v.gameVersions.includes(mc)) && (!loader || !v.loaders.length || v.loaders.includes(loader)))
        .map(v => ({
          id: v.id,
          version_number: v.versionNumber,
          name: v.name || v.versionNumber,
          loaders: v.loaders,
          game_versions: v.gameVersions,
          date_published: new Date(versionPublishedMs(v) || Date.now()).toISOString(),
          files: v.files.map(f => ({ url: f.url, filename: f.filename, primary: f.primary, size: f.size })),
          version_type: v.channel,
          changelog: v.changelog,
        }))
    },
    onInstalled: (projectId, versionId) => { countFport1Download(projectId, versionId) },
  }
}

const CHANNEL_STYLE: Record<string, string> = {
  release: 'bg-green-500/15 text-green-300 border-green-500/30',
  beta: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  alpha: 'bg-red-500/15 text-red-300 border-red-500/30',
}

// ── Iconos de pestañas y fuentes ──────────────────────────────────────────────

const TAB_ICONS: Record<ContentType, React.ReactNode> = {
  modpack: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/></svg>,
  mod: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 01-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 10-3.214 3.214c.446.166.855.497.925.968a.979.979 0 01-.276.837l-1.61 1.61a2.404 2.404 0 01-1.705.707 2.402 2.402 0 01-1.704-.706l-1.568-1.568a1.026 1.026 0 00-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 11-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 00-.289-.877l-1.568-1.568A2.402 2.402 0 011.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 103.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0112 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 113.237 3.237c-.464.18-.894.527-.967 1.02z"/></svg>,
  resourcepack: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 00-2.82 0L6 21"/></svg>,
  datapack: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z"/><path d="M14 2v6h6M10 13l-2 2 2 2M14 17l2-2-2-2"/></svg>,
  shader: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
}

type Source = 'modrinth' | 'curseforge' | 'fport1'

const SOURCES: { key: Source; label: string; color: string; icon: React.ReactNode }[] = [
  {
    key: 'modrinth', label: 'Modrinth', color: '#1bd96a',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12.252.004a11.78 11.768 0 00-8.92 3.73 11 11 0 00-2.17 3.11 11.37 11.359 0 00-1.16 5.169c0 1.42.17 2.5.6 3.77.24.759.77 1.899 1.17 2.529a12.3 12.298 0 008.85 5.639c.44.05 2.54.07 2.76.02.2-.04.22.1-.26-1.7l-.36-1.37-1.01-.06a8.5 8.489 0 01-5.18-1.8 5.34 5.34 0 01-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 012.88-1.629c.03 0 .5.45 1.06.98l1 .97 2.07-.43 2.06-.43 1.47-1.47c.8-.8 1.48-1.5 1.48-1.52 0-.09-.42-1.63-.46-1.7-.04-.06-.2-.03-1.02.18-.53.13-1.2.3-1.45.4l-.48.15-.53.53-.53.53-.93.1-.93.07-.52-.5a2.7 2.7 0 01-.96-1.7l-.13-.6.43-.57c.68-.9.68-.9 1.46-1.1.4-.1.65-.2.83-.33.13-.099.65-.579 1.14-1.069l.9-.9-.7-.7-.7-.7-1.95.54c-1.07.3-1.96.53-1.97.53-.03 0-2.23 2.48-2.63 2.97l-.29.35.28 1.03c.16.56.3 1.16.31 1.34l.03.3-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1-.08-.1-.23-.6-.32-1.03-.18-.86-.17-2.75.02-3.73a8.84 8.84 0 017.9-6.93c.43-.03.77-.08.78-.1.06-.17.5-2.999.47-3.039-.01-.02-.1-.02-.2-.03zm3.68.67c-.2 0-.3.1-.37.38-.06.23-.46 2.42-.46 2.52 0 .04.1.11.22.16a8.51 8.499 0 012.99 2 8.38 8.379 0 012.16 3.449 6.9 6.9 0 01.4 2.8c0 1.07 0 1.27-.1 1.73a9.37 9.369 0 01-1.76 3.769c-.32.4-.98 1.06-1.37 1.38-.38.32-1.54 1.1-1.7 1.14-.1.03-.1.06-.07.26.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 007.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 00-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06z"/></svg>,
  },
  {
    key: 'curseforge', label: 'CurseForge', color: '#F16436',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.326 9.2145S23.2261 8.4418 24 6.1882h-7.5066V4.4H0l2.0318 2.3576V9.173s5.1267-.2665 7.1098 1.2372c2.7146 2.516-3.053 5.917-3.053 5.917L5.0995 19.6c1.5465-1.4726 4.494-3.3775 9.8983-3.2857-2.0565.65-4.1245 1.6651-5.7344 3.2857h10.9248l-1.0288-3.2726s-7.918-4.6688-.8336-7.1127z"/></svg>,
  },
  {
    key: 'fport1', label: 'Fport1', color: '#a855f7',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>,
  },
]

export default function DiscoverPage() {
  const [source, setSource]             = useState<Source>(() => {
    const s = localStorage.getItem('ml-discover-source')
    return s === 'curseforge' || s === 'fport1' ? s : 'modrinth'
  })
  const [contentType, setContentType]   = useState<ContentType>('modpack')
  const [query, setQuery]               = useState('')
  const [draftQuery, setDraftQuery]     = useState('')
  const [page, setPage]                 = useState(0)
  const [results, setResults]           = useState<Hit[]>([])
  const [total, setTotal]               = useState(0)
  const [loading, setLoading]           = useState(false)
  const [categories, setCategories]     = useState<Category[]>([])
  const [catFilters, setCatFilters]     = useState<Record<string, FilterState>>({})
  const [selectedLoader, setSelectedLoader] = useState<string>('')
  const [sort, setSort]                 = useState('downloads')
  const [mcFilter, setMcFilter]         = useState('')
  const [mcVersions, setMcVersions]     = useState<string[]>([])
  const [instances, setInstances]       = useState<Instance[]>([])
  // Historial de fichas abiertas (lista → proyecto → dependencia…), también con los botones del ratón
  const [hist, setHist] = useState<{ list: (DetailRef | null)[]; idx: number }>({ list: [null], idx: 0 })
  const view = hist.list[hist.idx]
  // Pestaña y desplazamiento de cada paso del historial, y de la lista
  const viewState = useRef(new Map<number, { tab: DetailTab; scroll: number }>())
  const listScroll = useRef(0)
  const openDetail = (ref: DetailRef): void => {
    if (!histRef.current.list[histRef.current.idx]) listScroll.current = resultsRef.current?.scrollTop ?? 0
    setHist(h => {
      for (const k of [...viewState.current.keys()]) if (k > h.idx) viewState.current.delete(k)
      return { list: [...h.list.slice(0, h.idx + 1), ref], idx: h.idx + 1 }
    })
  }
  const histRef = useRef(hist)
  histRef.current = hist
  useEffect(() => nav.setInterceptor(dir => {
    const h = histRef.current
    const next = h.idx + (dir === 'back' ? -1 : 1)
    if (next < 0 || next >= h.list.length) return false
    setHist({ ...h, idx: next })
    return true
  }), [])
  useEffect(() => {
    if (!view) requestAnimationFrame(() => { if (resultsRef.current) resultsRef.current.scrollTop = listScroll.current })
  }, [view])
  const [installing, setInstalling]     = useState<{ project: Hit; version?: MVersion; source: 'modrinth' | 'fport1' } | null>(null)

  // CurseForge state
  const [cfResults, setCfResults]       = useState<CurseHit[]>([])
  const [cfTotal, setCfTotal]           = useState(0)
  const [cfInstalling, setCfInstalling] = useState<{ hit: CurseHit; file?: CurseFile } | null>(null)
  const [cfCategories, setCfCategories] = useState<{ id: number; name: string; parentCategoryId: number; iconUrl?: string }[]>([])
  const [cfCategoryId, setCfCategoryId] = useState<number | null>(null)

  // Fport1 state
  const [f1Projects, setF1Projects]     = useState<Fport1Project[]>([])
  const [f1Loading, setF1Loading]       = useState(false)
  const [f1Error, setF1Error]           = useState('')
  const [f1Category, setF1Category]     = useState('')
  const [f1Admin, setF1Admin]           = useState(false)
  const [studioOpen, setStudioOpen]     = useState(false)

  useEffect(() => {
    window.api.instances.list().then(setInstances).catch(() => {})
    window.api.launcher.getMcVersions()
      .then(vs => setMcVersions(
        (vs as { id: string; type: string }[]).filter(v => v.type === 'release').slice(0, 25).map(v => v.id)
      ))
      .catch(() => {})
  }, [])

  useEffect(() => { localStorage.setItem('ml-discover-source', source) }, [source])

  // ¿La sesión de fport1social es la de @fport1? Entonces puede publicar.
  useEffect(() => onAuthStateChanged(socialAuth, async u => {
    if (!u) { setF1Admin(false); return }
    try { setF1Admin((await getDoc(doc(socialDb, 'users', u.uid))).data()?.usernameSlug === 'fport1') }
    catch { setF1Admin(false) }
  }), [])

  const loadF1 = useCallback(async () => {
    setF1Loading(true); setF1Error('')
    try { setF1Projects(await listFport1Published()) }
    catch (e) {
      // Sin reglas publicadas en Firestore todavía: el catálogo está vacío, no roto
      if (/permission/i.test(String(e))) setF1Projects([])
      else setF1Error('No se pudo cargar el catálogo de Fport1')
    }
    finally { setF1Loading(false) }
  }, [])
  useEffect(() => { if (source === 'fport1') loadF1() }, [source, loadF1])

  useEffect(() => {
    setCategories([])
    setCatFilters({})
    setSelectedLoader('')
    // Modrinth has no 'datapack' project_type in category tags — use 'mod' categories
    const catType = contentType === 'datapack' ? 'mod' : contentType
    window.api.modrinth.getCategories(catType)
      .then(c => setCategories(c as Category[]))
      .catch(() => {})
  }, [contentType])

  const catIcons = useMemo(() => new Map(categories.filter(c => c.icon).map(c => [c.name, c.icon!])), [categories])

  const doSearch = useCallback(async (
    q: string,
    p: number,
    type: ContentType,
    filters: Record<string, FilterState>,
    loader: string,
    s: string,
    mc: string
  ) => {
    setLoading(true)
    const includedCats = Object.entries(filters).filter(([, v]) => v === 'include').map(([k]) => k)
    const excludedCats = Object.entries(filters).filter(([, v]) => v === 'exclude').map(([k]) => k)
    try {
      const res = await window.api.modrinth.search(q, mc, loader, includedCats, '', type, LIMIT, p * LIMIT, s) as { hits: Hit[]; total_hits: number }
      let hits = res.hits ?? []
      if (excludedCats.length > 0) {
        hits = hits.filter(h => !h.display_categories.some(c => excludedCats.includes(c)))
      }
      setResults(hits)
      setTotal(res.total_hits ?? 0)
    } catch { setResults([]); setTotal(0) }
    finally { setLoading(false) }
  }, [])

  const doCfSearch = useCallback(async (q: string, p: number, type: ContentType, loader: string, s: string, mc: string, catId?: number | null) => {
    const classId = CF_CLASS_ID[type]
    if (!classId) { setCfResults([]); setCfTotal(0); return }
    setLoading(true)
    try {
      const modLoaderType = loader ? CF_LOADER_TYPE[loader] : undefined
      const data = await window.api.curseforge.search({
        query: q, gameVersion: mc || undefined, classId,
        sortField: CF_SORT_FIELD[s] ?? 6,
        offset: p * LIMIT, modLoaderType,
        categoryId: catId ?? undefined,
      }) as { data: CurseHit[]; pagination: { totalCount: number } }
      setCfResults(data.data ?? [])
      setCfTotal(data.pagination?.totalCount ?? 0)
    } catch { setCfResults([]); setCfTotal(0) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (source !== 'curseforge') return
    const classId = CF_CLASS_ID[contentType]
    if (!classId) { setCfCategories([]); return }
    setCfCategories([])
    window.api.curseforge.getCategories(classId)
      .then((d: any) => setCfCategories(d?.data ?? []))
      .catch(() => setCfCategories([]))
  }, [source, contentType])

  useEffect(() => {
    setPage(0)
    if (source === 'modrinth') {
      doSearch(query, 0, contentType, catFilters, selectedLoader, sort, mcFilter)
    } else if (source === 'curseforge') {
      doCfSearch(query, 0, contentType, selectedLoader, sort, mcFilter, cfCategoryId)
    }
  }, [contentType, catFilters, selectedLoader, sort, mcFilter, source, cfCategoryId])

  // Fport1: el catálogo entero ya está en memoria, se filtra aquí
  const f1Filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = f1Projects.filter(p =>
      p.type === contentType &&
      (!q || p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q)) &&
      (!selectedLoader || p.loaders.includes(selectedLoader)) &&
      (!mcFilter || p.gameVersions.includes(mcFilter)) &&
      (!f1Category || p.categories.includes(f1Category))
    )
    const byFeatured = (a: Fport1Project, b: Fport1Project) => Number(!!b.featured) - Number(!!a.featured)
    return list.sort((a, b) => byFeatured(a, b) || (
      sort === 'newest' ? (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
      : sort === 'updated' ? projectUpdatedMs(b) - projectUpdatedMs(a)
      : sort === 'relevance' ? a.title.localeCompare(b.title)
      : b.downloads - a.downloads
    ))
  }, [f1Projects, contentType, query, selectedLoader, mcFilter, f1Category, sort])
  const f1Provider = useMemo(() => fport1Provider(), [])
  const f1Loaders = useMemo(() => [...new Set(f1Projects.filter(p => p.type === contentType).flatMap(p => p.loaders))], [f1Projects, contentType])
  const f1Cats = useMemo(() => [...new Set(f1Projects.filter(p => p.type === contentType).flatMap(p => p.categories))].sort(), [f1Projects, contentType])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setQuery(draftQuery)
    setPage(0)
    if (source === 'modrinth') {
      doSearch(draftQuery, 0, contentType, catFilters, selectedLoader, sort, mcFilter)
    } else if (source === 'curseforge') {
      doCfSearch(draftQuery, 0, contentType, selectedLoader, sort, mcFilter, cfCategoryId)
    }
  }

  function handleTabChange(type: ContentType) {
    setContentType(type)
    setDraftQuery('')
    setQuery('')
    setPage(0)
    setCfCategoryId(null)
    setCfResults([])
    setResults([])
    setSelectedLoader('')
    setCatFilters({})
    setF1Category('')
  }

  function handleSourceChange(src: Source) {
    setSource(src)
    setDraftQuery('')
    setQuery('')
    setPage(0)
    setHist({ list: [null], idx: 0 })
    setCfResults([])
    setResults([])
    setCfCategoryId(null)
    setF1Category('')
    setSelectedLoader('')
    if (src === 'curseforge' && CF_CLASS_ID[contentType] === undefined) setContentType('mod')
    // search is triggered by the useEffect watching [source, ...]
  }

  const resultsRef = useRef<HTMLDivElement>(null)
  function handlePage(p: number) {
    setPage(p)
    if (source === 'modrinth') {
      doSearch(query, p, contentType, catFilters, selectedLoader, sort, mcFilter)
    } else if (source === 'curseforge') {
      doCfSearch(query, p, contentType, selectedLoader, sort, mcFilter, cfCategoryId)
    }
    resultsRef.current?.scrollTo({ top: 0 })
  }

  const activeTotal = source === 'curseforge' ? cfTotal : source === 'fport1' ? f1Filtered.length : total
  const activeCount = source === 'curseforge' ? cfResults.length : source === 'fport1' ? f1Filtered.length : results.length
  const activeTotalPages = Math.ceil(activeTotal / LIMIT)
  const busy = source === 'fport1' ? f1Loading : loading
  const accentColor = SOURCES.find(s => s.key === source)!.color

  function toggleCat(cat: string, action: FilterState) {
    setCatFilters(prev => {
      if (prev[cat] === action) {
        const next = { ...prev }
        delete next[cat]
        return next
      }
      return { ...prev, [cat]: action }
    })
  }

  function toggleLoader(id: string) {
    setSelectedLoader(prev => prev === id ? '' : id)
  }

  // Build sorted category groups from API data
  const catGroups = categories.reduce<Record<string, string[]>>((acc, c) => {
    (acc[c.header] ??= []).push(c.name)
    return acc
  }, {})

  const sortedHeaders = Object.keys(catGroups).sort((a, b) => {
    const oa = HEADER_INFO[a]?.order ?? 99
    const ob = HEADER_INFO[b]?.order ?? 99
    return oa - ob
  })

  /** Instalar desde la ficha (con una versión concreta o la mejor para la instancia). */
  async function installFromDetail(ref: DetailRef, v?: DVersion): Promise<void> {
    if (ref.source === 'curseforge') {
      const m = (await window.api.curseforge.getMod(Number(ref.id)).catch(() => null))?.data as CurseHit | undefined
      const hit: CurseHit = m ?? { id: Number(ref.id), name: ref.title, summary: ref.summary, logo: ref.icon ? { thumbnailUrl: ref.icon } : undefined, downloadCount: 0, dateModified: '', latestFilesIndexes: [], classId: 0, categories: [] }
      setCfInstalling({ hit, file: v?.cf ? ({
        id: v.cf.fileId, displayName: v.name, fileName: v.filename, fileDate: new Date(v.date).toISOString(), fileLength: v.size ?? 0,
        gameVersions: [...v.gameVersions, ...v.platforms.map(x => x[0].toUpperCase() + x.slice(1))],
        dependencies: v.deps.filter(d => d.type === 'required').map(d => ({ modId: Number(d.id), relationType: 3 })),
      } as CurseFile) : undefined })
      return
    }
    const hit: Hit = { project_id: ref.id, title: ref.title, description: ref.summary, icon_url: ref.icon, downloads: 0, follows: 0, display_categories: [], date_modified: new Date().toISOString(), client_side: '', server_side: '' }
    if (ref.source !== 'modrinth' && ref.source !== 'fport1') return
    const mv: MVersion | undefined = v && v.url ? {
      id: v.id, version_number: v.number, name: v.name, loaders: v.platforms, game_versions: v.gameVersions,
      date_published: new Date(v.date).toISOString(), version_type: v.channel, changelog: v.changelog,
      files: [{ url: v.url, filename: v.filename, primary: true, size: v.size ?? 0 }],
    } : undefined
    setInstalling({ project: hit, version: mv, source: ref.source })
  }

  const typeLoaders = TYPE_LOADERS[contentType]
  const hasSidebar  = sortedHeaders.length > 0 || (typeLoaders && typeLoaders.length > 0)
  const visibleTabs = TABS.filter(t => source !== 'curseforge' || CF_CLASS_ID[t.key] !== undefined)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header — hidden when viewing a project detail */}
      {!view && (
        <div className="px-6 pt-5 pb-0 flex-shrink-0">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center transition-colors" style={{ background: `${accentColor}22`, color: accentColor }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"/></svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-text-primary leading-tight">Explorar</h1>
                <p className="text-xs text-text-muted">Modpacks, mods, texturas y shaders listos para instalar</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {source === 'fport1' && f1Admin && (
                <button onClick={() => setStudioOpen(true)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#a855f7]/40 bg-[#a855f7]/10 text-[#d8b4fe] text-sm font-semibold hover:bg-[#a855f7]/20 transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>
                  Mis creaciones
                </button>
              )}
              <div className="flex items-center gap-1 bg-bg-card border border-border rounded-2xl p-1">
                {SOURCES.map(s => (
                  <button key={s.key} onClick={() => handleSourceChange(s.key)}
                    className={`flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl transition-all ${source === s.key ? 'text-white shadow-md' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`}
                    style={source === s.key ? { background: s.color, boxShadow: `0 4px 14px ${s.color}40` } : { color: undefined }}>
                    <span style={source === s.key ? undefined : { color: s.color }}>{s.icon}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 border-b border-border pb-0">
            {visibleTabs.map(tab => (
              <button key={tab.key} onClick={() => handleTabChange(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${
                  contentType === tab.key
                    ? 'text-text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
                style={contentType === tab.key ? { borderColor: accentColor, color: accentColor } : undefined}>
                {TAB_ICONS[tab.key]}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Detail view (inline, replaces results + sidebar) */}
        {view && (
          <ExploreDetail
            key={hist.idx}
            target={view}
            kind={contentType}
            initialTab={viewState.current.get(hist.idx)?.tab}
            initialScroll={viewState.current.get(hist.idx)?.scroll}
            onViewChange={(tab, scroll) => viewState.current.set(hist.idx, { tab, scroll })}
            canGoBack={hist.idx > 0}
            canGoForward={hist.idx < hist.list.length - 1}
            onBack={() => setHist(h => ({ ...h, idx: Math.max(0, h.idx - 1) }))}
            onForward={() => setHist(h => ({ ...h, idx: Math.min(h.list.length - 1, h.idx + 1) }))}
            onOpen={openDetail}
            catLabel={catLabel}
            catIcons={catIcons}
            onInstall={v => installFromDetail(view, v)}
          />
        )}

        {/* Left: results */}
        <div className={`flex-1 flex flex-col overflow-hidden ${view ? 'hidden' : ''}`}>
          {/* Search + filters bar */}
          <div className="px-6 py-3.5 flex gap-2 flex-shrink-0 border-b border-border/50">
            <form className="flex-1 flex gap-2" onSubmit={handleSearch}>
              <div className="flex-1 relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted/60" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input value={draftQuery} onChange={e => { setDraftQuery(e.target.value); if (source === 'fport1') setQuery(e.target.value) }}
                  placeholder={`Buscar ${TABS.find(t => t.key === contentType)?.label.toLowerCase()}...`}
                  className="w-full bg-bg-card border border-border focus:border-accent/50 rounded-xl pl-10 pr-9 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted transition-colors" />
                {draftQuery && (
                  <button type="button" onClick={() => { setDraftQuery(''); setQuery(''); setPage(0); if (source === 'modrinth') doSearch('', 0, contentType, catFilters, selectedLoader, sort, mcFilter); else if (source === 'curseforge') doCfSearch('', 0, contentType, selectedLoader, sort, mcFilter, cfCategoryId) }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
              </div>
              {source !== 'fport1' && (
                <button type="submit" disabled={loading}
                  className="px-5 py-2.5 text-white text-sm font-semibold rounded-xl transition-opacity disabled:opacity-50 hover:opacity-90"
                  style={{ background: accentColor }}>
                  Buscar
                </button>
              )}
            </form>

            <select value={mcFilter} onChange={e => setMcFilter(e.target.value)}
              className="bg-bg-card border border-border rounded-xl px-3.5 py-2.5 text-sm text-text-secondary outline-none cursor-pointer hover:border-accent/40 transition-colors">
              <option value="">Versión MC</option>
              {mcVersions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>

            <select value={sort} onChange={e => setSort(e.target.value)}
              className="bg-bg-card border border-border rounded-xl px-3.5 py-2.5 text-sm text-text-secondary outline-none cursor-pointer hover:border-accent/40 transition-colors">
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.value === 'relevance' && source === 'fport1' ? 'Nombre' : o.label}</option>)}
            </select>
          </div>

          {/* Results */}
          <div ref={resultsRef} className="flex-1 overflow-y-auto px-6 py-5">
            {busy && activeCount === 0 && (
              <div className="flex items-center justify-center gap-2 py-20 text-text-muted text-sm">
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                Cargando...
              </div>
            )}

            {source === 'fport1' && f1Error && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <p className="text-sm text-red-300">{f1Error}</p>
                <button onClick={loadF1} className="px-4 py-2 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary">Reintentar</button>
              </div>
            )}

            {!busy && !f1Error && activeCount === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3">
                {source === 'fport1' ? (
                  <>
                    <div className="w-16 h-16 rounded-2xl bg-[#a855f7]/15 flex items-center justify-center text-[#a855f7]">{SOURCES[2].icon}</div>
                    <p className="text-sm">Aún no hay {TABS.find(t => t.key === contentType)?.label.toLowerCase()} de Fport1{query || selectedLoader || mcFilter || f1Category ? ' con esos filtros' : ''}</p>
                    {f1Admin && <button onClick={() => setStudioOpen(true)} className="text-sm text-[#c084fc] hover:underline">Publicar la primera</button>}
                  </>
                ) : (
                  <>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-30"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <p className="text-sm">Sin resultados</p>
                  </>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3">
              {source === 'modrinth' && results.map(hit => (
                <ProjectCard key={hit.project_id} hit={hit} contentType={contentType} catIcons={catIcons}
                  onInstall={() => setInstalling({ project: hit, source: 'modrinth' })}
                  onDetail={() => openDetail({ source: 'modrinth', id: hit.project_id, title: hit.title, icon: hit.icon_url, summary: hit.description })} />
              ))}
              {source === 'curseforge' && cfResults.map(hit => (
                <CurseCard key={hit.id} hit={hit}
                  onInstall={() => setCfInstalling({ hit })}
                  onDetail={() => openDetail({ source: 'curseforge', id: String(hit.id), title: hit.name, icon: hit.logo?.thumbnailUrl ?? null, summary: hit.summary })} />
              ))}
              {source === 'fport1' && f1Filtered.slice(page * LIMIT, (page + 1) * LIMIT).map(p => {
                const hit = fport1ToHit(p)
                return (
                  <ProjectCard key={p.id} hit={hit} contentType={contentType} catIcons={catIcons} hideFollows
                    extra={<>
                      {p.featured && <span className="text-[11px] px-2 py-0.5 rounded-md border font-semibold bg-[#a855f7]/15 text-[#d8b4fe] border-[#a855f7]/40">★ Destacado</span>}
                      {p.latestVersion && (
                        <span className={`text-[11px] px-2 py-0.5 rounded-md border font-semibold ${CHANNEL_STYLE[p.latestVersion.channel] ?? ''}`}>
                          v{p.latestVersion.versionNumber}{p.latestVersion.channel !== 'release' ? ` · ${p.latestVersion.channel}` : ''}
                        </span>
                      )}
                      {p.loaders.slice(0, 3).map(l => <LoaderChip key={l} id={l} />)}
                      {p.gameVersions[0] && <span className="text-[11px] px-2 py-0.5 rounded-md bg-bg-hover text-text-secondary border border-border">{p.gameVersions[0]}{p.gameVersions.length > 1 ? ` +${p.gameVersions.length - 1}` : ''}</span>}
                    </>}
                    onInstall={() => setInstalling({ project: hit, source: 'fport1' })}
                    onDetail={() => openDetail({ source: 'fport1', id: p.id, title: p.title, icon: p.iconUrl, summary: p.summary })} />
                )
              })}
            </div>

            {activeTotalPages > 1 && (() => {
              const win = [page - 1, page, page + 1].filter(p => p >= 0 && p < activeTotalPages)
              const btnCls = (active: boolean, disabled = false) =>
                `min-w-[34px] h-9 px-2.5 flex items-center justify-center rounded-xl text-sm transition-colors ${disabled ? 'opacity-30 pointer-events-none' : ''} ${active ? 'text-white font-semibold' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-border'}`
              return (
                <div className="flex items-center justify-between px-1 py-6">
                  <span className="text-sm text-text-muted">{activeTotal.toLocaleString('es')} resultados</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handlePage(page - 1)} disabled={page === 0 || busy} className={btnCls(false, page === 0 || busy)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    {win[0] > 0 && <>
                      <button onClick={() => handlePage(0)} className={btnCls(false)}>1</button>
                      {win[0] > 1 && <span className="text-xs text-text-muted px-0.5">…</span>}
                    </>}
                    {win.map(p => (
                      <button key={p} onClick={() => handlePage(p)} className={btnCls(p === page)} style={p === page ? { background: accentColor } : undefined}>{p + 1}</button>
                    ))}
                    {win[win.length - 1] < activeTotalPages - 1 && <>
                      {win[win.length - 1] < activeTotalPages - 2 && <span className="text-xs text-text-muted px-0.5">…</span>}
                      <button onClick={() => handlePage(activeTotalPages - 1)} className={btnCls(false)}>{activeTotalPages}</button>
                    </>}
                    <button onClick={() => handlePage(page + 1)} disabled={page >= activeTotalPages - 1 || busy} className={btnCls(false, page >= activeTotalPages - 1 || busy)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>

        {/* Right sidebar: filters */}
        {!view && (
          <>
            {/* Modrinth sidebar */}
            {source === 'modrinth' && hasSidebar && (
              <div className="w-60 flex-shrink-0 border-l border-border overflow-y-auto p-4 bg-bg-secondary/50">
                {(Object.keys(catFilters).length > 0 || selectedLoader) && (
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs text-text-muted">Filtros activos</span>
                    <button onClick={() => { setCatFilters({}); setSelectedLoader('') }} className="text-xs text-accent hover:underline">Limpiar</button>
                  </div>
                )}
                {sortedHeaders.map(header => {
                  const isResolution = header === 'resolution'
                  const sorted = sortCats(header, catGroups[header])
                  return (
                    <SidebarSection key={header} title={HEADER_INFO[header]?.label ?? header}>
                      {sorted.map(cat => {
                        const catObj = categories.find(c => c.name === cat)
                        return (
                          <FilterRow key={cat} label={catLabel(cat)} icon={catObj?.icon} state={catFilters[cat]} showIcon={!isResolution}
                            onInclude={() => toggleCat(cat, 'include')} onExclude={() => toggleCat(cat, 'exclude')} />
                        )
                      })}
                    </SidebarSection>
                  )
                })}
                {typeLoaders && typeLoaders.length > 0 && (
                  <SidebarSection title="Loader">
                    {typeLoaders.map(l => (
                      <LoaderButton key={l.id} label={l.label} active={selectedLoader === l.id} onClick={() => toggleLoader(l.id)} />
                    ))}
                  </SidebarSection>
                )}
              </div>
            )}

            {/* CurseForge sidebar */}
            {source === 'curseforge' && CF_CLASS_ID[contentType] !== undefined && (
              <div className="w-60 flex-shrink-0 border-l border-border overflow-y-auto p-4 bg-bg-secondary/50">
                {(cfCategoryId !== null || selectedLoader) && (
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs text-text-muted">Filtros activos</span>
                    <button onClick={() => { setCfCategoryId(null); setSelectedLoader('') }} className="text-xs text-[#F16436] hover:underline">Limpiar</button>
                  </div>
                )}

                {cfCategories.length > 0 && (() => {
                  const topLevel = cfCategories.filter(c => !c.parentCategoryId || c.parentCategoryId === CF_CLASS_ID[contentType])
                  const children = (parentId: number) => cfCategories.filter(c => c.parentCategoryId === parentId)
                  return (
                    <SidebarSection title="Categorías">
                      {topLevel.map(cat => {
                        const kids = children(cat.id)
                        const isSelected = cfCategoryId === cat.id
                        return (
                          <div key={cat.id}>
                            <button
                              onClick={() => setCfCategoryId(isSelected ? null : cat.id)}
                              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-sm transition-colors ${isSelected ? 'bg-[#F16436]/20 text-[#F16436]' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`}>
                              {cat.iconUrl && <img src={cat.iconUrl} alt="" className="w-5 h-5 flex-shrink-0 rounded" onError={e => (e.target as HTMLImageElement).style.display='none'} />}
                              <span className="truncate">{cat.name}</span>
                            </button>
                            {kids.length > 0 && (
                              <div className="ml-5 mt-0.5 mb-0.5 space-y-0.5">
                                {kids.map(kid => {
                                  const kidSelected = cfCategoryId === kid.id
                                  return (
                                    <button key={kid.id}
                                      onClick={() => setCfCategoryId(kidSelected ? null : kid.id)}
                                      className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left text-xs transition-colors ${kidSelected ? 'bg-[#F16436]/20 text-[#F16436]' : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'}`}>
                                      {kid.iconUrl && <img src={kid.iconUrl} alt="" className="w-4 h-4 flex-shrink-0 rounded" onError={e => (e.target as HTMLImageElement).style.display='none'} />}
                                      <span className="truncate">{kid.name}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </SidebarSection>
                  )
                })()}

                {TYPE_LOADERS[contentType] && (
                  <SidebarSection title="Mod Loader">
                    {(TYPE_LOADERS[contentType] ?? []).filter(l => CF_LOADER_TYPE[l.id] !== undefined).map(l => (
                      <LoaderButton key={l.id} label={l.label} active={selectedLoader === l.id} onClick={() => toggleLoader(l.id)} />
                    ))}
                  </SidebarSection>
                )}
              </div>
            )}

            {/* Fport1 sidebar */}
            {source === 'fport1' && (f1Loaders.length > 0 || f1Cats.length > 0) && (
              <div className="w-60 flex-shrink-0 border-l border-border overflow-y-auto p-4 bg-bg-secondary/50">
                {(f1Category || selectedLoader) && (
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs text-text-muted">Filtros activos</span>
                    <button onClick={() => { setF1Category(''); setSelectedLoader('') }} className="text-xs text-[#c084fc] hover:underline">Limpiar</button>
                  </div>
                )}
                {f1Cats.length > 0 && (
                  <SidebarSection title="Categorías">
                    {f1Cats.map(c => {
                      const svg = catIcons.get(c)
                      return (
                        <button key={c} onClick={() => setF1Category(f1Category === c ? '' : c)}
                          className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-sm capitalize transition-colors ${f1Category === c ? 'bg-[#a855f7]/20 text-[#d8b4fe]' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`}>
                          {svg && <span className="w-4 h-4 [&>svg]:w-full [&>svg]:h-full opacity-80" dangerouslySetInnerHTML={{ __html: svg }} />}
                          {catLabel(c)}
                        </button>
                      )
                    })}
                  </SidebarSection>
                )}
                {f1Loaders.length > 0 && (
                  <SidebarSection title="Loader">
                    {f1Loaders.map(l => (
                      <LoaderButton key={l} label={loaderLabel(l)} active={selectedLoader === l} onClick={() => toggleLoader(l)} />
                    ))}
                  </SidebarSection>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {installing && (
        <InstallModal
          project={installing.project}
          contentType={contentType}
          instances={instances}
          preselectedVersion={installing.version}
          provider={installing.source === 'fport1' ? f1Provider : modrinthProvider}
          onClose={() => setInstalling(null)}
        />
      )}

      {cfInstalling && (
        <CurseInstall
          hit={cfInstalling.hit}
          file={cfInstalling.file}
          contentType={contentType}
          instances={instances}
          onClose={() => setCfInstalling(null)}
        />
      )}

      {studioOpen && (
        <Fport1Studio
          mcVersions={mcVersions}
          onClose={() => setStudioOpen(false)}
          onChanged={loadF1}
        />
      )}
    </div>
  )
}
