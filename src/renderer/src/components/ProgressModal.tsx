import { useEffect, useState } from 'react'
import { useStore } from '../store'

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function ProgressModal() {
  const { progress, progressStartedAt } = useStore((s) => ({
    progress: s.progress,
    progressStartedAt: s.progressStartedAt
  }))
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!progress) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [!!progress])

  if (!progress) return null

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  const elapsed = progressStartedAt ? now - progressStartedAt : 0
  const rate = elapsed > 500 ? progress.current / elapsed : 0
  const eta = rate > 0 && progress.total > progress.current
    ? (progress.total - progress.current) / rate
    : 0

  const isBytes = progress.unit === 'bytes' || progress.total > 500_000

  const typeLabel: Record<string, string> = {
    download: 'Descargando',
    extract: 'Extrayendo',
    install: 'Instalando'
  }

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-bg-secondary border border-border rounded-2xl shadow-2xl z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <svg
            className="animate-spin w-4 h-4 text-accent flex-shrink-0"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.25" />
            <path d="M21 12a9 9 0 00-9-9" />
          </svg>
          <span className="text-sm font-semibold text-text-primary">
            {typeLabel[progress.type] ?? 'Procesando'}
          </span>
        </div>
        <button
          onClick={() => window.api.cancel()}
          className="text-xs text-text-muted hover:text-red-400 transition-colors px-2 py-0.5 rounded border border-border/60 hover:border-red-500/50"
        >
          Cancelar
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2">
        <p className="text-xs text-text-secondary truncate">{progress.message}</p>

        <div className="w-full bg-bg-primary rounded-full h-1.5">
          <div
            className="bg-accent h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex justify-between text-xs text-text-muted">
          <span>
            {isBytes
              ? `${formatSize(progress.current)} / ${formatSize(progress.total)}`
              : `${progress.current} / ${progress.total}`}
          </span>
          <span className="font-medium text-text-secondary">{pct}%</span>
        </div>

        {elapsed > 1000 && (
          <div className="flex justify-between text-xs text-text-muted">
            <span>{formatTime(elapsed)} transcurrido</span>
            {eta > 1000 && <span>~{formatTime(eta)} restante</span>}
          </div>
        )}
      </div>
    </div>
  )
}
