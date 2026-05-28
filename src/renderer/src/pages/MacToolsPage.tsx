import { useEffect, useState } from 'react'

type Arch = 'arm64' | 'x64'

function VlcIcon({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      {/* Traffic cone body */}
      <polygon points="50,8 78,82 22,82" fill="#F90" stroke="#E07000" strokeWidth="3" strokeLinejoin="round"/>
      {/* White stripes */}
      <rect x="31" y="50" width="38" height="8" rx="2" fill="white" opacity="0.85"/>
      <rect x="27" y="64" width="46" height="8" rx="2" fill="white" opacity="0.85"/>
      {/* Base */}
      <rect x="16" y="82" width="68" height="12" rx="6" fill="#CCC"/>
    </svg>
  )
}

export default function MacToolsPage() {
  const [vlcInstalled, setVlcInstalled] = useState<boolean | null>(null)
  const [arch, setArch] = useState<Arch>('arm64')
  const [selectedArch, setSelectedArch] = useState<Arch | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.tools.checkVlc().then(setVlcInstalled)
    window.api.tools.getArch().then(a => {
      const detected: Arch = a === 'arm64' ? 'arm64' : 'x64'
      setArch(detected)
      setSelectedArch(detected)
    })
  }, [])

  async function install() {
    if (!selectedArch || installing) return
    setInstalling(true)
    setError('')
    try {
      await window.api.tools.installVlc(selectedArch)
      setVlcInstalled(true)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Error al instalar VLC')
    } finally {
      setInstalling(false)
    }
  }

  async function recheck() {
    const installed = await window.api.tools.checkVlc()
    setVlcInstalled(installed)
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Herramientas</p>
        <h1 className="text-2xl font-bold text-text-primary mt-1">Utilidades macOS</h1>
        <p className="text-sm text-text-muted mt-1">Dependencias opcionales que algunos modpacks requieren.</p>
      </div>

      {/* VLC card */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-4 p-5 border-b border-border/50">
          <VlcIcon size={52} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-text-primary">VLC Media Player</h2>
              {vlcInstalled === true && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-green-400 bg-green-500/10 border border-green-500/30 rounded-full px-2 py-0.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                  Instalado
                </span>
              )}
              {vlcInstalled === false && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">
                  No instalado
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-0.5">v3.0.21 · videolan.org</p>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-secondary leading-relaxed">
            Algunos mods de reproducción de video y cinemáticas (como <span className="text-text-primary font-medium">Replay Mod</span> o mods de cutscenes) necesitan VLC instalado en tu Mac para funcionar correctamente.
          </p>

          {vlcInstalled === true && (
            <div className="flex items-center gap-3 bg-green-500/8 border border-green-500/20 rounded-xl p-4">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400 flex-shrink-0">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <div>
                <p className="text-sm font-medium text-green-400">VLC está instalado</p>
                <p className="text-xs text-text-muted mt-0.5">Los mods que lo requieren funcionarán correctamente.</p>
              </div>
            </div>
          )}

          {vlcInstalled === false && (
            <div className="space-y-4">
              {/* Arch selector */}
              <div>
                <p className="text-xs text-text-muted mb-2">
                  Arquitectura detectada: <span className="text-accent font-medium">{arch === 'arm64' ? 'Apple Silicon (ARM)' : 'Intel (x86_64)'}</span>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedArch('arm64')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      selectedArch === 'arm64'
                        ? 'bg-accent/15 border-accent text-accent'
                        : 'border-border text-text-secondary hover:border-border/80 hover:text-text-primary'
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/></svg>
                    Apple Silicon
                    {arch === 'arm64' && <span className="text-[10px] opacity-70">(tuyo)</span>}
                  </button>
                  <button
                    onClick={() => setSelectedArch('x64')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      selectedArch === 'x64'
                        ? 'bg-accent/15 border-accent text-accent'
                        : 'border-border text-text-secondary hover:border-border/80 hover:text-text-primary'
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                    Intel
                    {arch === 'x64' && <span className="text-[10px] opacity-70">(tuyo)</span>}
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <button
                onClick={install}
                disabled={installing || !selectedArch}
                className="w-full flex items-center justify-center gap-2 py-3 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                {installing ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 00-9-9"/>
                    </svg>
                    Instalando… (ver progreso abajo a la derecha)
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Instalar VLC {selectedArch === 'arm64' ? 'para Apple Silicon' : 'para Intel'}
                  </>
                )}
              </button>
            </div>
          )}

          {vlcInstalled === null && (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
              Comprobando...
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 flex items-center justify-between">
          <button
            onClick={recheck}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            Comprobar de nuevo
          </button>
          <button
            onClick={() => window.api.shell.openExternal('https://www.videolan.org/vlc/')}
            className="text-xs text-text-muted hover:text-accent transition-colors"
          >
            videolan.org →
          </button>
        </div>
      </div>
    </div>
  )
}
