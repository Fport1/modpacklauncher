import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { marked } from 'marked'
import ZoomableImage from '../components/ZoomableImage'
import type { Instance } from '../../../shared/types'

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
}

interface Category { name: string; header: string; icon?: string }
interface World { name: string }

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

const CAT_NAMES: Record<string, string> = {
  'adventure':          'Aventura',
  'combat':             'Combate',
  'challenging':        'Desafiante',
  'lightweight':        'Ligero',
  'magic':              'Magia',
  'quests':             'Misiones',
  'multiplayer':        'Multijugador',
  'optimization':       'Optimización',
  'technology':         'Tecnología',
  'miscellaneous':      'Variado',
  'cursed':             'Cursed',
  'decoration':         'Decoración',
  'economy':            'Economía',
  'equipment':          'Equipamiento',
  'food':               'Comida',
  'game-mechanics':     'Mecánicas de juego',
  'library':            'Librería',
  'management':         'Gestión',
  'minigame':           'Minijuego',
  'mobs':               'Mobs',
  'social':             'Social',
  'storage':            'Almacenamiento',
  'transportation':     'Transporte',
  'utility':            'Utilidad',
  'worldgeneration':    'Generación de mundo',
  'world-generation':   'Generación de mundo',
  'modded':             'Moddeado',
  'realistic':          'Realista',
  'simplistic':         'Simplista',
  'themed':             'Temático',
  'tweaks':             'Ajustes',
  'vanilla-like':       'Tipo Vainilla',
  'semi-realistic':     'Semi Realista',
  'fantasy':            'Fantasía',
  'cartoon':            'Cartoon',
  'audio':              'Audio',
  'blocks':             'Bloques',
  'core-shaders':       'Core Shaders',
  'entities':           'Entidades',
  'environment':        'Entorno',
  'fonts':              'Fuentes',
  'gui':                'GUI',
  'items':              'Objetos',
  'locale':             'Idioma',
  'models':             'Modelos',
  'atmosphere':         'Atmósfera',
  'bloom':              'Bloom',
  'colored-lighting':   'Iluminación de color',
  'foliage':            'Follaje',
  'path-tracing':       'Path Tracing',
  'pbr':                'PBR',
  'reflections':        'Reflejos',
  'shadows':            'Sombras',
  '8x':                 '8x o menor',
  '16x':                '16x',
  '32x':                '32x',
  '48x':                '48x',
  '64x':                '64x',
  '128x':               '128x',
  '256x':               '256x',
  '512x':               '512x o mayor',
  '512x-and-above':     '512x o mayor',
  'potato':             'Potato',
  'low':                'Bajo',
  'medium':             'Medio',
  'high':               'Alto',
  'screenshot':         'Screenshot',
  'client':             'Cliente',
  'server':             'Servidor',
}

const HEADER_INFO: Record<string, { label: string; order: number }> = {
  'category':           { label: 'Categoría',              order: 0 },
  'environment':        { label: 'Entorno',                order: 1 },
  'feature':            { label: 'Característica',         order: 2 },
  'resolution':         { label: 'Resolución',             order: 3 },
  'performance_impact': { label: 'Impacto en rendimiento', order: 4 },
}

const LIMIT = 20

