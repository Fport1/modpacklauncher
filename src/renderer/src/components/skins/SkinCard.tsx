import { useState, type ReactNode } from 'react'

// Tarjeta de una skin (librería y skins de Minecraft): vista 3D grande que gira
// al pasar el ratón, nombre, tipo de brazos y acciones con botones de tamaño
// cómodo. «Aplicar» ocupa todo el ancho; el resto son iconos con su nombre al
// pasar el ratón.

export const Icon = {
  edit: <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />,
  download: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
  trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></>,
  save: <><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  refresh: <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />,
  upload: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  reset: <><path d="M3 12a9 9 0 109-9" /><polyline points="3 3 3 9 9 9" /></>,
}

export function Svg({ children, size = 16, className = '' }: { children: ReactNode; size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className={className}>{children}</svg>
}

export interface CardAction { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }

export default function SkinCard({ name, model, viewer, onApply, actions, badge }: {
  name: string
  model: 'classic' | 'slim'
  /** La vista 3D; recibe si debe girar (al pasar el ratón) */
  viewer: (rotating: boolean) => ReactNode
  onApply: () => void
  actions: CardAction[]
  badge?: string
}) {
  const [hover, setHover] = useState(false)
  const [confirm, setConfirm] = useState<CardAction | null>(null)
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className="group relative rounded-2xl bg-bg-card border border-border hover:border-accent/50 hover:shadow-xl hover:shadow-black/30 hover:-translate-y-0.5 transition-all flex flex-col overflow-hidden">
      <div className="relative flex items-center justify-center pt-3 pb-1" style={{ background: 'radial-gradient(ellipse at 50% 35%, rgba(99,102,241,0.18), transparent 70%)' }}>
        {viewer(hover)}
        {badge && <span className="absolute top-2.5 left-2.5 text-[10px] font-bold px-2 py-0.5 rounded-md bg-accent text-white">{badge}</span>}
      </div>
      <div className="px-3.5 pb-3.5 pt-2 flex flex-col gap-2.5 flex-1">
        <div className="min-w-0">
          <p className="text-sm font-bold text-text-primary truncate" title={name}>{name}</p>
          <p className="text-[11px] text-text-muted mt-0.5">{model === 'slim' ? 'Brazos finos (Alex)' : 'Brazos clásicos (Steve)'}</p>
        </div>
        {confirm ? (
          <div className="mt-auto space-y-2">
            <p className="text-xs text-red-300 font-medium text-center">¿{confirm.label}?</p>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => setConfirm(null)} className="h-9 rounded-xl border border-border text-xs font-semibold text-text-secondary hover:text-text-primary">Cancelar</button>
              <button onClick={() => { confirm.onClick(); setConfirm(null) }} className="h-9 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-bold">{confirm.label}</button>
            </div>
          </div>
        ) : (
          <div className="mt-auto space-y-1.5">
            <button onClick={onApply} className="w-full h-9 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-bold flex items-center justify-center gap-1.5 transition-colors">
              <Svg size={15}>{Icon.check}</Svg>Aplicar
            </button>
            {actions.length > 0 && (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}>
                {actions.map((a) => (
                  <button key={a.label} title={a.label} onClick={() => (a.danger ? setConfirm(a) : a.onClick())}
                    className={`h-9 rounded-xl border flex items-center justify-center transition-colors ${a.danger ? 'border-border text-text-secondary hover:border-red-500/50 hover:text-red-300 hover:bg-red-500/10' : 'border-border text-text-secondary hover:border-accent/50 hover:text-accent hover:bg-accent/10'}`}>
                    <Svg size={17}>{a.icon}</Svg>
                    {actions.length === 1 && <span className="ml-2 text-xs font-semibold">{a.label}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Interruptor encendido/apagado */
export function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick}
      className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${on ? 'bg-accent' : 'bg-bg-hover border border-border'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}
