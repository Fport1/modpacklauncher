import { useEffect, useRef, useState } from 'react'
import { MC_COLORS, MC_STYLES, CLICK_ACTIONS, colorHex, parseCodes, type McSegment, type RichText, type ClickAction } from '../../lib/mcText'

// Campo para escribir texto con formato de Minecraft (&5&l[VIP]) con botones
// de colores y estilos, y cómo queda en el juego debajo. Pensado para quien no
// se sabe los códigos de memoria: con los botones basta.

/** Cómo se ve un texto con formato, con los colores del juego. */
export function McTextPreview({ segments, className = '', empty }: { segments: McSegment[]; className?: string; empty?: string }) {
  if (segments.length === 0 && empty) return <span className={`text-text-muted italic ${className}`}>{empty}</span>
  return (
    <span className={`font-mono whitespace-pre ${className}`} style={{ textShadow: '2px 2px 0 rgba(0,0,0,0.45)' }}>
      {segments.map((s, i) => (
        <span key={i}
          style={{
            color: colorHex(s.color) ?? '#FFFFFF',
            fontWeight: s.bold ? 700 : undefined,
            fontStyle: s.italic ? 'italic' : undefined,
            textDecoration: [s.underlined && 'underline', s.strikethrough && 'line-through'].filter(Boolean).join(' ') || undefined,
            opacity: s.obfuscated ? 0.6 : undefined
          }}>
          {s.obfuscated ? s.text.replace(/\S/g, '▒') : s.text}
        </span>
      ))}
    </span>
  )
}

interface Props {
  value: string
  onChange: (codes: string) => void
  placeholder?: string
  /** Texto de ejemplo detrás de la vista previa (p. ej. el nombre de un jugador para un prefijo). */
  previewAfter?: McSegment[]
  previewBefore?: McSegment[]
  compact?: boolean
  /** Varias líneas (el MOTD tiene dos). */
  multiline?: boolean
  /** Texto del cartelito al pasar el ratón por la vista previa. */
  hoverPreview?: string
}

