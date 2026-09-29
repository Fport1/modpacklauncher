import { useEffect, useRef, useState } from 'react'
import { esDescargaRiesgosa, extensionDe, fmtBytes, type Attachment } from '../../lib/chat/files'

// ── Visor de imágenes ───────────────────────────────────────────────────────

export function Lightbox({ src, alt, protectedView, onClose }: { src: string; alt?: string; protectedView?: boolean; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[3000] bg-black/90 flex items-center justify-center chat-fade" onClick={onClose}
      onContextMenu={protectedView ? (e) => e.preventDefault() : undefined}>
      <img src={src} alt={alt ?? ''} draggable={!protectedView}
        className={`max-w-[92vw] max-h-[88vh] rounded-lg shadow-2xl chat-zoom ${protectedView ? 'select-none pointer-events-none' : ''}`}
        onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-12 right-5 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl">✕</button>
      {protectedView && <p className="absolute bottom-6 text-xs text-white/60">Foto de ver una vez · ya no se podrá volver a abrir</p>}
      {!protectedView && (
        <button onClick={(e) => { e.stopPropagation(); window.api.social.saveFile(src, alt || 'imagen').catch(() => {}) }}
          className="absolute bottom-6 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm">Guardar</button>
      )}
    </div>
  )
}

// ── Audio ───────────────────────────────────────────────────────────────────

function fmtSecs(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export function AudioMessage({ src, mine, onEnded }: { src: string; mine: boolean; onEnded?: () => void }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [rate, setRate] = useState(1)
  // Barras fijas por audio (no es la onda real, solo decoración estable)
  const [bars] = useState(() => Array.from({ length: 32 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 1.7 + src.length)) * 0.75))

  function toggle(): void {
    const a = ref.current
    if (!a) return
    if (a.paused) a.play().catch(() => {}); else a.pause()
  }
  function seek(e: React.MouseEvent<HTMLDivElement>): void {
    const a = ref.current
    if (!a || !dur) return
    const r = e.currentTarget.getBoundingClientRect()
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur
  }
  const pct = dur ? time / dur : 0

  return (
    <div className="flex items-center gap-2.5 min-w-[240px] py-1">
      <audio ref={ref} src={src} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setTime(0); onEnded?.() }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          // Los webm grabados en el navegador no traen duración hasta leerlos enteros
          const a = e.currentTarget
          if (Number.isFinite(a.duration)) setDur(a.duration)
          else { a.currentTime = 1e9; a.ontimeupdate = () => { a.ontimeupdate = null; setDur(a.duration); a.currentTime = 0 } }
        }} />
      <button onClick={toggle} className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-transform hover:scale-105 ${mine ? 'bg-white/20' : 'bg-[#7c3aed]'} text-white`}>
        {playing
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[2px] h-7 cursor-pointer" onClick={seek}>
          {bars.map((h, i) => (
            <span key={i} className="flex-1 rounded-full transition-colors"
              style={{ height: `${h * 100}%`, background: i / bars.length <= pct ? (mine ? '#fff' : '#a855f7') : (mine ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.2)') }} />
          ))}
        </div>
        <div className="flex justify-between text-[10px] opacity-70 mt-0.5">
          <span>{fmtSecs(playing || time ? time : dur)}</span>
          <button onClick={() => { const r = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(r); if (ref.current) ref.current.playbackRate = r }}
            className="px-1.5 rounded bg-white/10 hover:bg-white/20 font-semibold">{rate}x</button>
        </div>
      </div>
    </div>
  )
}

// ── Archivo ─────────────────────────────────────────────────────────────────

export function FileAttachment({ att, mine }: { att: Attachment; mine: boolean }) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const ext = extensionDe(att.name ?? '').toUpperCase() || 'ARCHIVO'
  async function save(): Promise<void> {
    if (!att.url) return
    if (esDescargaRiesgosa(att.name ?? '') && !confirm(`"${att.name}" es un archivo comprimido o web: ábrelo solo si confías en quien te lo envió. ¿Descargar?`)) return
    setState('saving')
    try { setState((await window.api.social.saveFile(att.url, att.name ?? 'archivo')) ? 'done' : 'idle') }
    catch { setState('error') }
  }
  return (
    <button onClick={save} disabled={!att.url || state === 'saving'}
      className={`flex items-center gap-3 min-w-[220px] p-2.5 rounded-xl text-left transition-colors ${mine ? 'bg-white/10 hover:bg-white/15' : 'bg-black/20 hover:bg-black/30'}`}>
      <div className="w-10 h-11 shrink-0 rounded-lg bg-[#7c3aed]/30 flex items-center justify-center text-[10px] font-bold text-[#e9d5ff]">{ext.slice(0, 4)}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{att.name ?? 'Archivo'}</p>
        <p className="text-[11px] opacity-60">
          {!att.url ? 'Cargando…' : state === 'saving' ? 'Descargando…' : state === 'done' ? 'Guardado ✓' : state === 'error' ? 'No se pudo descargar' : `${fmtBytes(att.size)} · Descargar`}
        </p>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60 shrink-0"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
    </button>
  )
}
