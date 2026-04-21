import { useState } from 'react'
import { useStore } from '../store'
import { APP_VERSION } from '../../../shared/types'

export default function UpdateModal() {
  const { pendingUpdate, setPendingUpdate, updateModalOpen, setUpdateModalOpen } = useStore()
  const [opening, setOpening] = useState(false)

  if (!updateModalOpen || !pendingUpdate) return null

  async function handleUpdate() {
    if (!pendingUpdate) return
    setOpening(true)
    try {
      await window.api.updater.openDownload(pendingUpdate)
      setTimeout(() => setUpdateModalOpen(false), 1500)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'No se pudo abrir el enlace de descarga')
      setOpening(false)
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
        {pendingUpdate.releaseNotes && (
          <div className="bg-bg-primary rounded-xl p-4 mb-4 max-h-40 overflow-y-auto">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Novedades
            </p>
            <p className="text-sm text-text-secondary whitespace-pre-wrap">
              {pendingUpdate.releaseNotes}
            </p>
          </div>
        )}

        {/* Info box */}
        <div className="flex items-start gap-2 bg-accent/5 border border-accent/20 rounded-xl p-3 mb-5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent flex-shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-xs text-text-secondary">
            Se abrirá la página de descarga en tu navegador. El instalador detectará la versión actual
            y actualizará solo lo necesario, manteniendo tus instancias y ajustes intactos.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => setUpdateModalOpen(false)}
            className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors"
          >
            Más tarde
          </button>
          <button
            onClick={handleUpdate}
            disabled={opening}
            className="flex-1 flex items-center justify-center gap-2 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/60 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {opening ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 00-9-9" />
                </svg>
                Abriendo...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Descargar actualización
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