const CF_CLASS_ID: Partial<Record<ContentType, number>> = {
  modpack: 4471, mod: 6, resourcepack: 12, shader: 4546,
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

function catLabel(name: string) {
  return CAT_NAMES[name] ?? name
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
    <div className={`flex items-center gap-1 px-1.5 py-1 rounded-lg transition-colors group ${
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
          className={`w-3.5 h-3.5 flex-shrink-0 [&>svg]:w-full [&>svg]:h-full transition-colors ${
            included ? 'text-accent' : excluded ? 'text-red-400' : 'text-text-muted/60'
          }`}
          dangerouslySetInnerHTML={{ __html: icon }}
        />
      )}

      {/* Label */}
      <span className={`flex-1 text-xs truncate transition-colors ${
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
      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors text-left w-full ${
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
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
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

function InstallModal({ project, contentType, instances, onClose, preselectedVersion }: {
  project: Hit
  contentType: ContentType
  instances: Instance[]
  onClose: () => void
  preselectedVersion?: MVersion
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
      window.api.modrinth.getVersions(project.project_id, '', '').then(vs => {
        setAllVersions((vs as MVersion[]).filter(v => v.files.length > 0))
      }).catch(() => {})
    }
  }, [])

  async function loadVersions(inst?: Instance) {
    setVLoading(true)
    try {
      const mc     = inst?.minecraft ?? ''
      const loader = inst?.modloader ?? ''
      const vs     = await window.api.modrinth.getVersions(project.project_id, mc, loader) as MVersion[]
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
      if (isModpack) {
        const mc     = ver.game_versions[0] ?? ''
        const loader = ver.loaders[0] ?? 'vanilla'
        const inst   = await window.api.instances.create({
          name: instanceName.trim() || project.title,
          minecraft: mc,
          modloader: loader as Instance['modloader'],
          createdAt: Date.now(),
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
                <p className="text-sm text-text-muted text-center py-10">No hay versiones compatibles con esta instancia.</p>
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
                    (!installVTypeFilter || (v as any).version_type === installVTypeFilter) &&
                    (!installMcFilter || v.game_versions.includes(installMcFilter))
                  ).slice(0, 50).map(v => {
                    const pf = primaryFile(v)
                    const vt: string = (v as any).version_type ?? ''
                    return (
                      <button key={v.id} onClick={() => handleSelectVersion(v)}
                        className="flex items-center gap-3 p-3 bg-bg-card border border-border hover:border-accent/40 rounded-xl transition-colors text-left w-full">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <p className="text-sm font-medium text-text-primary truncate">{v.name || v.version_number}</p>
                            {vt === 'beta' && <span className="text-[9px] px-1.5 py-px rounded-full bg-amber-500/20 text-amber-400 font-semibold flex-shrink-0">Beta</span>}
                            {vt === 'alpha' && <span className="text-[9px] px-1.5 py-px rounded-full bg-red-500/20 text-red-400 font-semibold flex-shrink-0">Alpha</span>}
                          </div>
                          <p className="text-[11px] text-text-muted">
                            MC {v.game_versions.slice(0, 3).join(', ')}
                            {v.loaders.length > 0 && ` · ${v.loaders.join(', ')}`}
                          </p>
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

// ── Project detail panel (inline) ────────────────────────────────────────────

type DetailTab = 'description' | 'gallery' | 'versions'

interface GalleryItem { url: string; raw_url?: string; featured: boolean; title?: string; description?: string }

function ProjectDetail({ project, onClose, onInstall, onInstallVersion }: {
  project: Hit
  onClose: () => void
  onInstall: () => void
  onInstallVersion: (v: MVersion) => void
}) {
  const [tab, setTab]                   = useState<DetailTab>('description')
  const [detail, setDetail]             = useState<any>(null)
  const [versions, setVersions]         = useState<MVersion[]>([])
  const [loading, setLoading]           = useState(true)
  const [versionsLoading, setVersLoading] = useState(false)
  const [imgErr, setImgErr]             = useState(false)
  const [lightboxIdx, setLightboxIdx]   = useState<number | null>(null)
  const [vMcFilter, setVMcFilter]         = useState('')
  const [vLoaderFilter, setVLoader]       = useState('')
  const [vTypeFilter, setVTypeFilter]     = useState('')
  const [expandedChangelog, setExpandedChangelog] = useState<string | null>(null)
  const bodyRef                           = useRef<HTMLDivElement>(null)
  const versionsLoadedRef               = useRef(false)

  function changeTab(t: DetailTab) {
    setTab(t)
    bodyRef.current?.scrollTo({ top: 0 })
    if (t === 'versions' && !versionsLoadedRef.current) {
      versionsLoadedRef.current = true
      setVersLoading(true)
      window.api.modrinth.getVersions(project.project_id, '', '').then(vs => {
        setVersions((vs as MVersion[]).filter(v => v.files.length > 0))
      }).catch(() => {}).finally(() => setVersLoading(false))
    }
  }

  useEffect(() => {
    setLoading(true)
    setDetail(null)
    setVersions([])
    setVMcFilter('')
    setVLoader('')
    setVTypeFilter('')
    versionsLoadedRef.current = false
    window.api.modrinth.getProject(project.project_id)
      .then(d => setDetail(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [project.project_id])

  const bodyHtml = detail?.body ? String(marked.parse(detail.body)) : ''
  const gallery: GalleryItem[] = (detail?.gallery ?? []).slice().sort(
    (a: GalleryItem, b: GalleryItem) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0)
  )

  // Unique MC versions and loaders from all fetched versions (newest first)
  const availableMcVersions = [...new Set(versions.flatMap(v => v.game_versions))]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  const availableLoaders = [...new Set(versions.flatMap(v => v.loaders))]

  const filteredVersions = versions.filter(v => {
    if (vMcFilter && !v.game_versions.includes(vMcFilter)) return false
    if (vLoaderFilter && !v.loaders.includes(vLoaderFilter)) return false
    if (vTypeFilter && (v as any).version_type !== vTypeFilter) return false
    return true
  })

  const currentImg = lightboxIdx !== null ? (gallery[lightboxIdx] ?? null) : null

  const DETAIL_TABS: { key: DetailTab; label: string }[] = [
    { key: 'description', label: 'Descripción' },
    { key: 'gallery',     label: `Galería${gallery.length ? ` (${gallery.length})` : ''}` },
    { key: 'versions',    label: `Versiones${versions.length ? ` (${versions.length})` : ''}` },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar: back + project header + install */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border flex-shrink-0 bg-bg-secondary/60">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Volver
        </button>
        <div className="w-px h-5 bg-border flex-shrink-0" />
        <div className="w-9 h-9 rounded-lg bg-bg-hover flex-shrink-0 overflow-hidden flex items-center justify-center">
          {project.icon_url && !imgErr ? (
            <img src={project.icon_url} alt="" className="w-full h-full object-cover" onError={() => setImgErr(true)} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted/30">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-text-primary truncate">{project.title}</p>
          <div className="flex items-center gap-3 text-[10px] text-text-muted">
            <span>↓ {fmtDownloads(project.downloads)}</span>
            <span>♥ {fmtDownloads(project.follows)}</span>
            <span>{timeAgo(project.date_modified)}</span>
          </div>
        </div>
        <button
          onClick={onInstall}
          className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg font-medium transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/>
          </svg>
          Instalar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex px-6 border-b border-border flex-shrink-0">
        {DETAIL_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => changeTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-text-muted text-sm">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 00-9-9"/>
            </svg>
            Cargando...
          </div>
        )}

        {/* Description */}
        {!loading && tab === 'description' && (
          <div
            className="px-8 py-6 max-w-4xl text-sm text-text-secondary leading-relaxed
              [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-text-primary [&_h1]:mt-6 [&_h1]:mb-3
              [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-text-primary [&_h2]:mt-5 [&_h2]:mb-2
              [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-4 [&_h3]:mb-2
              [&_p]:mb-3
              [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3
              [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3
              [&_li]:mb-1
              [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2
              [&_code]:bg-bg-card [&_code]:text-accent [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono
              [&_pre]:bg-bg-card [&_pre]:p-4 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:mb-4 [&_pre]:text-xs [&_pre]:font-mono
              [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-text-secondary
              [&_img]:rounded-xl [&_img]:max-w-full [&_img]:my-4
              [&_blockquote]:border-l-4 [&_blockquote]:border-accent/30 [&_blockquote]:pl-4 [&_blockquote]:text-text-muted [&_blockquote]:italic [&_blockquote]:my-3
              [&_hr]:border-border [&_hr]:my-5
              [&_strong]:text-text-primary [&_strong]:font-semibold
              [&_table]:w-full [&_table]:border-collapse [&_table]:mb-4
              [&_th]:text-left [&_th]:px-3 [&_th]:py-2 [&_th]:border [&_th]:border-border [&_th]:bg-bg-card [&_th]:text-xs [&_th]:font-semibold
              [&_td]:px-3 [&_td]:py-2 [&_td]:border [&_td]:border-border [&_td]:text-xs"
            dangerouslySetInnerHTML={{ __html: bodyHtml || '<p>Sin descripción disponible.</p>' }}
          />
        )}

        {/* Gallery */}
        {!loading && tab === 'gallery' && (
          <div className="px-6 py-6">
            {gallery.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-2">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-30">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <p className="text-sm">No hay galería disponible</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {gallery.map((img, i) => (
                  <div
                    key={i}
                    className="rounded-xl overflow-hidden border border-border cursor-zoom-in hover:border-accent/40 transition-colors"
                    onClick={() => setLightboxIdx(i)}
                  >
                    <img
                      src={img.url}
                      alt={img.title ?? `Screenshot ${i + 1}`}
                      className="w-full aspect-video object-cover"
                      loading="lazy"
                    />
                    {img.title && (
                      <p className="text-xs text-text-muted px-3 py-2 bg-bg-card border-t border-border">{img.title}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Versions */}
        {!loading && tab === 'versions' && (
          <div className="px-6 py-4">
            {versionsLoading && (
              <div className="flex items-center justify-center gap-2 py-16 text-text-muted text-sm">
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                Cargando versiones...
              </div>
            )}
            {/* Filters */}
            {!versionsLoading && versions.length > 0 && (
              <div className="flex gap-2 mb-4">
                <select
                  value={vMcFilter}
                  onChange={e => setVMcFilter(e.target.value)}
                  className="bg-bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-text-secondary outline-none cursor-pointer hover:border-accent/40 transition-colors"
                >
                  <option value="">Todas las versiones MC</option>
                  {availableMcVersions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                {availableLoaders.length > 1 && (
                  <select
                    value={vLoaderFilter}
                    onChange={e => setVLoader(e.target.value)}
                    className="bg-bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-text-secondary outline-none cursor-pointer hover:border-accent/40 transition-colors"
                  >
                    <option value="">Todos los loaders</option>
                    {availableLoaders.map(l => <option key={l} value={l}>{loaderLabel(l)}</option>)}
                  </select>
                )}
                <div className="flex gap-1">
                  {([['', 'Todos'], ['release', 'Release'], ['beta', 'Beta'], ['alpha', 'Alpha']] as [string, string][]).map(([val, label]) => (
                    <button key={val} onClick={() => setVTypeFilter(val)}
                      className={`text-[10px] px-2 py-1 rounded-full font-medium transition-colors ${vTypeFilter === val ? 'bg-accent text-white' : 'bg-bg-hover text-text-muted hover:text-text-primary'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {(vMcFilter || vLoaderFilter || vTypeFilter) && (
                  <button
                    onClick={() => { setVMcFilter(''); setVLoader(''); setVTypeFilter('') }}
                    className="text-xs text-accent hover:underline"
                  >
                    Limpiar
                  </button>
                )}
                <span className="text-xs text-text-muted self-center ml-auto">
                  {filteredVersions.length} versión{filteredVersions.length !== 1 ? 'es' : ''}
                </span>
              </div>
            )}

            {!versionsLoading && <div className="flex flex-col gap-2">
              {filteredVersions.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-12">No hay versiones para estos filtros.</p>
              ) : (
                filteredVersions.slice(0, 100).map(v => {
                  const primary = v.files.find(f => f.primary) ?? v.files[0]
                  const changelog: string | undefined = (v as any).changelog
                  return (
                    <div key={v.id} className="bg-bg-card border border-border hover:border-accent/30 rounded-xl transition-colors">
                      <div className="flex items-center gap-3 p-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-text-primary truncate">{v.name || v.version_number}</p>
                            {(v as any).version_type === 'beta' && <span className="text-[9px] px-1.5 py-px rounded-full bg-amber-500/20 text-amber-400 font-semibold flex-shrink-0">Beta</span>}
                            {(v as any).version_type === 'alpha' && <span className="text-[9px] px-1.5 py-px rounded-full bg-red-500/20 text-red-400 font-semibold flex-shrink-0">Alpha</span>}
                          </div>
                          <p className="text-[11px] text-text-muted mt-0.5">
                            MC {v.game_versions.slice(0, 5).join(', ')}
                            {v.loaders.length > 0 && ` · ${v.loaders.map(loaderLabel).join(', ')}`}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0 text-[11px] text-text-muted">
                          {primary && <p>{(primary.size / 1024 / 1024).toFixed(1)} MB</p>}
                          <p>{timeAgo(v.date_published)}</p>
                        </div>
                        <button
                          onClick={() => onInstallVersion(v)}
                          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs rounded-lg font-medium transition-colors"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/>
                          </svg>
                          Instalar
                        </button>
                      </div>
                      {changelog && (
                        <div className="px-3 pb-3">
                          <button
                            onClick={() => setExpandedChangelog(expandedChangelog === v.id ? null : v.id)}
                            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                              className={`transition-transform ${expandedChangelog === v.id ? '' : '-rotate-90'}`}>
                              <polyline points="18 15 12 9 6 15"/>
                            </svg>
                            Changelog
                          </button>
                          {expandedChangelog === v.id && (
                            <div className="mt-1.5 text-[11px] text-text-secondary bg-bg-primary rounded-lg px-3 py-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
                              {changelog}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {currentImg && (
        <ZoomableImage
          src={currentImg.raw_url ?? currentImg.url}
          alt={currentImg.title ?? undefined}
          onClose={() => setLightboxIdx(null)}
          onPrev={(lightboxIdx ?? 0) > 0 ? () => setLightboxIdx(i => Math.max(0, (i ?? 1) - 1)) : undefined}
          onNext={(lightboxIdx ?? 0) < gallery.length - 1 ? () => setLightboxIdx(i => Math.min(gallery.length - 1, (i ?? 0) + 1)) : undefined}
          counter={gallery.length > 1 ? `${(lightboxIdx ?? 0) + 1} / ${gallery.length}` : undefined}
          footer={(currentImg.title || currentImg.description) ? (
            <div>
              {currentImg.title && <p className="text-sm font-medium text-white/90">{currentImg.title}</p>}
              {currentImg.description && <p className="text-xs text-white/55 mt-1">{currentImg.description}</p>}
            </div>
          ) : undefined}
        />
      )}
    </div>
  )
}

// ── Project card ──────────────────────────────────────────────────────────────

function ProjectCard({ hit, onInstall, onDetail, contentType }: { hit: Hit; onInstall: () => void; onDetail: () => void; contentType: ContentType }) {
  const [imgErr, setImgErr] = useState(false)
  return (
    <div
      className="flex items-start gap-4 p-4 bg-bg-card border border-border hover:border-accent/30 rounded-xl transition-colors cursor-pointer"
      onClick={onDetail}
    >
      <div className="w-14 h-14 rounded-xl bg-bg-hover flex-shrink-0 overflow-hidden flex items-center justify-center">
        {hit.icon_url && !imgErr ? (
          <img src={hit.icon_url} alt="" className="w-full h-full object-cover" onError={() => setImgErr(true)} />
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted/30">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-text-primary truncate">{hit.title}</p>
            <p className="text-xs text-text-muted mt-0.5 line-clamp-2 leading-relaxed">{hit.description}</p>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onInstall() }}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs rounded-lg font-medium transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/>
            </svg>
            Instalar
          </button>
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {hit.display_categories.slice(0, 5).map(cat => (
            <span key={cat} className="text-[10px] bg-bg-hover text-text-muted px-2 py-0.5 rounded-full capitalize">
              {catLabel(cat)}
            </span>
          ))}
          {(contentType === 'mod' || contentType === 'modpack') && (() => {
            const c = hit.client_side !== 'unsupported' && hit.client_side !== ''
            const s = hit.server_side !== 'unsupported' && hit.server_side !== ''
            if (!c && !s) return null
            return (
              <div className="flex items-center gap-0.5">
                {c && <span title="Cliente" className="w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">C</span>}
                {s && <span title="Servidor" className="w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">S</span>}
              </div>
            )
          })()}
          <div className="flex items-center gap-3 ml-auto text-[11px] text-text-muted">
            <span className="flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/>
              </svg>
              {fmtDownloads(hit.downloads)}
            </span>
            <span className="flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-red-400/70">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
              {fmtDownloads(hit.follows)}
            </span>
            <span>{timeAgo(hit.date_modified)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── CurseForge card ───────────────────────────────────────────────────────────

function CurseCard({ hit, onDetail, onInstall }: { hit: CurseHit; onDetail: () => void; onInstall: () => void }) {
  const loaderTypes = [...new Set(hit.latestFilesIndexes.map(f => f.modLoaderType).filter(Boolean))]
  return (
    <div className="flex items-start gap-3 p-3 bg-bg-card border border-border rounded-xl hover:border-accent/30 transition-colors cursor-pointer group"
      onClick={onDetail}>
      <div className="w-12 h-12 rounded-lg bg-bg-hover flex-shrink-0 overflow-hidden">
        {hit.logo?.thumbnailUrl
          ? <img src={hit.logo.thumbnailUrl} alt="" className="w-full h-full object-cover" onError={e => (e.target as HTMLImageElement).style.display='none'} />
          : <div className="w-full h-full flex items-center justify-center text-text-muted">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </div>
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-text-primary truncate group-hover:text-accent transition-colors">{hit.name}</p>
          <button onClick={e => { e.stopPropagation(); onInstall() }}
            className="flex-shrink-0 px-2.5 py-1 text-xs bg-accent/10 hover:bg-accent text-accent hover:text-white rounded-lg transition-colors border border-accent/20">
            Instalar
          </button>
        </div>
        <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">{hit.summary}</p>
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-text-muted">
          <span className="flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {fmtDownloads(hit.downloadCount)}
          </span>
          {loaderTypes.length > 0 && (
            <div className="flex items-center gap-1">
              {loaderTypes.slice(0,3).map(lt => <span key={lt} className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-bg-hover border border-border">{CF_LOADER_NAME[lt] ?? lt}</span>)}
            </div>
          )}
          {hit.latestFilesIndexes[0]?.gameVersion && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-bg-hover border border-border">{hit.latestFilesIndexes[0].gameVersion}</span>
          )}
          <span>{timeAgo(hit.dateModified)}</span>
        </div>
      </div>
    </div>
  )
}

// ── CurseForge detail ─────────────────────────────────────────────────────────

function CurseDetail({ hit, onClose, onInstall }: {
  hit: CurseHit; onClose: () => void; onInstall: (file?: CurseFile) => void
}) {
  const [files, setFiles] = useState<CurseFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [description, setDescription] = useState<string | null>(null)
  const [descLoading, setDescLoading] = useState(true)
  const [tab, setTab] = useState<'desc'|'files'>('desc')

  useEffect(() => {
    setDescLoading(true)
    setDescription(null)
    window.api.curseforge.getModDescription(hit.id)
      .then((d: any) => setDescription(d?.data ?? ''))
      .catch(() => setDescription(''))
      .finally(() => setDescLoading(false))
  }, [hit.id])

  function loadFiles() {
    if (files.length > 0 || filesLoading) return
    setFilesLoading(true)
    window.api.curseforge.getFiles(hit.id, undefined, undefined)
      .then((d: any) => setFiles(d?.data ?? []))
      .catch(() => {})
      .finally(() => setFilesLoading(false))
  }

  useEffect(() => { if (tab === 'files') loadFiles() }, [tab])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border flex-shrink-0">
        <button onClick={onClose} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mr-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          Volver
        </button>
        {hit.logo?.thumbnailUrl && <img src={hit.logo.thumbnailUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" onError={e => (e.target as HTMLImageElement).style.display='none'} />}
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-text-primary truncate">{hit.name}</p>
          <p className="text-xs text-text-muted truncate">{hit.summary}</p>
        </div>
        <button onClick={() => onInstall()}
          className="flex-shrink-0 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-xl transition-colors">
          Instalar
        </button>
      </div>

      <div className="flex gap-2 px-6 pt-3 pb-0 border-b border-border flex-shrink-0">
        {(['desc','files'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${t === tab ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
            {t === 'desc' ? 'Descripción' : 'Versiones'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {tab === 'desc' && (
          descLoading
            ? <div className="flex items-center justify-center gap-2 py-12 text-text-muted text-sm"><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>Cargando...</div>
            : description
              ? <div className="prose prose-sm prose-invert max-w-none text-text-secondary text-sm" dangerouslySetInnerHTML={{ __html: description }} />
              : <div className="flex flex-col items-center gap-2 py-12 text-text-muted"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-30"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p className="text-sm">Descripción no disponible</p></div>
        )}
        {tab === 'files' && (
          <>
            {filesLoading && <div className="flex items-center gap-2 py-10 justify-center text-text-muted text-sm"><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>Cargando...</div>}
            <div className="flex flex-col gap-2">
              {files.map(f => (
                <div key={f.id} className="flex items-center gap-3 p-3 bg-bg-card border border-border rounded-xl hover:border-accent/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{f.displayName}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text-muted flex-wrap">
                      {f.gameVersions.slice(0,4).map(v => <span key={v} className="px-1.5 py-0.5 rounded bg-bg-hover border border-border text-[9px]">{v}</span>)}
                      {f.modLoaderType && CF_LOADER_NAME[f.modLoaderType] && <span className="px-1.5 py-0.5 rounded bg-bg-hover border border-border text-[9px]">{CF_LOADER_NAME[f.modLoaderType]}</span>}
                      <span>{new Date(f.fileDate).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <button onClick={() => onInstall(f)}
                    className="flex-shrink-0 px-3 py-1.5 text-xs bg-accent/10 hover:bg-accent text-accent hover:text-white rounded-lg transition-colors border border-accent/20">
                    Instalar
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── CurseForge install dialog ─────────────────────────────────────────────────

function CurseInstall({ hit, file, contentType, instances, onClose }: {
  hit: CurseHit; file?: CurseFile; contentType: ContentType; instances: Instance[]; onClose: () => void
}) {
  const isModpack = contentType === 'modpack'
  const navigate = useNavigate()
  const [step, setStep] = useState<'instance'|'naming'|'installing'|'done'|'error'>(isModpack ? 'naming' : 'instance')
  const [instanceName, setInstanceName] = useState(hit.name)
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [createdInstanceId, setCreatedInstanceId] = useState<string | null>(null)

  const latestFile = file ?? (hit.latestFilesIndexes.length > 0 ? hit.latestFilesIndexes[0] : null)
  const gameVersion = (file as any)?.gameVersions?.[0] ?? hit.latestFilesIndexes[0]?.gameVersion ?? ''
  const loaderType = (file as any)?.modLoaderType ?? hit.latestFilesIndexes[0]?.modLoaderType ?? 0
  const loaderName = CF_LOADER_NAME[loaderType] ?? 'vanilla'

  async function doInstall() {
    if (!latestFile) return
    setStep('installing')
    try {
      if (isModpack) {
        const inst = await window.api.instances.create({
          name: instanceName.trim() || hit.name,
          minecraft: gameVersion,
          modloader: loaderName.toLowerCase() as Instance['modloader'],
          createdAt: Date.now(),
        })
        setCreatedInstanceId(inst.id)
        await window.api.curseforge.installModpack(inst.id, hit.id, (latestFile as any).fileId ?? (latestFile as any).id)
        if (hit.logo?.thumbnailUrl) {
          await window.api.instances.setIconFromUrl(inst.id, hit.logo.thumbnailUrl).catch(() => {})
        }
        await window.api.launcher.installVersion(gameVersion, loaderName.toLowerCase() !== 'vanilla' ? loaderName.toLowerCase() : undefined, undefined)
      } else {
        const subFolder = SUBFOLDER[contentType as Exclude<ContentType, 'modpack'>]
        await window.api.curseforge.installMod(selectedInstance!.id, hit.id, (latestFile as any).fileId ?? (latestFile as any).id, subFolder)
      }
      setStep('done')
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Error desconocido')
      setStep('error')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[500px] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          {hit.logo?.thumbnailUrl && <img src={hit.logo.thumbnailUrl} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-text-primary truncate">{hit.name}</p>
            <p className="text-[11px] text-text-muted">CurseForge · {gameVersion} {CF_LOADER_NAME[loaderType] ? `· ${CF_LOADER_NAME[loaderType]}` : ''}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto">
          {step === 'naming' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Nombre de la instancia</label>
                <input value={instanceName} onChange={e => setInstanceName(e.target.value)}
                  className="w-full bg-bg-card border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                  onKeyDown={e => e.key === 'Enter' && doInstall()} />
              </div>
              <button onClick={doInstall} className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-colors">
                Instalar modpack
              </button>
            </div>
          )}

          {step === 'instance' && (
            <div className="space-y-2">
              <p className="text-sm text-text-secondary mb-3">Selecciona la instancia donde instalar:</p>
              {instances.map(inst => (
                <button key={inst.id} onClick={() => { setSelectedInstance(inst); doInstall() }}
                  className="w-full flex items-center gap-3 p-3 bg-bg-card border border-border rounded-xl hover:border-accent/40 transition-colors text-left">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{inst.name}</p>
                    <p className="text-xs text-text-muted">{inst.minecraft} · {inst.modloader}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 'installing' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <svg className="animate-spin w-8 h-8 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
              <p className="text-sm text-text-secondary">Instalando desde CurseForge...</p>
              <p className="text-xs text-text-muted">Esto puede tomar varios minutos</p>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <p className="text-sm font-semibold text-text-primary">¡Instalado correctamente!</p>
              {createdInstanceId && (
                <button onClick={() => { onClose(); navigate('/instances') }}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-xl transition-colors">
                  Ver instancias
                </button>
              )}
            </div>
          )}

          {step === 'error' && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </div>
              <p className="text-sm font-semibold text-red-400">Error al instalar</p>
              <p className="text-xs text-text-muted text-center">{errorMsg}</p>
              <button onClick={onClose} className="px-4 py-2 border border-border rounded-xl text-sm text-text-secondary hover:text-text-primary transition-colors">Cerrar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DiscoverPage() {
  const [source, setSource]             = useState<'modrinth' | 'curseforge'>('modrinth')
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
  const [detailProject, setDetailProject] = useState<Hit | null>(null)
  const [installing, setInstalling]     = useState<{ project: Hit; version?: MVersion } | null>(null)

  // CurseForge state
  const [cfResults, setCfResults]       = useState<CurseHit[]>([])
  const [cfTotal, setCfTotal]           = useState(0)
  const [cfDetail, setCfDetail]         = useState<CurseHit | null>(null)
  const [cfInstalling, setCfInstalling] = useState<{ hit: CurseHit; file?: CurseFile } | null>(null)
  const [cfCategories, setCfCategories] = useState<{ id: number; name: string; parentCategoryId: number; iconUrl?: string }[]>([])
  const [cfCategoryId, setCfCategoryId] = useState<number | null>(null)

  useEffect(() => {
    window.api.instances.list().then(setInstances).catch(() => {})
    window.api.launcher.getMcVersions()
      .then(vs => setMcVersions(
        (vs as { id: string; type: string }[]).filter(v => v.type === 'release').slice(0, 25).map(v => v.id)
      ))
      .catch(() => {})
  }, [])

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
    } else {
      doCfSearch(query, 0, contentType, selectedLoader, sort, mcFilter, cfCategoryId)
    }
  }, [contentType, catFilters, selectedLoader, sort, mcFilter, source, cfCategoryId])

  useEffect(() => {
    doSearch('', 0, 'modpack', {}, '', 'downloads', '')
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setQuery(draftQuery)
    setPage(0)
    if (source === 'modrinth') {
      doSearch(draftQuery, 0, contentType, catFilters, selectedLoader, sort, mcFilter)
    } else {
      doCfSearch(draftQuery, 0, contentType, selectedLoader, sort, mcFilter, cfCategoryId)
    }
  }

  function handleTabChange(type: ContentType) {
    setContentType(type)
    setDraftQuery('')
    setQuery('')
    setPage(0)
    setCfDetail(null)
    setCfCategoryId(null)
    setCfResults([])
    setResults([])
  }

  function handleSourceChange(src: 'modrinth' | 'curseforge') {
    setSource(src)
    setDraftQuery('')
    setQuery('')
    setPage(0)
    setDetailProject(null)
    setCfDetail(null)
    setCfResults([])
    setResults([])
    setCfCategoryId(null)
    // search is triggered by the useEffect watching [source, ...]
  }

  function handlePage(p: number) {
    setPage(p)
    if (source === 'modrinth') {
      doSearch(query, p, contentType, catFilters, selectedLoader, sort, mcFilter)
    } else {
      doCfSearch(query, p, contentType, selectedLoader, sort, mcFilter, cfCategoryId)
    }
    window.scrollTo(0, 0)
  }

  const activeTotal = source === 'curseforge' ? cfTotal : total
  const activeResults = source === 'curseforge' ? cfResults : results
  const activeTotalPages = Math.ceil(activeTotal / LIMIT)

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

  const typeLoaders = TYPE_LOADERS[contentType]
  const hasSidebar  = sortedHeaders.length > 0 || (typeLoaders && typeLoaders.length > 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header — hidden when viewing a project detail */}
      {!detailProject && !cfDetail && (
        <div className="px-6 pt-5 pb-0 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-text-primary">Descubrir</h1>
            {/* Source toggle — CurseForge hidden until API access is approved */}
            <div className="flex items-center gap-1 bg-bg-card border border-border rounded-xl p-1">
              <button className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white">
                Modrinth
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1 border-b border-border pb-0">
            {TABS.filter(t => source === 'modrinth' || CF_CLASS_ID[t.key] !== undefined).map(tab => (
              <button key={tab.key} onClick={() => handleTabChange(tab.key)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  contentType === tab.key
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Detail view (inline, replaces results + sidebar) */}
        {detailProject && (
          <ProjectDetail
            project={detailProject}
            onClose={() => setDetailProject(null)}
            onInstall={() => setInstalling({ project: detailProject })}
            onInstallVersion={v => setInstalling({ project: detailProject, version: v })}
          />
        )}

        {cfDetail && (
          <CurseDetail
            hit={cfDetail}
            onClose={() => setCfDetail(null)}
            onInstall={f => setCfInstalling({ hit: cfDetail, file: f as CurseFile | undefined })}
          />
        )}

        {/* Left: results */}
        <div className={`flex-1 flex flex-col overflow-hidden ${detailProject || cfDetail ? 'hidden' : ''}`}>
          {/* Search + filters bar */}
          <div className="px-6 py-3 flex gap-2 flex-shrink-0 border-b border-border/50">
            <form className="flex-1 flex gap-2" onSubmit={handleSearch}>
              <div className="flex-1 relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted/50" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input value={draftQuery} onChange={e => setDraftQuery(e.target.value)}
                  placeholder={`Buscar ${TABS.find(t => t.key === contentType)?.label.toLowerCase()}...`}
                  className="w-full bg-bg-card border border-border focus:border-accent/50 rounded-lg pl-8 pr-8 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted transition-colors" />
                {draftQuery && (
                  <button type="button" onClick={() => { setDraftQuery(''); setQuery(''); setPage(0); source === 'modrinth' ? doSearch('', 0, contentType, catFilters, selectedLoader, sort, mcFilter) : doCfSearch('', 0, contentType, selectedLoader, sort, mcFilter) }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
              </div>
              <button type="submit" disabled={loading}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors disabled:opacity-50">
                Buscar
              </button>
            </form>

            <select value={mcFilter} onChange={e => setMcFilter(e.target.value)}
              className="bg-bg-card border border-border rounded-lg px-3 py-2 text-sm text-text-secondary outline-none cursor-pointer hover:border-accent/40 transition-colors">
              <option value="">Versión MC</option>
              {mcVersions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>

            <select value={sort} onChange={e => setSort(e.target.value)}
              className="bg-bg-card border border-border rounded-lg px-3 py-2 text-sm text-text-secondary outline-none cursor-pointer hover:border-accent/40 transition-colors">
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {loading && activeResults.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-20 text-text-muted text-sm">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                Cargando...
              </div>
            )}

            {!loading && activeResults.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-2">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-30"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <p className="text-sm">Sin resultados</p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {source === 'modrinth'
                ? results.map(hit => (
                    <ProjectCard key={hit.project_id} hit={hit} contentType={contentType}
                      onInstall={() => setInstalling({ project: hit })}
                      onDetail={() => setDetailProject(hit)} />
                  ))
                : cfResults.map(hit => (
                    <CurseCard key={hit.id} hit={hit}
                      onInstall={() => setCfInstalling({ hit })}
                      onDetail={() => setCfDetail(hit)} />
                  ))
              }
            </div>

            {activeTotalPages > 1 && (() => {
              const win = [page - 1, page, page + 1].filter(p => p >= 0 && p < activeTotalPages)
              const btnCls = (active: boolean, disabled = false) =>
                `min-w-[30px] h-8 px-2 flex items-center justify-center rounded-lg text-sm transition-colors ${disabled ? 'opacity-30 pointer-events-none' : ''} ${active ? 'bg-accent text-white font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-border'}`
              return (
                <div className="flex items-center justify-between px-1 py-6">
                  <span className="text-sm text-text-muted">{activeTotal} resultados</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handlePage(page - 1)} disabled={page === 0 || loading} className={btnCls(false, page === 0 || loading)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    {win[0] > 0 && <>
                      <button onClick={() => handlePage(0)} className={btnCls(false)}>1</button>
                      {win[0] > 1 && <span className="text-xs text-text-muted px-0.5">…</span>}
                    </>}
                    {win.map(p => (
                      <button key={p} onClick={() => handlePage(p)} className={btnCls(p === page)}>{p + 1}</button>
                    ))}
                    {win[win.length - 1] < activeTotalPages - 1 && <>
                      {win[win.length - 1] < activeTotalPages - 2 && <span className="text-xs text-text-muted px-0.5">…</span>}
                      <button onClick={() => handlePage(activeTotalPages - 1)} className={btnCls(false)}>{activeTotalPages}</button>
                    </>}
                    <button onClick={() => handlePage(page + 1)} disabled={page >= activeTotalPages - 1 || loading} className={btnCls(false, page >= activeTotalPages - 1 || loading)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>

        {/* Right sidebar: filters */}
        {!detailProject && !cfDetail && (
          <>
            {/* Modrinth sidebar */}
            {source === 'modrinth' && hasSidebar && (
              <div className="w-52 flex-shrink-0 border-l border-border overflow-y-auto p-4 bg-bg-secondary/50">
                {(Object.keys(catFilters).length > 0 || selectedLoader) && (
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[10px] text-text-muted">Filtros activos</span>
                    <button onClick={() => { setCatFilters({}); setSelectedLoader('') }} className="text-[10px] text-accent hover:underline">Limpiar</button>
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
              <div className="w-52 flex-shrink-0 border-l border-border overflow-y-auto p-4 bg-bg-secondary/50">
                {/* Clear filter */}
                {(cfCategoryId !== null || selectedLoader) && (
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[10px] text-text-muted">Filtros activos</span>
                    <button onClick={() => { setCfCategoryId(null); setSelectedLoader('') }} className="text-[10px] text-[#F16436] hover:underline">Limpiar</button>
                  </div>
                )}

                {/* Categories */}
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
                              className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left text-xs transition-colors ${isSelected ? 'bg-[#F16436]/20 text-[#F16436]' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`}>
                              {cat.iconUrl && <img src={cat.iconUrl} alt="" className="w-3.5 h-3.5 flex-shrink-0 opacity-70" onError={e => (e.target as HTMLImageElement).style.display='none'} />}
                              <span className="truncate">{cat.name}</span>
                            </button>
                            {kids.length > 0 && (
                              <div className="ml-4 mt-0.5 mb-0.5 space-y-0.5">
                                {kids.map(kid => {
                                  const kidSelected = cfCategoryId === kid.id
                                  return (
                                    <button key={kid.id}
                                      onClick={() => setCfCategoryId(kidSelected ? null : kid.id)}
                                      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-[11px] transition-colors ${kidSelected ? 'bg-[#F16436]/20 text-[#F16436]' : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'}`}>
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

                {/* Loader */}
                {TYPE_LOADERS[contentType] && (
                  <SidebarSection title="Mod Loader">
                    {(TYPE_LOADERS[contentType] ?? []).filter(l => CF_LOADER_TYPE[l.id] !== undefined).map(l => (
                      <LoaderButton key={l.id} label={l.label} active={selectedLoader === l.id} onClick={() => toggleLoader(l.id)} />
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
    </div>
  )
}