export default function McTextInput({ value: external, onChange: emit, placeholder, previewAfter, previewBefore, compact, multiline, hoverPreview }: Props) {
  const [hovering, setHovering] = useState(false)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  // Lo que se escribe se guarda como JSON y se vuelve a leer: un "&5" todavía
  // sin texto detrás desaparecería a mitad de escribirlo. Mientras el campo
  // tiene el foco manda lo escrito; fuera de él, lo guardado (p. ej. al deshacer).
  const [draft, setDraft] = useState(external)
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setDraft(external) }, [external, focused])
  const value = focused ? draft : external
  const onChange = (v: string): void => { setDraft(v); emit(v) }

  /** Mete el código donde está el cursor (o delante de lo seleccionado). */
  function insert(code: string): void {
    const el = ref.current
    setFocused(true)
    if (!el) { onChange(value + code); return }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    // Con texto seleccionado: se le aplica el formato y se vuelve a lo de antes al final
    const selected = value.slice(start, end)
    const next = selected
      ? value.slice(0, start) + code + selected + '&r' + value.slice(end)
      : value.slice(0, start) + code + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + code.length + selected.length
      el.setSelectionRange(pos, pos)
    })
  }

  const segments = parseCodes(value)
  const inputCls = 'w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary font-mono outline-none focus:border-accent/60'

  return (
    <div className="space-y-1.5">
      {multiline ? (
        <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2}
          onFocus={() => { if (!focused) setDraft(external); setFocused(true) }} onBlur={() => setFocused(false)}
          className={`${inputCls} resize-none`} />
      ) : (
        <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls}
          onFocus={() => { if (!focused) setDraft(external); setFocused(true) }} onBlur={() => setFocused(false)} />
      )}
      {/* Sin quitar el foco al campo: el código va donde estaba el cursor */}
      <div className="flex items-center gap-1 flex-wrap" onMouseDown={(e) => e.preventDefault()}>
        {MC_COLORS.map((c) => (
          <button key={c.code} type="button" title={`${c.label} (&${c.code})`} onClick={() => insert(`&${c.code}`)}
            className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} rounded border border-black/40 hover:scale-110 transition-transform`}
            style={{ background: c.hex }} />
        ))}
        <span className="w-px h-4 bg-border mx-1" />
        {MC_STYLES.map((s) => (
          <button key={s.code} type="button" title={`${s.label} (&${s.code})`} onClick={() => insert(`&${s.code}`)}
            className="h-5 min-w-[20px] px-1 rounded border border-border text-[11px] text-text-secondary hover:text-text-primary hover:border-accent/50"
            style={{
              fontWeight: s.code === 'l' ? 700 : undefined,
              fontStyle: s.code === 'o' ? 'italic' : undefined,
              textDecoration: s.code === 'n' ? 'underline' : s.code === 'm' ? 'line-through' : undefined
            }}>
            {s.code === 'k' ? '▒' : 'A'}
          </button>
        ))}
        <button type="button" title="Quitar formato a partir de aquí (&r)" onClick={() => insert('&r')}
          className="h-5 px-1.5 rounded border border-border text-[11px] text-text-muted hover:text-text-primary">↺</button>
      </div>
      <div className="relative">
        <div className="px-3 py-1.5 rounded-lg bg-[#1d1d24] border border-black/40 min-h-[30px] flex items-center overflow-x-auto"
          title={hoverPreview ? undefined : 'Así se ve en el juego'}
          onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
          <McTextPreview segments={[...(previewBefore ?? []), ...segments, ...(previewAfter ?? [])]} empty="(vacío)" className="text-sm" />
        </div>
        {hoverPreview && hovering && <div className="absolute left-4 top-full mt-1 z-20 pointer-events-none"><McTooltip codes={hoverPreview} /></div>}
      </div>
    </div>
  )
}

/**
 * Texto con formato y, opcionalmente, lo que pasa al poner el ratón encima
 * (un cartelito con más texto) y al hacer clic (abrir un enlace, ejecutar o
 * sugerir un comando, copiar algo). Funciona en el chat y en los nombres.
 */
export function RichTextInput({ value, onChange, placeholder, previewBefore, previewAfter, compact }: {
  value: RichText
  onChange: (v: RichText) => void
  placeholder?: string
  previewBefore?: McSegment[]
  previewAfter?: McSegment[]
  compact?: boolean
}) {
  const [showHover, setShowHover] = useState(!!value.hover)
  const [showClick, setShowClick] = useState(!!value.click)
  const set = (patch: Partial<RichText>): void => onChange({ ...value, ...patch, lossy: undefined })
  const action = CLICK_ACTIONS.find((a) => a.id === value.click?.action) ?? CLICK_ACTIONS[0]

  return (
    <div className="space-y-2">
      {value.lossy && (
        <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-2 py-1">
          Este texto usa cosas que el modo sencillo no conserva ({value.lossy.join(', ')}). Si lo cambias aquí se simplificará; para mantenerlo, edítalo en modo avanzado.
        </p>
      )}
      <McTextInput value={value.codes} onChange={(codes) => set({ codes })} placeholder={placeholder}
        previewBefore={previewBefore} previewAfter={previewAfter} compact={compact}
        hoverPreview={value.hover} />

      <div className="flex gap-1.5 flex-wrap">
        <button type="button" onClick={() => { if (showHover) set({ hover: undefined }); setShowHover(!showHover) }}
          className={`px-2 py-0.5 rounded-md border text-[11px] ${showHover ? 'border-accent/60 text-accent bg-accent/10' : 'border-border text-text-muted hover:text-text-primary'}`}>
          {showHover ? '✕ Quitar' : '＋'} texto al pasar el ratón
        </button>
        <button type="button" onClick={() => { if (showClick) set({ click: undefined }); setShowClick(!showClick) }}
          className={`px-2 py-0.5 rounded-md border text-[11px] ${showClick ? 'border-accent/60 text-accent bg-accent/10' : 'border-border text-text-muted hover:text-text-primary'}`}>
          {showClick ? '✕ Quitar' : '＋'} acción al hacer clic
        </button>
      </div>

      {showHover && (
        <div className="pl-3 border-l-2 border-accent/30 space-y-1">
          <p className="text-[11px] text-text-muted">Sale en un cartelito al poner el ratón encima (en el chat, o en la lista con Tab):</p>
          <McTextInput multiline compact value={value.hover ?? ''} onChange={(hover) => set({ hover })} placeholder="&7Rango VIP&r\n&eApoya al servidor en la tienda" />
        </div>
      )}
      {showClick && (
        <div className="pl-3 border-l-2 border-accent/30 flex gap-2 flex-wrap items-center">
          <select value={action.id} onChange={(e) => set({ click: { action: e.target.value as ClickAction, value: value.click?.value ?? '' } })}
            className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary">
            {CLICK_ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <input value={value.click?.value ?? ''} placeholder={action.hint}
            onChange={(e) => set({ click: { action: action.id, value: e.target.value } })}
            className="flex-1 min-w-[140px] bg-bg-primary border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary font-mono outline-none focus:border-accent/60" />
        </div>
      )}
    </div>
  )
}

/** El cartelito de Minecraft al pasar el ratón: fondo oscuro con borde morado. */
export function McTooltip({ codes }: { codes: string }) {
  return (
    <div className="px-2 py-1.5 rounded-sm text-sm leading-snug whitespace-pre"
      style={{ background: 'rgba(16,0,16,0.94)', border: '2px solid #2a0a5e', boxShadow: 'inset 0 0 0 1px #5000c8' }}>
      {codes.split('\n').map((line, i) => <div key={i}><McTextPreview segments={parseCodes(line)} empty=" " /></div>)}
    </div>
  )
}
