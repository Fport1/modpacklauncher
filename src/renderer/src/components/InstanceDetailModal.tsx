import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useStore } from '../store'
import type { Instance } from '../../../shared/types'

type Tab = 'mods' | 'worlds' | 'resourcepacks' | 'shaderpacks' | 'screenshots' | 'console' | 'options'
type SortKey = 'name-asc' | 'name-desc' | 'size-asc' | 'size-desc' | 'date-asc' | 'date-desc'

interface ModMeta { name?: string; author?: string; iconBase64?: string }
interface ModFile { filename: string; size: number; enabled: boolean; date: number; meta?: ModMeta }
interface WorldFolder { name: string; lastPlayed?: number; iconBase64?: string }
interface ScreenshotFile { filename: string; filePath: string; date: number; size: number }
interface CrashReport { filename: string; date: number }

// ─── helpers ────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function formatDate(ms?: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString()
}
function mediaUrl(filePath: string): string {
  return 'media:///' + filePath.replace(/\\/g, '/')
}
function displayName(filename: string): string {
  return filename.endsWith('.disabled') ? filename.slice(0, -'.disabled'.length) : filename
}

// ─── sub-components ─────────────────────────────────────────────────────────

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative flex-1 min-w-0">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="Buscar..."
        className="w-full pl-7 pr-3 py-1.5 text-xs bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent" />
    </div>
  )
}

function SortSelect({ value, onChange, withDate }: {
  value: SortKey; onChange: (v: SortKey) => void; withDate?: boolean
}) {
  const opts: { key: SortKey; label: string }[] = [
    { key: 'name-asc',  label: 'Nombre A–Z' },
    { key: 'name-desc', label: 'Nombre Z–A' },
    { key: 'size-asc',  label: 'Tamaño ↑' },
    { key: 'size-desc', label: 'Tamaño ↓' },
    ...(withDate ? [
      { key: 'date-asc'  as SortKey, label: 'Fecha ↑' },
      { key: 'date-desc' as SortKey, label: 'Fecha ↓' },
    ] : [])
  ]
  return (
    <select value={value} onChange={e => onChange(e.target.value as SortKey)}
      className="text-xs bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-text-secondary focus:outline-none flex-shrink-0">
      {opts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  )
}

function EnabledFilter({ value, onChange }: {
  value: 'all' | 'active' | 'inactive'
  onChange: (v: 'all' | 'active' | 'inactive') => void
}) {
  const opts: { key: 'all' | 'active' | 'inactive'; label: string }[] = [
    { key: 'all', label: 'Todos' },
    { key: 'active', label: 'Activos' },
    { key: 'inactive', label: 'Inactivos' },
  ]
  return (
    <div className="flex rounded-lg border border-border overflow-hidden flex-shrink-0">
      {opts.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)}
          className={`px-2 py-1.5 text-xs transition-colors ${value === o.key ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary bg-bg-primary'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function FolderBtn({ onClick, label = 'Abrir carpeta' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} title={label}
      className="flex items-center gap-1 text-xs text-text-muted hover:text-accent transition-colors flex-shrink-0 px-2 py-1.5 border border-border rounded-lg hover:border-accent/50">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
      {label}
    </button>
  )
}

function GameLockedBanner() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-400 flex-shrink-0">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
      El juego está en ejecución. Ciérralo antes de modificar estos archivos.
    </div>
  )
}

function ConfirmDialog({ title, message, confirmLabel = 'Eliminar', onConfirm, onCancel }: {
  title: string; message: string; confirmLabel?: string
  onConfirm: () => void; onCancel: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCancel])
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70]" onClick={onCancel}>
      <div className="bg-bg-secondary border border-border rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-text-primary mb-1.5">{title}</h3>
        <p className="text-sm text-text-secondary mb-5">{message}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-4 py-1.5 text-sm text-text-secondary border border-border rounded-lg hover:bg-bg-hover transition-colors">
            Cancelar
          </button>
          <button onClick={onConfirm}
            className="px-4 py-1.5 text-sm text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function CtxMenu({ x, y, items, onClose }: {
  x: number; y: number
  items: { label: string; danger?: boolean; action: () => void }[]
  onClose: () => void
}) {
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('click', close, true)
    window.addEventListener('contextmenu', close, true)
    return () => { window.removeEventListener('click', close, true); window.removeEventListener('contextmenu', close, true) }
  }, [onClose])
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useEffect(() => {
    if (!menuRef.current) return
    const { offsetWidth: w, offsetHeight: h } = menuRef.current
    const vw = window.innerWidth, vh = window.innerHeight
    setPos({ left: x + w > vw ? vw - w - 4 : x, top: y + h > vh ? vh - h - 4 : y })
  }, [x, y])
  return (
    <div ref={menuRef} className="fixed bg-bg-card border border-border rounded-xl shadow-2xl py-1 z-[80] min-w-40"
      style={{ left: pos.left, top: pos.top }} onClick={e => e.stopPropagation()}>
      {items.map((item, i) => (
        <button key={i} onClick={() => { item.action(); onClose() }}
          className={`w-full text-left px-3 py-2 text-xs transition-colors ${item.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}>
          {item.label}
        </button>
      ))}
    </div>
  )
}

