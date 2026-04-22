import { useEffect, useRef, useState } from 'react'
import type { Instance } from '../../../shared/types'

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
}

interface Props {
  instance: Instance
  onClose: () => void
  onInstalled: () => void
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

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevancia' },
  { value: 'downloads', label: 'Descargas' },
  { value: 'follows', label: 'Seguidos' },
  { value: 'newest', label: 'Más nuevos' },
  { value: 'updated', label: 'Actualizados' }
]

export default function ModrinthModal({ instance, onClose, onInstalled }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('relevance')
  const [results, setResults] = useState<ModrinthHit[]>([])
  const [totalHits, setTotalHits] = useState(0)
  const [offset, setOffset] = useState(0)
  const [searching, setSearching] = useState(false)
  const [selectedMod, setSelectedMod] = useState<ModrinthHit | null>(null)
  const [versions, setVersions] = useState<ModrinthVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [installingId, setInstallingId] = useState('')
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const LIMIT = 20

  useEffect(() => {
    doSearch(query, sort, 0)
  }, [])

  function scheduleSearch(q: string) {
    setQuery(q)
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => doSearch(q, sort, 0), 400)
  }

  async function doSearch(q: string, s: string, off: number) {
    setSearching(true)
    setError('')
    try {
      const res = await window.api.modrinth.search(q, instance.minecraft, instance.modloader, LIMIT, off, s)
      setResults(res.hits)
      setTotalHits(res.total_hits)
      setOffset(off)
    } catch {
      setError('Error al buscar en Modrinth')
    } finally {
      setSearching(false)
    }
  }

  async function selectMod(mod: ModrinthHit) {
    setSelectedMod(mod)
    setVersions([])
    setLoadingVersions(true)
    try {
      const vers = await window.api.modrinth.getVersions(mod.project_id, instance.minecraft, instance.modloader)
      setVersions(vers)
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
    try {
      await window.api.modrinth.installMod(instance.id, file.url, file.filename)
      setInstalledIds(prev => new Set(prev).add(version.id))
      onInstalled()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al instalar')
    } finally {
      setInstallingId('')
    }
  }

  function changeSort(s: string) {
    setSort(s)
    doSearch(query, s, 0)
  }

  const pages = Math.ceil(totalHits / LIMIT)
  const currentPage = Math.floor(offset / LIMIT)

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-secondary border border-border rounded-2xl w-[820px] max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 flex-1">
            <div className="w-6 h-6 rounded flex items-center justify-center">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" className="text-green-400">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
              </svg>
            </div>
            <h2 className="text-base font-bold text-text-primary">Buscar en Modrinth</h2>
            <span className="text-xs text-text-muted">MC {instance.minecraft} · {instance.modloader}</span>
          </div>
          {selectedMod && (
            <button onClick={() => setSelectedMod(null)}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors px-2 py-1 rounded-lg hover:bg-bg-hover">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              Volver
            </button>
          )}
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {!selectedMod ? (
          <>
            {/* Search bar */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border/50 flex-shrink-0">
              <div className="relative flex-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={e => scheduleSearch(e.target.value)}
                  placeholder="Buscar mods..."
                  autoFocus
                  className="w-full bg-bg-primary border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <select value={sort} onChange={e => changeSort(e.target.value)}
                className="bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-secondary focus:outline-none focus:border-accent">
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto">
              {error && <p className="text-sm text-red-400 p-4">{error}</p>}
              {searching ? (
                <div className="flex items-center justify-center gap-2 py-16 text-text-muted text-sm">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                  Buscando...
                </div>
              ) : results.length === 0 ? (
                <div className="text-center py-16 text-text-muted text-sm">No se encontraron mods</div>
              ) : (
                <div className="divide-y divide-border/40">
                  {results.map(mod => (
                    <button key={mod.project_id} onClick={() => selectMod(mod)}
                      className="w-full flex items-start gap-3 px-5 py-3.5 hover:bg-bg-hover transition-colors text-left">
                      {mod.icon_url ? (
                        <img src={mod.icon_url} alt="" className="w-12 h-12 rounded-lg flex-shrink-0 object-cover bg-bg-card" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg flex-shrink-0 bg-bg-card flex items-center justify-center">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
                            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                          </svg>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-text-primary truncate">{mod.title}</p>
                        </div>
                        <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{mod.description}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="flex items-center gap-1 text-[11px] text-text-muted">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                            {formatNum(mod.downloads)}
                          </span>
                          {mod.categories.slice(0, 3).map(c => (
                            <span key={c} className="text-[10px] bg-bg-card text-text-muted px-1.5 py-0.5 rounded-full">{c}</span>
                          ))}
                        </div>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted flex-shrink-0 mt-1">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border/50 flex-shrink-0">
                <span className="text-xs text-text-muted">{totalHits} resultados</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => doSearch(query, sort, offset - LIMIT)} disabled={offset === 0 || searching}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover disabled:opacity-40 transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                  <span className="text-xs text-text-secondary">{currentPage + 1} / {pages}</span>
                  <button onClick={() => doSearch(query, sort, offset + LIMIT)} disabled={offset + LIMIT >= totalHits || searching}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover disabled:opacity-40 transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Mod detail + versions */
          <div className="flex-1 overflow-y-auto">
            {/* Mod header */}
            <div className="flex items-start gap-4 p-5 border-b border-border/50">
              {selectedMod.icon_url ? (
                <img src={selectedMod.icon_url} alt="" className="w-16 h-16 rounded-xl flex-shrink-0 object-cover bg-bg-card" />
              ) : (
                <div className="w-16 h-16 rounded-xl flex-shrink-0 bg-bg-card flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
                    <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                  </svg>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-text-primary">{selectedMod.title}</p>
                <p className="text-sm text-text-muted mt-0.5">{selectedMod.description}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="flex items-center gap-1 text-xs text-text-muted">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                    {formatNum(selectedMod.downloads)} descargas
                  </span>
                </div>
              </div>
            </div>

            {/* Versions */}
            <div className="p-5">
              <p className="text-xs font-semibold text-text-secondary mb-3">
                Versiones compatibles con MC {instance.minecraft} · {instance.modloader}
              </p>
              {loadingVersions ? (
                <div className="flex items-center gap-2 py-8 justify-center text-text-muted text-sm">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                  Cargando versiones...
                </div>
              ) : versions.length === 0 ? (
                <div className="text-center py-8 text-text-muted text-sm">
                  No hay versiones compatibles con esta versión de MC y modloader
                </div>
              ) : (
                <div className="space-y-2">
                  {versions.map(ver => {
                    const file = ver.files.find(f => f.primary) ?? ver.files[0]
                    const isInstalling = installingId === ver.id
                    const isInstalled = installedIds.has(ver.id)
                    return (
                      <div key={ver.id} className="flex items-center gap-3 bg-bg-card border border-border rounded-xl px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-text-primary truncate">{ver.name || ver.version_number}</p>
                            <span className="text-[10px] bg-bg-hover text-text-muted px-1.5 py-0.5 rounded-full flex-shrink-0">{ver.version_number}</span>
                          </div>
                          {file && (
                            <p className="text-[11px] text-text-muted mt-0.5 truncate font-mono">
                              {file.filename} · {formatSize(file.size)}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => installVersion(ver)}
                          disabled={isInstalling || isInstalled}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${
                            isInstalled
                              ? 'bg-green-500/15 text-green-400 cursor-default'
                              : 'bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white'
                          }`}
                        >
                          {isInstalling ? (
                            <>
                              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                              Instalando...
                            </>
                          ) : isInstalled ? (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                              Instalado
                            </>
                          ) : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                              Instalar
                            </>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
