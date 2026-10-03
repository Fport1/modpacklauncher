import { useEffect, useState } from 'react'
import type { AiActivity, Instance } from '../../../shared/types'
import { useStore } from '../store'
import AiToolPicker from './ai/AiToolPicker'

// La IA de una instancia: prepara su carpeta y abre Claude Code, Codex, Gemini o
// Grok ya conectados al launcher. Aquí se enseña qué puede hacer, no cómo está
// hecho por dentro: eso no le hace falta al jugador.

type Status = Awaited<ReturnType<typeof window.api.aiContext.status>>

const CAN_DO: { icon: string; title: string; hint: string }[] = [
  { icon: '🩺', title: 'Arreglar crashes', hint: 'Encuentra el mod o la config que rompe la partida y lo arregla' },
  { icon: '⚡', title: 'Rendimiento', hint: 'Mira por qué va lento y ajusta memoria, mods y opciones' },
  { icon: '🧩', title: 'Mods, packs y configs', hint: 'Instala, cambia o quita mods, resource packs, shaders y datapacks' },
  { icon: '🌍', title: 'Crear y probar', hint: 'Datapacks, mundos, mobs, packs y mods, con el juego al lado' },
]

const clean = (e: unknown): string => e instanceof Error ? e.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, '') : 'Algo ha fallado'


export default function AiContextModal({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const updateInstanceStore = useStore((s) => s.updateInstance)
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [auto, setAuto] = useState(!!instance.aiAutoContext)
  const [activity, setActivity] = useState<AiActivity[]>([])

  useEffect(() => {
    window.api.aiContext.status(instance.id).then(setStatus).catch(() => setStatus({ exists: false }))
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

  return (
    <div className="fixed inset-0 z-[260] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="w-[720px] max-h-[90vh] flex flex-col bg-bg-secondary border border-border rounded-3xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-6 py-5 border-b border-border" style={{ background: 'linear-gradient(115deg, rgba(217,119,87,0.22), transparent 70%)' }}>
          <div className="w-12 h-12 rounded-2xl bg-[#d97757]/20 text-[#e8a488] flex items-center justify-center">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M10 2.5c.4 3.9 2.1 5.6 6 6-3.9.4-5.6 2.1-6 6-.4-3.9-2.1-5.6-6-6 3.9-.4 5.6-2.1 6-6Z" /><path d="M18 12.5c.25 2.3 1.2 3.25 3.5 3.5-2.3.25-3.25 1.2-3.5 3.5-.25-2.3-1.2-3.25-3.5-3.5 2.3-.25 3.25-1.2 3.5-3.5Z" /></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-text-primary">IA en esta instancia</p>
            <p className="text-xs text-text-muted">Claude Code, Codex, Gemini, Grok, Copilot o Cursor trabajando en «{instance.name}» a través del launcher: arreglar crashes, cambiar mods y packs, configs y desarrollo</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-hover">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 gap-2.5">
            {CAN_DO.map((c) => (
              <div key={c.title} className="flex gap-3 p-3 rounded-2xl bg-bg-card border border-border">
                <span className="text-xl leading-none mt-0.5">{c.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary">{c.title}</p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-snug">{c.hint}</p>
                </div>
              </div>
            ))}
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Abrir la IA ya conectada al launcher</p>
            <AiToolPicker onError={setError}
              beforeOpen={async () => { if (!status?.exists) setStatus(await window.api.aiContext.prepare(instance.id)) }}
              open={(tool) => window.api.aiAgent.openTerminal(instance.id, tool)}
              extra={<button onClick={() => window.api.instances.openFolder(instance.id)} className="px-4 py-2 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover">Abrir carpeta</button>} />
            <p className="text-xs text-text-muted mt-2">Los permisos los gestiona tu IA: antes de abrir el juego o cambiar mods, packs o configs te pedirá permiso, y puedes decirle que no vuelva a preguntar. Se abre en la carpeta del juego, ya conectada al launcher (que tiene que seguir abierto). Prueba a pedirle «el juego crashea, arréglalo» o «enlaza mi resource pack de C:\proyectos\mipack».</p>
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

        </div>
      </div>
    </div>
  )
}