function Lightbox({ screenshots, index, onClose, onChange, onDelete }: {
  screenshots: ScreenshotFile[]
  index: number
  onClose: () => void
  onChange: (i: number) => void
  onDelete: (s: ScreenshotFile) => void
}) {
  const s = screenshots[index]
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onChange(index - 1)
      if (e.key === 'ArrowRight' && index < screenshots.length - 1) onChange(index + 1)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [index, screenshots.length, onClose, onChange])

  async function copyImage() {
    await window.api.clipboard.writeImagePath(s.filePath)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="fixed inset-0 bg-black/96 z-[60] flex flex-col" onClick={onClose}>
      {/* toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 bg-black/60 flex-shrink-0 border-b border-white/10"
        onClick={e => e.stopPropagation()}>
        <p className="text-white text-sm truncate flex-1">{s.filename}</p>
        <span className="text-white/40 text-xs flex-shrink-0">{formatDate(s.date)} · {formatSize(s.size)}</span>
        <button onClick={copyImage}
          className="px-3 py-1.5 text-xs text-white/70 hover:text-white border border-white/20 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0">
          {copied ? '¡Copiado!' : 'Copiar imagen'}
        </button>
        <button onClick={() => window.api.clipboard.writeText(s.filePath)}
          className="px-3 py-1.5 text-xs text-white/70 hover:text-white border border-white/20 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0">
          Copiar ruta
        </button>
        <button onClick={() => onDelete(s)}
          className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors flex-shrink-0">
          Eliminar
        </button>
        <button onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-white/20 text-white/50 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {/* image */}
      <div className="flex-1 flex items-center justify-center relative min-h-0 p-4" onClick={onClose}>
        <img src={mediaUrl(s.filePath)} alt={s.filename}
          className="max-w-full max-h-full object-contain rounded select-none"
          onClick={e => e.stopPropagation()} />
        {index > 0 && (
          <button onClick={e => { e.stopPropagation(); onChange(index - 1) }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white text-lg transition-colors">
            ‹
          </button>
        )}
        {index < screenshots.length - 1 && (
          <button onClick={e => { e.stopPropagation(); onChange(index + 1) }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white text-lg transition-colors">
            ›
          </button>
        )}
      </div>
      {/* filmstrip counter */}
      <p className="text-center text-xs text-white/30 pb-3 flex-shrink-0">
        {index + 1} / {screenshots.length}
      </p>
    </div>
  )
}

// ─── Options UI ─────────────────────────────────────────────────────────────

type OptionType =
  | { kind: 'bool' }
  | { kind: 'slider'; min: number; max: number; step: number; display?: (v: number) => string; store?: (v: number) => string; load?: (raw: string) => number }
  | { kind: 'audio' }
  | { kind: 'text'; placeholder?: string; hint?: string }

interface OptionDef { label: string; type: OptionType }

function fovLoad(raw: string): number {
  const n = parseFloat(raw)
  if (Math.abs(n) <= 1.5) return Math.round(n * 40 + 70)
  return Math.round(n)
}
function fovStore(v: number): string { return String(v) }

const WHITELIST: Record<string, OptionDef> = {
  ao:                    { label: 'Smooth Lighting',     type: { kind: 'bool' } },
  fullscreen:            { label: 'Pantalla completa',   type: { kind: 'bool' } },
  fullscreenResolution:  { label: 'Resolución pantalla completa', type: { kind: 'text', placeholder: '1920x1080@144:24', hint: 'Formato: ANCHOxALTO@HZ:bits — ej. 1920x1080@144:24' } },
  fov:                   { label: 'FOV', type: { kind: 'slider', min: 30, max: 110, step: 1, display: v => `${v}°`, store: fovStore, load: fovLoad } },
  gamma:                 { label: 'Brillo',              type: { kind: 'slider', min: 0, max: 100, step: 1, display: v => `${v}%`, store: v => (v / 100).toFixed(2), load: r => Math.round(parseFloat(r) * 100) } },
  maxFps:                { label: 'Max FPS',             type: { kind: 'slider', min: 10, max: 260, step: 10, display: v => v >= 260 ? 'Sin límite' : `${v} fps` } },
  renderDistance:        { label: 'Render Distance',     type: { kind: 'slider', min: 2, max: 32, step: 1, display: v => `${v} chunks` } },
  simulationDistance:    { label: 'Simulation Distance', type: { kind: 'slider', min: 2, max: 32, step: 1, display: v => `${v} chunks` } },
  soundCategory_master:  { label: 'Volumen master',      type: { kind: 'audio' } },
  soundCategory_music:   { label: 'Música',              type: { kind: 'audio' } },
  soundCategory_record:  { label: 'Jukeboxes',           type: { kind: 'audio' } },
  soundCategory_weather: { label: 'Clima',               type: { kind: 'audio' } },
  soundCategory_block:   { label: 'Bloques',             type: { kind: 'audio' } },
  soundCategory_hostile: { label: 'Mobs hostiles',       type: { kind: 'audio' } },
  soundCategory_neutral: { label: 'Mobs neutros',        type: { kind: 'audio' } },
  soundCategory_player:  { label: 'Jugador',             type: { kind: 'audio' } },
  soundCategory_ambient: { label: 'Ambiente',            type: { kind: 'audio' } },
  soundCategory_voice:   { label: 'Voces',               type: { kind: 'audio' } },
}

function OptionSlider({ label, rawValue, def, onUpdate, disabled, hzHint }: {
  label: string; rawValue: string; def: Extract<OptionDef['type'], { kind: 'slider' | 'audio' }>
  onUpdate: (raw: string) => void; disabled: boolean; hzHint?: number
}) {
  const min = def.kind === 'audio' ? 0 : def.min
  const max = def.kind === 'audio' ? 100 : def.max
  const step = def.kind === 'audio' ? 1 : def.step
  const load = def.kind !== 'audio' && def.load ? def.load : (r: string) => def.kind === 'audio' ? Math.round(parseFloat(r) * 100) : parseFloat(r)
  const store = def.kind !== 'audio' && def.store ? def.store : (v: number) => def.kind === 'audio' ? (v / 100).toFixed(2) : String(v)
  const displayFn = def.kind !== 'audio' && def.display ? def.display : (v: number) => `${v}%`

  const displayVal = isNaN(parseFloat(rawValue)) ? min : load(rawValue)
  const pct = Math.max(0, Math.min(100, ((displayVal - min) / (max - min)) * 100))

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <p className="text-sm text-text-primary">{label}</p>
          {hzHint !== undefined && hzHint > 0 && (
            <span className="text-xs text-text-muted">· pantalla {hzHint} Hz</span>
          )}
        </div>
        <input type="range" min={min} max={max} step={step}
          value={isNaN(displayVal) ? min : displayVal}
          disabled={disabled}
          onChange={e => onUpdate(store(parseInt(e.target.value)))}
          className="ram-slider w-full disabled:opacity-40"
          style={{ background: `linear-gradient(to right, #22c55e ${pct}%, #334155 ${pct}%)` }}
        />
      </div>
      <span className="text-xs text-accent font-medium w-20 text-right flex-shrink-0">{displayFn(isNaN(displayVal) ? min : displayVal)}</span>
    </div>
  )
}

