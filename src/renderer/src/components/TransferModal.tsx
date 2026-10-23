import { useEffect, useMemo, useState } from 'react'
import type { Instance, TransferKey, TransferPlan, TransferResult } from '../../../shared/types'
import { DOT_MINECRAFT_ID } from '../../../shared/types'
import { IconCopy, IconTransfer, IconCheck } from './ui/icons'

// Pasar contenido (mods, packs, mundos…) de una instancia a otra, también a o desde la
// carpeta .minecraft del launcher oficial. Tres pasos: a dónde y cómo, qué, y revisar los
// avisos antes de hacerlo. Nada se toca hasta pulsar el botón del último paso.

interface Props {
  source: Instance
  instances: Instance[]
  onClose: () => void
  onFinished: (result: TransferResult, mode: 'copy' | 'move') => void
}

type Step = 'target' | 'content' | 'confirm'

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${Math.round(b / 1024)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

const isDot = (i: { id: string }): boolean => i.id === DOT_MINECRAFT_ID

function InstanceTag({ inst }: { inst: { id: string; name: string; minecraft: string; modloader: string } }) {
  return (
    <span className="min-w-0">
      <span className={`block text-sm font-medium truncate ${isDot(inst) ? 'text-emerald-300' : 'text-text-primary'}`}>{inst.name}</span>
      <span className="block text-[11px] text-text-muted capitalize">MC {inst.minecraft} · {inst.modloader}</span>
    </span>
  )
}

export default function TransferModal({ source, instances, onClose, onFinished }: Props) {
  const [step, setStep] = useState<Step>('target')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [mode, setMode] = useState<'copy' | 'move'>('copy')
  const [plan, setPlan] = useState<TransferPlan | null>(null)
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [error, setError] = useState('')
  /** Elementos elegidos de cada categoría */
  const [picked, setPicked] = useState<Record<string, Set<string>>>({})
  const [open, setOpen] = useState<Set<TransferKey>>(new Set())
  const [conflict, setConflict] = useState<'overwrite' | 'skip'>('skip')
  const [understood, setUnderstood] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !running) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, onClose])

  const targets = instances.filter((i) => i.id !== source.id)

  async function goContent(): Promise<void> {
    if (!targetId) return
    setLoadingPlan(true); setError('')
    try {
      const p = await window.api.instances.transferPlan(source.id, targetId)
      setPlan(p)
      setPicked({})
      setOpen(new Set())
      setStep('content')
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, '') : 'No se pudo leer la instancia')
    } finally { setLoadingPlan(false) }
  }

  // ── Selección ──
  const toggleItem = (key: TransferKey, name: string): void => setPicked((prev) => {
    const set = new Set(prev[key] ?? [])
    if (set.has(name)) set.delete(name); else set.add(name)
    return { ...prev, [key]: set }
  })
  const toggleCategory = (key: TransferKey, names: string[]): void => setPicked((prev) => {
    const all = (prev[key]?.size ?? 0) === names.length
    return { ...prev, [key]: all ? new Set() : new Set(names) }
  })

  const summary = useMemo(() => {
    if (!plan) return null
    let count = 0, size = 0, conflicts = 0, similar = 0
    const keys = new Set<TransferKey>()
    for (const c of plan.categories) {
      const set = picked[c.key]
      if (!set?.size) continue
      keys.add(c.key)
      for (const it of c.items) {
        if (!set.has(it.name)) continue
        count++; size += it.size
        if (it.exists) conflicts++
        if (it.similar) similar++
      }
    }
    return { count, size, conflicts, similar, keys }
  }, [plan, picked])

  // ── Avisos del último paso ──
  const warnings = useMemo(() => {
    if (!plan || !summary) return []
    const w: { text: string; strong?: boolean }[] = []
    const { keys } = summary
    const gameContent = keys.has('mods') || keys.has('saves') || keys.has('resourcepacks') || keys.has('shaderpacks') || keys.has('config')
    if (plan.source.minecraft !== plan.target.minecraft && gameContent) {
      w.push({ strong: true, text: `El origen es Minecraft ${plan.source.minecraft} y el destino ${plan.target.minecraft}. Los mods y packs de otra versión pueden no funcionar, y abrir un mundo en otra versión puede estropearlo: haz una copia de tus mundos antes.` })
    }
    if (keys.has('mods')) {
      if (plan.target.modloader === 'vanilla') w.push({ strong: true, text: 'La instancia de destino no tiene modloader (es vanilla): los mods no se cargarán.' })
      else if (plan.source.modloader !== plan.target.modloader && plan.source.modloader !== 'vanilla') {
        w.push({ strong: true, text: `Los mods de ${plan.source.modloader} no suelen funcionar en ${plan.target.modloader}: el juego puede no arrancar.` })
      }
      if (summary.similar) w.push({ text: `${summary.similar} mod(s) parecen tener ya otra versión en el destino: tendrías el mismo mod dos veces y el juego podría no arrancar. Quita la versión vieja del destino después.` })
    }
    if (summary.conflicts) {
      w.push(conflict === 'overwrite'
        ? { strong: true, text: `${summary.conflicts} elemento(s) ya existen en el destino y se reemplazarán por los del origen. Lo que había en el destino se pierde.` }
        : { text: `${summary.conflicts} elemento(s) ya existen en el destino: se dejarán como están (no se copian).` })
    }
    if (keys.has('options') && plan.categories.find((c) => c.key === 'options')?.items[0]?.exists && conflict === 'overwrite') {
      w.push({ text: 'Tus ajustes del juego en el destino (vídeo, sonido, controles…) se cambiarán por los del origen.' })
    }
    if (keys.has('config') && conflict === 'overwrite') w.push({ text: 'La configuración de los mods del destino que tenga el mismo nombre se sustituirá.' })
    if (mode === 'move') w.push({ strong: true, text: `Al mover, todo lo elegido desaparece de «${plan.source.name}».` })
    if (isDot(plan.target)) w.push({ text: 'Vas a cambiar archivos de tu Minecraft normal (.minecraft): también los verá el launcher oficial de Minecraft.' })
    if (isDot(plan.source) && mode === 'move') w.push({ strong: true, text: 'Vas a quitar archivos de tu Minecraft normal (.minecraft).' })
    return w
  }, [plan, summary, conflict, mode])

  const blocked = plan
    ? plan.targetRunning ? `«${plan.target.name}» está abierta: cierra el juego para poder pasarle contenido.`
      : plan.sourceRunning && mode === 'move' ? `«${plan.source.name}» está abierta: ciérrala para mover desde ella (o elige Copiar).`
      : null
    : null
  const risky = warnings.some((w) => w.strong) || mode === 'move'

  async function run(): Promise<void> {
    if (!plan) return
    setRunning(true); setError('')
    try {
      const selection = plan.categories
        .filter((c) => picked[c.key]?.size)
        .map((c) => ({ key: c.key, names: [...picked[c.key]] }))
      const result = await window.api.instances.transfer({ sourceId: source.id, targetId: plan.target.id, selection, mode, conflict })
      onFinished(result, mode)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, '') : 'No se pudo transferir')
      setRunning(false)
    }
  }

  const stepIdx = step === 'target' ? 0 : step === 'content' ? 1 : 2

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { if (!running) onClose() }}>
      <div className="relative bg-bg-secondary border border-border rounded-2xl w-[min(720px,94vw)] max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Cabecera con los pasos */}
        <div className="px-6 pt-5 pb-4 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0"><IconTransfer size={18} /></div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-text-primary">Transferir contenido</h2>
              <p className="text-xs text-text-muted truncate">Desde «{source.name}» · sin volver a descargar nada</p>
            </div>
            <button onClick={onClose} disabled={running} className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover disabled:opacity-40">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <div className="flex items-center gap-2 mt-4">
            {['Destino', 'Qué pasar', 'Revisar'].map((label, i) => (
              <div key={label} className="flex items-center gap-2 flex-1">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${i < stepIdx ? 'bg-accent text-white' : i === stepIdx ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-bg-hover text-text-muted'}`}>
                  {i < stepIdx ? <IconCheck size={12} /> : i + 1}
                </span>
                <span className={`text-xs ${i === stepIdx ? 'text-text-primary font-medium' : 'text-text-muted'}`}>{label}</span>
                {i < 2 && <span className="flex-1 h-px bg-border" />}
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* ── Paso 1: destino y modo ── */}
          {step === 'target' && (
            <>
              <section>
                <p className="text-xs font-semibold text-text-primary mb-2">¿A qué instancia?</p>
                {targets.length === 0 && <p className="text-sm text-text-muted">No hay otras instancias.</p>}
                <div className="grid grid-cols-2 gap-2">
                  {targets.map((t) => (
                    <button key={t.id} onClick={() => setTargetId(t.id)}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${targetId === t.id
                        ? isDot(t) ? 'border-emerald-500/70 bg-emerald-500/10' : 'border-accent/70 bg-accent/10'
                        : isDot(t) ? 'border-emerald-500/30 hover:bg-emerald-500/5' : 'border-border hover:bg-bg-hover'}`}>
                      <span className={`w-2 h-8 rounded-full shrink-0 ${isDot(t) ? 'bg-emerald-500' : targetId === t.id ? 'bg-accent' : 'bg-border'}`} />
                      <InstanceTag inst={t} />
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <p className="text-xs font-semibold text-text-primary mb-2">¿Cómo?</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['copy', 'Copiar', 'Queda en las dos instancias. Lo más seguro.', <IconCopy key="c" size={16} />],
                    ['move', 'Mover', `Se pasa al destino y se quita de «${source.name}».`, <IconTransfer key="m" size={16} />],
                  ] as const).map(([k, title, hint, icon]) => (
                    <button key={k} onClick={() => setMode(k)}
                      className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${mode === k ? 'border-accent/70 bg-accent/10' : 'border-border hover:bg-bg-hover'}`}>
                      <span className={`mt-0.5 ${mode === k ? 'text-accent' : 'text-text-muted'}`}>{icon}</span>
                      <span>
                        <span className="block text-sm font-semibold text-text-primary">{title}</span>
                        <span className="block text-[11px] text-text-muted mt-0.5">{hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* ── Paso 2: qué pasar ── */}
          {step === 'content' && plan && (
            <>
              <div className="flex items-center gap-3 text-xs bg-bg-card border border-border rounded-xl px-3 py-2.5">
                <InstanceTag inst={plan.source} />
                <span className="text-text-muted shrink-0">{mode === 'move' ? 'mover a' : 'copiar a'} →</span>
                <InstanceTag inst={plan.target} />
              </div>
              {plan.categories.length === 0 && <p className="text-sm text-text-muted">«{plan.source.name}» no tiene nada que pasar.</p>}
              <div className="space-y-2">
                {plan.categories.map((c) => {
                  const names = c.items.map((i) => i.name)
                  const n = picked[c.key]?.size ?? 0
                  const all = n === names.length && n > 0
                  const isOpen = open.has(c.key)
                  const size = c.items.reduce((s, i) => s + i.size, 0)
                  return (
                    <div key={c.key} className={`border rounded-xl overflow-hidden ${n ? 'border-accent/40' : 'border-border'}`}>
                      <div className="flex items-center gap-3 px-3 py-2.5 bg-bg-card">
                        <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = n > 0 && !all }}
                          onChange={() => toggleCategory(c.key, names)} className="w-4 h-4 accent-accent shrink-0" />
                        <button className="flex-1 min-w-0 text-left" onClick={() => !c.single && setOpen((p) => { const s = new Set(p); if (s.has(c.key)) s.delete(c.key); else s.add(c.key); return s })}>
                          <span className="block text-sm text-text-primary">{c.label} {!c.single && <span className="text-text-muted text-xs">({n ? `${n} de ` : ''}{names.length})</span>}</span>
                          <span className="block text-[11px] text-text-muted truncate">{c.hint}</span>
                        </button>
                        <span className="text-[11px] text-text-muted shrink-0">{fmtSize(size)}</span>
                        {c.single && c.items[0].exists && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 shrink-0">ya existe</span>}
                        {!c.single && (
                          <button onClick={() => setOpen((p) => { const s = new Set(p); if (s.has(c.key)) s.delete(c.key); else s.add(c.key); return s })}
                            className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary shrink-0" title={isOpen ? 'Ocultar' : 'Elegir uno a uno'}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
                          </button>
                        )}
                      </div>
                      {isOpen && (
                        <div className="max-h-56 overflow-y-auto divide-y divide-border/40 border-t border-border/60">
                          {c.items.map((it) => (
                            <label key={it.name} className="flex items-center gap-3 px-3 py-1.5 pl-10 cursor-pointer hover:bg-bg-hover">
                              <input type="checkbox" checked={!!picked[c.key]?.has(it.name)} onChange={() => toggleItem(c.key, it.name)} className="w-3.5 h-3.5 accent-accent shrink-0" />
                              <span className="flex-1 min-w-0 text-xs text-text-secondary truncate" title={it.name}>{it.isDir ? '📁 ' : ''}{it.name}</span>
                              {it.exists && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 shrink-0">ya existe</span>}
                              {it.similar && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-300 shrink-0" title={`En el destino: ${it.similar}`}>otra versión en destino</span>}
                              <span className="text-[10px] text-text-muted shrink-0 w-14 text-right">{fmtSize(it.size)}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* ── Paso 3: revisar ── */}
          {step === 'confirm' && plan && summary && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-bg-card border border-border rounded-xl px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-text-muted">Elementos</p>
                  <p className="text-xl font-bold text-text-primary">{summary.count}</p>
                </div>
                <div className="bg-bg-card border border-border rounded-xl px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-text-muted">Tamaño</p>
                  <p className="text-xl font-bold text-text-primary">{fmtSize(summary.size)}</p>
                </div>
                <div className="bg-bg-card border border-border rounded-xl px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-text-muted">Ya existen</p>
                  <p className={`text-xl font-bold ${summary.conflicts ? 'text-amber-300' : 'text-text-primary'}`}>{summary.conflicts}</p>
                </div>
              </div>

              {summary.conflicts > 0 && (
                <section>
                  <p className="text-xs font-semibold text-text-primary mb-2">Si ya existe en el destino…</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([['skip', 'Dejar el del destino', 'No se toca lo que ya hay'], ['overwrite', 'Reemplazarlo', 'Se pone el del origen y se pierde el otro']] as const).map(([k, t, h]) => (
                      <button key={k} onClick={() => { setConflict(k); setUnderstood(false) }}
                        className={`p-2.5 rounded-lg border text-left ${conflict === k ? 'border-accent/70 bg-accent/10' : 'border-border hover:bg-bg-hover'}`}>
                        <span className="block text-xs font-semibold text-text-primary">{t}</span>
                        <span className="block text-[10px] text-text-muted mt-0.5">{h}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {warnings.length > 0 && (
                <section className="space-y-1.5">
                  <p className="text-xs font-semibold text-text-primary">Ten en cuenta</p>
                  {warnings.map((w, i) => (
                    <div key={i} className={`flex gap-2 text-xs rounded-lg px-3 py-2 border ${w.strong ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-bg-card border-border text-text-secondary'}`}>
                      <span className="shrink-0">{w.strong ? '⚠️' : 'ℹ️'}</span>
                      <span>{w.text}</span>
                    </div>
                  ))}
                </section>
              )}

              {blocked && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{blocked}</p>}

              {risky && !blocked && (
                <label className="flex items-center gap-2.5 text-xs text-text-secondary cursor-pointer">
                  <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="w-4 h-4 accent-accent" />
                  He leído los avisos y quiero seguir
                </label>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        {/* Pie */}
        <div className="px-6 py-4 border-t border-border/60 flex items-center gap-3">
          {step !== 'target' && (
            <button onClick={() => { setStep(step === 'confirm' ? 'content' : 'target'); setUnderstood(false) }} disabled={running}
              className="px-4 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm disabled:opacity-40">Atrás</button>
          )}
          <span className="flex-1 text-xs text-text-muted">
            {step === 'content' && summary && (summary.count ? `${summary.count} elegido(s) · ${fmtSize(summary.size)}` : 'Elige qué quieres pasar')}
          </span>
          {step === 'target' && (
            <button onClick={goContent} disabled={!targetId || loadingPlan}
              className="px-5 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium">
              {loadingPlan ? 'Leyendo…' : 'Siguiente'}
            </button>
          )}
          {step === 'content' && (
            <button onClick={() => { setUnderstood(false); setStep('confirm') }} disabled={!summary?.count}
              className="px-5 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-lg text-sm font-medium">Revisar</button>
          )}
          {step === 'confirm' && (
            <button onClick={run} disabled={running || !!blocked || (risky && !understood)}
              className={`px-5 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-40 ${mode === 'move' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-accent hover:bg-accent-hover'}`}>
              {running ? 'Pasando…' : `${mode === 'move' ? 'Mover' : 'Copiar'} ${summary?.count ?? 0} elemento(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
