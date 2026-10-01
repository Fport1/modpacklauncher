import { useState, type ReactNode } from 'react'
import type { AiToolId, AiToolMissing } from '../../../../shared/types'
import { CLAUDE_PATH, GEMINI_PATH, OPENAI_PATH } from '../aiLogos'

// Botones para abrir cada IA de terminal y, si no está instalada, el panel con
// su orden oficial y un botón que la instala. Lo usan la IA de una instancia y
// la IA del launcher en general.

const clean = (e: unknown): string => e instanceof Error ? e.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, '') : 'Algo ha fallado'

// Grok no está en simple-icons: su marca es un círculo cortado por una diagonal
function GrokLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M17.5 5.2A8.5 8.5 0 1 0 19.6 16" />
      <path d="M21 3 9.5 14.5" />
    </svg>
  )
}

export const AI_TOOLS: { id: AiToolId; label: string; logo: (c: string) => JSX.Element; className: string }[] = [
  { id: 'claude', label: 'Claude Code', logo: (c) => <svg viewBox="0 0 24 24" className={c} fill="currentColor"><path d={CLAUDE_PATH} /></svg>, className: 'bg-[#d97757] hover:bg-[#c96747] text-white border-transparent' },
  { id: 'codex', label: 'Codex', logo: (c) => <svg viewBox="0 0 24 24" className={c} fill="currentColor"><path d={OPENAI_PATH} /></svg>, className: 'bg-bg-card hover:bg-bg-hover text-text-primary border-border' },
  { id: 'gemini', label: 'Gemini CLI', logo: (c) => <svg viewBox="0 0 24 24" className={c}><defs><linearGradient id="gemini-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4796e3" /><stop offset="0.5" stopColor="#9168c0" /><stop offset="1" stopColor="#d6645d" /></linearGradient></defs><path d={GEMINI_PATH} fill="url(#gemini-g)" /></svg>, className: 'bg-bg-card hover:bg-bg-hover text-text-primary border-border' },
  { id: 'grok', label: 'Grok', logo: (c) => <GrokLogo className={c} />, className: 'bg-bg-card hover:bg-bg-hover text-text-primary border-border' },
]

export default function AiToolPicker({ open, beforeOpen, extra, onError }: {
  /** Abre la IA; devuelve { missing } si no está instalada */
  open: (tool: AiToolId) => Promise<{ opened: true } | { missing: AiToolMissing }>
  /** Algo que hacer antes de abrir (preparar el contexto) */
  beforeOpen?: () => Promise<void>
  /** Botones extra al lado (abrir carpeta…) */
  extra?: ReactNode
  onError: (msg: string) => void
}) {
  const [opening, setOpening] = useState('')
  const [missing, setMissing] = useState<AiToolMissing | null>(null)
  const [installStarted, setInstallStarted] = useState(false)
  const [cmdCopied, setCmdCopied] = useState(false)

  async function openTool(tool: AiToolId): Promise<void> {
    setOpening(tool); onError('')
    try {
      await beforeOpen?.()
      const r = await open(tool)
      if ('missing' in r) {
        if (missing?.tool !== tool) setInstallStarted(false)
        setMissing(r.missing)
      } else setMissing(null)
    } catch (e) { onError(clean(e)) }
    finally { setOpening('') }
  }

  async function install(): Promise<void> {
    if (!missing) return
    onError('')
    try {
      const r = await window.api.aiAgent.installTool(missing.tool)
      setMissing(r)
      if (!r.needsNode) setInstallStarted(true)
    } catch (e) { onError(clean(e)) }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {AI_TOOLS.map((t) => (
          <button key={t.id} onClick={() => openTool(t.id)} disabled={!!opening}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-colors disabled:opacity-60 ${t.className}`}>
            {t.logo('w-[18px] h-[18px] shrink-0')}
            {opening === t.id ? 'Abriendo…' : t.label}
          </button>
        ))}
        {extra}
      </div>
      {missing && (
        <div className="mt-3 p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-lg leading-none mt-0.5">⬇</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-100">{`${missing.name} no está instalado en este equipo`}</p>
              {missing.needsNode
                ? <p className="text-xs text-amber-200/80 mt-1">Se instala con npm, que viene con Node.js, y no lo tienes. Descarga Node.js (la versión LTS), instálalo, cierra y vuelve a abrir el launcher, y luego pulsa «Instalar».</p>
                : <p className="text-xs text-amber-200/80 mt-1">{`Se instala con su orden oficial. Pulsa «Instalar» y se abrirá una terminal que lo hace sola; cuando termine, vuelve aquí y pulsa «Abrir ${missing.name}».`}</p>}
            </div>
            <button onClick={() => setMissing(null)} className="text-amber-200/60 hover:text-amber-100 text-sm" title="Cerrar">✕</button>
          </div>
          {!missing.needsNode && (
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-xl bg-black/30 text-xs text-text-primary font-mono" title={missing.command}>{missing.command}</code>
              <button onClick={() => { window.api.clipboard.writeText(missing.command).catch(() => {}); setCmdCopied(true); setTimeout(() => setCmdCopied(false), 2000) }}
                className="px-3 py-2 rounded-xl border border-border text-xs text-text-secondary hover:text-text-primary shrink-0">{cmdCopied ? 'Copiado ✓' : 'Copiar'}</button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {missing.needsNode
              ? <button onClick={() => window.api.shell.openExternal('https://nodejs.org/')} className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold">Descargar Node.js</button>
              : <button onClick={install} className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold">{installStarted ? 'Instalar de nuevo' : 'Instalar'}</button>}
            <button onClick={() => openTool(missing.tool)} disabled={!!opening}
              className="px-4 py-2 rounded-xl border border-amber-500/40 text-amber-100 text-sm font-semibold hover:bg-amber-500/10 disabled:opacity-60">
              {opening === missing.tool ? 'Buscando…' : `Abrir ${missing.name}`}
            </button>
            <button onClick={() => window.api.shell.openExternal(missing.docs)} className="text-xs text-amber-200/70 hover:text-amber-100 underline underline-offset-2 ml-auto">Instrucciones oficiales</button>
          </div>
          {installStarted && <p className="text-xs text-amber-200/80"><span>{`Se ha abierto una terminal instalando ${missing.name}.`}</span>{missing.after && <span> {missing.after}</span>}</p>}
        </div>
      )}
    </>
  )
}
