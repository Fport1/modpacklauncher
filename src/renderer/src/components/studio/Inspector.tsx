import { useEffect, useState } from 'react'
import { DIRS, DIR_NAMES, defaultUv, size, type Dir, type SElement, type SModel } from '../../lib/studio/model'
import { ANGLES } from '../../lib/studio/validate'
import Tip from './Tip'
import Icon from './icons'
import G from '../ui/Glyph'

// Lo que se puede cambiar del cubo elegido. En modo fácil, botones grandes («mover un
// píxel», «más ancho»…); en el avanzado, además, los números exactos, el punto de giro y
// cada cara con su trozo de textura (UV).

type Edit = (label: string, fn: (e: SElement, m: SModel) => void) => void

interface Props {
  model: SModel
  cube: SElement | null
  count: number
  advanced: boolean
  onEdit: Edit
  onDuplicate: () => void
  onMirror: () => void
  onDelete: () => void
  onGroup: () => void
}

function Num({ value, onCommit, step = 1 }: { value: number; onCommit: (v: number) => void; step?: number }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const commit = (): void => { const n = Number(v.replace(',', '.')); if (isFinite(n) && n !== value) onCommit(n); else setV(String(value)) }
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'ArrowUp') { e.preventDefault(); onCommit(value + step) } if (e.key === 'ArrowDown') { e.preventDefault(); onCommit(value - step) } }}
      className="w-full min-w-0 bg-bg-primary border border-border rounded-md px-1.5 py-1 text-sm text-text-primary text-right tabular-nums outline-none focus:border-accent" />
  )
}

const AX = ['x', 'y', 'z'] as const
const AXIS_NAMES = { x: 'X (izquierda-derecha)', y: 'Y (arriba-abajo)', z: 'Z (delante-detrás)' }

function Big({ tip, children, onClick, danger }: { tip: string; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <Tip text={tip}>
      <button type="button" onClick={onClick}
        className={`min-w-[2.5rem] h-9 px-2 rounded-lg border text-sm inline-flex items-center justify-center gap-1.5 ${danger ? 'border-red-500/40 text-red-300 hover:bg-red-500/10' : 'border-border text-text-primary hover:bg-bg-hover hover:border-accent/50'}`}>
        {children}
      </button>
    </Tip>
  )
}

