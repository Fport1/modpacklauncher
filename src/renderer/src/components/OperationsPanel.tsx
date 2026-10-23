import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { shallow } from 'zustand/shallow'
import type { Operation, OperationType } from '../../../shared/types'

/* ── per-type metadata ─────────────────────────────────────────── */
const OP_META: Record<OperationType, { label: string; icon: React.ReactNode }> = {
  'install-modpack':    { label: 'Instalando',   icon: <InstallIcon /> },
  'update-modpack':     { label: 'Actualizando',  icon: <RefreshIcon /> },
  'install-mrpack':     { label: 'Instalando',   icon: <InstallIcon /> },
  'install-curseforge': { label: 'Instalando',   icon: <InstallIcon /> },
  'export-modpack':     { label: 'Exportando',   icon: <UploadIcon /> },
  'import-fpack':       { label: 'Importando',   icon: <FolderIcon /> },
  'save-fpack':         { label: 'Guardando',    icon: <SaveIcon /> },
  'install-minecraft':  { label: 'Preparando',   icon: <GearIcon /> },
  'install-java':       { label: 'Instalando Java', icon: <CodeIcon /> },
  'install-vlc':        { label: 'Instalando VLC',  icon: <VideoIcon /> },
  'duplicate-instance': { label: 'Duplicando',   icon: <CopyIcon /> },
  'download-update':    { label: 'Descargando',  icon: <DownloadIcon /> },
  'delete-instance':    { label: 'Eliminando',   icon: <TrashIcon /> },
  'ftp-upload':         { label: 'Subiendo',     icon: <UploadIcon /> },
  'ftp-download':       { label: 'Descargando',  icon: <DownloadIcon /> },
  'transfer-content':   { label: 'Transfiriendo', icon: <CopyIcon /> },
}

function InstallIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
}
function RefreshIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
}
function UploadIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
}
function FolderIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
}
function SaveIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
}
function GearIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
}
function CodeIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
}
function CopyIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
}
function DownloadIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
}
function VideoIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
}
function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}
function fmtDuration(s: number): string {
  if (s < 60) return `${Math.max(1, Math.round(s))} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
}
function fmtClock(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** A partir de cuántos segundos sin novedades se avisa de que parece parada. */
const STALL_WARN_S = 20

/* ── single chip ───────────────────────────────────────────────── */
function OpChip({ op, onDismiss }: { op: Operation; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())

  const meta = OP_META[op.type] ?? { label: 'Procesando', icon: <GearIcon /> }
  const pct = op.current != null && op.total != null && op.total > 0
    ? Math.min(100, Math.round((op.current / op.total) * 100))
    : 0
  const isDone = op.status === 'done'
  const isError = op.status === 'error'
  const isRunning = op.status === 'running'

  // Reloj para el tiempo transcurrido y el aviso de «parece parada»
  useEffect(() => {
    if (!isRunning) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [isRunning])

  const d = op.detail
  const idle = isRunning && op.updatedAt ? Math.floor((now - op.updatedAt) / 1000) : 0
  const stalled = idle >= STALL_WARN_S
  const elapsed = Math.max(0, (now - op.startedAt) / 1000)
  const transfer = d?.bytes != null
    ? [
        d.totalBytes ? `${fmtBytes(d.bytes)} de ${fmtBytes(d.totalBytes)}` : fmtBytes(d.bytes),
        d.speed ? `${fmtBytes(d.speed)}/s` : null,
        d.eta ? `quedan ${fmtDuration(d.eta)}` : null,
      ].filter(Boolean).join(' · ')
    : null

  function cancel() {
    setCancelling(true)
    window.api.cancel().catch(() => {})
  }

  function copyLog() {
    const lines = [
      `${op.name} (${meta.label})`,
      ...(op.log ?? []).map((l) => `[${fmtClock(l.at)}] ${l.text}`),
      op.error ? `Error: ${op.error}` : '',
    ].filter(Boolean)
    window.api.clipboard.writeText(lines.join('\n'))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      .catch(() => {})
  }

  /* ── small (default) ── */
  if (!expanded) {
    return (
      <div className={`w-72 rounded-xl shadow-2xl border overflow-hidden transition-all ${
        isDone ? 'bg-green-950/80 border-green-700/50'
        : isError ? 'bg-red-950/80 border-red-700/50'
        : stalled ? 'bg-bg-secondary border-amber-600/50'
        : 'bg-bg-secondary border-border'
      }`}>
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          {/* icon */}
          <span className={`flex-shrink-0 ${isDone ? 'text-green-400' : isError ? 'text-red-400' : 'text-accent'}`}>
            {isDone
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              : isError
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              : <span className={cancelling ? '' : 'animate-spin block'}>{meta.icon}</span>
            }
          </span>

          {/* name + bar */}
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-medium truncate ${isDone ? 'text-green-300' : isError ? 'text-red-300' : 'text-text-primary'}`}>
              {op.name}
            </p>
            {isRunning && (
              <div className="mt-1 h-1 bg-bg-hover rounded-full overflow-hidden">
                {pct > 0
                  ? <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                  : <div className="h-full bg-accent/60 rounded-full animate-pulse w-full" />
                }
              </div>
            )}
            {isRunning && (
              <p className={`text-[10px] truncate mt-0.5 ${stalled ? 'text-amber-400' : 'text-text-muted'}`}>
                {stalled ? `Sin novedades desde hace ${fmtDuration(idle)}` : transfer ?? op.message ?? ''}
              </p>
            )}
            {isDone && op.message && (
              <p className="text-[10px] text-green-400/70 truncate mt-0.5">{op.message}</p>
            )}
            {/* Sin `|| 'Error'` un error de mensaje vacío pinta el chip rojo
                sin decir nada, y parece que la operación sigue en marcha. */}
            {isError && (
              <p className="text-[10px] text-red-400/70 truncate mt-0.5">{op.error || 'Error desconocido'}</p>
            )}
          </div>

          {/* right side */}
          {isRunning && (
            <span className="text-[11px] text-text-muted flex-shrink-0 font-mono">{pct}%</span>
          )}
          {(isRunning || isError) && (
            <button onClick={() => setExpanded(true)} title="Ver detalles"
              className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary flex-shrink-0">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
          )}
          {(isDone || isError) && (
            <button onClick={onDismiss} title="Cerrar"
              className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary flex-shrink-0">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
      </div>
    )
  }

  /* ── large (expanded) ── */
  return (
    <div className={`w-96 bg-bg-secondary border rounded-xl shadow-2xl overflow-hidden ${isError ? 'border-red-700/50' : stalled ? 'border-amber-600/50' : 'border-border'}`}>
      {/* header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border/50">
        <span className={`flex-shrink-0 ${isError ? 'text-red-400' : 'text-accent'}`}>
          {isRunning
            ? <span className={cancelling ? '' : 'animate-spin block'}>{meta.icon}</span>
            : meta.icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-text-primary truncate">{op.name}</p>
          <p className="text-[10px] text-text-muted truncate">
            {meta.label}{d?.phase ? ` · ${d.phase}` : ''} · {fmtDuration(elapsed)}
          </p>
        </div>
        <button onClick={() => setExpanded(false)} title="Contraer"
          className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary flex-shrink-0">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>

      {/* body */}
      <div className="px-3 py-2.5 space-y-2 select-text">
        {op.message && isRunning && (
          <p className="text-[11px] text-text-secondary break-words">{op.message}</p>
        )}
        {isError && (
          <p className="text-[11px] text-red-300 break-words">{op.error || 'Error desconocido'}</p>
        )}

        {isRunning && (
          <>
            <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
              {pct > 0
                ? <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                : <div className="h-full bg-accent/60 rounded-full animate-pulse w-full" />}
            </div>
            <div className="flex justify-between text-[10px] text-text-muted">
              <span>{pct}% del total</span>
              {d?.eta ? <span>Quedan {fmtDuration(d.eta)}</span> : <span />}
            </div>
          </>
        )}

        {isRunning && (d?.bytes != null || d?.filesTotal != null || d?.file) && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] bg-bg-primary/60 rounded-lg px-2.5 py-2">
            {d?.bytes != null && (<>
              <span className="text-text-muted">Descargado</span>
              <span className="text-text-secondary text-right font-mono">{fmtBytes(d.bytes)}{d.totalBytes ? ` / ${fmtBytes(d.totalBytes)}` : ''}</span>
              <span className="text-text-muted">Velocidad</span>
              <span className={`text-right font-mono ${d.speed ? 'text-text-secondary' : 'text-amber-400'}`}>{d.speed ? `${fmtBytes(d.speed)}/s` : 'sin datos ahora mismo'}</span>
            </>)}
            {d?.filesTotal != null && (<>
              <span className="text-text-muted">Archivos</span>
              <span className="text-text-secondary text-right font-mono">{d.filesDone ?? 0} / {d.filesTotal}</span>
            </>)}
            {d?.file && (<>
              <span className="text-text-muted">Archivo</span>
              <span className="text-text-secondary text-right truncate" title={d.file}>{d.file}</span>
            </>)}
          </div>
        )}

        {stalled && (
          <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
            Sin novedades desde hace {fmtDuration(idle)}. Si no avanza, el launcher lo reintenta solo; el historial de abajo dice en qué paso está.
          </p>
        )}

        {(op.log?.length ?? 0) > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wide text-text-muted">Historial</span>
              <button onClick={copyLog} className="text-[10px] text-text-muted hover:text-text-primary">
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <div className="max-h-36 overflow-y-auto rounded-lg bg-bg-primary/60 px-2 py-1.5 font-mono text-[10px] leading-relaxed space-y-0.5">
              {[...(op.log ?? [])].reverse().map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-text-muted flex-shrink-0">{fmtClock(l.at)}</span>
                  <span className="text-text-secondary break-words min-w-0">{l.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isError && (
          <button onClick={onDismiss}
            className="w-full py-1 text-[11px] text-text-muted hover:text-text-primary border border-border/50 rounded-lg transition-colors">
            Cerrar
          </button>
        )}
        {isRunning && !cancelling && (
          <button onClick={cancel}
            className="w-full py-1 text-[11px] text-text-muted hover:text-red-400 border border-border/50 hover:border-red-500/40 rounded-lg transition-colors">
            Cancelar
          </button>
        )}
        {cancelling && (
          <p className="text-[11px] text-text-muted text-center">Cancelando...</p>
        )}
      </div>
    </div>
  )
}

/* ── panel ─────────────────────────────────────────────────────── */
export default function OperationsPanel() {
  const { operations, removeOperation } = useStore((s) => ({
    operations: s.operations,
    removeOperation: s.removeOperation,
  }), shallow)

  const ops = [...operations.values()]
  if (ops.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 flex flex-col-reverse gap-2 z-50 items-end pointer-events-none">
      {ops.map((op) => (
        <div key={op.id} className="pointer-events-auto">
          <OpChip op={op} onDismiss={() => removeOperation(op.id)} />
        </div>
      ))}
    </div>
  )
}
