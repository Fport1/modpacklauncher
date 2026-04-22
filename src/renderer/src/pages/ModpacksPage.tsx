import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Instance, ModpackManifest, DownloadProgress, PublishedModpack } from '../../../shared/types'

interface UpdateStatus {
  instanceId: string
  hasUpdate: boolean
  latestVersion?: string
  checking?: boolean
}

export default function ModpacksPage() {
  const instances = useStore((s) => s.instances)
  const { updateInstance: updateInstanceStore, setInstances } = useStore()

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
  const [revealedInstId, setRevealedInstId] = useState('')
  const [copiedInstId, setCopiedInstId] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [statuses, setStatuses] = useState<Map<string, UpdateStatus>>(new Map())
  const [modal, setModal] = useState<'addUrl' | 'changelog' | null>(null)
  const [changelogManifest, setChangelogManifest] = useState<ModpackManifest | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [installProgress, setInstallProgress] = useState<DownloadProgress | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    window.api.instances.list().then(setInstances)
    window.api.modpacks.getPublished().then(setPublished)
  }, [])

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
          new Map(prev).set(inst.id, { instanceId: inst.id, hasUpdate: false, checking: false })
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
    setLoading(true)
    setError('')
    setInstallProgress(null)
    unsubRef.current?.()
    unsubRef.current = window.api.onProgress(setInstallProgress)
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
      await window.api.modpacks.install(newInst.id, fetchedManifest)
      const allInstances = await window.api.instances.list()
      setInstances(allInstances)
      setModal(null)
      setFetchedManifest(null)
      setUrlInput('')
      setInstanceName('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Installation failed')
    } finally {
      setLoading(false)
      setInstallProgress(null)
      unsubRef.current?.()
    }
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-text-primary">Modpacks</h1>
        <div className="flex gap-2">
          <button
            onClick={checkAllUpdates}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            Check Updates
          </button>
          <button
            onClick={() => { setModal('addUrl'); setFetchedManifest(null); setUrlInput(''); setKeyInput(''); setShowKeyInput(false); setError('') }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Modpack
          </button>
        </div>
      </div>

      {modpackInstances.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-xl">
          <div className="w-14 h-14 rounded-xl bg-bg-card flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
            </svg>
          </div>
          <p className="text-text-muted mb-1">No modpacks linked yet</p>
          <p className="text-xs text-text-muted mb-4">Add a modpack URL to an instance to enable one-click updates</p>
          <button
            onClick={() => setModal('addUrl')}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
          >
            Add Modpack URL
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {modpackInstances.map((inst) => {
            const status = statuses.get(inst.id)
            return (
              <div key={inst.id} className="flex items-center gap-3 bg-bg-card border border-border rounded-xl px-4 py-3 hover:border-accent/30 transition-colors">
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-text-primary truncate">{inst.name}</p>
                    <span className="text-[10px] bg-bg-hover text-text-muted px-1.5 py-0.5 rounded-full flex-shrink-0">v{inst.modpackVersion ?? '?'}</span>
                    <span className="text-xs text-text-muted flex-shrink-0">MC {inst.minecraft} · {inst.modloader}</span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-0.5 truncate font-mono">
                    {revealedInstId === inst.id ? inst.modpackUrl : '••••••••••••••••••••••••••••••••••••'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => setRevealedInstId(prev => prev === inst.id ? '' : inst.id)} className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors" title={revealedInstId === inst.id ? 'Ocultar' : 'Mostrar URL'}>
                    {revealedInstId === inst.id
                      ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                  <button onClick={() => copyInstanceUrl(inst)} className="w-7 h-7 flex items-center justify-center transition-colors" title="Copiar URL">
                    {copiedInstId === inst.id
                      ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400"><polyline points="20 6 9 17 4 12"/></svg>
                      : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted hover:text-text-primary"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    }
                  </button>
                  <div className="w-8 flex items-center justify-center">
                    {status?.checking ? (
                      <svg className="animate-spin w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                    ) : status?.hasUpdate ? (
                      <button onClick={() => handleUpdate(inst)} title={`Actualizar a v${status.latestVersion}`}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-accent hover:bg-accent-hover text-white transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                        </svg>
                      </button>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Published modpacks */}
      {published.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-text-secondary mb-3">Mis Modpacks Publicados</h2>
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
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={() => setRevealedId(prev => prev === mp.id ? '' : mp.id)} className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors" title={revealedId === mp.id ? 'Ocultar' : 'Mostrar URL'}>
                              {revealedId === mp.id
                                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                              }
                            </button>
                            <button onClick={() => copyPublishedUrl(mp)} className="w-7 h-7 flex items-center justify-center transition-colors" title="Copiar URL">
                              {copiedId === mp.id
                                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400"><polyline points="20 6 9 17 4 12"/></svg>
                                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted hover:text-text-primary"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                              }
                            </button>
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

      {/* Add Modpack Modal */}
      {modal === 'addUrl' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-bg-secondary border border-border rounded-2xl p-6 w-[500px] shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-text-primary">Add Modpack</h2>
              <button onClick={() => setModal(null)} className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <p className="text-xs text-text-muted mb-5">
              Enter the URL of a modpack manifest JSON file. You can host it on GitHub Gist or any public URL.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-text-muted mb-1.5">Manifest URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchManifest()}
                    placeholder="https://example.com/modpack.json"
                    className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
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
                  <label className="block text-xs text-text-muted mb-1.5">
                    🔒 Clave de acceso
                  </label>
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
                  <p className="text-[11px] text-text-muted mt-1">Se creará una nueva instancia automáticamente con MC {fetchedManifest.minecraft} · {fetchedManifest.modloader}</p>
                </div>
              )}
            </div>

            {installProgress && (
              <div className="mt-3">
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

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setModal(null)}
                disabled={loading}
                className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary disabled:opacity-40 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              {fetchedManifest && (
                <button
                  onClick={handleInstall}
                  disabled={loading}
                  className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {loading ? 'Instalando...' : 'Instalar Modpack'}
                </button>
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
              Updated to v{changelogManifest.version}
            </h2>
            <p className="text-sm text-text-muted mb-4">{changelogManifest.name}</p>
            {changelogManifest.changelog ? (
              <div className="bg-bg-primary rounded-lg p-4 text-sm text-text-secondary whitespace-pre-wrap mb-5 max-h-40 overflow-y-auto">
                {changelogManifest.changelog}
              </div>
            ) : (
              <p className="text-sm text-text-muted mb-5">No changelog provided.</p>
            )}
            <button
              onClick={() => setModal(null)}
              className="w-full py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
