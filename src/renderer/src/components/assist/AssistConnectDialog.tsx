import { useEffect, useState } from 'react'
import { connectHelper, disconnectHelper, resetHelper, useAssistHelper } from '../../lib/assist/session'

// "Ayudar a un amigo": se mete el código que te ha pasado y, cuando él acepta,
// su instancia aparece en el cuadro del servidor como si fuera uno más.

export default function AssistConnectDialog({ onClose }: { onClose: () => void }) {
  const state = useAssistHelper()
  const [code, setCode] = useState('')

  useEffect(() => { resetHelper() }, [])
  // Conectado: el diálogo sobra, ya se ve su instancia en Servidores
  useEffect(() => { if (state.phase === 'connected') onClose() }, [state.phase])

  const busy = state.phase === 'connecting' || state.phase === 'waiting'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={() => { if (!busy) onClose() }}>
      <div className="w-full max-w-md bg-bg-secondary border border-border rounded-2xl shadow-2xl p-5 space-y-4" onMouseDown={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-semibold text-text-primary">🤝 Ayudar a un amigo</h2>
          <p className="text-sm text-text-muted mt-1">
            Tu amigo pulsa «Pedir ayuda» en su instancia y te pasa el código. Cuando lo acepte, verás los archivos de esa
            instancia aquí, en el cuadro del servidor, y podrás editarlos, instalar mods, etc. Solo esa instancia, nada más de su equipo.
          </p>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) connectHelper(code) }} className="space-y-3">
          <input autoFocus value={code} disabled={busy}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-2345"
            className="w-full text-center text-2xl font-mono tracking-[0.3em] bg-bg-primary border border-border rounded-xl px-3 py-3 text-text-primary outline-none focus:border-accent/60 disabled:opacity-60" />

          {state.phase === 'connecting' && <Status spin>Conectando…</Status>}
          {state.phase === 'waiting' && (
            <Status spin>Esperando a que {state.hostName ?? 'tu amigo'} acepte la conexión…</Status>
          )}
          {state.phase === 'error' && <p className="text-sm text-red-400">{state.message}</p>}

          <div className="flex justify-end gap-2">
            {busy ? (
              <button type="button" onClick={() => disconnectHelper()}
                className="px-4 py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
            ) : (
              <>
                <button type="button" onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary">Cerrar</button>
                <button type="submit" disabled={code.replace(/[^A-Z0-9]/gi, '').length !== 8}
                  className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40">Conectar</button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

function Status({ children, spin }: { children: React.ReactNode; spin?: boolean }) {
  return (
    <p className="flex items-center gap-2 text-sm text-text-secondary">
      {spin && <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />}
      {children}
    </p>
  )
}
