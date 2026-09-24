import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { typingIn } from './shared'

// Marco común de todo lo que se abre dentro de un cuadro de Servidores (texto,
// NBT, server.properties, equipos, jugadores, imágenes): la cabecera con
// "volver a la carpeta", el botón de guardar, Ctrl+S, y la pregunta antes de
// salir con cambios sin guardar.
//
// Va dentro del cuadro y no en una ventana encima: así se ve a la vez lo que
// hay en el otro cuadro.

/** Pedir salir del editor; `then` se ejecuta si se sale (tras guardar o descartar). */
export type CloseRequest = (then?: () => void) => void

interface Props {
  title: string
  subtitle?: string
  hint?: ReactNode
  dirty?: boolean
  /** Sin esto no hay botón de guardar (visor de imágenes). */
  onSave?: () => Promise<boolean>
  saving?: boolean
  onClose: () => void
  closeRef?: MutableRefObject<CloseRequest | null>
  /** Botones propios de cada editor, a la izquierda de Guardar. */
  headerExtra?: ReactNode
  banner?: ReactNode
  status?: { kind: 'ok' | 'error'; text: string } | null
  /** Teclas propias del editor, solo con el foco dentro. */
  onKeyDown?: (e: React.KeyboardEvent) => void
  /** Estilo oscuro del editor de código (Monaco). */
  code?: boolean
  children: ReactNode
}

export default function EditorShell({
  title, subtitle, hint, dirty = false, onSave, saving, onClose, closeRef,
  headerExtra, banner, status, onKeyDown, code, children
}: Props) {
  const [ask, setAsk] = useState<{ then: () => void } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  function requestClose(then: () => void = onClose): void {
    if (dirty) setAsk({ then })
    else then()
  }
  if (closeRef) closeRef.current = requestClose

  // Coger el foco al abrirse: Ctrl+S y las teclas del editor funcionan sin clic previo
  useEffect(() => { if (!rootRef.current?.contains(document.activeElement)) rootRef.current?.focus() }, [])

  return (
    <div ref={rootRef} tabIndex={-1}
      onKeyDownCapture={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          e.stopPropagation()
          if (onSave && dirty && !saving) onSave()
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !typingIn(e.target)) { e.preventDefault(); requestClose(); return }
        onKeyDown?.(e)
      }}
      className={`relative flex-1 flex flex-col min-h-0 outline-none ${code ? 'bg-[#1e1e1e]' : ''}`}>
      {/* Cabecera */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${code ? 'border-black/40 bg-[#252526]' : 'border-border bg-bg-secondary'}`}>
        <button type="button" onClick={() => requestClose()} title="Volver a la carpeta (Esc)"
          className="shrink-0 flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary hover:border-accent/50">
          ← <span className="hidden md:inline">Carpeta</span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary truncate flex items-center gap-2">
            <span className="truncate">{title}</span>
            {dirty && <span className="shrink-0 text-[11px] font-normal text-amber-400">● sin guardar</span>}
            {hint}
          </p>
          {subtitle && <p className="text-[11px] text-text-muted font-mono truncate">{subtitle}</p>}
        </div>
        {headerExtra}
        {onSave && (
          <button type="button" onClick={() => onSave()} disabled={!dirty || saving} title="Guardar (Ctrl+S)"
            className="shrink-0 h-8 px-4 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-40">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>

      {banner}
      <div className="flex-1 flex flex-col min-h-0">{children}</div>
      {status && (
        <p className={`px-3 py-1.5 text-xs border-t border-border ${status.kind === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{status.text}</p>
      )}

      {ask && (
        <div className="absolute inset-0 z-20 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-bg-secondary border border-border rounded-xl p-5 shadow-2xl">
            <p className="text-sm font-semibold text-text-primary">Hay cambios sin guardar</p>
            <p className="text-sm text-text-muted mt-1">Si sales ahora se pierden los cambios en {title}.</p>
            <div className="flex justify-end gap-2 mt-4 flex-wrap">
              <button type="button" onClick={() => setAsk(null)}
                className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary">Seguir editando</button>
              <button type="button" onClick={() => { const t = ask.then; setAsk(null); t() }}
                className="px-3 py-1.5 text-sm rounded-md border border-border text-text-secondary hover:text-red-400">Descartar</button>
              {onSave && (
                <button type="button" onClick={async () => { const t = ask.then; setAsk(null); if (await onSave()) t() }}
                  className="px-3 py-1.5 text-sm rounded-md bg-accent text-white">Guardar y salir</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Guardado con estado de "guardando" y mensaje, común a todos los editores.
 * Devuelve true si quedó guardado.
 */
export function useSaver(save: () => Promise<void>, okText = 'Guardado') {
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const busy = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  async function run(): Promise<boolean> {
    if (busy.current) return false
    busy.current = true
    setSaving(true)
    setStatus(null)
    try {
      await save()
      setStatus({ kind: 'ok', text: okText })
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setStatus(null), 4000)
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus({ kind: 'error', text: `No se pudo guardar: ${msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}` })
      return false
    } finally {
      busy.current = false
      setSaving(false)
    }
  }
  return { run, saving, status, setStatus }
}
