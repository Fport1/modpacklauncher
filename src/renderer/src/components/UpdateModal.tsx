import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { APP_VERSION } from '../../../shared/types'

export default function UpdateModal() {
  const { pendingUpdate, updateModalOpen, setUpdateModalOpen } = useStore()
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => { unsubRef.current?.() }
  }, [])

  if (!updateModalOpen || !pendingUpdate) return null

  async function handleUpdate() {
    if (!pendingUpdate) return
    setDownloading(true)
    setProgress(0)
    unsubRef.current = window.api.updater.onDownloadProgress((pct) => setProgress(pct))
    try {
      await window.api.updater.downloadAndInstall(pendingUpdate)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error al descargar la actualización')
      setDownloading(false)
      setProgress(0)
      unsubRef.current?.()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-bg-secondary border border-border rounded-2xl p-6 w-[440px] shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-text-primary">Actualización disponible</h2>
            <p className="text-xs text-text-muted">
              v{APP_VERSION} → <span className="text-accent font-semibold">v{pendingUpdate.version}</span>
            </p>
          </div>
        </div>

        {/* Release notes */}
        {pendingUpdate.releaseNotes && !downloading && (
          <div className="bg-bg-primary rounded-xl p-4 mb-4 max-h-40 overflow-y-auto">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Novedades</p>
            <p className="text-sm text-text-secondary whitespace-pre-wrap">{pendingUpdate.releaseNotes}</p>
          </div>
        )}

        {/* Download progress */}
        {downloading ? (
          <div className="mb-5">
            <div className="flex justify-between text-xs text-text-muted mb-2">
              <span>{progress < 100 ? 'Descargando actualización...' : 'Instalando...'}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-2 bg-bg-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            {progress === 100 && (
              <p className="text-xs text-text-muted mt-2 text-center">
                Lanzando instalador, la app se cerrará...
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-2 bg-accent/5 border border-accent/20 rounded-xl p-3 mb-5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent flex-shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-text-secondary">
              La actualización se descargará e instalará automáticamente. La app se cerrará y se abrirá el instalador.
            </p>
          </div>
        )}

        {/* Actions */}
        {!downloading && (
          <div className="flex gap-3">
            <button
              onClick={() => setUpdateModalOpen(false)}
              className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors"
            >
              Más tarde
            </button>
            <button
              onClick={handleUpdate}
              className="flex-1 flex items-center justify-center gap-2 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Actualizar ahora
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
