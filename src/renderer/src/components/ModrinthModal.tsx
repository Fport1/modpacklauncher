import { useEffect, useRef, useState } from 'react'
import type { Instance } from '../../../shared/types'
import { nav } from '../nav'

type ProjectType = 'mod' | 'resourcepack' | 'shader'

interface ModrinthHit {
  project_id: string
  title: string
  description: string
  icon_url: string | null
  downloads: number
  categories: string[]
}

interface ModrinthVersion {
  id: string
  version_number: string
  name: string
  files: { url: string; filename: string; primary: boolean; size: number }[]
  date_published: string
  downloads: number
  dependencies: { project_id: string | null; version_id?: string; dependency_type: 'required' | 'optional' | 'incompatible' }[]
}

interface ModrinthCategory { name: string; header: string }

interface Props {
  instance: Instance
  projectType?: ProjectType
  onClose: () => void
  onInstalled: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  adventure: 'Aventura', decoration: 'Decoración', economy: 'Economía',
  equipment: 'Equipamiento', food: 'Comida', 'game-mechanics': 'Mecánicas de juego',
  library: 'Librería', magic: 'Magia', management: 'Administración',
  minigame: 'Minijuego', mobs: 'Criaturas', optimization: 'Optimización',
  social: 'Social', storage: 'Almacenamiento', technology: 'Tecnología',
  transportation: 'Transporte', utility: 'Utilidad', worldgen: 'Generación de mundo',
  cursed: 'Extraño',
}

const CAT_ICONS: Record<string, string> = {
  adventure: 'M14.5 10.5L12 8l-7 7 2.5 2.5 7-7zm5-5l-2-2-1.5 1.5 2 2L19.5 5.5zM3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z',
  decoration: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm13 0v3h-3v2h3v3h2v-3h3v-2h-3v-3z',
  economy: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
  equipment: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z',
  food: 'M18.06 22.99h1.66c.84 0 1.53-.64 1.63-1.46L23 5.05h-5V1h-1.97v4.05h-4.97l.3 2.34c1.71.47 3.31 1.32 4.27 2.26 1.44 1.42 2.43 2.89 2.43 5.29v8.05zM1 21.99V21h15.03v.99c0 .55-.45 1-1.01 1H2.01c-.56 0-1.01-.45-1.01-1z',
  'game-mechanics': 'M12 15.5A3.5 3.5 0 018.5 12 3.5 3.5 0 0112 8.5a3.5 3.5 0 013.5 3.5 3.5 3.5 0 01-3.5 3.5m7.43-2.92c.04-.36.07-.72.07-1.08 0-.36-.03-.73-.07-1.08l2.32-1.82c.21-.16.27-.46.13-.69l-2.2-3.82c-.14-.23-.43-.3-.66-.23l-2.74 1.1c-.57-.44-1.18-.79-1.85-1.05l-.42-2.92c-.05-.25-.27-.43-.52-.43h-4.4c-.25 0-.47.18-.51.43l-.42 2.92c-.67.26-1.28.62-1.85 1.05L4.36 6.96c-.24-.09-.52 0-.66.23L1.5 11.01c-.14.23-.08.53.13.69l2.32 1.82c-.04.35-.07.72-.07 1.08 0 .36.03.73.07 1.08l-2.32 1.82c-.21.16-.27.46-.13.69l2.2 3.82c.14.23.43.3.66.23l2.74-1.1c.57.44 1.18.79 1.85 1.05l.42 2.92c.04.25.26.43.51.43h4.4c.25 0 .47-.18.51-.43l.42-2.92c.67-.26 1.28-.62 1.85-1.05l2.74 1.1c.24.09.52 0 .66-.23l2.2-3.82c.14-.23.08-.53-.13-.69l-2.32-1.82z',
  library: 'M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 14H5V5h14v12zm-4-4H7v-2h8v2zm0-4H7V7h8v2z',
  magic: 'M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29c-.39-.39-1.02-.39-1.41 0L1.29 18.96c-.39.39-.39 1.02 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 11.04c.39-.39.39-1.02 0-1.41l-2.33-2.34z',
  management: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
  minigame: 'M15 7.5V2H9v5.5l3 3 3-3zM7.5 9H2v6h5.5l3-3-3-3zm1 6.5V21h6v-5.5l-3-3-3 3zm8-6.5l-3 3 3 3H21V9h-5.5z',
  mobs: 'M4.5 11h-2V9H1v6h1.5v-2.5h2V15H6V9H4.5v2zm2.5-.5h1.5V15H10V10.5h1.5V9H7v1.5zm5.5 0H14V15h1.5v-4.5H17V9h-4.5v1.5zm5.5-1.5v6H19v-2.5h2V15H22.5V9H18z',
  optimization: 'M13 2.05v2.02c3.95.49 7 3.85 7 7.93 0 3.21-1.81 6-4.72 7.72L13 17v5h5l-1.22-1.22C19.91 19.07 22 15.76 22 12c0-5.18-3.95-9.45-9-9.95zM11 2.05C5.95 2.55 2 6.82 2 12c0 3.76 2.09 7.07 5.22 8.78L6 22h5V2.05z',
  social: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  storage: 'M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z',
  technology: 'M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z',
  transportation: 'M17 8C8 10 5.9 16.17 3.82 22H5.4l1.5-3h9.2l1.5 3h1.58C17.1 16.17 15 10 6 8c6-.5 9.5 2.5 11 5-1.5-5.5-7-9-12-9 7-.5 14 4.5 14 9-3-3.5-6-4-8-4z',
  utility: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
  worldgen: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  cursed: 'M12 2C6.47 2 2 6.5 2 12a10 10 0 0010 10 10 10 0 0010-10A10 10 0 0012 2M8.29 14.71L9.7 13.3c.39.39 1.02.39 1.41 0l4.25-4.25c.39-.39.39-1.02 0-1.41l1.41-1.41c1.17 1.17 1.17 3.07 0 4.24l-4.24 4.24c-1.17 1.17-3.07 1.17-4.24 0z',
}

