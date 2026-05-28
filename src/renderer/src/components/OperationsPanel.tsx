import { useState } from 'react'
import { useStore } from '../store'
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

/* ── single chip ───────────────────────────────────────────────── */
function OpChip({ op, onDismiss }: { op: Operation; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const meta = OP_META[op.type] ?? { label: 'Procesando', icon: <GearIcon /> }
  const pct = op.current != null && op.total != null && op.total > 0
    ? Math.min(100, Math.round((op.current / op.total) * 100))
    : 0
  const isDone = op.status === 'done'
  const isError = op.status === 'error'
  const isRunning = op.status === 'running'

  function cancel() {
    setCancelling(true)
    window.api.cancel().catch(() => {})
  }

  /* ── small (default) ── */
  if (!expanded) {
    return (
      <div className={`w-72 rounded-xl shadow-2xl border overflow-hidden transition-all ${
        isDone ? 'bg-green-950/80 border-green-700/50'
        : isError ? 'bg-red-950/80 border-red-700/50'
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
                <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            )}
            {isDone && op.message && (
              <p className="text-[10px] text-green-400/70 truncate mt-0.5">{op.message}</p>
            )}
            {isError && op.error && (
              <p className="text-[10px] text-red-400/70 truncate mt-0.5">{op.error}</p>
            )}
          </div>

          {/* right side */}
          {isRunning && (
            <span className="text-[11px] text-text-muted flex-shrink-0 font-mono">{pct}%</span>
          )}
          {isRunning && (
            <button onClick={() => setExpanded(true)} title="Expandir"
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
    <div className="w-80 bg-bg-secondary border border-border rounded-xl shadow-2xl overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border/50">
        <span className="text-accent flex-shrink-0">
          {isRunning
            ? <span className={cancelling ? '' : 'animate-spin block'}>{meta.icon}</span>
            : meta.icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-text-primary truncate">{meta.label}</p>
          <p className="text-[10px] text-text-muted truncate">{op.name}</p>
        </div>
        <button onClick={() => setExpanded(false)} title="Contraer"
          className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary flex-shrink-0">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>

      {/* body */}
      <div className="px-3 py-2.5 space-y-2">
        {op.message && (
          <p className="text-[11px] text-text-secondary truncate">{op.message}</p>
        )}

        {op.total != null && op.total > 0 && (
          <>
            <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-text-muted">
              <span>{op.current} / {op.total} {op.total > 500_000 ? 'bytes' : 'archivos'}</span>
              <span className="font-medium text-text-secondary">{pct}%</span>
            </div>
          </>
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
  }))

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