function OptionBool({ label, rawValue, onUpdate, disabled }: {
  label: string; rawValue: string; onUpdate: (v: string) => void; disabled: boolean
}) {
  const on = rawValue.trim() === 'true'
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <p className="flex-1 text-sm text-text-primary">{label}</p>
      <button disabled={disabled}
        onClick={() => onUpdate(on ? 'false' : 'true')}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-40 ${on ? 'bg-accent' : 'bg-border'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}

function OptionText({ label, rawValue, def, onUpdate, disabled }: {
  label: string; rawValue: string; def: Extract<OptionDef['type'], { kind: 'text' }>
  onUpdate: (v: string) => void; disabled: boolean
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-sm text-text-primary mb-1.5">{label}</p>
      <input
        type="text"
        value={rawValue}
        onChange={e => onUpdate(e.target.value)}
        disabled={disabled}
        placeholder={def.placeholder}
        className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent disabled:opacity-40"
      />
      {def.hint && <p className="text-xs text-text-muted mt-1">{def.hint}</p>}
    </div>
  )
}

function OptionsEditor({ content, onChange, disabled, displayHz }: {
  content: string; onChange: (s: string) => void; disabled: boolean; displayHz?: number
}) {
  const entries = useMemo(() => {
    return content.split('\n').map(line => {
      const idx = line.indexOf(':')
      if (idx === -1) return null
      return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() }
    }).filter((e): e is { key: string; value: string } => e !== null && e.key !== '')
  }, [content])

  function update(key: string, value: string) {
    const lines = content.split('\n').map(line => {
      const idx = line.indexOf(':')
      if (idx === -1) return line
      return line.slice(0, idx).trim() === key ? `${key}:${value}` : line
    })
    onChange(lines.join('\n'))
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted text-sm gap-2">
        <p>options.txt vacío</p>
        <p className="text-xs">Se generará al lanzar el juego por primera vez.</p>
      </div>
    )
  }

  const entryMap = Object.fromEntries(entries.map(e => [e.key, e.value]))
  const isFullscreen = entryMap['fullscreen']?.trim() === 'true'
  const baseVideoKeys = ['ao', 'fullscreen', 'fov', 'gamma', 'maxFps', 'renderDistance', 'simulationDistance']
  const videoKeys = isFullscreen
    ? ['ao', 'fullscreen', 'fullscreenResolution', 'fov', 'gamma', 'maxFps', 'renderDistance', 'simulationDistance']
    : baseVideoKeys
  const audioKeys = Object.keys(WHITELIST).filter(k => k.startsWith('soundCategory_'))

  const videoItems = videoKeys.filter(k => k in entryMap || k === 'fullscreenResolution' && isFullscreen)
  const audioItems = audioKeys.filter(k => k in entryMap)

  if (videoItems.length === 0 && audioItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted text-sm gap-2">
        <p>No hay opciones configuradas todavía.</p>
        <p className="text-xs">Lanza el juego una vez para generar options.txt.</p>
      </div>
    )
  }

  function addOrUpdate(key: string, value: string) {
    if (key in entryMap) {
      update(key, value)
    } else {
      onChange(content.trimEnd() + `\n${key}:${value}`)
    }
  }

  function renderOption(key: string) {
    const def = WHITELIST[key]
    const val = entryMap[key] ?? ''
    if (!def) return null
    if (def.type.kind === 'bool') {
      return <OptionBool key={key} label={def.label} rawValue={val} onUpdate={v => update(key, v)} disabled={disabled} />
    }
    if (def.type.kind === 'text') {
      return <OptionText key={key} label={def.label} rawValue={val} def={def.type} onUpdate={v => addOrUpdate(key, v)} disabled={disabled} />
    }
    const sliderDef = def.type as Extract<OptionDef['type'], { kind: 'slider' | 'audio' }>
    return <OptionSlider key={key} label={def.label} rawValue={val} def={sliderDef} onUpdate={v => update(key, v)} disabled={disabled}
      hzHint={key === 'maxFps' ? displayHz : undefined} />
  }

  return (
    <div className="space-y-5">
      {videoItems.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-1">Video</p>
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden divide-y divide-border/40">
            {videoItems.map(renderOption)}
          </div>
        </div>
      )}
      {audioItems.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-1">Audio</p>
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden divide-y divide-border/40">
            {audioItems.map(renderOption)}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Icon helpers ────────────────────────────────────────────────────────────

function BoxIcon({ className }: { className?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`flex-shrink-0 ${className}`}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /></svg>
}
function GlobeIcon({ className }: { className?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`flex-shrink-0 ${className}`}><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>
}
function RpIcon({ className }: { className?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`flex-shrink-0 ${className}`}><rect x="2" y="3" width="20" height="14" rx="2" /></svg>
}
function ShaderIcon({ className }: { className?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`flex-shrink-0 ${className}`}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
}
function TrashIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>
}

// ─── Main component ──────────────────────────────────────────────────────────

interface CtxState { x: number; y: number; items: { label: string; danger?: boolean; action: () => void }[] }
interface ConfirmState { title: string; message: string; onConfirm: () => void }

interface Props { instance: Instance; onClose: () => void }

