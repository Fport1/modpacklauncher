import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { RegionChunkInfo } from '../../../../shared/types'
import type { CloseRequest } from './EditorShell'
import NbtFileView from './NbtFileView'
import { errText } from './shared'

// Un archivo de región (.mca): los 1024 chunks que caben en él (32×32) como un mapa, con lo
// básico de cada uno. Se pueden seleccionar (clic, Mayús o arrastrando), borrar y abrir uno
// en el editor NBT. Es la fase 1 del editor de mundos (docs/editor-mundos.md).

type ColorBy = 'inhabited' | 'status' | 'size' | 'updated'

const COLOR_BY: { id: ColorBy; label: string }[] = [
  { id: 'inhabited', label: 'Tiempo habitado' },
  { id: 'status', label: 'Generación' },
  { id: 'size', label: 'Tamaño' },
  { id: 'updated', label: 'Última vez guardado' },
]

const fmtTicks = (t: number | null): string => {
  if (t === null) return '—'
  const s = t / 20
  return s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`
}
const fmtSize = (b: number): string => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`

function cellColor(c: RegionChunkInfo, by: ColorBy, maxBytes: number, minTs: number, maxTs: number): string {
  if (c.error) return '#b91c1c'
  if (by === 'status') return c.status === 'minecraft:full' || c.status === 'full' ? '#16a34a' : '#ca8a04'
  if (by === 'size') return `hsl(210, 80%, ${15 + 55 * Math.min(1, c.bytes / Math.max(1, maxBytes))}%)`
  if (by === 'updated') {
    const f = maxTs > minTs ? (c.timestamp - minTs) / (maxTs - minTs) : 1
    return `hsl(280, 60%, ${15 + 55 * f}%)`
  }
  const t = c.inhabited ?? 0
  if (t <= 0) return '#334155'
  // Escala logarítmica: de unos segundos a muchas horas
  const f = Math.min(1, Math.log10(1 + t / 20) / Math.log10(1 + 36_000))
  return `hsl(${120 - 120 * f}, 85%, ${30 + 25 * f}%)`
}

interface Props {
  name: string
  /** Para enseñar dónde está */
  location: string
  side: 'local' | 'remote'
  /** Ruta del archivo (en el servidor si side es remote) */
  path: string
  onClose: () => void
  closeRef?: MutableRefObject<CloseRequest | null>
}

export default function RegionView({ name, location, side, path, onClose, closeRef }: Props) {
  const [local, setLocal] = useState<string | null>(null)
  const [chunks, setChunks] = useState<RegionChunkInfo[] | null>(null)
  const [size, setSize] = useState(0)
  const [error, setError] = useState('')
  const [by, setBy] = useState<ColorBy>('inhabited')
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [hover, setHover] = useState<RegionChunkInfo | null>(null)
  const [editing, setEditing] = useState<RegionChunkInfo | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const drag = useRef<{ from: number; add: boolean } | null>(null)
  const nbtClose = useRef<CloseRequest | null>(null)
  // Cómo venía comprimido el chunk abierto, para guardarlo igual
  const compression = useRef(2)

  async function reload(l = local): Promise<void> {
    if (!l) return
    try {
      const r = await window.api.region.list(l)
      setChunks(r.chunks)
      setSize(r.size)
    } catch (e) { setError(errText(e)) }
  }

  useEffect(() => {
    setBusy(side === 'remote' ? 'Bajando la región del servidor…' : '')
    window.api.region.open(side, path)
      .then(async (l) => { setLocal(l); await reload(l) })
      .catch((e) => setError(errText(e)))
      .finally(() => setBusy(''))
  }, [side, path])

  // Volver desde el editor NBT primero; si no, cerrar la región
  if (closeRef) closeRef.current = (done) => {
    const inner = nbtClose.current
    if (!editing) done?.()
    else if (inner) inner(() => setEditing(null))
    else setEditing(null)
  }

  const byIndex = useMemo(() => new Map((chunks ?? []).map((c) => [c.index, c])), [chunks])
  const stats = useMemo(() => {
    const list = chunks ?? []
    const ts = list.map((c) => c.timestamp).filter(Boolean)
    return {
      maxBytes: Math.max(1, ...list.map((c) => c.bytes)),
      minTs: ts.length ? Math.min(...ts) : 0,
      maxTs: ts.length ? Math.max(...ts) : 0,
      never: list.filter((c) => (c.inhabited ?? 0) <= 0).length,
      partial: list.filter((c) => c.status && c.status !== 'minecraft:full' && c.status !== 'full').length,
      broken: list.filter((c) => c.error).length,
    }
  }, [chunks])

  function rect(a: number, b: number): number[] {
    const [x1, z1, x2, z2] = [a % 32, Math.floor(a / 32), b % 32, Math.floor(b / 32)]
    const out: number[] = []
    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      const i = z * 32 + x
      if (byIndex.has(i)) out.push(i)
    }
    return out
  }

  async function removeSelected(): Promise<void> {
    if (!local || sel.size === 0) return
    if (!window.confirm(`¿Borrar ${sel.size} chunk${sel.size === 1 ? '' : 's'}? El juego los vuelve a generar desde la semilla, sin lo que se hubiera construido ahí.\n\n${side === 'remote' ? 'En el servidor queda el archivo de antes como .bak.' : 'Queda una copia del archivo de antes como .mca.bak.'}\nCierra el juego o el servidor antes.`)) return
    setBusy('Borrando…')
    try {
      await window.api.region.delete(local, [...sel])
      setMsg(`✓ ${sel.size} chunk${sel.size === 1 ? '' : 's'} borrado${sel.size === 1 ? '' : 's'}`)
      setSel(new Set())
      await reload()
    } catch (e) { setError(errText(e)) }
    finally { setBusy('') }
  }

  if (editing && local) {
    return (
      <NbtFileView name={`Chunk ${editing.x}, ${editing.z}`} location={`${location} · chunk ${editing.index}`} kind="nbt"
        remote={side === 'remote'} closeRef={nbtClose}
        warning="Guarda con el juego o el servidor cerrados: si no, el juego vuelve a escribir este chunk."
        onClose={() => { setEditing(null); void reload() }}
        load={async () => { const d = await window.api.region.read(local, editing.index); compression.current = d.regionCompression; return d }}
        save={(doc) => window.api.region.write(local, editing.index, doc, compression.current)} />
    )
  }

  const regionXZ = /^r\.(-?\d+)\.(-?\d+)\.mca$/i.exec(name)
  const info = hover ?? (sel.size === 1 ? byIndex.get([...sel][0]) ?? null : null)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border">
        <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" title="Volver">←</button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary truncate">{name}</p>
          <p className="text-[11px] text-text-muted truncate">
            {location}{regionXZ ? ` · chunks ${+regionXZ[1] * 32}…${+regionXZ[1] * 32 + 31}, ${+regionXZ[2] * 32}…${+regionXZ[2] * 32 + 31} · bloques desde ${+regionXZ[1] * 512}, ${+regionXZ[2] * 512}` : ''}
          </p>
        </div>
        <select value={by} onChange={(e) => setBy(e.target.value as ColorBy)}
          className="bg-bg-primary border border-border rounded-lg px-2 py-1 text-xs text-text-primary outline-none">
          {COLOR_BY.map((c) => <option key={c.id} value={c.id}>Color: {c.label}</option>)}
        </select>
      </div>

      {error && <p className="px-4 py-2 text-sm text-red-400">{error}</p>}
      {busy && <p className="px-4 py-2 text-sm text-text-muted">{busy}</p>}

      {chunks && (
        <div className="flex-1 flex gap-4 p-4 min-h-0 overflow-auto">
          {/* Mapa 32×32: x de izquierda a derecha, z de arriba abajo (norte arriba), como el juego */}
          <div className="shrink-0 select-none" onMouseLeave={() => setHover(null)}
            onMouseUp={() => { drag.current = null }}>
            <div className="grid gap-px bg-black/40 p-px rounded" style={{ gridTemplateColumns: 'repeat(32, 14px)' }}>
              {Array.from({ length: 1024 }, (_, i) => {
                const c = byIndex.get(i)
                const selected = sel.has(i)
                return (
                  <div key={i}
                    onMouseEnter={() => {
                      setHover(c ?? null)
                      if (drag.current && c) {
                        const r = rect(drag.current.from, i)
                        setSel((s) => { const n = new Set(drag.current!.add ? s : []); r.forEach((x) => n.add(x)); return n })
                      }
                    }}
                    onMouseDown={(e) => {
                      if (!c) return
                      if (e.shiftKey || e.ctrlKey || e.metaKey) {
                        setSel((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
                        drag.current = { from: i, add: true }
                      } else {
                        setSel(new Set([i]))
                        drag.current = { from: i, add: false }
                      }
                    }}
                    onDoubleClick={() => { if (c && !c.error) setEditing(c) }}
                    className="w-[14px] h-[14px]"
                    style={{
                      background: c ? cellColor(c, by, stats.maxBytes, stats.minTs, stats.maxTs) : '#0b0f17',
                      outline: selected ? '2px solid #fff' : undefined, outlineOffset: -1,
                      cursor: c ? 'pointer' : 'default',
                    }} />
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-text-muted max-w-[480px]">
              Clic para elegir, Mayús o Ctrl para añadir, arrastra para elegir una zona, doble clic para abrir su NBT. Norte arriba.
            </p>
          </div>

          {/* Detalle */}
          <div className="min-w-[220px] flex-1 space-y-3 text-sm">
            <div className="rounded-xl border border-border bg-bg-card p-3 space-y-1 text-xs">
              <p className="text-text-primary font-semibold text-sm">{chunks.length} de 1024 chunks · {fmtSize(size)}</p>
              <p className="text-text-muted">{stats.never} sin visitar (nadie ha estado cerca)</p>
              {stats.partial > 0 && <p className="text-amber-300">{stats.partial} a medio generar</p>}
              {stats.broken > 0 && <p className="text-red-400">{stats.broken} dañados o que no se pueden leer</p>}
            </div>

            {info ? (
              <div className="rounded-xl border border-border bg-bg-card p-3 space-y-1 text-xs">
                <p className="text-text-primary font-semibold text-sm">Chunk {info.x}, {info.z}</p>
                <p className="text-text-muted">Bloques {info.x * 16}…{info.x * 16 + 15}, {info.z * 16}…{info.z * 16 + 15}</p>
                <p>Tiempo habitado: <span className="text-text-primary">{fmtTicks(info.inhabited)}</span></p>
                <p>Generación: <span className="text-text-primary">{info.status?.replace(/^minecraft:/, '') ?? '—'}</span></p>
                <p>Tamaño: <span className="text-text-primary">{fmtSize(info.bytes)}{info.external ? ' (en un .mcc aparte)' : ''}</span></p>
                <p>Guardado: <span className="text-text-primary">{info.timestamp ? new Date(info.timestamp * 1000).toLocaleString('es') : '—'}</span></p>
                {info.dataVersion !== null && <p>Versión de datos: <span className="text-text-primary">{info.dataVersion}</span></p>}
                {info.error && <p className="text-red-400">{info.error}</p>}
              </div>
            ) : (
              <p className="text-xs text-text-muted">Pasa el ratón o elige un chunk para ver sus datos.</p>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={sel.size !== 1 || !!byIndex.get([...sel][0])?.error}
                onClick={() => setEditing(byIndex.get([...sel][0]) ?? null)}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-40">Abrir NBT</button>
              <button type="button" disabled={sel.size === 0 || !!busy} onClick={removeSelected}
                className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 text-xs hover:bg-red-500/10 disabled:opacity-40">
                Borrar {sel.size > 1 ? `${sel.size} chunks` : 'chunk'}
              </button>
              <button type="button" disabled={stats.never === 0}
                onClick={() => setSel(new Set((chunks ?? []).filter((c) => (c.inhabited ?? 0) <= 0).map((c) => c.index)))}
                className="px-3 py-1.5 rounded-lg border border-border text-text-secondary text-xs hover:text-text-primary disabled:opacity-40">
                Elegir los sin visitar
              </button>
              {sel.size > 0 && <button type="button" onClick={() => setSel(new Set())} className="text-xs text-text-muted hover:text-text-primary">Quitar selección</button>}
            </div>
            {msg && <p className="text-xs text-green-400">{msg}</p>}
            <p className="text-[11px] text-amber-300/90">⚠ Cierra el juego o el servidor antes de cambiar nada: si están abiertos, vuelven a escribir la región.</p>
          </div>
        </div>
      )}
    </div>
  )
}