const ENV_ICONS = {
  client: 'M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z',
  server: 'M20 2H4c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM4 14h16c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2z',
}

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevancia' },
  { value: 'downloads', label: 'Descargas' },
  { value: 'follows', label: 'Seguidos' },
  { value: 'newest', label: 'Más nuevos' },
  { value: 'updated', label: 'Actualizados' },
]

const TYPE_LABELS: Record<string, string> = {
  mod: 'Mods', resourcepack: 'Resource Packs', shader: 'Shaders'
}

const TYPE_FOLDER: Record<string, { folder: string; exts: string[] }> = {
  mod: { folder: 'mods', exts: ['.jar', '.jar.disabled'] },
  resourcepack: { folder: 'resourcepacks', exts: ['.zip', '.zip.disabled'] },
  shader: { folder: 'shaderpacks', exts: ['.zip', '.zip.disabled'] },
}

const TYPE_INSTALL_FOLDER: Record<string, string> = {
  mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks'
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface FilterRowProps {
  checked: boolean
  excluded?: boolean
  onChange: () => void
  onExclude?: () => void
  label: string
  icon?: string
}

function FilterRow({ checked, excluded, onChange, onExclude, label, icon }: FilterRowProps) {
  return (
    <div className={`flex items-center gap-1.5 px-1 py-1 rounded transition-colors group ${checked ? 'bg-accent/10' : excluded ? 'bg-red-500/10' : 'hover:bg-bg-hover'}`}>
      <button onClick={onChange} className="flex items-center gap-1.5 flex-1 min-w-0">
        <div className={`w-4 h-4 flex items-center justify-center flex-shrink-0 rounded transition-colors ${checked ? 'text-accent' : excluded ? 'text-red-400/50' : 'text-transparent'}`}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        {icon && (
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" className={`flex-shrink-0 ${checked ? 'text-accent' : excluded ? 'text-red-400/50' : 'text-text-muted'}`}>
            <path d={icon}/>
          </svg>
        )}
        <span className={`text-xs truncate ${checked ? 'text-accent font-medium' : excluded ? 'text-red-400/50 line-through' : 'text-text-secondary group-hover:text-text-primary'}`}>
          {label}
        </span>
      </button>
      {onExclude && !checked && (
        <button onClick={onExclude} title={excluded ? 'Quitar exclusión' : 'Excluir categoría'}
          className={`flex-shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-all ${excluded ? 'opacity-100' : 'hover:opacity-80'}`}>
          <span className="text-[11px] leading-none">🚫</span>
        </button>
      )}
    </div>
  )
}

export default function ModrinthModal({ instance, projectType = 'mod', onClose, onInstalled }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('relevance')
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set())
  const [excludedCats, setExcludedCats] = useState<Set<string>>(new Set())
  const [environment, setEnvironment] = useState<'any' | 'client' | 'server'>('any')
  const [hideInstalled, setHideInstalled] = useState(false)
  const [catCollapsed, setCatCollapsed] = useState(false)
  const [envCollapsed, setEnvCollapsed] = useState(false)

  const [categories, setCategories] = useState<ModrinthCategory[]>([])
  const [allResults, setAllResults] = useState<ModrinthHit[]>([])
  const [totalHits, setTotalHits] = useState(0)
  const [page, setPage] = useState(0)
  const [searching, setSearching] = useState(false)
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [loadingInstalled, setLoadingInstalled] = useState(true)

  const [selectedMod, setSelectedMod] = useState<ModrinthHit | null>(null)
  const [projectBody, setProjectBody] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'desc' | 'versions'>('desc')
  const [versions, setVersions] = useState<ModrinthVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [depNames, setDepNames] = useState<Record<string, string>>({})
  const [installingId, setInstallingId] = useState('')
  const [justInstalled, setJustInstalled] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const LIMIT = 20

  const { folder, exts } = TYPE_FOLDER[projectType]
  const installFolder = TYPE_INSTALL_FOLDER[projectType]

  useEffect(() => {
    const baseSize = nav.size()
    nav.push(() => onClose())
    const modrinthType = projectType === 'shader' ? 'shader' : projectType === 'resourcepack' ? 'resourcepack' : 'mod'
    window.api.modrinth.getCategories(modrinthType).then(cats => {
      setCategories((cats as ModrinthCategory[]).filter(c => !['fabric','forge','neoforge','quilt','liteloader','modloader','rift'].includes(c.name)))
    }).catch(() => {})
    window.api.modrinth.getInstalledIds(instance.id, folder, exts).then(ids => {
      setInstalledIds(new Set(ids))
    }).catch(() => {}).finally(() => setLoadingInstalled(false))
    doSearch('', 'relevance', new Set(), new Set(), 'any', 0, 0)
    return () => { nav.clearFrom(baseSize) }
  }, [])

  function scheduleSearch(q: string) {
    setQuery(q)
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => doSearch(q, sort, selectedCats, excludedCats, environment, 0, 0), 350)
  }

  async function doSearch(q: string, s: string, cats: Set<string>, excCats: Set<string>, env: string, pageNum: number, rawOffset: number) {
    setSearching(true)
    setError('')
    try {
      const fetchLimit = hideInstalled ? LIMIT * 3 : LIMIT
      const res = await window.api.modrinth.search(q, instance.minecraft, instance.modloader, [...cats], env, projectType, fetchLimit, rawOffset, s)
      let hits = res.hits as ModrinthHit[]
      if (excCats.size > 0) {
        hits = hits.filter(h => !h.categories.some(c => excCats.has(c)))
      }
      setAllResults(hits)
      setTotalHits(res.total_hits)
      setPage(pageNum)
    } catch {
      setError('Error al buscar en Modrinth')
    } finally {
      setSearching(false)
    }
  }

  function triggerSearch(overrides: Partial<{ q: string; s: string; cats: Set<string>; excCats: Set<string>; env: string; pageNum: number }> = {}) {
    const q = overrides.q ?? query
    const s = overrides.s ?? sort
    const cats = overrides.cats ?? selectedCats
    const excCats = overrides.excCats ?? excludedCats
    const env = overrides.env ?? environment
    const pageNum = overrides.pageNum ?? 0
    const fetchLimit = hideInstalled ? LIMIT * 3 : LIMIT
    doSearch(q, s, cats, excCats, env, pageNum, pageNum * fetchLimit)
  }

  function toggleCat(cat: string) {
    if (excludedCats.has(cat)) return
    const next = new Set(selectedCats)
    next.has(cat) ? next.delete(cat) : next.add(cat)
    setSelectedCats(next)
    triggerSearch({ cats: next })
  }

  function toggleExclude(cat: string) {
    if (selectedCats.has(cat)) return
    const next = new Set(excludedCats)
    next.has(cat) ? next.delete(cat) : next.add(cat)
    setExcludedCats(next)
    triggerSearch({ excCats: next })
  }

  function changeSort(s: string) {
    setSort(s)
    triggerSearch({ s })
  }

  function changeEnv(env: 'any' | 'client' | 'server') {
    setEnvironment(env)
    triggerSearch({ env })
  }

  async function selectMod(mod: ModrinthHit) {
    nav.push(() => { setSelectedMod(null); setProjectBody(null); setDepNames({}) })
    setSelectedMod(mod)
    setProjectBody(null)
    setDepNames({})
    setDetailTab('desc')
    setVersions([])
    setLoadingVersions(true)
    try {
      const [proj, vers] = await Promise.all([
        window.api.modrinth.getProject(mod.project_id).catch(() => null),
        window.api.modrinth.getVersions(mod.project_id, instance.minecraft, instance.modloader).catch(() => [] as ModrinthVersion[])
      ])
      if (proj) setProjectBody((proj as any).body ?? null)
      const vList = vers as ModrinthVersion[]
      setVersions(vList)
      const allDepIds = [...new Set(
        vList.flatMap(v => v.dependencies ?? [])
          .filter(d => d.dependency_type !== 'incompatible' && d.project_id)
          .map(d => d.project_id!)
      )]
      if (allDepIds.length > 0) {
        window.api.modrinth.getProjects(allDepIds).then(projs => {
          const m: Record<string, string> = {}
          for (const p of projs as { id: string; title: string; icon_url?: string }[]) m[p.id] = p.title
          setDepNames(m)
        }).catch(() => {})
      }
    } catch {
      setVersions([])
    } finally {
      setLoadingVersions(false)
    }
  }

  async function installVersion(version: ModrinthVersion) {
    const file = version.files.find(f => f.primary) ?? version.files[0]
    if (!file) return
    setInstallingId(version.id)
    setError('')
    try {
      if (projectType === 'mod') {
        const requiredDeps = version.dependencies?.filter(d => d.dependency_type === 'required' && d.project_id) ?? []
        for (const dep of requiredDeps) {
          if (dep.project_id && !installedIds.has(dep.project_id)) {
            try {
              const depVer = await window.api.modrinth.getProjectVersion(dep.project_id, instance.minecraft, instance.modloader)
              if (depVer) {
                const depFile = (depVer.files as { url: string; filename: string; primary: boolean }[]).find(f => f.primary) ?? depVer.files[0]
                if (depFile) {
                  await window.api.modrinth.installMod(instance.id, depFile.url, depFile.filename, installFolder)
                  setInstalledIds(prev => new Set(prev).add(dep.project_id!))
                }
              }
            } catch { /* skip failed deps */ }
          }
        }
      }
      await window.api.modrinth.installMod(instance.id, file.url, file.filename, installFolder)
      setJustInstalled(prev => new Set(prev).add(version.id))
      if (selectedMod) setInstalledIds(prev => new Set(prev).add(selectedMod.project_id))
      onInstalled()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al instalar')
    } finally {
      setInstallingId('')
    }
  }

  const displayResults = (() => {
    let hits = allResults
    if (hideInstalled) hits = hits.filter(r => !installedIds.has(r.project_id))
    return hits.slice(0, LIMIT)
  })()

  const fetchLimit = hideInstalled ? LIMIT * 3 : LIMIT
  const totalPages = Math.ceil(totalHits / fetchLimit)

  function goToPage(p: number) {
    const clamped = Math.max(0, Math.min(p, totalPages - 1))
    if (clamped === page) return
    const prev = page
    nav.push(() => triggerSearch({ pageNum: prev }))
    triggerSearch({ pageNum: clamped })
  }

  const showSidebar = true

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-secondary border border-border rounded-2xl w-[900px] max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 flex-1">
            <h2 className="text-base font-bold text-text-primary">Modrinth — {TYPE_LABELS[projectType]}</h2>
            <span className="text-xs text-text-muted bg-bg-hover px-2 py-0.5 rounded-full">MC {instance.minecraft}{projectType === 'mod' ? ` · ${instance.modloader}` : ''}</span>
          </div>
          {selectedMod && (
            <button onClick={() => { setSelectedMod(null); setProjectBody(null); setDepNames({}); setError('') }}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors px-2 py-1 rounded-lg hover:bg-bg-hover">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              Volver
            </button>
          )}
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          {showSidebar && !selectedMod && (
            <div className="w-52 flex-shrink-0 border-r border-border overflow-y-auto py-3 px-3 space-y-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div onClick={() => setHideInstalled(v => !v)}
                  className={`w-4 h-4 flex items-center justify-center flex-shrink-0 rounded transition-colors cursor-pointer ${hideInstalled ? 'text-accent' : 'text-transparent'}`}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <span className="text-xs text-text-secondary cursor-pointer" onClick={() => setHideInstalled(v => !v)}>Ocultar instalados</span>
                {loadingInstalled && <svg className="animate-spin w-3 h-3 text-text-muted ml-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>}
              </label>

              {/* Categories */}
              <div>
                <button onClick={() => setCatCollapsed(v => !v)}
                  className="w-full flex items-center justify-between text-xs font-bold text-text-primary mb-2 hover:text-accent transition-colors">
                  Categoría
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    className={`transition-transform ${catCollapsed ? '-rotate-90' : ''}`}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {!catCollapsed && (
                  <div className="space-y-0.5">
                    {categories.map(cat => (
                      <FilterRow
                        key={cat.name}
                        checked={selectedCats.has(cat.name)}
                        excluded={excludedCats.has(cat.name)}
                        onChange={() => toggleCat(cat.name)}
                        onExclude={() => toggleExclude(cat.name)}
                        label={CATEGORY_LABELS[cat.name] ?? cat.name}
                        icon={CAT_ICONS[cat.name]}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Environment — only for mods */}
              {projectType === 'mod' && (
                <div>
                  <button onClick={() => setEnvCollapsed(v => !v)}
                    className="w-full flex items-center justify-between text-xs font-bold text-text-primary mb-2 hover:text-accent transition-colors">
                    Entorno
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      className={`transition-transform ${envCollapsed ? '-rotate-90' : ''}`}>
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  {!envCollapsed && (
                    <div className="space-y-0.5">
                      {(['any', 'client', 'server'] as const).map(e => (
                        <FilterRow
                          key={e}
                          checked={environment === e}
                          onChange={() => changeEnv(e)}
                          label={e === 'any' ? 'Cualquiera' : e === 'client' ? 'Cliente' : 'Servidor'}
                          icon={e !== 'any' ? ENV_ICONS[e] : undefined}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(selectedCats.size > 0 || excludedCats.size > 0 || (projectType === 'mod' && environment !== 'any')) && (
                <button onClick={() => {
                  setSelectedCats(new Set()); setExcludedCats(new Set()); setEnvironment('any')
                  triggerSearch({ cats: new Set(), excCats: new Set(), env: 'any' })
                }} className="text-xs text-red-400 hover:text-red-300 transition-colors">
                  Limpiar filtros
                </button>
              )}
            </div>
          )}

          {/* Main content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!selectedMod ? (
              <>
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 flex-shrink-0">
                  {!showSidebar && (
                    <label className="flex items-center gap-2 cursor-pointer select-none flex-shrink-0">
                      <div onClick={() => setHideInstalled(v => !v)}
                        className={`w-4 h-4 flex items-center justify-center flex-shrink-0 rounded transition-colors cursor-pointer ${hideInstalled ? 'text-accent' : 'text-transparent'}`}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                      <span className="text-xs text-text-secondary" onClick={() => setHideInstalled(v => !v)}>Ocultar instalados</span>
                    </label>
                  )}
                  <div className="relative flex-1">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input type="text" value={query} onChange={e => scheduleSearch(e.target.value)}
                      placeholder={`Buscar ${TYPE_LABELS[projectType].toLowerCase()}...`} autoFocus
                      className="w-full bg-bg-primary border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent" />
                  </div>
                  <select value={sort} onChange={e => changeSort(e.target.value)}
                    className="bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-secondary focus:outline-none focus:border-accent">
                    {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {error && <p className="text-sm text-red-400 p-4">{error}</p>}
                  {searching ? (
                    <div className="flex items-center justify-center gap-2 py-16 text-text-muted text-sm">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                      Buscando...
                    </div>
                  ) : displayResults.length === 0 ? (
                    <div className="text-center py-16 text-text-muted text-sm">No se encontraron resultados</div>
                  ) : (
                    <div className="divide-y divide-border/40">
                      {displayResults.map(mod => {
                        const isInstalled = installedIds.has(mod.project_id)
                        return (
                          <button key={mod.project_id} onClick={() => selectMod(mod)}
                            className="w-full flex items-start gap-3 px-4 py-3 hover:bg-bg-hover transition-colors text-left">
                            {mod.icon_url ? (
                              <img src={mod.icon_url} alt="" className="w-11 h-11 rounded-lg flex-shrink-0 object-cover bg-bg-card" />
                            ) : (
                              <div className="w-11 h-11 rounded-lg flex-shrink-0 bg-bg-card flex items-center justify-center">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
                                  <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                                </svg>
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-text-primary truncate">{mod.title}</p>
                                {isInstalled && (
                                  <span className="text-[10px] bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded-full flex-shrink-0">Instalado</span>
                                )}
                              </div>
                              <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{mod.description}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="flex items-center gap-1 text-[11px] text-text-muted">
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                                  {formatNum(mod.downloads)}
                                </span>
                                {mod.categories.filter(c => !['fabric','forge','neoforge','quilt'].includes(c)).slice(0, 3).map(c => (
                                  <span key={c} className="flex items-center gap-0.5 text-[10px] bg-bg-card text-text-muted px-1.5 py-0.5 rounded-full">
                                    {CAT_ICONS[c] && (
                                      <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><path d={CAT_ICONS[c]}/></svg>
                                    )}
                                    {CATEGORY_LABELS[c] ?? c}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted flex-shrink-0 mt-1.5">
                              <polyline points="9 18 15 12 9 6"/>
                            </svg>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {totalPages > 1 && (() => {
                  const win = [page, page + 1, page + 2].filter(p => p < totalPages)
                  const showLastSep = win[win.length - 1] < totalPages - 1
                  const btnCls = (active: boolean, disabled = false) =>
                    `min-w-[28px] h-7 px-1.5 flex items-center justify-center rounded-lg text-xs transition-colors ${disabled ? 'opacity-40 pointer-events-none' : ''} ${active ? 'bg-accent text-white font-medium' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`
                  return (
                    <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/50 flex-shrink-0">
                      <span className="text-xs text-text-muted">{totalHits} resultados</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => goToPage(page - 1)} disabled={page === 0 || searching}
                          className={btnCls(false, page === 0 || searching)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                        </button>
                        {win[0] > 0 && <>
                          <button onClick={() => goToPage(0)} className={btnCls(false)}>1</button>
                          {win[0] > 1 && <span className="text-xs text-text-muted px-0.5">…</span>}
                        </>}
                        {win.map(p => (
                          <button key={p} onClick={() => goToPage(p)} className={btnCls(p === page)}>{p + 1}</button>
                        ))}
                        {showLastSep && <>
                          {win[win.length - 1] < totalPages - 2 && <span className="text-xs text-text-muted px-0.5">…</span>}
                          <button onClick={() => goToPage(totalPages - 1)} className={btnCls(false)}>{totalPages}</button>
                        </>}
                        <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages - 1 || searching}
                          className={btnCls(false, page >= totalPages - 1 || searching)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                        </button>
                      </div>
                    </div>
                  )
                })()}
              </>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Mod header */}
                <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-border/40 flex-shrink-0">
                  {selectedMod.icon_url ? (
                    <img src={selectedMod.icon_url} alt="" className="w-12 h-12 rounded-xl flex-shrink-0 object-cover bg-bg-card" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl flex-shrink-0 bg-bg-card flex items-center justify-center">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-text-primary">{selectedMod.title}</p>
                      {installedIds.has(selectedMod.project_id) && (
                        <span className="text-[10px] bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded-full">Instalado</span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{selectedMod.description}</p>
                    <span className="text-[11px] text-text-muted mt-1 flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                      {formatNum(selectedMod.downloads)}
                    </span>
                  </div>
                </div>
                {/* Detail tabs */}
                <div className="flex gap-0.5 px-5 pt-2 border-b border-border/30 flex-shrink-0">
                  {(['desc', 'versions'] as const).map(dt => (
                    <button key={dt} onClick={() => setDetailTab(dt)}
                      className={`px-3 py-1.5 text-xs rounded-t-lg transition-colors ${detailTab === dt ? 'text-accent border-b-2 border-accent -mb-px font-medium' : 'text-text-muted hover:text-text-secondary'}`}>
                      {dt === 'desc' ? 'Descripción' : 'Versiones'}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto p-5">
                  {detailTab === 'desc' ? (
                    <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
                      {projectBody ?? selectedMod.description}
                    </div>
                  ) : (
                    <>
                      <p className="text-xs font-semibold text-text-secondary mb-3">
                        Versiones compatibles con MC {instance.minecraft}{projectType === 'mod' ? ` · ${instance.modloader}` : ''}
                      </p>
                      {loadingVersions ? (
                        <div className="flex items-center gap-2 py-8 justify-center text-text-muted text-sm">
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                          Cargando versiones...
                        </div>
                      ) : versions.length === 0 ? (
                        <div className="text-center py-8 text-text-muted text-sm">No hay versiones compatibles</div>
                      ) : (
                        <div className="space-y-2">
                          {versions.map(ver => {
                            const file = ver.files.find(f => f.primary) ?? ver.files[0]
                            const isInstalling = installingId === ver.id
                            const isInstalled = justInstalled.has(ver.id)
                            const requiredDeps = ver.dependencies?.filter(d => d.dependency_type === 'required' && d.project_id) ?? []
                            const optionalDeps = ver.dependencies?.filter(d => d.dependency_type === 'optional' && d.project_id) ?? []
                            return (
                              <div key={ver.id} className="bg-bg-card border border-border rounded-xl px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-medium text-text-primary truncate">{ver.name || ver.version_number}</p>
                                      <span className="text-[10px] bg-bg-hover text-text-muted px-1.5 py-0.5 rounded-full flex-shrink-0">{ver.version_number}</span>
                                    </div>
                                    {file && <p className="text-[11px] text-text-muted mt-0.5 truncate font-mono">{file.filename} · {formatSize(file.size)}</p>}
                                  </div>
                                  <button onClick={() => installVersion(ver)} disabled={isInstalling || isInstalled}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${
                                      isInstalled ? 'bg-green-500/15 text-green-400 cursor-default'
                                        : 'bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white'
                                    }`}>
                                    {isInstalling ? (<><svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>Instalando...</>)
                                      : isInstalled ? (<><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>Instalado</>)
                                      : (<><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>Instalar</>)}
                                  </button>
                                </div>
                                {(requiredDeps.length > 0 || optionalDeps.length > 0) && (
                                  <div className="mt-2 pt-2 border-t border-border/40 flex flex-wrap gap-1.5">
                                    {requiredDeps.map(d => (
                                      <span key={d.project_id} className="text-[10px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                                        Req: {depNames[d.project_id!] ?? d.project_id?.slice(0, 8)}
                                      </span>
                                    ))}
                                    {optionalDeps.map(d => (
                                      <span key={d.project_id} className="text-[10px] bg-bg-hover text-text-muted px-1.5 py-0.5 rounded-full">
                                        Opt: {depNames[d.project_id!] ?? d.project_id?.slice(0, 8)}
                                      </span>
                                    ))}
                                    {requiredDeps.length > 0 && (
                                      <span className="text-[10px] text-red-400/70 italic">Las dependencias requeridas se instalan automáticamente</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