export default function InstanceDetailModal({ instance, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('mods')
  const [mods, setMods] = useState<ModFile[]>([])
  const [worlds, setWorlds] = useState<WorldFolder[]>([])
  const [resourcepacks, setResourcepacks] = useState<ModFile[]>([])
  const [shaderpacks, setShaderpacks] = useState<ModFile[]>([])
  const [screenshots, setScreenshots] = useState<ScreenshotFile[]>([])
  const [crashes, setCrashes] = useState<CrashReport[]>([])
  const [selectedCrash, setSelectedCrash] = useState<string | null>(null)
  const [crashContent, setCrashContent] = useState('')
  const [latestLog, setLatestLog] = useState('')
  const [consoleView, setConsoleView] = useState<'live' | 'log' | 'crash'>('live')
  const [optionsContent, setOptionsContent] = useState('')
  const [optionsSavedContent, setOptionsSavedContent] = useState('')
  const [optionsSaved, setOptionsSaved] = useState(false)
  const [displayHz, setDisplayHz] = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('name-asc')
  const [filterEnabled, setFilterEnabled] = useState<'all' | 'active' | 'inactive'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const [ctx, setCtx] = useState<CtxState | null>(null)

  const gameLogs = useStore(s => s.gameLogs[instance.id] ?? [])
  const isRunning = useStore(s => s.runningInstances.has(instance.id))
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadTab(tab) }, [tab, instance.id])
  useEffect(() => { setSearch(''); setSort('name-asc'); setFilterEnabled('all'); setSelected(new Set()) }, [tab])
  useEffect(() => {
    if (tab === 'console' && consoleView === 'live' && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [gameLogs, tab, consoleView])

  async function loadTab(t: Tab) {
    setLoading(true)
    try {
      if (t === 'mods') setMods(await window.api.instances.listMods(instance.id))
      else if (t === 'worlds') setWorlds(await window.api.instances.listWorlds(instance.id))
      else if (t === 'resourcepacks') setResourcepacks(await window.api.instances.listResourcepacks(instance.id))
      else if (t === 'shaderpacks') setShaderpacks(await window.api.instances.listShaderpacks(instance.id))
      else if (t === 'screenshots') setScreenshots(await window.api.instances.listScreenshots(instance.id))
      else if (t === 'console') {
        const [log, list] = await Promise.all([
          window.api.instances.readLatestLog(instance.id),
          window.api.instances.listCrashReports(instance.id)
        ])
        setLatestLog(log); setCrashes(list)
      }
      else if (t === 'options') {
        const c = await window.api.instances.readOptions(instance.id)
        setOptionsContent(c); setOptionsSavedContent(c)
        if (displayHz === 0) window.api.system.getDisplayHz().then(setDisplayHz).catch(() => {})
      }
    } finally { setLoading(false) }
  }

  // ── sort/filter helpers ──────────────────────────────────────────────────

  function applySort<T>(items: T[], key: SortKey, g: { name: (i: T) => string; size?: (i: T) => number; date?: (i: T) => number }): T[] {
    return [...items].sort((a, b) => {
      const asc = key.endsWith('-asc')
      const field = key.replace(/-asc$|-desc$/, '')
      if (field === 'size' && g.size) return asc ? (g.size(a) ?? 0) - (g.size(b) ?? 0) : (g.size(b) ?? 0) - (g.size(a) ?? 0)
      if (field === 'date' && g.date) return asc ? (g.date(a) ?? 0) - (g.date(b) ?? 0) : (g.date(b) ?? 0) - (g.date(a) ?? 0)
      const cmp = g.name(a).localeCompare(g.name(b))
      return asc ? cmp : -cmp
    })
  }
  function filtered<T>(items: T[], getName: (i: T) => string): T[] {
    const q = search.trim().toLowerCase()
    return q ? items.filter(i => getName(i).toLowerCase().includes(q)) : items
  }

  function applyEnabledFilter<T extends { enabled: boolean }>(items: T[]): T[] {
    if (filterEnabled === 'active') return items.filter(i => i.enabled)
    if (filterEnabled === 'inactive') return items.filter(i => !i.enabled)
    return items
  }
  const sortedMods = applyEnabledFilter(filtered(applySort(mods, sort, { name: i => i.filename, size: i => i.size, date: i => i.date }), i => i.filename))
  const sortedRps = applyEnabledFilter(filtered(applySort(resourcepacks, sort, { name: i => i.filename, size: i => i.size, date: i => i.date }), i => i.filename))
  const sortedShaders = applyEnabledFilter(filtered(applySort(shaderpacks, sort, { name: i => i.filename, size: i => i.size, date: i => i.date }), i => i.filename))
  const sortedScreenshots = filtered(applySort(screenshots, sort, { name: i => i.filename, size: i => i.size, date: i => i.date }), i => i.filename)
  const filteredWorlds = filtered(worlds, i => i.name)

  // ── toggle / delete helpers ──────────────────────────────────────────────

  async function doToggleMod(filename: string) {
    const next = await window.api.instances.toggleMod(instance.id, filename)
    setMods(p => p.map(m => m.filename === filename ? { ...m, filename: next, enabled: !m.enabled } : m))
  }
  async function doToggleModBulk(filenames: string[]) {
    const results = await Promise.all(filenames.map(fn => window.api.instances.toggleMod(instance.id, fn)))
    setMods(p => p.map(m => {
      const idx = filenames.indexOf(m.filename)
      return idx === -1 ? m : { ...m, filename: results[idx], enabled: !m.enabled }
    }))
    setSelected(prev => {
      const next = new Set<string>()
      filenames.forEach((fn, i) => { if (prev.has(fn)) next.add(results[i]) })
      ;[...prev].filter(s => !filenames.includes(s)).forEach(s => next.add(s))
      return next
    })
  }
  async function doToggleRp(filename: string) {
    const next = await window.api.instances.toggleResourcepack(instance.id, filename)
    setResourcepacks(p => p.map(m => m.filename === filename ? { ...m, filename: next, enabled: !m.enabled } : m))
  }
  async function doToggleRpBulk(filenames: string[]) {
    const results = await Promise.all(filenames.map(fn => window.api.instances.toggleResourcepack(instance.id, fn)))
    setResourcepacks(p => p.map(m => {
      const idx = filenames.indexOf(m.filename)
      return idx === -1 ? m : { ...m, filename: results[idx], enabled: !m.enabled }
    }))
    setSelected(prev => {
      const next = new Set<string>()
      filenames.forEach((fn, i) => { if (prev.has(fn)) next.add(results[i]) })
      ;[...prev].filter(s => !filenames.includes(s)).forEach(s => next.add(s))
      return next
    })
  }
  async function doToggleShader(filename: string) {
    const next = await window.api.instances.toggleShaderpack(instance.id, filename)
    setShaderpacks(p => p.map(m => m.filename === filename ? { ...m, filename: next, enabled: !m.enabled } : m))
  }
  async function doToggleShaderBulk(filenames: string[]) {
    const results = await Promise.all(filenames.map(fn => window.api.instances.toggleShaderpack(instance.id, fn)))
    setShaderpacks(p => p.map(m => {
      const idx = filenames.indexOf(m.filename)
      return idx === -1 ? m : { ...m, filename: results[idx], enabled: !m.enabled }
    }))
    setSelected(prev => {
      const next = new Set<string>()
      filenames.forEach((fn, i) => { if (prev.has(fn)) next.add(results[i]) })
      ;[...prev].filter(s => !filenames.includes(s)).forEach(s => next.add(s))
      return next
    })
  }

  const askDelete = useCallback((title: string, message: string, onConfirm: () => void) => {
    setConfirm({ title, message, onConfirm })
  }, [])

  function deleteModFiles(filenames: string[]) {
    const n = filenames.length
    askDelete(
      n === 1 ? 'Eliminar mod' : `Eliminar ${n} mods`,
      n === 1 ? `¿Eliminar "${displayName(filenames[0])}"? No se puede deshacer.` : `¿Eliminar ${n} mods? No se puede deshacer.`,
      async () => {
        await Promise.all(filenames.map(f => window.api.instances.deleteMod(instance.id, f)))
        setMods(p => p.filter(m => !filenames.includes(m.filename)))
        setSelected(new Set()); setConfirm(null)
      }
    )
  }
  function deleteRpFiles(filenames: string[]) {
    const n = filenames.length
    askDelete(
      n === 1 ? 'Eliminar resource pack' : `Eliminar ${n} resource packs`,
      `¿Eliminar ${n === 1 ? `"${displayName(filenames[0])}"` : `${n} resource packs`}? No se puede deshacer.`,
      async () => {
        await Promise.all(filenames.map(f => window.api.instances.deleteResourcepack(instance.id, f)))
        setResourcepacks(p => p.filter(m => !filenames.includes(m.filename)))
        setSelected(new Set()); setConfirm(null)
      }
    )
  }
  function deleteShaderFiles(filenames: string[]) {
    const n = filenames.length
    askDelete(
      n === 1 ? 'Eliminar shaderpack' : `Eliminar ${n} shaderpacks`,
      `¿Eliminar ${n === 1 ? `"${displayName(filenames[0])}"` : `${n} shaderpacks`}? No se puede deshacer.`,
      async () => {
        await Promise.all(filenames.map(f => window.api.instances.deleteShaderpack(instance.id, f)))
        setShaderpacks(p => p.filter(m => !filenames.includes(m.filename)))
        setSelected(new Set()); setConfirm(null)
      }
    )
  }
  function deleteWorldItems(names: string[]) {
    const n = names.length
    askDelete(
      n === 1 ? 'Eliminar mundo' : `Eliminar ${n} mundos`,
      `¿Eliminar ${n === 1 ? `"${names[0]}"` : `${n} mundos`}? Se perderán las partidas guardadas.`,
      async () => {
        await Promise.all(names.map(w => window.api.instances.deleteWorld(instance.id, w)))
        setWorlds(p => p.filter(w => !names.includes(w.name)))
        setSelected(new Set()); setConfirm(null)
      }
    )
  }
  function deleteScreenshotItems(filenames: string[]) {
    const n = filenames.length
    askDelete(
      n === 1 ? 'Eliminar screenshot' : `Eliminar ${n} screenshots`,
      `¿Eliminar ${n === 1 ? `"${filenames[0]}"` : `${n} screenshots`}? No se puede deshacer.`,
      async () => {
        await Promise.all(filenames.map(f => window.api.instances.deleteScreenshot(instance.id, f)))
        setScreenshots(p => p.filter(s => !filenames.includes(s.filename)))
        if (lightboxIdx !== null) {
          const remaining = screenshots.filter(s => !filenames.includes(s.filename))
          if (remaining.length === 0) setLightboxIdx(null)
          else setLightboxIdx(Math.min(lightboxIdx, remaining.length - 1))
        }
        setSelected(new Set()); setConfirm(null)
      }
    )
  }

  // ── selection helpers ────────────────────────────────────────────────────

  function toggleSel(name: string) {
    setSelected(p => { const n = new Set(p); n.has(name) ? n.delete(name) : n.add(name); return n })
  }

  // ── ModFile row (shared by mods, rp, shaders) ────────────────────────────

  function FileRow({
    item, icon, onToggle, onDelete, onCtx
  }: {
    item: ModFile
    icon: React.ReactNode
    onToggle?: () => void
    onDelete: () => void
    onCtx: (e: React.MouseEvent) => void
  }) {
    const isSelected = selected.has(item.filename)
    const hasMeta = !!(item.meta?.name || item.meta?.iconBase64)
    const displayLabel = item.meta?.name || displayName(item.filename)

    return (
      <div
        onContextMenu={onCtx}
        className={`group flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
          isSelected ? 'bg-accent/10 border-accent/40' : 'bg-bg-card border-border hover:border-border/80'
        } ${!item.enabled ? 'opacity-50' : ''}`}
        onClick={() => toggleSel(item.filename)}
      >
        {/* Checkbox */}
        <div className="w-4 flex-shrink-0 flex items-center justify-center">
          <div className={`w-3.5 h-3.5 rounded border transition-colors ${isSelected ? 'bg-accent border-accent' : 'border-border group-hover:border-text-muted'}`}>
            {isSelected && <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" className="w-full h-full p-0.5"><polyline points="2 6 5 9 10 3" /></svg>}
          </div>
        </div>

        {/* Icon */}
        {hasMeta && item.meta?.iconBase64 ? (
          <img src={item.meta.iconBase64} alt="" className="w-8 h-8 rounded flex-shrink-0 object-cover" />
        ) : (
          <div className="w-8 h-8 rounded bg-bg-hover flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
        )}

        {/* Name + filename */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-primary truncate">{displayLabel}</p>
          {hasMeta && (
            <p className="text-xs text-text-muted truncate">{displayName(item.filename)}</p>
          )}
        </div>

        {/* Size */}
        {item.size > 0 && <span className="text-xs text-text-muted flex-shrink-0">{formatSize(item.size)}</span>}

        {/* Toggle pill */}
        {onToggle && (
          <button onClick={e => { e.stopPropagation(); onToggle() }}
            title={item.enabled ? 'Deshabilitar' : 'Habilitar'}
            className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium transition-colors border ${
              item.enabled
                ? 'bg-green-500/10 text-green-400 border-green-500/30 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30'
                : 'bg-bg-hover text-text-muted border-border hover:bg-green-500/10 hover:text-green-400 hover:border-green-500/30'
            }`}>
            {item.enabled ? 'Activo' : 'Inactivo'}
          </button>
        )}

        {/* Delete */}
        <button onClick={e => { e.stopPropagation(); onDelete() }}
          title="Eliminar"
          className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors">
          <TrashIcon />
        </button>
      </div>
    )
  }

  function SelectAllBar({ items, onDelete }: { items: string[]; onDelete: (names: string[]) => void }) {
    const allSelected = items.length > 0 && items.every(i => selected.has(i))
    return (
      <div className="flex items-center justify-between flex-shrink-0">
        <button
          onClick={() => allSelected ? setSelected(new Set()) : setSelected(new Set(items))}
          className="text-xs text-text-muted hover:text-accent transition-colors">
          {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
        </button>
        {selected.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-accent">{selected.size} seleccionado{selected.size !== 1 ? 's' : ''}</span>
            <button onClick={() => setSelected(new Set())} className="text-xs text-text-muted hover:text-text-secondary">Quitar selección</button>
            <button onClick={() => {
              const names = [...selected].filter(s => items.includes(s))
              onDelete(names)
            }} className="text-xs text-red-400 hover:text-red-300">Eliminar</button>
          </div>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string }[] = [
    { key: 'mods', label: 'Mods' },
    { key: 'worlds', label: 'Mundos' },
    { key: 'resourcepacks', label: 'Resource Packs' },
    { key: 'shaderpacks', label: 'Shaderpacks' },
    { key: 'screenshots', label: 'Screenshots' },
    { key: 'console', label: isRunning ? '● Consola' : 'Consola' },
    { key: 'options', label: 'Options' },
  ]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="relative bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[720px] max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/50 flex-shrink-0">
          <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <div className="flex-1 overflow-hidden">
            <h2 className="font-semibold text-text-primary truncate">{instance.name}</h2>
            <p className="text-xs text-text-muted capitalize">
              MC {instance.minecraft}
              {instance.modloader !== 'vanilla' && ` · ${instance.modloader}${instance.modloaderVersion ? ` ${instance.modloaderVersion}` : ''}`}
            </p>
          </div>
          {isRunning && (
            <button onClick={() => window.api.launcher.kill(instance.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs rounded-lg transition-colors">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
              Cerrar juego
            </button>
          )}
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 px-4 pt-2 border-b border-border/30 flex-shrink-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-t-lg transition-colors ${
                tab === t.key ? 'text-accent border-b-2 border-accent -mb-px font-medium' : 'text-text-muted hover:text-text-secondary'
              } ${t.key === 'console' && isRunning ? 'text-green-400' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">

          {/* ── MODS ── */}
          {tab === 'mods' && (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {isRunning && <GameLockedBanner />}
              <div className="flex items-center gap-2">
                <SearchBar value={search} onChange={setSearch} />
                <SortSelect value={sort} onChange={setSort} withDate />
                <EnabledFilter value={filterEnabled} onChange={setFilterEnabled} />
                <FolderBtn onClick={() => window.api.instances.openModsFolder(instance.id)} />
              </div>
              <div className="flex items-center justify-between flex-shrink-0">
                <p className="text-xs text-text-muted">{sortedMods.length} mod{sortedMods.length !== 1 ? 's' : ''}</p>
              </div>
              {loading ? <LoadSpinner /> : sortedMods.length === 0 ? <EmptyMsg msg="No hay mods instalados" /> : (
                <>
                  <SelectAllBar items={sortedMods.map(m => m.filename)} onDelete={deleteModFiles} />
                  {sortedMods.map(mod => (
                    <FileRow key={mod.filename} item={mod} icon={<BoxIcon className="text-accent" />}
                      onToggle={isRunning ? undefined : () => {
                        if (selected.has(mod.filename) && selected.size > 1)
                          doToggleModBulk(sortedMods.filter(m => selected.has(m.filename)).map(m => m.filename))
                        else doToggleMod(mod.filename)
                      }}
                      onDelete={() => deleteModFiles([mod.filename])}
                      onCtx={e => {
                        e.preventDefault()
                        setCtx({ x: e.clientX, y: e.clientY, items: [
                          ...(mod.enabled
                            ? [{ label: 'Deshabilitar', action: () => doToggleMod(mod.filename) }]
                            : [{ label: 'Habilitar', action: () => doToggleMod(mod.filename) }]),
                          { label: 'Eliminar', danger: true, action: () => deleteModFiles([mod.filename]) }
                        ]})
                      }}
                    />
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── WORLDS ── */}
          {tab === 'worlds' && (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <SearchBar value={search} onChange={setSearch} />
                <FolderBtn onClick={() => window.api.instances.openSavesFolder(instance.id)} />
              </div>
              <div className="flex items-center justify-between flex-shrink-0">
                <p className="text-xs text-text-muted">{filteredWorlds.length} mundo{filteredWorlds.length !== 1 ? 's' : ''}</p>
              </div>
              {loading ? <LoadSpinner /> : filteredWorlds.length === 0 ? <EmptyMsg msg="No hay mundos guardados" /> : (
                <>
                  <SelectAllBar items={filteredWorlds.map(w => w.name)} onDelete={deleteWorldItems} />
                  {filteredWorlds.map(w => {
                    const isSel = selected.has(w.name)
                    return (
                      <div key={w.name}
                        onContextMenu={e => {
                          e.preventDefault()
                          setCtx({ x: e.clientX, y: e.clientY, items: [
                            { label: 'Eliminar', danger: true, action: () => deleteWorldItems([w.name]) }
                          ]})
                        }}
                        onClick={() => toggleSel(w.name)}
                        className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${isSel ? 'bg-accent/10 border-accent/40' : 'bg-bg-card border-border hover:border-border/80'}`}>
                        <div className="w-4 flex-shrink-0 flex items-center justify-center">
                          <div className={`w-3.5 h-3.5 rounded border transition-colors ${isSel ? 'bg-accent border-accent' : 'border-border group-hover:border-text-muted'}`}>
                            {isSel && <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" className="w-full h-full p-0.5"><polyline points="2 6 5 9 10 3" /></svg>}
                          </div>
                        </div>
                        {w.iconBase64
                          ? <img src={w.iconBase64} alt="" className="w-10 h-10 rounded-md flex-shrink-0 object-cover" />
                          : <div className="w-10 h-10 rounded-md bg-bg-hover flex items-center justify-center flex-shrink-0"><GlobeIcon className="text-green-400" /></div>
                        }
                        <div className="flex-1 overflow-hidden">
                          <p className="text-sm text-text-primary truncate">{w.name}</p>
                          <p className="text-xs text-text-muted">{formatDate(w.lastPlayed)}</p>
                        </div>
                        <button onClick={e => { e.stopPropagation(); deleteWorldItems([w.name]) }}
                          title="Eliminar"
                          className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors">
                          <TrashIcon />
                        </button>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}

          {/* ── RESOURCE PACKS ── */}
          {tab === 'resourcepacks' && (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {isRunning && <GameLockedBanner />}
              <div className="flex items-center gap-2">
                <SearchBar value={search} onChange={setSearch} />
                <SortSelect value={sort} onChange={setSort} withDate />
                <EnabledFilter value={filterEnabled} onChange={setFilterEnabled} />
                <FolderBtn onClick={() => window.api.instances.openResourcepacksFolder(instance.id)} />
              </div>
              <p className="text-xs text-text-muted flex-shrink-0">{sortedRps.length} resource pack{sortedRps.length !== 1 ? 's' : ''}</p>
              {loading ? <LoadSpinner /> : sortedRps.length === 0 ? <EmptyMsg msg="No hay resource packs instalados" /> : (
                <>
                  <SelectAllBar items={sortedRps.map(m => m.filename)} onDelete={deleteRpFiles} />
                  {sortedRps.map(rp => (
                    <FileRow key={rp.filename} item={rp} icon={<RpIcon className="text-purple-400" />}
                      onToggle={isRunning ? undefined : () => {
                        if (selected.has(rp.filename) && selected.size > 1)
                          doToggleRpBulk(sortedRps.filter(m => selected.has(m.filename)).map(m => m.filename))
                        else doToggleRp(rp.filename)
                      }}
                      onDelete={() => deleteRpFiles([rp.filename])}
                      onCtx={e => {
                        e.preventDefault()
                        setCtx({ x: e.clientX, y: e.clientY, items: [
                          ...(rp.enabled
                            ? [{ label: 'Deshabilitar', action: () => doToggleRp(rp.filename) }]
                            : [{ label: 'Habilitar', action: () => doToggleRp(rp.filename) }]),
                          { label: 'Eliminar', danger: true, action: () => deleteRpFiles([rp.filename]) }
                        ]})
                      }}
                    />
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── SHADERPACKS ── */}
          {tab === 'shaderpacks' && (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {isRunning && <GameLockedBanner />}
              <div className="flex items-center gap-2">
                <SearchBar value={search} onChange={setSearch} />
                <SortSelect value={sort} onChange={setSort} withDate />
                <EnabledFilter value={filterEnabled} onChange={setFilterEnabled} />
                <FolderBtn onClick={() => window.api.instances.openShaderpacks(instance.id)} />
              </div>
              <p className="text-xs text-text-muted flex-shrink-0">{sortedShaders.length} shaderpack{sortedShaders.length !== 1 ? 's' : ''}</p>
              {loading ? <LoadSpinner /> : sortedShaders.length === 0 ? <EmptyMsg msg="No hay shaderpacks instalados" /> : (
                <>
                  <SelectAllBar items={sortedShaders.map(m => m.filename)} onDelete={deleteShaderFiles} />
                  {sortedShaders.map(s => (
                    <FileRow key={s.filename} item={s} icon={<ShaderIcon className="text-yellow-400" />}
                      onToggle={isRunning ? undefined : () => {
                        if (selected.has(s.filename) && selected.size > 1)
                          doToggleShaderBulk(sortedShaders.filter(m => selected.has(m.filename)).map(m => m.filename))
                        else doToggleShader(s.filename)
                      }}
                      onDelete={() => deleteShaderFiles([s.filename])}
                      onCtx={e => {
                        e.preventDefault()
                        setCtx({ x: e.clientX, y: e.clientY, items: [
                          ...(s.enabled
                            ? [{ label: 'Deshabilitar', action: () => doToggleShader(s.filename) }]
                            : [{ label: 'Habilitar', action: () => doToggleShader(s.filename) }]),
                          { label: 'Eliminar', danger: true, action: () => deleteShaderFiles([s.filename]) }
                        ]})
                      }}
                    />
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── SCREENSHOTS ── */}
          {tab === 'screenshots' && (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <SearchBar value={search} onChange={setSearch} />
                <SortSelect value={sort} onChange={setSort} withDate />
                <FolderBtn onClick={() => window.api.instances.openScreenshots(instance.id)} />
              </div>
              <p className="text-xs text-text-muted flex-shrink-0">{sortedScreenshots.length} screenshot{sortedScreenshots.length !== 1 ? 's' : ''}</p>
              {loading ? <LoadSpinner /> : sortedScreenshots.length === 0 ? <EmptyMsg msg="No hay screenshots" /> : (
                <>
                  <SelectAllBar items={sortedScreenshots.map(s => s.filename)} onDelete={deleteScreenshotItems} />
                  <div className="grid grid-cols-3 gap-2">
                    {sortedScreenshots.map((s, idx) => {
                      const isSel = selected.has(s.filename)
                      return (
                        <div key={s.filename}
                          className={`group relative rounded-lg overflow-hidden border aspect-video cursor-pointer transition-colors ${isSel ? 'border-accent ring-1 ring-accent/50' : 'border-border hover:border-border/80'}`}
                          onContextMenu={e => {
                            e.preventDefault()
                            setCtx({ x: e.clientX, y: e.clientY, items: [
                              { label: 'Abrir', action: () => setLightboxIdx(idx) },
                              { label: 'Copiar imagen', action: () => window.api.clipboard.writeImagePath(s.filePath) },
                              { label: 'Copiar ruta', action: () => window.api.clipboard.writeText(s.filePath) },
                              { label: 'Eliminar', danger: true, action: () => deleteScreenshotItems([s.filename]) }
                            ]})
                          }}
                          onClick={() => {
                            if (selected.size > 0) { toggleSel(s.filename); return }
                            setLightboxIdx(idx)
                          }}
                        >
                          <img src={mediaUrl(s.filePath)} alt={s.filename}
                            className="w-full h-full object-cover" loading="lazy" />
                          {/* hover overlay */}
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-0.5 p-2">
                            <p className="text-white text-xs text-center truncate w-full">{s.filename}</p>
                            <p className="text-white/60 text-xs">{formatDate(s.date)}</p>
                          </div>
                          {/* selection checkbox */}
                          <div
                            className={`absolute top-1.5 left-1.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                              isSel ? 'bg-accent border-accent opacity-100' : 'bg-black/40 border-white/50 opacity-0 group-hover:opacity-100'
                            }`}
                            onClick={e => { e.stopPropagation(); toggleSel(s.filename) }}>
                            {isSel && <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" className="w-3 h-3"><polyline points="2 6 5 9 10 3" /></svg>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── CONSOLE ── */}
          {tab === 'console' && (
            <div className="flex-1 flex flex-col min-h-0 p-4 gap-2">
              <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
                {(['live', 'log', 'crash'] as const).map(v => (
                  <button key={v} onClick={() => setConsoleView(v)}
                    className={`px-3 py-1 text-xs rounded-lg transition-colors ${consoleView === v ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary border border-border'}`}>
                    {v === 'live' ? (isRunning ? '● En vivo' : 'Logs en vivo') : v === 'log' ? 'latest.log' : 'Crash Reports'}
                  </button>
                ))}
                <div className="flex-1" />
                {consoleView === 'live' && (
                  <button onClick={() => useStore.getState().clearGameLog(instance.id)}
                    className="text-xs text-text-muted hover:text-text-secondary">Limpiar</button>
                )}
                {consoleView === 'log' && latestLog && (
                  <div className="flex gap-2">
                    <button onClick={() => window.api.clipboard.writeText(latestLog)} className="text-xs text-accent hover:text-accent/80">Copiar</button>
                    <FolderBtn onClick={() => window.api.instances.openLogsFolder(instance.id)} label="Abrir logs" />
                  </div>
                )}
                {consoleView === 'crash' && (
                  <FolderBtn onClick={() => window.api.instances.openCrashReportsFolder(instance.id)} label="Abrir crashes" />
                )}
              </div>

              {consoleView === 'live' && (
                <div ref={logRef} className="flex-1 overflow-y-auto bg-bg-primary border border-border rounded-lg p-3 font-mono text-xs text-text-secondary leading-5 min-h-0">
                  {gameLogs.length === 0
                    ? <p className="text-text-muted">Los logs aparecerán aquí al lanzar el juego.</p>
                    : gameLogs.map((line, i) => (
                      <div key={i} className={line.includes('ERROR') || line.includes('FATAL') ? 'text-red-400' : line.includes('WARN') ? 'text-amber-400' : ''}>{line}</div>
                    ))}
                </div>
              )}

              {consoleView === 'log' && (
                <div className="flex-1 overflow-y-auto bg-bg-primary border border-border rounded-lg p-3 font-mono text-xs text-text-secondary leading-5 min-h-0">
                  {loading ? <p className="text-text-muted">Cargando...</p>
                    : !latestLog ? <p className="text-text-muted">No hay logs disponibles.</p>
                    : latestLog.split('\n').map((line, i) => (
                      <div key={i} className={line.includes('ERROR') || line.includes('FATAL') ? 'text-red-400' : line.includes('WARN') ? 'text-amber-400' : ''}>{line}</div>
                    ))}
                </div>
              )}

              {consoleView === 'crash' && (
                <div className="flex-1 flex gap-3 min-h-0">
                  <div className="w-48 flex-shrink-0 overflow-y-auto flex flex-col gap-1">
                    {crashes.length === 0
                      ? <p className="text-xs text-text-muted px-1">No hay crash reports.</p>
                      : crashes.map(c => (
                        <button key={c.filename}
                          onClick={async () => {
                            setSelectedCrash(c.filename)
                            setCrashContent(await window.api.instances.readCrashReport(instance.id, c.filename))
                          }}
                          className={`text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${selectedCrash === c.filename ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-hover'}`}>
                          <p className="truncate">{c.filename}</p>
                          <p className="text-text-muted text-xs">{formatDate(c.date)}</p>
                        </button>
                      ))}
                  </div>
                  <div className="flex-1 flex flex-col gap-2 min-w-0">
                    {selectedCrash && (
                      <button onClick={() => window.api.clipboard.writeText(crashContent)}
                        className="self-end text-xs text-accent hover:text-accent/80">Copiar</button>
                    )}
                    <div className="flex-1 overflow-y-auto bg-bg-primary border border-border rounded-lg p-3 font-mono text-xs text-red-300 leading-5 min-h-0">
                      {!selectedCrash
                        ? <p className="text-text-muted">Selecciona un crash report.</p>
                        : crashContent.split('\n').map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── OPTIONS ── */}
          {tab === 'options' && (
            <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
              {isRunning && <GameLockedBanner />}
              <div className="flex-1 overflow-y-auto min-h-0">
                {loading ? <LoadSpinner /> : (
                  <OptionsEditor content={optionsContent} onChange={setOptionsContent} disabled={isRunning} displayHz={displayHz} />
                )}
              </div>
              <div className="flex justify-end flex-shrink-0 pt-1 border-t border-border/30">
                <button
                  onClick={async () => {
                    await window.api.instances.writeOptions(instance.id, optionsContent)
                    setOptionsSavedContent(optionsContent)
                    setOptionsSaved(true); setTimeout(() => setOptionsSaved(false), 2000)
                  }}
                  disabled={isRunning || optionsContent === optionsSavedContent}
                  className="px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors">
                  {optionsSaved ? '¡Guardado!' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Overlays */}
      {confirm && (
        <ConfirmDialog title={confirm.title} message={confirm.message}
          onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />
      )}
      {ctx && (
        <CtxMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />
      )}
      {lightboxIdx !== null && sortedScreenshots.length > 0 && (
        <Lightbox
          screenshots={sortedScreenshots}
          index={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onChange={setLightboxIdx}
          onDelete={s => deleteScreenshotItems([s.filename])}
        />
      )}
    </div>
  )
}

function LoadSpinner() {
  return <div className="flex items-center justify-center py-12 text-text-muted text-sm">Cargando...</div>
}
function EmptyMsg({ msg }: { msg: string }) {
  return <div className="flex items-center justify-center py-12 text-text-muted text-sm">{msg}</div>
}
