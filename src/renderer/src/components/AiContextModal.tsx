import { useEffect, useState } from 'react'
import type { AiActivity, Instance } from '../../../shared/types'
import { useStore } from '../store'

// Prepara la carpeta de una instancia para trabajar con Claude Code u otra IA:
// AGENTS.md / CLAUDE.md / GEMINI.md, fichas de cada mod en .ai/ y habilidades
// de Claude Code en .claude/skills/.

type Status = Awaited<ReturnType<typeof window.api.aiContext.status>>

const GENERATED = [
  ['AGENTS.md', 'Versión de Minecraft, loader, pack_format y reglas. Lo leen Codex, Cursor, Copilot, Gemini y otras.'],
  ['CLAUDE.md · GEMINI.md', 'Apuntan a AGENTS.md para Claude Code y Gemini CLI (más tus notas de NOTAS.md).'],
  ['.ai/mods/', 'Una ficha por mod: descripción del autor (comandos, configuración), wiki, fallos conocidos, dependencias, incompatibilidades, sus configs e ids de bloques e ítems.'],
  ['.ai/worlds.md · packs.md', 'Mundos con sus datapacks, resource packs y shaders.'],
  ['.claude/skills/', 'Habilidades de Claude Code: arreglar crashes en bucle, desarrollo (mods, packs y datapacks con el juego al lado), configs y diagnóstico.'],
  ['.mcp.json · .cursor · .gemini · .codex · .vscode', 'Conectan cada IA con el launcher (servidor MCP «modpack-launcher»): lanzar el juego, leer crashes, instalar, quitar o cambiar de versión mods y packs, editar configs.'],
  ['.ai/lecciones.md', 'Lo que la IA aprende al arreglar fallos; lo lee antes de diagnosticar para detectarlos antes.'],
] as const

const clean = (e: unknown): string => e instanceof Error ? e.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, '') : 'Algo ha fallado'

const MODES = [
  { id: 'off', label: 'Solo mirar', desc: 'Lee logs, crashes, mods y configs, pero no cambia nada ni abre el juego.' },
  { id: 'ask', label: 'Preguntar', desc: 'Antes de abrir el juego o cambiar mods, packs o configs, el launcher te pide permiso.' },
  { id: 'auto', label: 'Automático', desc: 'Prueba, corrige y vuelve a probar sola hasta que funcione. Todo queda en la actividad y se puede deshacer.' },
] as const

