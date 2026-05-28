import { useEffect, useState } from 'react'

type Arch = 'arm64' | 'x64'

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
    setVlcInstalled(null)
    const installed = await window.api.tools.checkVlc()
    setVlcInstalled(installed)
  }

  /* ── Loading ── */
  if (vlcInstalled === null) {
    return (
      <div className="p-6 max-w-xl mx-auto flex flex-col items-center justify-center gap-3 mt-20">
        <span className="text-4xl">🔍</span>
        <p className="text-text-muted text-sm">Comprobando si tienes VLC...</p>
      </div>
    )
  }

  /* ── Already installed ── */
  if (vlcInstalled === true) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="bg-green-500/10 border-2 border-green-500/40 rounded-2xl p-8 text-center">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-green-400 mb-2">¡VLC está instalado!</h1>
          <p className="text-text-secondary text-sm mb-6">
            🎉 ¡Perfecto! Los videos y cinemáticas de tus modpacks funcionarán sin ningún problema.
          </p>
          <button
            onClick={recheck}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors underline underline-offset-2"
          >
            Comprobar de nuevo
          </button>
        </div>
      </div>
    )
  }

  /* ── Not installed ── */
  return (
    <div className="p-6 max-w-xl mx-auto space-y-4">

      {/* Header */}
      <div className="text-center pb-2">
        <div className="text-5xl mb-3">🎬</div>
        <h1 className="text-2xl font-bold text-text-primary">Necesitas instalar VLC</h1>
        <p className="text-sm text-text-muted mt-1">
          Sin VLC los videos y cinemáticas de algunos modpacks <span className="text-red-400 font-medium">no funcionan</span> en Mac.
        </p>
      </div>

      {/* Step 1 */}
      <div className="bg-bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white font-bold text-sm flex-shrink-0">1</span>
          <div>
            <p className="font-bold text-text-primary">¿Qué tipo de Mac tienes?</p>
            <p className="text-xs text-text-muted">Si tienes un Mac desde 2020 en adelante, casi seguro es Apple Silicon 🍎</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Apple Silicon */}
          <button
            onClick={() => setSelectedArch('arm64')}
            className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
              selectedArch === 'arm64'
                ? 'bg-accent/15 border-accent'
                : 'border-border hover:border-border/60 bg-bg-secondary'
            }`}
          >
            {arch === 'arm64' && (
              <span className="absolute top-2 right-2 text-[10px] bg-accent text-white rounded-full px-1.5 py-0.5 font-bold">
                ← El tuyo
              </span>
            )}
            <span className="text-3xl">🍎</span>
            <div className="text-center">
              <p className="font-bold text-sm text-text-primary">Apple Silicon</p>
              <p className="text-[11px] text-text-muted">M1, M2, M3, M4...</p>
            </div>
            {selectedArch === 'arm64' && (
              <span className="text-accent text-lg">✓</span>
            )}
          </button>

          {/* Intel */}
          <button
            onClick={() => setSelectedArch('x64')}
            className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
              selectedArch === 'x64'
                ? 'bg-blue-500/15 border-blue-500'
                : 'border-border hover:border-border/60 bg-bg-secondary'
            }`}
          >
            {arch === 'x64' && (
              <span className="absolute top-2 right-2 text-[10px] bg-blue-500 text-white rounded-full px-1.5 py-0.5 font-bold">
                ← El tuyo
              </span>
            )}
            <span className="text-3xl">🖥️</span>
            <div className="text-center">
              <p className="font-bold text-sm text-text-primary">Intel</p>
              <p className="text-[11px] text-text-muted">Macs antes de 2020</p>
            </div>
            {selectedArch === 'x64' && (
              <span className="text-blue-400 text-lg">✓</span>
            )}
          </button>
        </div>

        <p className="text-[11px] text-text-muted mt-3 text-center">
          💡 ¿No sabes cuál tienes? En tu Mac ve a{' '}
          <span className="text-text-secondary font-medium"> 🍎 → Acerca de este Mac</span>
          {' '}y mira el procesador.
        </p>
      </div>

      {/* Step 2 */}
      <div className="bg-bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white font-bold text-sm flex-shrink-0">2</span>
          <div>
            <p className="font-bold text-text-primary">¡Pulsa el botón y listo!</p>
            <p className="text-xs text-text-muted">El launcher lo descarga e instala solo, tú no tienes que hacer nada más 🙌</p>
          </div>
        </div>

        {error && (
          <div className="mb-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">
            ❌ {error}
          </div>
        )}

        <button
          onClick={install}
          disabled={installing || !selectedArch}
          className="w-full flex items-center justify-center gap-2 py-4 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-xl text-base font-bold transition-colors"
        >
          {installing ? (
            <>
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 00-9-9"/>
              </svg>
              Instalando VLC...
            </>
          ) : (
            <>
              <span className="text-xl">📥</span>
              Instalar VLC {selectedArch === 'arm64' ? 'para Apple Silicon' : 'para Intel'}
            </>
          )}
        </button>

        {installing && (
          <div className="mt-3 flex items-start gap-2 bg-accent/8 border border-accent/20 rounded-xl px-4 py-3">
            <span className="text-lg flex-shrink-0">👀</span>
            <p className="text-xs text-text-secondary">
              Mira la <span className="text-accent font-medium">esquina inferior derecha</span> de la pantalla — ahí verás el progreso de la instalación.
            </p>
          </div>
        )}
      </div>

      {/* Step 3 — after install */}
      <div className="bg-bg-card border border-border rounded-2xl p-5 opacity-50">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-green-500/30 flex items-center justify-center text-green-400 font-bold text-sm flex-shrink-0">3</span>
          <div>
            <p className="font-bold text-text-primary">¡Ya puedes jugar! 🎮</p>
            <p className="text-xs text-text-muted">Cuando termine, esta página cambiará a verde y ya está.</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 px-1">
        <button
          onClick={recheck}
          className="text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          🔄 Ya lo instalé manualmente, comprobar de nuevo
        </button>
        <button
          onClick={() => window.api.shell.openExternal('https://www.videolan.org/vlc/')}
          className="text-xs text-text-muted hover:text-accent transition-colors"
        >
          videolan.org →
        </button>
      </div>

    </div>
  )
}
