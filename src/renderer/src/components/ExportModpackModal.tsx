import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../store'
import type { Instance } from '../../../shared/types'

interface Props {
  instance: Instance
  onClose: () => void
}

interface DirEntry {
  name: string
  relativePath: string
  isDir: boolean
  size?: number
}

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted flex-shrink-0">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
    </svg>
  )
}
function FolderIcon({ open }: { open?: boolean }) {
  return open ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-accent/80 flex-shrink-0">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent/70 flex-shrink-0">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
    </svg>
  )
}

/* ─── Checkbox component (supports indeterminate) ────────────── */
function Checkbox({ checked, indeterminate, onChange, disabled }: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !checked && !!indeterminate
  }, [checked, indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className="w-3.5 h-3.5 accent-accent flex-shrink-0 cursor-pointer"
    />
  )
}

/* ─── Tree node ─────────────────────────────────────────────── */
function TreeNode({
  entry,
  depth,
  selected,
  onToggle,
  childrenMap,
  loadingSet,
  expandedSet,
  onExpand,
  disabled
}: {
  entry: DirEntry
  depth: number
  selected: Set<string>
  onToggle: (path: string, isDir: boolean) => void
  childrenMap: Map<string, DirEntry[]>
  loadingSet: Set<string>
  expandedSet: Set<string>
  onExpand: (path: string) => void
  disabled: boolean
}) {
  const isExpanded = expandedSet.has(entry.relativePath)
  const isLoading = loadingSet.has(entry.relativePath)
  const children = childrenMap.get(entry.relativePath)

  // A file/folder is "checked" if it's directly in selected, OR if a parent dir is in selected
  function isChecked(p: string): boolean {
    if (selected.has(p)) return true
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) {
      if (selected.has(parts.slice(0, i).join('/'))) return true
    }
    return false
  }

  const checked = isChecked(entry.relativePath)

  // Indeterminate: dir is not selected, but some children are
  const indeterminate = entry.isDir && !checked && !!children && children.some(c => isChecked(c.relativePath))

  const indent = depth * 16

  return (
    <>
      <div
        className={`flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover transition-colors ${checked ? 'bg-accent/5' : ''}`}
        style={{ paddingLeft: `${12 + indent}px` }}
      >
        {/* Left: checkbox */}
        <Checkbox
          checked={checked}
          indeterminate={indeterminate}
          onChange={() => onToggle(entry.relativePath, entry.isDir)}
          disabled={disabled}
        />

        {/* Icon + name */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {entry.isDir ? <FolderIcon open={isExpanded} /> : <FileIcon />}
          <span className={`text-xs truncate ${checked ? 'text-text-primary' : 'text-text-secondary'}`}>
            {entry.name}
          </span>
          {entry.size !== undefined && (
            <span className="text-[10px] text-text-muted flex-shrink-0">{formatSize(entry.size)}</span>
          )}
        </div>

        {/* Right: expand button (dirs only) */}
        {entry.isDir && (
          <button
            onClick={() => onExpand(entry.relativePath)}
            disabled={disabled}
            title={isExpanded ? 'Colapsar' : 'Ver contenido'}
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-card flex-shrink-0 transition-colors disabled:opacity-40"
          >
            {isLoading ? (
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Children */}
      {isExpanded && children && children.map(child => (
        <TreeNode
          key={child.relativePath}
          entry={child}
          depth={depth + 1}
          selected={selected}
          onToggle={onToggle}
          childrenMap={childrenMap}
          loadingSet={loadingSet}
          expandedSet={expandedSet}
          onExpand={onExpand}
          disabled={disabled}
        />
      ))}
    </>
  )
}

/* ─── Main modal ─────────────────────────────────────────────── */
export default function ExportModpackModal({ instance, onClose }: Props) {
  const { settings } = useStore()

  // Metadata form
  const [name, setName] = useState(instance.name)
  const [version, setVersion] = useState('1.0.0')
  const [description, setDescription] = useState(instance.description ?? '')
  const [changelog, setChangelog] = useState('')
  const [repoName, setRepoName] = useState(
    instance.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  )

  // Directory tree state
  const [rootEntries, setRootEntries] = useState<DirEntry[]>([])
  const [childrenMap, setChildrenMap] = useState<Map<string, DirEntry[]>>(new Map())
  const [loadingSet, setLoadingSet] = useState<Set<string>>(new Set())
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadingRoot, setLoadingRoot] = useState(true)

  // Export state
  const [progress, setProgress] = useState<{ message: string; current: number; total: number } | null>(null)
  const [resultUrl, setResultUrl] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  const hasToken = !!settings.githubToken
  const isExporting = !!progress

  useEffect(() => {
    window.api.instances.listGameDir(instance.id).then(entries => {
      setRootEntries(entries)
      setLoadingRoot(false)
    }).catch(() => setLoadingRoot(false))
    return () => { unsubRef.current?.() }
  }, [instance.id])

  const handleExpand = useCallback(async (dirPath: string) => {
    // Toggle collapse
    if (expandedSet.has(dirPath)) {
      setExpandedSet(prev => { const s = new Set(prev); s.delete(dirPath); return s })
      return
    }

    // Load children if not cached
    if (!childrenMap.has(dirPath)) {
      setLoadingSet(prev => new Set(prev).add(dirPath))
      try {
        const children = await window.api.instances.listGameDir(instance.id, dirPath)
        setChildrenMap(prev => new Map(prev).set(dirPath, children))
      } catch { /* ignore */ } finally {
        setLoadingSet(prev => { const s = new Set(prev); s.delete(dirPath); return s })
      }
    }

    setExpandedSet(prev => new Set(prev).add(dirPath))
  }, [expandedSet, childrenMap, instance.id])

  const handleToggle = useCallback((p: string, isDir: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      // Check if already "covered" by a parent dir
      const parts = p.split('/')
      let coveredByParent = false
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('/')
        if (next.has(parent)) { coveredByParent = true; break }
      }

      if (coveredByParent) {
        // Need to "expand" the parent selection to exclude this item
        // Find the nearest parent in selected
        for (let i = parts.length - 1; i >= 1; i--) {
          const parent = parts.slice(0, i).join('/')
          if (next.has(parent)) {
            next.delete(parent)
            // Add all siblings of each part of path (except current)
            const siblings = childrenMap.get(parent) ?? []
            for (const sibling of siblings) {
              if (sibling.relativePath !== p) next.add(sibling.relativePath)
            }
            break
          }
        }
        return next
      }

      if (next.has(p)) {
        // Deselect — remove this and all its children
        for (const key of [...next]) {
          if (key === p || key.startsWith(p + '/')) next.delete(key)
        }
      } else {
        // Select — add this, remove any children that were individually selected
        for (const key of [...next]) {
          if (key.startsWith(p + '/')) next.delete(key)
        }
        next.add(p)
      }
      return next
    })
  }, [childrenMap])

  function selectAll() {
    setSelected(new Set(rootEntries.map(e => e.relativePath)))
  }
  function selectNone() {
    setSelected(new Set())
  }

  async function handleExport() {
    if (!settings.githubToken) { setError('Configura tu token de GitHub en Ajustes primero.'); return }
    if (!name.trim() || !version.trim() || !repoName.trim()) { setError('Rellena todos los campos obligatorios.'); return }
    if (selected.size === 0) { setError('Selecciona al menos un archivo o carpeta.'); return }

    setError('')
    setResultUrl('')
    setProgress({ message: 'Iniciando...', current: 0, total: 1 })

    unsubRef.current?.()
    unsubRef.current = window.api.modpacks.onExportProgress(setProgress)

    try {
      const url = await window.api.modpacks.export({
        instanceId: instance.id,
        name: name.trim(),
        version: version.trim(),
        description: description.trim(),
        changelog: changelog.trim(),
        repoName: repoName.trim(),
        githubToken: settings.githubToken,
        minecraft: instance.minecraft,
        modloader: instance.modloader,
        modloaderVersion: instance.modloaderVersion,
        selectedPaths: [...selected]
      })
      setResultUrl(url)
      setProgress(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al exportar')
      setProgress(null)
    } finally {
      unsubRef.current?.()
    }
  }

  async function copyUrl() {
    await window.api.clipboard.writeText(resultUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  const selectedCount = selected.size

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-secondary border border-border rounded-2xl w-[640px] max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-4 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Exportar Modpack</h2>
            <p className="text-xs text-text-muted mt-0.5">{instance.name} · MC {instance.minecraft}</p>
          </div>
          <button onClick={onClose} disabled={isExporting}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-40">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-5 pb-5 space-y-4">

          {/* No token warning */}
          {!hasToken && (
            <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400 flex-shrink-0 mt-0.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <p className="text-xs text-amber-300">
                Necesitas un token de GitHub en <span className="font-semibold">Ajustes → Creación de Modpacks</span> para publicar.
              </p>
            </div>
          )}

          {/* Result */}
          {resultUrl && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-green-400">¡Modpack publicado!</p>
              <div className="flex gap-2">
                <input readOnly value={resultUrl} className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none" />
                <button onClick={copyUrl} className="px-3 py-2 bg-accent hover:bg-accent-hover text-white text-xs rounded-lg transition-colors whitespace-nowrap">
                  {copied ? '¡Copiado!' : 'Copiar'}
                </button>
              </div>
              <div className="bg-bg-card rounded-lg p-3 text-xs text-text-muted space-y-1.5">
                <p className="text-text-secondary font-medium">¿Cómo instalar este modpack?</p>
                <p>1. Comparte el enlace de arriba con tus jugadores.</p>
                <p>2. En el launcher, ve a <span className="text-text-primary font-medium">Instancias → Nueva Instancia → Instalar Modpack</span>.</p>
                <p>3. Pega el enlace y haz clic en <span className="text-text-primary font-medium">Obtener</span>.</p>
              </div>
            </div>
          )}

          {/* Progress */}
          {isExporting && (
            <div>
              <div className="flex justify-between items-center text-xs text-text-muted mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="animate-spin w-3.5 h-3.5 flex-shrink-0 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 00-9-9"/>
                  </svg>
                  <span className="truncate">{progress.message}</span>
                </div>
                <span className="flex-shrink-0 ml-2">{pct}%</span>
              </div>
              <div className="w-full h-2 bg-bg-hover rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {!isExporting && !resultUrl && (
            <>
              {/* Metadata fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Nombre *</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Versión *</label>
                  <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.0.0"
                    className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-text-muted mb-1">Nombre del repositorio GitHub *</label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted whitespace-nowrap">github.com/tu-usuario/</span>
                  <input value={repoName}
                    onChange={e => setRepoName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-text-muted mb-1">Descripción</label>
                <input value={description} onChange={e => setDescription(e.target.value)}
                  className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
              </div>

              <div>
                <label className="block text-xs text-text-muted mb-1">Changelog</label>
                <textarea value={changelog} onChange={e => setChangelog(e.target.value)} rows={2}
                  className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent resize-none" />
              </div>

              {/* File picker */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-text-secondary">Archivos a incluir</label>
                    {selectedCount > 0 && (
                      <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded-full">
                        {selectedCount} seleccionado{selectedCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={selectAll} className="text-[11px] text-text-muted hover:text-accent transition-colors">Todo</button>
                    <span className="text-border text-xs">·</span>
                    <button onClick={selectNone} className="text-[11px] text-text-muted hover:text-accent transition-colors">Nada</button>
                  </div>
                </div>

                <div className="bg-bg-primary border border-border rounded-xl overflow-hidden">
                  {/* Column headers */}
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-bg-hover/50">
                    <div className="w-3.5" />
                    <span className="text-[10px] text-text-muted flex-1">Nombre</span>
                    <span className="text-[10px] text-text-muted w-5 text-center">▶</span>
                  </div>

                  <div className="max-h-56 overflow-y-auto">
                    {loadingRoot ? (
                      <div className="flex items-center gap-2 p-4 text-xs text-text-muted">
                        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                        Leyendo directorio...
                      </div>
                    ) : rootEntries.length === 0 ? (
                      <p className="p-4 text-xs text-text-muted">Directorio vacío.</p>
                    ) : (
                      rootEntries.map(entry => (
                        <TreeNode
                          key={entry.relativePath}
                          entry={entry}
                          depth={0}
                          selected={selected}
                          onToggle={handleToggle}
                          childrenMap={childrenMap}
                          loadingSet={loadingSet}
                          expandedSet={expandedSet}
                          onExpand={handleExpand}
                          disabled={false}
                        />
                      ))
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-text-muted mt-1.5">
                  <span className="font-medium">☐ izquierdo</span> = incluir carpeta/archivo completo ·{' '}
                  <span className="font-medium">▶ derecho</span> = expandir y seleccionar archivos individuales
                </p>
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        {!isExporting && (
          <div className="flex gap-3 p-5 pt-3 border-t border-border/30 flex-shrink-0">
            <button onClick={onClose}
              className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">
              {resultUrl ? 'Cerrar' : 'Cancelar'}
            </button>
            {!resultUrl && (
              <button onClick={handleExport} disabled={!hasToken || selectedCount === 0}
                className="flex-1 flex items-center justify-center gap-2 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                </svg>
                Publicar en GitHub
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
