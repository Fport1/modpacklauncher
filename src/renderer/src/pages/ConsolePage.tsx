import { useState, useEffect, useRef } from 'react'

interface LogEntry {
  level: string
  message: string
  at: number
}

type FilterLevel = 'all' | 'warn' | 'error'

const LEVEL_COLOR: Record<string, string> = {
  log:   '#71717a',
  info:  '#60a5fa',
  warn:  '#facc15',
  error: '#f87171',
}

const LEVEL_BG: Record<string, string> = {
  error: 'rgba(248,113,113,.05)',
  warn:  'rgba(250,204,21,.04)',
}

const LEVEL_LABEL: Record<string, string> = {
  log: 'LOG', info: 'INFO', warn: 'WARN', error: 'ERR',
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function ConsolePage() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<FilterLevel>('all')
  const [search, setSearch] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.console.getLogs().then(setEntries).catch(() => {})

    const unsubLog = window.api.console.onLog((entry) => {
      setEntries(prev => {
        const next = [...prev, entry as LogEntry]
        return next.length > 1000 ? next.slice(next.length - 1000) : next
      })
    })

    const unsubHistory = window.api.console.onHistory((hist) => {
      setEntries(hist as LogEntry[])
    })

    return () => { unsubLog(); unsubHistory() }
  }, [])

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [entries, autoScroll])

  function onScroll() {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (atBottom !== autoScroll) setAutoScroll(atBottom)
  }

  const filtered = entries.filter(e => {
    if (filter === 'warn') return e.level === 'warn' || e.level === 'error'
    if (filter === 'error') return e.level === 'error'
    return true
  }).filter(e => !search || e.message.toLowerCase().includes(search.toLowerCase()))

  const errCount  = filtered.filter(e => e.level === 'error').length
  const warnCount = filtered.filter(e => e.level === 'warn').length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#09090b', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #27272a', flexShrink: 0 }}>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#7c3aed', textTransform: 'uppercase', margin: '0 0 3px' }}>
          Herramientas
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f4f4f5', margin: 0 }}>Consola del Launcher</h2>
            <p style={{ fontSize: 12, color: '#71717a', margin: '2px 0 0' }}>
              Logs, avisos y errores internos del launcher en tiempo real
            </p>
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
            {(['all', 'warn', 'error'] as const).map(l => (
              <button key={l} onClick={() => setFilter(l)} style={{
                padding: '4px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                border: `1px solid ${filter === l ? '#7c3aed' : '#27272a'}`,
                background: filter === l ? 'rgba(124,58,237,.15)' : 'transparent',
                color: filter === l ? '#a855f7' : '#71717a',
              }}>
                {l === 'all' ? 'Todo' : l === 'warn' ? 'Avisos' : 'Errores'}
              </button>
            ))}
            <button onClick={() => { setEntries([]); setSearch('') }} style={{
              padding: '4px 10px', borderRadius: 7, border: '1px solid #27272a',
              background: 'transparent', color: '#71717a', fontSize: 11, cursor: 'pointer',
            }}>
              Limpiar
            </button>
          </div>
        </div>
        <input
          type="text"
          placeholder="Buscar en los logs..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', background: '#18181b', border: '1px solid #27272a',
            borderRadius: 8, padding: '7px 12px', color: '#f4f4f5', fontSize: 12,
            outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Log list */}
      <div
        ref={containerRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: 'auto', fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace', fontSize: 12 }}
      >
        {filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10 }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="1.5">
              <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
            <p style={{ color: '#52525b', fontSize: 13, margin: 0 }}>
              {entries.length === 0 ? 'Sin logs aún' : 'Sin resultados para este filtro'}
            </p>
          </div>
        ) : (
          filtered.map((entry, i) => (
            <div key={i} style={{
              display: 'flex', gap: 10, padding: '3px 14px', alignItems: 'flex-start',
              borderBottom: '1px solid rgba(255,255,255,.03)',
              background: LEVEL_BG[entry.level] ?? 'transparent',
            }}>
              <span style={{ color: '#3f3f46', flexShrink: 0, fontSize: 11, paddingTop: 1, userSelect: 'none' }}>
                {fmtTime(entry.at)}
              </span>
              <span style={{
                color: LEVEL_COLOR[entry.level] ?? '#71717a',
                fontSize: 10, fontWeight: 700, flexShrink: 0,
                letterSpacing: '0.04em', minWidth: 28, paddingTop: 2,
                userSelect: 'none',
              }}>
                {LEVEL_LABEL[entry.level] ?? entry.level.toUpperCase()}
              </span>
              <span style={{
                color: entry.level === 'error' ? '#fca5a5' : entry.level === 'warn' ? '#fde68a' : '#a1a1aa',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.55, flex: 1,
              }}>
                {entry.message}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Status bar */}
      <div style={{
        padding: '5px 14px', borderTop: '1px solid #27272a', flexShrink: 0,
        display: 'flex', gap: 12, alignItems: 'center', background: '#111118',
      }}>
        <span style={{ fontSize: 11, color: '#52525b' }}>{filtered.length} entradas</span>
        {errCount > 0 && (
          <span style={{ fontSize: 11, color: '#f87171', fontWeight: 600 }}>{errCount} error{errCount !== 1 ? 'es' : ''}</span>
        )}
        {warnCount > 0 && (
          <span style={{ fontSize: 11, color: '#facc15' }}>{warnCount} aviso{warnCount !== 1 ? 's' : ''}</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: autoScroll ? '#7c3aed' : '#52525b', cursor: 'pointer' }}
          onClick={() => {
            setAutoScroll(true)
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
          }}>
          {autoScroll ? '↓ Auto' : '↓ Ir al final'}
        </span>
      </div>
    </div>
  )
}
