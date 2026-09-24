import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Menú contextual del launcher: se abre donde está el ratón (clic derecho) o
// debajo de un botón, nunca se sale de la pantalla, y se cierra al hacer clic
// fuera, con Esc, al hacer scroll o al cambiar de ventana.

export type MenuEntry =
  | {
      label: string
      icon?: ReactNode
      onClick: () => void
      /** Texto gris a la derecha (un atajo, un estado…). */
      hint?: string
      danger?: boolean
      disabled?: boolean
      /** Color del icono (clase de Tailwind), para destacar una acción. */
      tone?: string
    }
  | 'separator'
  | { header: string }

interface Props {
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
  /** Cabecera opcional (p. ej. el nombre e icono de la instancia). */
  title?: ReactNode
}

export default function ContextMenu({ x, y, items, onClose, title }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })

  // Recolocar si no cabe: hacia la izquierda o hacia arriba del punto
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = x + width > window.innerWidth - 8 ? Math.max(8, x - width) : x
    const top = y + height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - height - 8) : y
    setPos({ left, top, ready: true })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const close = (): void => onClose()
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [onClose])

  return createPortal(
    <div ref={ref} role="menu" data-context-menu
      onContextMenu={(e) => e.preventDefault()}
      className={`fixed z-[1000] min-w-[230px] max-w-[300px] rounded-xl border border-border/80 bg-bg-secondary/95 backdrop-blur-md shadow-2xl shadow-black/50 p-1.5 transition-[opacity,transform] duration-100 ${pos.ready ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
      style={{ left: pos.left, top: pos.top, transformOrigin: 'top left' }}>
      {title && <div className="px-2.5 pt-1.5 pb-2 mb-1 border-b border-border/60">{title}</div>}
      {items.map((item, i) => {
        if (item === 'separator') return <div key={i} className="my-1 mx-2 h-px bg-border/60" />
        if ('header' in item) return <p key={i} className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{item.header}</p>
        return (
          <button key={i} type="button" role="menuitem" disabled={item.disabled}
            onClick={() => { onClose(); item.onClick() }}
            className={`group w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13px] text-left transition-colors disabled:opacity-40 disabled:pointer-events-none ${
              item.danger ? 'text-red-400 hover:bg-red-500/15' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}>
            <span className={`w-5 flex items-center justify-center ${item.danger ? 'text-red-400' : item.tone ?? 'text-text-muted group-hover:text-text-primary'}`}>
              {item.icon}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && <span className="text-[11px] text-text-muted">{item.hint}</span>}
          </button>
        )
      })}
    </div>,
    document.body
  )
}
