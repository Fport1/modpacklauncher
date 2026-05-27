import { useEffect, useState } from 'react'
import type { Instance, ModpackManifest } from '../../../shared/types'

interface Props {
  instance: Instance
  outputPath: string
  onClose: () => void
  manifest?: ModpackManifest
}

export default function FpackSaveModal({ instance, outputPath, onClose, manifest }: Props) {
  const [progress, setProgress] = useState<{ message: string; current: number; total: number } | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [minimized, setMinimized] = useState(false)

  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0

  const fileName = outputPath.split(/[\\/]/).pop() ?? outputPath

  useEffect(() => {
    const unsubProgress = window.api.fpack.onSaveProgress(d => setProgress(d))

    window.api.fpack.saveTo(instance.id, outputPath, manifest)
      .then(() => setDone(true))
      .catch(e => setError(e?.message ?? 'Error al guardar'))

    return unsubProgress
  }, [])

  // Minimized chip
  if (minimized && !done && !error) {
    return (
      <div
        className="fixed bottom-4 right-4 w-72 bg-bg-secondary border border-border rounded-xl shadow-2xl z-50 overflow-hidden cursor-pointer"
        onClick={() => setMinimized(false)}
      >
        <div className="flex items-center gap-3 p-3">
          <svg className="animate-spin w-4 h-4 text-accent flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 00-9-9"/>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-text-primary truncate">Guardando {fileName}…</p>
            <div className="mt-1.5 h-1 bg-bg-hover rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <span className="text-xs text-text-muted flex-shrink-0">{pct}%</span>
          <button
            onClick={e => { e.stopPropagation(); setMinimized(false) }}
            className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary flex-shrink-0"
            title="Expandir"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="18 15 12 9 6 15"/>
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-secondary border border-border rounded-2xl w-[440px] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl flex-shrink-0">📦</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">Guardando como .fpack</p>
              <p className="text-xs text-text-muted truncate">{fileName}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 ml-3">
            {!done && !error && (
              <button
                onClick={() => setMinimized(true)}
                title="Minimizar"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            )}
            <button
              onClick={onClose}
              disabled={!done && !error}
              title="Cerrar"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {error ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <p className="text-sm font-medium text-red-400 mb-1">Error al guardar</p>
              <p className="text-xs text-red-400/80 whitespace-pre-line">{error}</p>
            </div>
          ) : done ? (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-green-400">¡Guardado con éxito!</p>
              <p className="text-xs text-text-muted font-mono break-all">{outputPath}</p>
              <p className="text-xs text-text-muted">
                Comparte este archivo con cualquiera — al hacer doble clic se instala directamente en el launcher.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Current file */}
              <div className="bg-bg-primary border border-border rounded-xl px-4 py-3">
                <p className="text-xs text-text-muted mb-0.5">Procesando</p>
                <p className="text-xs text-text-primary truncate">{progress?.message ?? 'Preparando…'}</p>
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-text-muted">
                    {progress ? `${progress.current} / ${progress.total} archivos` : '…'}
                  </span>
                  <span className="text-xs text-text-muted">{pct}%</span>
                </div>
                <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {(done || error) && (
            <button
              onClick={onClose}
              className="w-full py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
            >
              {error ? 'Cerrar' : 'Hecho'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
