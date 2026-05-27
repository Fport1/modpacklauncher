import { useEffect, useState } from 'react'
import type { Instance, ModpackManifest } from '../../../shared/types'

const MODLOADER_ICON: Record<string, string> = {
  fabric: '🧵', forge: '⚙️', quilt: '🪡', neoforge: '🔩', vanilla: '🟩'
}

interface Props {
  filePath: string
  onClose: () => void
  onInstalled: (inst: Instance) => void
}

export default function FpackImportModal({ filePath, onClose, onInstalled }: Props) {
  const [manifest, setManifest] = useState<ModpackManifest | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    window.api.fpack.readManifest(filePath)
      .then(m => { setManifest(m); setName(m.name) })
      .catch(e => setError(e?.message ?? 'Archivo .fpack inválido'))
  }, [filePath])

  async function install() {
    if (!manifest || !name.trim() || installing) return
    setInstalling(true)
    setError('')
    try {
      const inst = await window.api.fpack.import(filePath, name.trim())
      onInstalled(inst)
    } catch (e: any) {
      setError(e?.message ?? 'Error al instalar')
      setInstalling(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
      <div className="relative bg-bg-secondary border border-border rounded-2xl p-6 w-[440px] shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-2xl flex-shrink-0">
            📦
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-accent uppercase tracking-wider mb-0.5">Instalar modpack</p>
            <h2 className="text-base font-bold text-text-primary leading-tight truncate">
              {manifest?.name ?? 'Cargando…'}
            </h2>
          </div>
        </div>

        {error && !manifest && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400 mb-4">{error}</div>
        )}

        {manifest && (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="text-xs px-2 py-1 rounded-md bg-bg-hover text-text-secondary">⛏ {manifest.minecraft}</span>
              <span className="text-xs px-2 py-1 rounded-md bg-bg-hover text-text-secondary">
                {MODLOADER_ICON[manifest.modloader] ?? '•'} {manifest.modloader}
                {manifest.modloaderVersion ? ` ${manifest.modloaderVersion}` : ''}
              </span>
              <span className="text-xs px-2 py-1 rounded-md bg-bg-hover text-text-secondary">v{manifest.version}</span>
              {(manifest.files?.length ?? 0) > 0 && (
                <span className="text-xs px-2 py-1 rounded-md bg-bg-hover text-text-secondary">
                  {manifest.files!.length} archivos
                </span>
              )}
            </div>

            {manifest.description && (
              <p className="text-xs text-text-muted mb-4 leading-relaxed">{manifest.description}</p>
            )}

            <label className="block text-xs text-text-muted mb-1.5">Nombre de la instancia</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={installing}
              className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent mb-4 disabled:opacity-50"
              onKeyDown={e => e.key === 'Enter' && install()}
              autoFocus
            />

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400 mb-4">{error}</div>
            )}

            <div className="flex gap-3">
              <button onClick={onClose} disabled={installing} className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors disabled:opacity-40">
                Cancelar
              </button>
              <button
                onClick={install}
                disabled={!name.trim() || installing}
                className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {installing ? 'Instalando…' : 'Instalar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
