import { useState } from 'react'
import { errText } from './ftp/shared'

// Limpiar un mundo: quitar los chunks por los que casi no ha pasado nadie. Es lo que más
// ocupa en un mundo de servidor (todo lo que se generó al volar o explorar de lejos) y se
// vuelve a generar igual si alguien vuelve a pasar, porque sale de la misma semilla.
// Primero se analiza (sin tocar nada) y, al confirmar, se hace una copia del mundo entero y
// se limpia.

const LEVELS: { ticks: number; label: string; hint: string }[] = [
  { ticks: 1, label: 'Nadie ha estado cerca', hint: 'Solo lo que se generó de lejos. Lo más seguro.' },
  { ticks: 20 * 60, label: 'Menos de 1 minuto', hint: 'Zonas por las que solo se pasó de camino.' },
  { ticks: 20 * 60 * 5, label: 'Menos de 5 minutos', hint: 'Limpia mucho más; revisa que no haya construcciones lejanas.' },
  { ticks: 20 * 60 * 30, label: 'Menos de 30 minutos', hint: 'Agresivo: solo para servidores muy grandes.' },
]

const DIM_NAMES: Record<string, string> = {
  '.': 'Mundo normal', 'DIM-1': 'Nether', 'DIM1': 'End',
  'dimensions/minecraft/overworld': 'Mundo normal', 'dimensions/minecraft/the_nether': 'Nether', 'dimensions/minecraft/the_end': 'End',
}

const mb = (b: number): string => b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`

type Result = Awaited<ReturnType<typeof window.api.world.prune>>

export default function WorldCleanup({ worldDir, worldName, backupDir, onClose, onDone }: {
  worldDir: string
  worldName: string
  /** Dónde va la copia del mundo antes de limpiar */
  backupDir: string
  onClose: () => void
  onDone?: () => void
}) {
  const [level, setLevel] = useState(LEVELS[0].ticks)
  const [preview, setPreview] = useState<Result | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState<'scan' | 'apply' | null>(null)
  const [error, setError] = useState('')

  async function scan(ticks = level): Promise<void> {
    setBusy('scan'); setError(''); setPreview(null); setResult(null)
    try { setPreview(await window.api.world.prune(worldDir, { minInhabited: ticks, dryRun: true })) }
    catch (e) { setError(errText(e)) }
    finally { setBusy(null) }
  }

  async function apply(): Promise<void> {
    if (!preview) return
    const n = preview.dims.reduce((s, d) => s + d.remove, 0)
    if (!window.confirm(`Se quitarán ${n.toLocaleString('es')} chunks de «${worldName}».\n\nAntes se guarda una copia del mundo entero en:\n${backupDir}\n\nCierra el juego y el servidor que use este mundo. ¿Seguir?`)) return
    setBusy('apply'); setError('')
    try { setResult(await window.api.world.prune(worldDir, { minInhabited: level, dryRun: false, backupDir })); onDone?.() }
    catch (e) { setError(errText(e)) }
    finally { setBusy(null) }
  }

  const shown = result ?? preview
  const totals = shown?.dims.reduce((t, d) => ({ chunks: t.chunks + d.chunks, remove: t.remove + d.remove, before: t.before + d.bytesBefore, after: t.after + d.bytesAfter }), { chunks: 0, remove: 0, before: 0, after: 0 })

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="w-[min(600px,100%)] bg-bg-secondary border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-text-primary">🧹 Limpiar «{worldName}»</p>
            <p className="text-xs text-text-muted mt-0.5">
              Quita los chunks por los que casi no ha pasado nadie. Si alguien vuelve, el juego los genera otra vez igual (sale de la misma semilla), pero sin lo que hubiera cambiado ahí.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} className="w-8 h-8 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {LEVELS.map((l) => (
            <button key={l.ticks} type="button" disabled={!!busy || !!result}
              onClick={() => { setLevel(l.ticks); if (preview) void scan(l.ticks) }}
              className={`text-left px-3 py-2 rounded-lg border ${level === l.ticks ? 'border-accent bg-accent/10' : 'border-border bg-bg-card hover:border-accent/40'}`}>
              <span className="block text-sm text-text-primary">{l.label}</span>
              <span className="block text-[10px] text-text-muted leading-tight">{l.hint}</span>
            </button>
          ))}
        </div>

        {shown && totals && (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-bg-card text-text-muted">
                <tr><th className="text-left px-3 py-1.5">Dimensión</th><th className="text-right px-2">Chunks</th><th className="text-right px-2">{result ? 'Quitados' : 'Se quitan'}</th><th className="text-right px-3">Tamaño</th></tr>
              </thead>
              <tbody>
                {shown.dims.map((d) => (
                  <tr key={d.dim} className="border-t border-border">
                    <td className="px-3 py-1.5 text-text-primary">{DIM_NAMES[d.dim] ?? d.dim}</td>
                    <td className="text-right px-2 text-text-secondary">{d.chunks.toLocaleString('es')}</td>
                    <td className="text-right px-2 text-amber-300">{d.remove.toLocaleString('es')}{d.unknown ? <span className="text-text-muted" title="Chunks que no se pueden leer (otra compresión o dañados): se dejan como están"> · {d.unknown} sin leer</span> : null}</td>
                    <td className="text-right px-3 text-text-secondary">{mb(d.bytesBefore)} → <span className="text-green-300">{result ? '' : '~'}{mb(d.bytesAfter)}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-bg-card">
                <tr>
                  <td className="px-3 py-1.5 font-semibold text-text-primary">Total</td>
                  <td className="text-right px-2 text-text-secondary">{totals.chunks.toLocaleString('es')}</td>
                  <td className="text-right px-2 text-amber-300">{totals.remove.toLocaleString('es')} ({totals.chunks ? Math.round((totals.remove / totals.chunks) * 100) : 0} %)</td>
                  <td className="text-right px-3 text-text-secondary">{mb(totals.before)} → <span className="text-green-300">{result ? '' : '~'}{mb(totals.after)}</span></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {result?.backup && <p className="text-xs text-green-400 break-all">✓ Mundo limpio. Copia de antes en {result.backup}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={!!busy} className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-secondary">{result ? 'Cerrar' : 'Cancelar'}</button>
          {!result && (
            preview ? (
              <button type="button" onClick={apply} disabled={!!busy || totals?.remove === 0} className="px-4 py-1.5 rounded-lg bg-accent text-white text-sm disabled:opacity-40">
                {busy === 'apply' ? 'Copiando y limpiando…' : 'Limpiar (con copia)'}
              </button>
            ) : (
              <button type="button" onClick={() => scan()} disabled={!!busy} className="px-4 py-1.5 rounded-lg bg-accent text-white text-sm disabled:opacity-40">
                {busy === 'scan' ? 'Analizando…' : 'Analizar (no cambia nada)'}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
