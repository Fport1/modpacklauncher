import { useState } from 'react'
import { acceptHelper, dismissHost, rejectHelper, stopHosting, useAssistHost } from '../../lib/assist/session'

// Tarjeta fija en la esquina mientras alguien te está ayudando (o esperas a
// que entre): el código, quién quiere conectarse, qué está tocando y el botón
// para cortar. Se ve en cualquier página del launcher.

export default function AssistHostPanel() {
  const s = useAssistHost()
  const [copied, setCopied] = useState(false)
  const [minimized, setMinimized] = useState(false)
  if (s.phase === 'idle') return null

  const title = s.phase === 'connected' ? `${s.helperName} te está ayudando`
    : s.phase === 'ended' ? 'Sesión de ayuda terminada'
      : s.phase === 'request' ? `${s.helperName} quiere conectarse`
        : 'Pedir ayuda'

  if (minimized) {
    return (
      <button type="button" onClick={() => setMinimized(false)}
        className={`fixed bottom-4 right-4 z-[450] flex items-center gap-2 px-3 py-2 rounded-full shadow-2xl border text-sm font-medium ${
          s.phase === 'connected' ? 'bg-purple-600 border-purple-400 text-white' : 'bg-bg-secondary border-border text-text-primary'
        }`}>
        🤝 {title}
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-[450] w-[360px] bg-bg-secondary border-2 border-purple-500/60 rounded-2xl shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-purple-500/15 border-b border-purple-500/30">
        <span className="text-lg">🤝</span>
        <p className="text-sm font-semibold text-text-primary flex-1 truncate">{title}</p>
        {s.phase !== 'ended' && <button type="button" onClick={() => setMinimized(true)} title="Minimizar" className="text-text-muted hover:text-text-primary px-1">▁</button>}
      </div>

      <div className="p-4 space-y-3">
        {s.instance && <p className="text-xs text-text-muted">Instancia compartida: <span className="text-text-primary">{s.instance.instanceName}</span></p>}

        {s.phase === 'starting' && <p className="text-sm text-text-secondary">Preparando la sesión…</p>}

        {s.phase === 'waiting' && s.code && (
          <>
            <p className="text-sm text-text-secondary">Pásale este código a tu amigo. Lo mete en Servidores → «Ayudar a un amigo».</p>
            <button type="button" title="Copiar"
              onClick={() => { navigator.clipboard.writeText(s.code!); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              className="w-full py-3 rounded-xl bg-bg-primary border border-border font-mono text-3xl tracking-[0.25em] text-accent hover:border-accent/50">
              {s.code}
            </button>
            <p className="text-[11px] text-text-muted text-center">{copied ? '✓ Copiado' : 'Clic para copiar · caduca en 30 minutos'}</p>
          </>
        )}

        {s.phase === 'request' && (
          <>
            <p className="text-sm text-text-secondary">
              <b className="text-text-primary">{s.helperName}</b> quiere ver y cambiar los archivos de esta instancia.
              Solo podrá tocar esta instancia, nada más de tu equipo, y verás aquí todo lo que haga.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => rejectHelper()} className="flex-1 py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-red-400">Rechazar</button>
              <button type="button" onClick={() => acceptHelper()} className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium">Aceptar</button>
            </div>
          </>
        )}

        {s.phase === 'connecting' && <p className="text-sm text-text-secondary">Conectando con {s.helperName}…</p>}

        {s.phase === 'connected' && (
          <p className="text-sm text-text-secondary">Puede ver y cambiar los archivos de la instancia. No juegues con ella mientras tanto.</p>
        )}

        {s.log.length > 0 && (
          <div className="max-h-36 overflow-y-auto rounded-lg bg-bg-primary border border-border px-2.5 py-1.5 font-mono text-[11px] space-y-0.5">
            {s.log.map((l, i) => (
              <p key={i} className="text-text-muted"><span className="text-text-muted/60">{new Date(l.t).toLocaleTimeString()}</span> {l.text}</p>
            ))}
          </div>
        )}

        {s.phase === 'ended' ? (
          <button type="button" onClick={dismissHost} className="w-full py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary">Cerrar</button>
        ) : (
          <button type="button" onClick={() => stopHosting()} className="w-full py-2 rounded-lg bg-red-500/90 hover:bg-red-500 text-white text-sm font-medium">
            {s.phase === 'connected' ? 'Terminar la sesión' : 'Cancelar'}
          </button>
        )}
        <p className="text-[10px] text-text-muted text-center">Cerrar el launcher también termina la sesión.</p>
      </div>
    </div>
  )
}
