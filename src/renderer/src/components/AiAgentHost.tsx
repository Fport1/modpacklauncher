import { useEffect, useState } from 'react'
import type { AiActivity, AiApprovalRequest } from '../../../shared/types'

// Lo que hace una IA en el launcher, visible siempre: pide permiso aquí (modo
// «preguntar») y cada acción aparece como aviso abajo a la derecha.

interface Toast extends AiActivity { key: number }

export default function AiAgentHost() {
  const [queue, setQueue] = useState<AiApprovalRequest[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const offA = window.api.aiAgent.onApproval((r) => setQueue((q) => [...q, r]))
    const offD = window.api.aiAgent.onApprovalDone((id) => setQueue((q) => q.filter((x) => x.id !== id)))
    let n = 0
    const offT = window.api.aiAgent.onActivity((a) => {
      const key = ++n
      setToasts((t) => [...t.slice(-3), { ...a, key }])
      setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), a.kind === 'error' ? 9000 : 5000)
    })
    return () => { offA(); offD(); offT() }
  }, [])

  const req = queue[0]
  const decide = (d: 'allow' | 'always' | 'deny'): void => {
    if (!req) return
    window.api.aiAgent.approve(req.id, d).catch(() => {})
    setQueue((q) => q.filter((x) => x.id !== req.id))
  }

  return (
    <>
      {req && (
        <div className="fixed inset-0 z-[400] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-[460px] bg-bg-secondary border border-[#d97757]/40 rounded-3xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border" style={{ background: 'linear-gradient(115deg, rgba(217,119,87,0.22), transparent 70%)' }}>
              <div className="w-10 h-10 rounded-2xl bg-[#d97757]/20 text-[#e8a488] flex items-center justify-center text-xl">✳</div>
              <div className="min-w-0">
                <p className="font-bold text-text-primary">La IA pide permiso</p>
                <p className="text-xs text-text-muted truncate">En «{req.instanceName}»{queue.length > 1 ? ` · ${queue.length - 1} más en cola` : ''}</p>
              </div>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-text-primary">{req.detail}</p>
              <p className="text-xs text-text-muted mt-2">Todo lo que quita la IA va a una papelera de la instancia y las configs se copian antes de cambiarlas, así que se puede deshacer.</p>
            </div>
            <div className="flex gap-2 px-6 pb-5">
              <button onClick={() => decide('deny')} className="px-4 py-2 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover">Denegar</button>
              <div className="flex-1" />
              <button onClick={() => decide('always')} className="px-4 py-2 rounded-xl border border-[#d97757]/50 text-sm text-[#e8a488] hover:bg-[#d97757]/10" title="No volver a preguntar por este tipo de acción en esta instancia hasta cerrar el launcher">
                Permitir siempre
              </button>
              <button autoFocus onClick={() => decide('allow')} className="px-4 py-2 rounded-xl bg-[#d97757] hover:bg-[#c96747] text-white text-sm font-bold">Permitir</button>
            </div>
          </div>
        </div>
      )}
      <div className="fixed bottom-4 right-4 z-[390] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.key} className={`max-w-[360px] flex items-start gap-2 px-3.5 py-2.5 rounded-2xl border shadow-xl text-xs backdrop-blur ${
            t.kind === 'error' ? 'bg-red-950/80 border-red-500/40 text-red-100'
            : t.kind === 'denied' ? 'bg-amber-950/80 border-amber-500/40 text-amber-100'
            : 'bg-bg-secondary/95 border-[#d97757]/40 text-text-primary'}`}>
            <span className="text-[#e8a488]">✳</span>
            <span className="leading-snug">{t.text}</span>
          </div>
        ))}
      </div>
    </>
  )
}
