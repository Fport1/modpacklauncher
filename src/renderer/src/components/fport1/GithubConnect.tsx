import { useEffect, useState } from 'react'
import type { GithubStatus } from '../../../../shared/types'

// Conectar la cuenta de GitHub al launcher (Ajustes › Cuentas y entrada a
// «Mis creaciones»). La clave se queda cifrada en el proceso principal: aquí
// solo se ve el usuario.

const GH_PATH = 'M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8 0 3.2.9.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3'

export function GithubLogo({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="currentColor"><path d={GH_PATH} /></svg>
}

const clean = (e: unknown): string => e instanceof Error ? e.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, '') : 'Algo ha fallado'

/** Página de GitHub para crear un token clásico con el permiso «repo» ya marcado. */
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Modpack%20Launcher%20by%20Fport1'

export function useGithubStatus(): [GithubStatus | null, (s: GithubStatus) => void] {
  const [status, setStatus] = useState<GithubStatus | null>(null)
  useEffect(() => { window.api.github.status().then(setStatus).catch(() => setStatus({ connected: false, deviceFlow: false })) }, [])
  return [status, setStatus]
}

export default function GithubConnect({ status, onChange, compact }: { status: GithubStatus | null; onChange: (s: GithubStatus) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null)
  const [tokenOpen, setTokenOpen] = useState(false)
  const [token, setToken] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => () => { window.api.github.deviceCancel().catch(() => {}) }, [])

  async function connectDevice(): Promise<void> {
    setBusy(true); setError('')
    try {
      const d = await window.api.github.deviceStart()
      setDevice(d)
      onChange(await window.api.github.deviceWait())
      setDevice(null)
    } catch (e) { setError(clean(e)); setDevice(null) }
    finally { setBusy(false) }
  }

  async function saveToken(): Promise<void> {
    if (!token.trim()) return
    setBusy(true); setError('')
    try { onChange(await window.api.github.setToken(token)); setToken(''); setTokenOpen(false) }
    catch (e) { setError(clean(e)) }
    finally { setBusy(false) }
  }

  if (!status) return <div className="p-4 rounded-xl border border-border bg-bg-card text-sm text-text-muted">Comprobando GitHub…</div>

  if (status.connected) {
    return (
      <div className={`flex items-center gap-3 ${compact ? '' : 'p-3 rounded-xl border border-border bg-bg-card'}`}>
        {status.avatarUrl ? <img src={status.avatarUrl} alt="" className="w-9 h-9 rounded-full" /> : <GithubLogo className="w-8 h-8 text-text-primary" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{status.name || status.login}</p>
          <p className="text-[11px] text-text-muted truncate">GitHub · @{status.login}{status.canPrivate ? '' : ' · solo repos públicos'}</p>
        </div>
        <button onClick={() => window.api.github.logout().then(onChange)} className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:text-red-300 hover:border-red-500/40">Desconectar</button>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-xl border border-border bg-bg-card space-y-3">
      <div className="flex items-start gap-3">
        <GithubLogo className="w-8 h-8 text-text-primary shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-text-primary">GitHub</p>
          <p className="text-xs text-text-muted mt-0.5">Para publicar tus creaciones en GitHub: las versiones van a GitHub Releases y las imágenes a un repositorio público, sin coste de descargas. La clave se guarda cifrada en este equipo.</p>
        </div>
      </div>

      {device ? (
        <div className="p-3 rounded-xl bg-bg-primary border border-border space-y-2">
          <p className="text-xs text-text-secondary">Se ha abierto GitHub en el navegador. Escribe este código y autoriza:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-center text-xl font-bold tracking-[0.3em] text-text-primary py-2 rounded-lg bg-black/30">{device.userCode}</code>
            <button onClick={() => { window.api.clipboard.writeText(device.userCode).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="px-3 py-2 rounded-lg border border-border text-xs text-text-secondary hover:text-text-primary">{copied ? 'Copiado ✓' : 'Copiar'}</button>
          </div>
          <div className="flex items-center justify-between">
            <button onClick={() => window.api.shell.openExternal(device.verificationUri)} className="text-xs text-[#c084fc] hover:underline">Volver a abrir GitHub</button>
            <span className="text-xs text-text-muted">Esperando…</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status.deviceFlow && (
            <button onClick={connectDevice} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#24292f] hover:bg-[#32383f] border border-white/10 text-white text-sm font-semibold disabled:opacity-60">
              <GithubLogo className="w-4 h-4" /> Conectar con GitHub
            </button>
          )}
          <button onClick={() => setTokenOpen((o) => !o)} className={`px-4 py-2 rounded-lg text-sm ${status.deviceFlow ? 'border border-border text-text-secondary hover:text-text-primary' : 'bg-[#24292f] hover:bg-[#32383f] border border-white/10 text-white font-semibold'}`}>
            {status.deviceFlow ? 'Usar un token' : 'Conectar con un token de GitHub'}
          </button>
        </div>
      )}

      {tokenOpen && !device && (
        <div className="space-y-2">
          <ol className="text-xs text-text-muted list-decimal pl-4 space-y-0.5">
            <li><button onClick={() => window.api.shell.openExternal(TOKEN_URL)} className="text-[#c084fc] hover:underline">Abre esta página de GitHub</button> (ya viene con el permiso «repo» marcado).</li>
            <li>Elige cuándo caduca, pulsa «Generate token» y copia el token.</li>
            <li>Pégalo aquí:</li>
          </ol>
          <div className="flex gap-2">
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveToken()} placeholder="ghp_…"
              className="flex-1 bg-bg-primary border border-border focus:border-[#a855f7] rounded-lg px-3 py-2 text-sm text-text-primary outline-none" autoComplete="off" spellCheck={false} />
            <button onClick={saveToken} disabled={busy || !token.trim()} className="px-4 py-2 rounded-lg bg-[#a855f7] hover:bg-[#9333ea] text-white text-sm font-semibold disabled:opacity-50">{busy ? 'Comprobando…' : 'Conectar'}</button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  )
}