export default function AiContextModal({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const updateInstanceStore = useStore((s) => s.updateInstance)
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dir, setDir] = useState('')
  const [copied, setCopied] = useState(false)
  const [auto, setAuto] = useState(!!instance.aiAutoContext)
  const [control, setControl] = useState<'off' | 'ask' | 'auto'>(instance.aiControl ?? 'off')
  const [activity, setActivity] = useState<AiActivity[]>([])
  const [opening, setOpening] = useState('')

  useEffect(() => {
    window.api.aiContext.status(instance.id).then(setStatus).catch(() => setStatus({ exists: false }))
    window.api.instances.savesPath(instance.id).then((p) => window.api.ftp.localParent(p)).then(setDir).catch(() => {})
  }, [instance.id])

  useEffect(() => {
    window.api.aiAgent.activity(instance.id).then(setActivity).catch(() => {})
    return window.api.aiAgent.onActivity((a) => { if (a.instanceId === instance.id) setActivity((l) => [...l.slice(-99), a]) })
  }, [instance.id])

  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  async function prepare(): Promise<void> {
    setBusy(true); setError('')
    try { setStatus(await window.api.aiContext.prepare(instance.id)) }
    catch (e) { setError(clean(e)) }
    finally { setBusy(false) }
  }

  async function toggleAuto(): Promise<void> {
    const updated = { ...instance, aiAutoContext: !auto }
    setAuto(!auto)
    await window.api.instances.update(updated)
    updateInstanceStore(updated)
  }

  async function changeControl(mode: 'off' | 'ask' | 'auto'): Promise<void> {
    setControl(mode)
    try { updateInstanceStore(await window.api.aiAgent.setControl(instance.id, mode)) }
    catch (e) { setError(clean(e)) }
  }

  async function openTool(tool: 'claude' | 'codex' | 'gemini'): Promise<void> {
    setOpening(tool); setError('')
    try {
      if (!status?.exists) setStatus(await window.api.aiContext.prepare(instance.id))
      await window.api.aiAgent.openTerminal(instance.id, tool)
    } catch (e) { setError(clean(e)) }
    finally { setOpening('') }
  }

  const command = dir ? `cd "${dir}"; claude` : ''

  return (
    <div className="fixed inset-0 z-[260] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="w-[720px] max-h-[90vh] flex flex-col bg-bg-secondary border border-border rounded-3xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-6 py-5 border-b border-border" style={{ background: 'linear-gradient(115deg, rgba(217,119,87,0.22), transparent 70%)' }}>
          <div className="w-12 h-12 rounded-2xl bg-[#d97757]/20 text-[#e8a488] flex items-center justify-center text-2xl">✳</div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-text-primary">IA en esta instancia</p>
            <p className="text-xs text-text-muted">Claude Code, Codex, Gemini, Copilot o Cursor trabajando en «{instance.name}» a través del launcher: arreglar crashes, cambiar mods y packs, configs y desarrollo</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-hover">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Qué puede hacer la IA</p>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button key={m.id} onClick={() => changeControl(m.id)}
                  className={`text-left px-3.5 py-3 rounded-2xl border transition-colors ${control === m.id ? 'bg-[#d97757]/15 border-[#d97757]/60' : 'bg-bg-card border-border hover:border-[#d97757]/30'}`}>
                  <p className={`text-sm font-bold ${control === m.id ? 'text-[#e8a488]' : 'text-text-primary'}`}>{m.label}</p>
                  <p className="text-[11px] text-text-muted mt-1 leading-snug">{m.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Abrir la IA ya conectada al launcher</p>
            <div className="flex flex-wrap gap-2">
              {([['claude', 'Claude Code'], ['codex', 'Codex'], ['gemini', 'Gemini CLI']] as const).map(([id, label]) => (
                <button key={id} onClick={() => openTool(id)} disabled={!!opening}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60 ${id === 'claude' ? 'bg-[#d97757] hover:bg-[#c96747] text-white' : 'border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`}>
                  {opening === id ? 'Abriendo…' : label}
                </button>
              ))}
              <button onClick={() => window.api.instances.openFolder(instance.id)}
                className="px-4 py-2 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover">Abrir carpeta</button>
            </div>
            <p className="text-xs text-text-muted mt-2">Se abre en la carpeta del juego con las herramientas del launcher cargadas. Prueba a pedirle «el juego crashea, arréglalo» o «enlaza mi resource pack de C:\proyectos\mipack».</p>
          </div>

          {activity.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Actividad de la IA</p>
              <div className="max-h-44 overflow-y-auto rounded-2xl bg-bg-card border border-border divide-y divide-border">
                {[...activity].reverse().map((a, i) => (
                  <div key={i} className="flex gap-3 px-3.5 py-2 text-xs">
                    <span className="text-text-muted shrink-0 tabular-nums">{new Date(a.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span className={a.kind === 'error' ? 'text-red-300' : a.kind === 'denied' ? 'text-amber-300' : a.kind === 'change' ? 'text-text-primary' : 'text-text-secondary'}>{a.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${!status?.exists ? 'bg-bg-card border-border' : status.stale ? 'bg-amber-500/10 border-amber-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
            <span className="text-xl">{!status ? '…' : !status.exists ? '○' : status.stale ? '⚠' : '✓'}</span>
            <div className="flex-1 text-sm">
              {!status ? 'Comprobando…'
                : !status.exists ? <span className="text-text-secondary">Esta instancia aún no está preparada.</span>
                : status.stale ? <span className="text-amber-200">Preparada el {new Date(status.generatedAt!).toLocaleString('es')}, pero los mods han cambiado desde entonces.</span>
                : <span className="text-green-200">Preparada el {new Date(status.generatedAt!).toLocaleString('es')} · {status.mods} mods documentados.</span>}
            </div>
            <button onClick={prepare} disabled={busy}
              className="px-4 py-2 rounded-xl bg-[#d97757] hover:bg-[#c96747] text-white text-sm font-bold disabled:opacity-60">
              {busy ? 'Preparando…' : status?.exists ? 'Actualizar' : 'Preparar'}
            </button>
          </div>
          {error && <p className="text-sm text-red-300">{error}</p>}

          <label className="flex items-center gap-3 text-sm text-text-secondary cursor-pointer">
            <input type="checkbox" checked={auto} onChange={toggleAuto} className="w-4 h-4 accent-[#d97757]" />
            Actualizarlo solo cuando cambien los mods (al abrir los detalles de la instancia)
          </label>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Contexto que se crea en la carpeta del juego</p>
            <div className="space-y-1.5">
              {GENERATED.map(([file, what]) => (
                <div key={file} className="flex gap-3 px-3 py-2 rounded-xl bg-bg-card border border-border">
                  <code className="text-xs text-[#e8a488] shrink-0 w-44 pt-0.5">{file}</code>
                  <p className="text-xs text-text-secondary">{what}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Cómo usarlo</p>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm text-text-secondary">
              <li>Prepara la instancia (arriba).</li>
              <li>Usa los botones de arriba, o abre esa carpeta con tu IA. Con Claude Code, en una terminal:</li>
            </ol>
            {command && (
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 px-3 py-2 rounded-xl bg-bg-primary border border-border text-xs text-text-primary truncate">{command}</code>
                <button onClick={() => { navigator.clipboard.writeText(command).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                  className="px-3 py-2 rounded-xl border border-border text-xs text-text-secondary hover:text-text-primary">{copied ? 'Copiado ✓' : 'Copiar'}</button>
                <button onClick={() => window.api.instances.openFolder(instance.id)}
                  className="px-3 py-2 rounded-xl border border-border text-xs text-text-secondary hover:text-text-primary">Abrir carpeta</button>
              </div>
            )}
            <p className="text-xs text-text-muted mt-2">
              En VS Code, Cursor o Windsurf abre la carpeta como proyecto: cogen AGENTS.md / .cursor/rules solos. En Claude Code las habilidades
              (arreglar-crash, desarrollo, datapack, configs, resourcepack, diagnostico) se activan solas según lo que pidas. Las herramientas del launcher necesitan que el launcher esté abierto. Tus notas para la IA van en <code>NOTAS.md</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
