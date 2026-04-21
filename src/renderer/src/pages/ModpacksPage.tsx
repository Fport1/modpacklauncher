import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { Instance, ModpackManifest } from '../../../shared/types'

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
  const [targetInstanceId, setTargetInstanceId] = useState('')
  const [fetchedManifest, setFetchedManifest] = useState<ModpackManifest | null>(null)
  const [statuses, setStatuses] = useState<Map<string, UpdateStatus>>(new Map())
  const [modal, setModal] = useState<'addUrl' | 'changelog' | null>(null)
  const [changelogManifest, setChangelogManifest] = useState<ModpackManifest | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    window.api.instances.list().then(setInstances)
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
      const manifest = await window.api.modpacks.fetch(urlInput.trim())
      setFetchedManifest(manifest)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch manifest')
    } finally {
      setLoading(false)
    }
  }

  async function handleInstall() {
    if (!fetchedManifest || !targetInstanceId) {
      setError('Select an instance first')
      return
    }
    setLoading(true)
    setError('')
    try {
      await window.api.modpacks.install(targetInstanceId, fetchedManifest)
      const allInstances = await window.api.instances.list()
      const inst = allInstances.find((i) => i.id === targetInstanceId)
      if (inst) {
        const updated = { ...inst, modpackUrl: urlInput.trim(), modpackVersion: fetchedManifest.version }
        await window.api.instances.update(updated)
        updateInstanceStore(updated)
      }
      setModal(null)
      setFetchedManifest(null)
      setUrlInput('')
      setInstances(allInstances)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Installation failed')
    } finally {
      setLoading(false)
    }
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

  const instancesWithoutPack = instances.filter((i) => !i.modpackUrl)

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
            onClick={() => { setModal('addUrl'); setFetchedManifest(null); setUrlInput(''); setError('') }}
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
        <div className="space-y-3">
          {modpackInstances.map((inst) => {
            const status = statuses.get(inst.id)
            return (
              <div
                key={inst.id}
                className="flex items-center gap-4 bg-bg-card border border-border rounded-xl p-4 hover:border-accent/30 transition-colors"
              >
                <div className="w-12 h-12 rounded-lg bg-bg-hover flex items-center justify-center flex-shrink-0">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                    <polyline points="16 16 12 12 8 16" />
                    <line x1="12" y1="12" x2="12" y2="21" />
                    <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
                  </svg>
                </div>

                <div className="flex-1 overflow-hidden">
                  <p className="font-semibold text-text-primary truncate">{inst.name}</p>
                  <p className="text-xs text-text-secondary">
                    MC {inst.minecraft} · {inst.modloader}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5 truncate">{inst.modpackUrl}</p>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-xs text-text-muted">Installed</p>
                    <p className="text-sm font-medium text-text-primary">
                      v{inst.modpackVersion ?? '?'}
                    </p>
                  </div>

                  {status?.checking ? (
                    <div className="flex items-center gap-1.5 text-xs text-text-muted">
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 12a9 9 0 00-9-9" />
                      </svg>
                      Checking...
                    </div>
                  ) : status?.hasUpdate ? (
                    <button
                      onClick={() => handleUpdate(inst)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                      </svg>
                      Update to v{status.latestVersion}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Up to date
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add Modpack Modal */}
      {modal === 'addUrl' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-bg-secondary border border-border rounded-2xl p-6 w-[500px] shadow-2xl">
            <h2 className="text-lg font-bold text-text-primary mb-2">Add Modpack</h2>
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

              {fetchedManifest && (
                <div className="bg-bg-primary border border-accent/30 rounded-lg p-4">
                  <p className="font-semibold text-text-primary">{fetchedManifest.name}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    v{fetchedManifest.version} · MC {fetchedManifest.minecraft} · {fetchedManifest.modloader}
                  </p>
                  {fetchedManifest.description && (
                    <p className="text-xs text-text-secondary mt-2">{fetchedManifest.description}</p>
                  )}
                  <p className="text-xs text-text-muted mt-2">{fetchedManifest.mods.length} mods</p>
                </div>
              )}

              {fetchedManifest && (
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Install to Instance</label>
                  {instancesWithoutPack.length === 0 ? (
                    <p className="text-xs text-text-muted">No instances without a modpack. Create one first.</p>
                  ) : (
                    <select
                      value={targetInstanceId}
                      onChange={(e) => setTargetInstanceId(e.target.value)}
                      className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                    >
                      <option value="">Select instance...</option>
                      {instancesWithoutPack.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} (MC {i.minecraft})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setModal(null)}
                className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              {fetchedManifest && (
                <button
                  onClick={handleInstall}
                  disabled={loading || !targetInstanceId}
                  className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {loading ? 'Installing...' : 'Install Modpack'}
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
