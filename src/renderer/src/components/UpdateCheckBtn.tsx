import { useState } from 'react'
import { useStore } from '../store'

export default function UpdateCheckBtn() {
  const { pendingUpdate, setPendingUpdate, setUpdateModalOpen, settings } = useStore()
  const [checking, setChecking] = useState(false)

  async function handleClick() {
    if (pendingUpdate) {
      setUpdateModalOpen(true)
      return
    }
    if (!settings.updateManifestUrl) return
    setChecking(true)
    try {
      const result = await window.api.updater.check()
      if (result.hasUpdate && result.manifest) {
        setPendingUpdate(result.manifest)
        setUpdateModalOpen(true)
      }
    } catch {
      // ignore
    } finally {
      setChecking(false)
    }
  }

  if (!settings.updateManifestUrl) return null

  if (pendingUpdate) {
    return (
      <button
        onClick={handleClick}
        title={`Actualización disponible: v${pendingUpdate.version}`}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 transition-colors text-xs font-medium"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        v{pendingUpdate.version}
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={checking}
      title="Buscar actualizaciones"
      className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover disabled:opacity-50 transition-colors"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className={checking ? 'animate-spin' : ''}
      >
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
      </svg>
    </button>
  )
}
