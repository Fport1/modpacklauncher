import { useRef, useState, type ReactNode } from 'react'

// Explicación corta al pasar el ratón por cualquier botón del Estudio: qué hace y para qué.
// Sale enseguida (sin esperar como el title del navegador) y no tapa el botón.

export default function Tip({ text, children, side = 'bottom', className = '' }: { text: string; children: ReactNode; side?: 'bottom' | 'top' | 'right'; className?: string }) {
  const [show, setShow] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pos = side === 'top' ? 'bottom-full mb-2 left-1/2 -translate-x-1/2' : side === 'right' ? 'left-full ml-2 top-1/2 -translate-y-1/2' : 'top-full mt-2 left-1/2 -translate-x-1/2'
  return (
    <span className={`relative inline-flex ${className}`}
      onMouseEnter={() => { timer.current = setTimeout(() => setShow(true), 250) }}
      onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setShow(false) }}>
      {children}
      {show && (
        <span className={`absolute ${pos} z-[300] w-max max-w-[240px] px-3 py-2 rounded-xl bg-[#0f1726] border border-sky-400/30 text-[12.5px] leading-snug text-sky-50 shadow-xl pointer-events-none`}>
          {text}
        </span>
      )}
    </span>
  )
}
