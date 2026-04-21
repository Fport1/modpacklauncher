import { useState } from 'react'
import type { Instance } from '../../../shared/types'

interface Props {
  instance: Instance
  onPlay: () => void
  onKill: () => void
  onEdit: () => void
  onDelete: () => void
  onOpenFolder: () => void
  onDetails: () => void
  onExport: () => void
  isLaunching?: boolean
  isRunning?: boolean
}

const MODLOADER_COLORS: Record<string, string> = {
  vanilla: 'text-green-400',
  forge: 'text-orange-400',
  fabric: 'text-blue-400',
  quilt: 'text-purple-400',
  neoforge: 'text-amber-400'
}

export default function InstanceCard({
  instance,
  onPlay,
  onKill,
  onEdit,
  onDelete,
  onOpenFolder,
  onDetails,
  onExport,
  isLaunching,
  isRunning
}: Props) {
  const [showMenu, setShowMenu] = useState(false)

  const loaderColor = MODLOADER_COLORS[instance.modloader] ?? 'text-text-secondary'

  const lastPlayedText = instance.lastPlayed
    ? new Date(instance.lastPlayed).toLocaleDateString()
    : 'Never'

  return (
    <div
      className={`relative group bg-bg-card border rounded-xl p-4 transition-all hover:shadow-lg ${
        isRunning
          ? 'border-green-500/60 shadow-green-500/10 shadow-md'
          : 'border-border hover:border-accent/40 hover:shadow-accent/5'
      }`}
      onMouseLeave={() => setShowMenu(false)}
    >
      {/* Icon */}
      <div className="w-12 h-12 rounded-lg bg-bg-hover flex items-center justify-center mb-3">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      </div>

      {/* Info */}
      <h3 className="font-semibold text-text-primary truncate mb-1">{instance.name}</h3>
      <div className="flex items-center gap-2 text-xs text-text-secondary mb-1">
        <span>MC {instance.minecraft}</span>
        <span className="text-border">·</span>
        <span className={loaderColor + ' capitalize'}>{instance.modloader}</span>
      </div>
      <p className="text-xs text-text-muted">Played: {lastPlayedText}</p>

      {/* Running badge */}
      {isRunning && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            En juego
          </span>
        </div>
      )}

      {/* Modpack badge */}
      {instance.modpackUrl && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
            </svg>
            Modpack v{instance.modpackVersion ?? '?'}
          </span>
        </div>
      )}

      {/* Play / Kill button */}
      {isRunning ? (
        <button
          onClick={onKill}
          className="mt-3 w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-semibold py-2 rounded-lg transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
          Cerrar juego
        </button>
      ) : (
        <button
          onClick={onPlay}
          disabled={isLaunching}
          className="mt-3 w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
        >
          {isLaunching ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.3" />
                <path d="M21 12a9 9 0 00-9-9" />
              </svg>
              Lanzando...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
              Play
            </>
          )}
        </button>
      )}

      {/* Context menu */}
      <div className="absolute top-3 right-3">
        <button
          onClick={() => setShowMenu((v) => !v)}
          className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors opacity-0 group-hover:opacity-100"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>

        {showMenu && (
          <div className="absolute right-0 top-8 w-44 bg-bg-secondary border border-border rounded-lg shadow-xl z-10 py-1 text-sm">
            <button
              onClick={() => { onDetails(); setShowMenu(false) }}
              className="w-full px-3 py-1.5 text-left text-text-secondary hover:text-text-primary hover:bg-bg-hover"
            >
              Detalles
            </button>
            <button
              onClick={() => { onEdit(); setShowMenu(false) }}
              className="w-full px-3 py-1.5 text-left text-text-secondary hover:text-text-primary hover:bg-bg-hover"
            >
              Editar
            </button>
            <button
              onClick={() => { onOpenFolder(); setShowMenu(false) }}
              className="w-full px-3 py-1.5 text-left text-text-secondary hover:text-text-primary hover:bg-bg-hover"
            >
              Abrir carpeta
            </button>
            <button
              onClick={() => { onExport(); setShowMenu(false) }}
              className="w-full px-3 py-1.5 text-left text-text-secondary hover:text-text-primary hover:bg-bg-hover"
            >
              Exportar modpack
            </button>
            <div className="border-t border-border my-1" />
            <button
              onClick={() => { onDelete(); setShowMenu(false) }}
              className="w-full px-3 py-1.5 text-left text-red-400 hover:bg-red-500/10"
            >
              Eliminar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
