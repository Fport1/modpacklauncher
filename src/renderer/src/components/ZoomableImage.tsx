import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  src: string
  alt?: string
  onClose: () => void
  toolbar?: React.ReactNode
  footer?: React.ReactNode
  onPrev?: () => void
  onNext?: () => void
  counter?: string
}

export default function ZoomableImage({ src, alt, onClose, toolbar, footer, onPrev, onNext, counter }: Props) {
  const [scale, setScale]       = useState(1)
  const [offset, setOffset]     = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [imgCtx, setImgCtx]     = useState<{ x: number; y: number } | null>(null)
  const isDragging  = useRef(false)
  const dragStart   = useRef({ mx: 0, my: 0, ox: 0, oy: 0 })

  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [src])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setImgCtx(null); onClose() }
      if (e.key === 'ArrowLeft')  { reset(); onPrev?.() }
      if (e.key === 'ArrowRight') { reset(); onNext?.() }
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

  const ctxItems: { label: string; icon: React.ReactNode; action: () => void }[] = [
    {
      label: 'Copiar imagen',
      icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
      action: async () => {
        try {
          const res = await fetch(src)
          const blob = await res.blob()
          await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
        } catch {}
        setImgCtx(null)
      }
    },
    {
      label: 'Guardar imagen',
      icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>,
      action: () => {
        const a = document.createElement('a')
        a.href = src
        a.download = src.split('/').pop()?.split('?')[0] ?? 'image.png'
        a.click()
        setImgCtx(null)
      }
    },
    {
      label: 'Copiar dirección',
      icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>,
      action: () => { navigator.clipboard.writeText(src); setImgCtx(null) }
    },
  ]

  const pct = Math.round(scale * 100)

  return createPortal(
    <>
      {/* Overlay — starts below TitleBar (top-9 = 36px) */}
      <div
        className="fixed top-9 right-0 bottom-0 left-0 bg-black z-[500] flex flex-col"
        onClick={onClose}
      >
        {toolbar && (
          <div onClick={e => e.stopPropagation()}>{toolbar}</div>
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
              maxWidth: '90%',
              maxHeight: '90%',
              objectFit: 'contain',
              userSelect: 'none',
            }}
            onClick={e => e.stopPropagation()}
            onContextMenu={e => {
              e.preventDefault()
              e.stopPropagation()
              setImgCtx({ x: e.clientX, y: e.clientY })
            }}
          />

          {/* Prev */}
          {onPrev && (
            <button
              onClick={e => { e.stopPropagation(); reset(); onPrev() }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
          )}
          {/* Next */}
          {onNext && (
            <button
              onClick={e => { e.stopPropagation(); reset(); onNext() }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          )}
        </div>

        {/* Footer (title/description below image) */}
        {footer && (
          <div className="text-center flex-shrink-0 pb-1 px-8" onClick={e => e.stopPropagation()}>
            {footer}
          </div>
        )}

        {/* Bottom bar */}
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
              className="absolute right-4 top-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Right-click context menu */}
      {imgCtx && (
        <div
          className="fixed inset-0 z-[600]"
          onClick={() => setImgCtx(null)}
          onContextMenu={e => { e.preventDefault(); setImgCtx(null) }}
        >
          <div
            className="absolute bg-bg-secondary border border-border rounded-lg shadow-2xl py-1 min-w-[180px]"
            style={{ left: imgCtx.x, top: imgCtx.y }}
            onClick={e => e.stopPropagation()}
          >
            {ctxItems.map(item => (
              <button
                key={item.label}
                onClick={item.action}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-left"
              >
                <span className="text-text-muted flex-shrink-0">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>,
    document.body
  )
}
