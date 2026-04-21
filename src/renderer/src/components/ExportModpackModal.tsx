import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Instance } from '../../../shared/types'

interface Props {
  instance: Instance
  onClose: () => void
}

const CATEGORIES = [
  { key: 'mods', label: 'Mods', desc: 'Archivos .jar en la carpeta mods/' },
  { key: 'config', label: 'Configuraciones', desc: 'Todo el contenido de config/' },
  { key: 'resourcepacks', label: 'Resourcepacks', desc: 'Packs de recursos' },
  { key: 'shaderpacks', label: 'Shaderpacks', desc: 'Shaders instalados' },
  { key: 'scripts', label: 'Scripts', desc: 'Scripts de KubeJS u otros mods' },
  { key: 'options', label: 'Options.txt', desc: 'Configuración de video y controles' }
] as const

type CatKey = typeof CATEGORIES[number]['key']

export default function ExportModpackModal({ instance, onClose }: Props) {
  const { settings } = useStore()
  const [name, setName] = useState(instance.name)
  const [version, setVersion] = useState('1.0.0')
  const [description, setDescription] = useState(instance.description ?? '')
  const [changelog, setChangelog] = useState('')
  const [repoName, setRepoName] = useState(instance.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
  const [categories, setCategories] = useState<Record<CatKey, boolean>>({
    mods: true, config: true, resourcepacks: false, shaderpacks: false, scripts: false, options: false
  })
  const [progress, setProgress] = useState<{ message: string; current: number; total: number } | null>(null)
  const [resultUrl, setResultUrl] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  const hasToken = !!settings.githubToken

  useEffect(() => {
    return () => { unsubRef.current?.() }
  }, [])

  function toggleCat(key: CatKey) {
    setCategories(c => ({ ...c, [key]: !c[key] }))
  }

  async function handleExport() {
    if (!settings.githubToken) { setError('Configura tu token de GitHub en Ajustes primero.'); return }
    if (!name.trim() || !version.trim() || !repoName.trim()) { setError('Rellena todos los campos obligatorios.'); return }
    if (!Object.values(categories).some(Boolean)) { setError('Selecciona al menos una categoría.'); return }

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
        categories
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
  const isExporting = !!progress

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-secondary border border-border rounded-2xl w-[560px] max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-text-primary">Exportar Modpack</h2>
              <p className="text-xs text-text-muted mt-0.5">{instance.name} · MC {instance.minecraft}</p>
            </div>
            <button onClick={onClose} disabled={isExporting} className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-40">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {/* No token warning */}
          {!hasToken && (
            <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400 flex-shrink-0 mt-0.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <p className="text-xs text-amber-300">
                Necesitas un token de GitHub en <span className="font-semibold">Ajustes → Creación de Modpacks</span> para publicar.
              </p>
            </div>
          )}

          {/* Result */}
          {resultUrl && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 mb-5">
              <p className="text-xs font-semibold text-green-400 mb-2">¡Modpack publicado!</p>
              <p className="text-xs text-text-muted mb-2">Comparte este enlace con tus usuarios:</p>
              <div className="flex gap-2">
                <input readOnly value={resultUrl} className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none" />
                <button onClick={copyUrl} className="px-3 py-2 bg-accent hover:bg-accent-hover text-white text-xs rounded-lg transition-colors">
                  {copied ? '¡Copiado!' : 'Copiar'}
                </button>
              </div>
            </div>
          )}

          {/* Progress */}
          {isExporting && (
            <div className="mb-5">
              <div className="flex justify-between text-xs text-text-muted mb-2">
                <span>{progress.message}</span>
                <span>{pct}%</span>
              </div>
              <div className="w-full h-2 bg-bg-hover rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {!isExporting && !resultUrl && (
            <>
              {/* Fields */}
              <div className="space-y-3 mb-5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Nombre *</label>
                    <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Versión *</label>
                    <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.0.0" className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Nombre del repositorio GitHub *</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted">github.com/tu-usuario/</span>
                    <input value={repoName} onChange={e => setRepoName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Descripción</label>
                  <input value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Novedades / Changelog</label>
                  <textarea value={changelog} onChange={e => setChangelog(e.target.value)} rows={2} className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent resize-none" />
                </div>
              </div>

              {/* Categories */}
              <div className="mb-5">
                <p className="text-xs text-text-muted mb-2">¿Qué incluir?</p>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map(({ key, label, desc }) => (
                    <label key={key} className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${categories[key] ? 'border-accent/50 bg-accent/5' : 'border-border bg-bg-card hover:border-border/60'}`}>
                      <input type="checkbox" checked={categories[key]} onChange={() => toggleCat(key)} className="mt-0.5 accent-accent" />
                      <div>
                        <p className="text-xs font-medium text-text-primary">{label}</p>
                        <p className="text-xs text-text-muted">{desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

          {/* Actions */}
          {!isExporting && (
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">
                {resultUrl ? 'Cerrar' : 'Cancelar'}
              </button>
              {!resultUrl && (
                <button onClick={handleExport} disabled={!hasToken} className="flex-1 flex items-center justify-center gap-2 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
                  Publicar en GitHub
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
