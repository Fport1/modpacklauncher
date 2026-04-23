import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  src: string
  alt?: string
  onClose: () => void
  toolbar?: React.ReactNode
  onPrev?: () => void
  onNext?: () => void
  counter?: string
}

export default function ZoomableImage({ src, alt, onClose, toolbar, onPrev, onNext, counter }: Props) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const isDragging = useRef(false)
  const dragStart = useRef({ mx: 0, my: 0, ox: 0, oy: 0 })
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [src])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev?.()
      if (e.key === 'ArrowRight') onNext?.()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onPrev, onNext])

  function zoom(delta: number) {
    setScale(s => {
      const next = Math.max(1, Math.min(8, s + delta))
      if (next === 1) setOffset({ x: 0, y: 0 })
      return next
    })
  }

  function handleWheel(e: React.WheelEvent) {
    e.stopPropagation()
    zoom(e.deltaY > 0 ? -0.3 : 0.3)
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (scale <= 1) return
    e.stopPropagation()
    e.preventDefault()
    isDragging.current = true
    setDragging(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging.current) return
    e.stopPropagation()
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.mx),
      y: dragStart.current.oy + (e.clientY - dragStart.current.my),
    })
  }

  function handleMouseUp() {
    isDragging.current = false
    setDragging(false)
  }

  function reset() {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  const pct = Math.round(scale * 100)

  return createPortal(
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[500] flex flex-col" onClick={onClose}>
      {/* Toolbar slot */}
      {toolbar && (
        <div onClick={e => e.stopPropagation()}>
          {toolbar}
        </div>
      )}

      {/* Image area */}
      <div
        className="flex-1 flex items-center justify-center relative min-h-0 overflow-hidden select-none"
        style={{ cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={e => { if (scale <= 1) onClose(); else e.stopPropagation() }}
      >
        <img
          src={src}
          alt={alt ?? ''}
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center',
            transition: dragging ? 'none' : 'transform 0.12s ease',
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            userSelect: 'none',
          }}
          onClick={e => e.stopPropagation()}
        />

        {/* Prev/next arrows */}
        {onPrev && (
          <button onClick={e => { e.stopPropagation(); onPrev() }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white text-xl transition-colors z-10">
            ‹
          </button>
        )}
        {onNext && (
          <button onClick={e => { e.stopPropagation(); onNext() }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white text-xl transition-colors z-10">
            ›
          </button>
        )}
      </div>

      {/* Bottom bar: zoom controls + counter */}
      <div className="flex items-center justify-center gap-2 py-2.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
        <button onClick={() => zoom(-0.5)} disabled={scale <= 1}
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 transition-colors text-sm font-bold">
          −
        </button>
        <span className="text-white/50 text-xs w-12 text-center tabular-nums">{pct}%</span>
        <button onClick={() => zoom(0.5)} disabled={scale >= 8}
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 transition-colors text-sm font-bold">
          +
        </button>
        {scale !== 1 && (
          <button onClick={reset}
            className="px-2 py-1 text-[11px] text-white/50 hover:text-white border border-white/20 rounded-lg hover:bg-white/10 transition-colors ml-1">
            Restablecer
          </button>
        )}
        {counter && <span className="text-white/30 text-xs ml-4">{counter}</span>}
        {!toolbar && (
          <button onClick={onClose}
            className="absolute right-4 top-4 w-8 h-8 flex items-center justify-center rounded-full bg-black/60 hover:bg-white/20 text-white transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}
