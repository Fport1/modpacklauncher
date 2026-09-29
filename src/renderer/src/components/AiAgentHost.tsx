import { useEffect, useState } from 'react'
import type { AiActivity } from '../../../shared/types'

// Lo que hace una IA en el launcher, visible siempre: cada acción aparece como
// aviso abajo a la derecha. Los permisos los pide la propia IA.

interface Toast extends AiActivity { key: number }

export default function AiAgentHost() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    let n = 0
    return window.api.aiAgent.onActivity((a) => {
      const key = ++n
      setToasts((t) => [...t.slice(-3), { ...a, key }])
      setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), a.kind === 'error' ? 9000 : 5000)
    })
  }, [])

  return (
    <div className="fixed bottom-4 right-4 z-[390] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.key} className={`max-w-[360px] flex items-start gap-2 px-3.5 py-2.5 rounded-2xl border shadow-xl text-xs backdrop-blur ${
          t.kind === 'error' ? 'bg-red-950/80 border-red-500/40 text-red-100'
          : t.kind === 'denied' ? 'bg-amber-950/80 border-amber-500/40 text-amber-100'
          : 'bg-bg-secondary/95 border-[#d97757]/40 text-text-primary'}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#e8a488" className="shrink-0 mt-px"><path d="M10 2.5c.4 3.9 2.1 5.6 6 6-3.9.4-5.6 2.1-6 6-.4-3.9-2.1-5.6-6-6 3.9-.4 5.6-2.1 6-6Z" /><path d="M18 12.5c.25 2.3 1.2 3.25 3.5 3.5-2.3.25-3.25 1.2-3.5 3.5-.25-2.3-1.2-3.25-3.5-3.5 2.3-.25 3.25-1.2 3.5-3.5Z" /></svg>
          <span className="leading-snug">{t.text}</span>
        </div>
      ))}
    </div>
  )
}