export default function Inspector({ model, cube, count, advanced, onEdit, onDuplicate, onMirror, onDelete, onGroup }: Props) {
  if (!cube && count === 0) {
    return <p className="text-sm text-text-muted p-1">Haz clic en un cubo (en la vista 3D o en la lista) para cambiarlo.</p>
  }
  const actions = (
    <div className="flex flex-wrap gap-1.5" data-tour="cube-actions">
      <Big tip="Hace una copia igual del cubo, justo encima, para no empezar de cero." onClick={onDuplicate}><Icon name="copy" size={15} />Duplicar</Big>
      <Big tip="Copia en espejo al otro lado (de izquierda a derecha). Ideal para brazos y piernas." onClick={onMirror}><Icon name="mirror" size={15} />Espejo</Big>
      <Big tip="Junta los cubos elegidos en una pieza (por ejemplo, «brazo»), con su punto de giro." onClick={onGroup}><Icon name="part" size={15} />Hacer pieza</Big>
      <Big tip="Quita el cubo del modelo. Se puede deshacer." onClick={onDelete} danger><Icon name="trash" size={15} />Borrar</Big>
    </div>
  )
  if (!cube) return <div className="space-y-3"><p className="text-sm text-text-secondary">{count} cubos elegidos</p>{actions}</div>

  const sz = size(cube)
  const texVars = Object.keys(model.textures)
  const allFacesTex = DIRS.map((d) => cube.faces[d]?.texture).filter(Boolean)
  const sameTex = allFacesTex.every((t) => t === allFacesTex[0]) ? allFacesTex[0] : ''
  const rot = cube.rotation

  return (
    <div className="space-y-4 text-sm">
      {cube.locked && <p className="text-xs text-amber-300">Está bloqueado: desbloquéalo en la lista para moverlo.</p>}

      <section className="space-y-1.5" data-tour="move-buttons">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Mover (1 píxel)</p>
        <div className="grid grid-cols-3 gap-1.5">
          <Big tip="Mueve el cubo un píxel a la izquierda (hacia el oeste)." onClick={() => onEdit('Mover', (e) => { e.from[0]--; e.to[0]--; if (e.rotation) e.rotation.origin[0]-- })}><G n="arrowLeft" /> Izq.</Big>
          <Big tip="Mueve el cubo un píxel hacia arriba." onClick={() => onEdit('Mover', (e) => { e.from[1]++; e.to[1]++; if (e.rotation) e.rotation.origin[1]++ })}><G n="arrowUp" /> Arriba</Big>
          <Big tip="Mueve el cubo un píxel a la derecha (hacia el este)." onClick={() => onEdit('Mover', (e) => { e.from[0]++; e.to[0]++; if (e.rotation) e.rotation.origin[0]++ })}>Der. <G n="arrowRight" /></Big>
          <Big tip="Mueve el cubo un píxel hacia delante (hacia el norte)." onClick={() => onEdit('Mover', (e) => { e.from[2]--; e.to[2]--; if (e.rotation) e.rotation.origin[2]-- })}><G n="arrowUp" className="rotate-45" /> Delante</Big>
          <Big tip="Mueve el cubo un píxel hacia abajo." onClick={() => onEdit('Mover', (e) => { e.from[1]--; e.to[1]--; if (e.rotation) e.rotation.origin[1]-- })}><G n="arrowDown" /> Abajo</Big>
          <Big tip="Mueve el cubo un píxel hacia atrás (hacia el sur)." onClick={() => onEdit('Mover', (e) => { e.from[2]++; e.to[2]++; if (e.rotation) e.rotation.origin[2]++ })}><G n="arrowDownLeft" /> Detrás</Big>
        </div>
      </section>

      <section className="space-y-1.5" data-tour="size-buttons">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Tamaño · {sz[0]} × {sz[1]} × {sz[2]} px</p>
        {(['Ancho', 'Alto', 'Fondo'] as const).map((n, k) => (
          <div key={n} className="flex items-center gap-1.5">
            <span className="w-14 text-text-secondary">{n}</span>
            <Big tip={`Un píxel menos de ${n.toLowerCase()}.`} onClick={() => onEdit('Cambiar tamaño', (e) => { if (e.to[k] - e.from[k] > 0) e.to[k]-- })}>−</Big>
            <span className="w-8 text-center tabular-nums text-text-primary">{sz[k]}</span>
            <Big tip={`Un píxel más de ${n.toLowerCase()}.`} onClick={() => onEdit('Cambiar tamaño', (e) => { e.to[k]++ })}>+</Big>
          </div>
        ))}
      </section>

      <section className="space-y-1.5" data-tour="rotate-buttons">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Girar {rot && rot.angle ? `· ${rot.angle}° en ${rot.axis.toUpperCase()}` : ''}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {AX.map((a) => (
            <Big key={a} tip={`Girar alrededor del eje ${AXIS_NAMES[a]}. En los modelos de bloque solo se puede girar en un eje y de 22,5 en 22,5 grados.`}
              onClick={() => onEdit('Girar', (e) => {
                const cur = e.rotation && e.rotation.axis === a ? e.rotation.angle : 0
                const next = ANGLES[Math.min(ANGLES.length - 1, ANGLES.indexOf(cur) + 1)] ?? 22.5
                e.rotation = { origin: e.rotation?.origin ?? [(e.from[0] + e.to[0]) / 2, (e.from[1] + e.to[1]) / 2, (e.from[2] + e.to[2]) / 2], axis: a, angle: next === cur ? -45 : next }
              })}><G n="rotate" /> {a.toUpperCase()}</Big>
          ))}
          {rot && <Big tip="Lo deja recto." onClick={() => onEdit('Quitar giro', (e) => { delete e.rotation })}>Recto</Big>}
        </div>
      </section>

      <section className="space-y-1.5">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Textura del cubo</p>
        <select value={sameTex} onChange={(ev) => onEdit('Cambiar textura', (e) => { for (const d of DIRS) if (e.faces[d]) e.faces[d]!.texture = ev.target.value })}
          className="w-full bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary outline-none">
          {!sameTex && <option value="">(cada cara una distinta)</option>}
          {texVars.map((v) => <option key={v} value={`#${v}`}>{v} · {model.textures[v]}</option>)}
        </select>
      </section>

      {actions}

      {advanced && (
        <section className="space-y-3 pt-2 border-t border-border">
          <p className="text-xs font-semibold text-sky-300 uppercase tracking-wide">Avanzado</p>
          {(['from', 'to'] as const).map((k) => (
            <div key={k} className="grid grid-cols-[3.5rem_1fr_1fr_1fr] gap-1 items-center">
              <Tip text={k === 'from' ? 'Esquina donde empieza el cubo (x, y, z en píxeles).' : 'Esquina donde acaba el cubo.'}><span className="text-text-secondary text-xs">{k === 'from' ? 'Desde' : 'Hasta'}</span></Tip>
              {[0, 1, 2].map((i) => <Num key={i} value={cube[k][i]} step={0.25} onCommit={(v) => onEdit('Cambiar posición', (e) => { e[k][i] = v })} />)}
            </div>
          ))}
          <div className="grid grid-cols-[3.5rem_1fr_1fr_1fr] gap-1 items-center">
            <Tip text="Punto de giro: el cubo gira alrededor de este punto."><span className="text-text-secondary text-xs">Pivote</span></Tip>
            {[0, 1, 2].map((i) => <Num key={i} value={rot?.origin[i] ?? 8} step={0.5} onCommit={(v) => onEdit('Mover pivote', (e) => { e.rotation = { origin: [...(e.rotation?.origin ?? [8, 8, 8])] as SElement['from'], axis: e.rotation?.axis ?? 'y', angle: e.rotation?.angle ?? 0, rescale: e.rotation?.rescale }; e.rotation.origin[i] = v })} />)}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={rot?.axis ?? 'y'} onChange={(ev) => onEdit('Eje de giro', (e) => { e.rotation = { origin: e.rotation?.origin ?? [8, 8, 8], angle: e.rotation?.angle ?? 0, rescale: e.rotation?.rescale, axis: ev.target.value as 'x' | 'y' | 'z' } })}
              className="bg-bg-primary border border-border rounded-md px-1.5 py-1 text-sm text-text-primary">
              {AX.map((a) => <option key={a} value={a}>Eje {a.toUpperCase()}</option>)}
            </select>
            <select value={rot?.angle ?? 0} onChange={(ev) => onEdit('Ángulo', (e) => { e.rotation = { origin: e.rotation?.origin ?? [8, 8, 8], axis: e.rotation?.axis ?? 'y', rescale: e.rotation?.rescale, angle: Number(ev.target.value) } })}
              className="bg-bg-primary border border-border rounded-md px-1.5 py-1 text-sm text-text-primary">
              {ANGLES.map((a) => <option key={a} value={a}>{a}°</option>)}
            </select>
            <Tip text="Estira el cubo al girarlo para que ocupe lo mismo (útil en plantas cruzadas)."><label className="flex items-center gap-1 text-xs text-text-secondary"><input type="checkbox" checked={!!rot?.rescale} onChange={(ev) => onEdit('Reescalar', (e) => { if (e.rotation) e.rotation.rescale = ev.target.checked || undefined })} /> Reescalar</label></Tip>
            <Tip text="Si se quita, el cubo no se oscurece por los lados (como si brillara un poco)."><label className="flex items-center gap-1 text-xs text-text-secondary"><input type="checkbox" checked={cube.shade !== false} onChange={(ev) => onEdit('Sombra', (e) => { e.shade = ev.target.checked ? undefined : false })} /> Sombra</label></Tip>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-text-muted">Caras: qué trozo de la textura pinta cada una (UV: u1, v1, u2, v2 en píxeles de 0 a 16).</p>
            {DIRS.map((d: Dir) => {
              const f = cube.faces[d]
              return (
                <div key={d} className="rounded-lg border border-border p-1.5 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <label className="flex items-center gap-1 text-xs text-text-primary w-16"><input type="checkbox" checked={!!f} onChange={(ev) => onEdit('Cara', (e) => { if (ev.target.checked) e.faces[d] = { texture: sameTex || `#${texVars[0] ?? 'missing'}`, uv: defaultUv(d, e) }; else delete e.faces[d] })} />{DIR_NAMES[d]}</label>
                    {f && (
                      <>
                        <select value={f.texture} onChange={(ev) => onEdit('Textura de cara', (e) => { e.faces[d]!.texture = ev.target.value })} className="flex-1 min-w-0 bg-bg-primary border border-border rounded px-1 py-0.5 text-xs text-text-primary">
                          {texVars.map((v) => <option key={v} value={`#${v}`}>{v}</option>)}
                          {!texVars.includes(f.texture.slice(1)) && <option value={f.texture}>{f.texture}</option>}
                        </select>
                        <select value={f.rotation ?? 0} onChange={(ev) => onEdit('Girar textura', (e) => { const r = Number(ev.target.value); e.faces[d]!.rotation = r || undefined })} className="bg-bg-primary border border-border rounded px-1 py-0.5 text-xs text-text-primary">
                          {[0, 90, 180, 270].map((r) => <option key={r} value={r}>{r}°</option>)}
                        </select>
                      </>
                    )}
                  </div>
                  {f && (
                    <div className="grid grid-cols-4 gap-1">
                      {[0, 1, 2, 3].map((i) => <Num key={i} value={(f.uv ?? defaultUv(d, cube))[i]} step={0.5} onCommit={(v) => onEdit('UV', (e) => { const uv = [...(e.faces[d]!.uv ?? defaultUv(d, e))] as [number, number, number, number]; uv[i] = v; e.faces[d]!.uv = uv })} />)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
