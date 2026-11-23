import { useState } from 'react'
import { cubesOf, type SGroup, type SModel } from '../../lib/studio/model'
import Tip from './Tip'
import Icon from './icons'

// El árbol del modelo: las piezas (cabeza, brazos…) con sus cubos dentro, y los cubos sueltos.
// Cada fila se puede elegir, renombrar (doble clic), ocultar o bloquear.

interface Props {
  model: SModel
  selected: string[]
  activeGroup: string | null
  onSelect: (ids: string[], additive: boolean) => void
  onSelectGroup: (g: SGroup) => void
  onToggle: (uid: string, what: 'hidden' | 'locked') => void
  onRename: (uid: string, name: string) => void
}

export default function Outliner(p: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const els = p.model.elements ?? []
  const byId = new Map(els.map((e, i) => [e.uid, { e, i }]))
  const inGroups = new Set((p.model.groups ?? []).flatMap(cubesOf))

  const name = (uid: string, current: string, fallback: string): JSX.Element => editing === uid ? (
    <input autoFocus defaultValue={current} onBlur={(ev) => { p.onRename(uid, ev.target.value.trim() || fallback); setEditing(null) }}
      onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); if (ev.key === 'Escape') setEditing(null) }}
      onClick={(ev) => ev.stopPropagation()}
      className="flex-1 min-w-0 bg-bg-primary border border-accent rounded px-1 text-sm text-text-primary outline-none" />
  ) : <span className="flex-1 min-w-0 truncate" onDoubleClick={(ev) => { ev.stopPropagation(); setEditing(uid) }}>{current || fallback}</span>

  const toggles = (uid: string, hidden?: boolean, locked?: boolean): JSX.Element => (
    <span className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100">
      <Tip text={hidden ? 'Mostrar' : 'Ocultar (solo en el editor; en el juego se sigue viendo)'}>
        <button type="button" onClick={(ev) => { ev.stopPropagation(); p.onToggle(uid, 'hidden') }} className="w-6 h-6 rounded hover:bg-bg-hover text-xs flex items-center justify-center"><Icon name={hidden ? 'eyeOff' : 'eye'} size={13} /></button>
      </Tip>
      <Tip text={locked ? 'Desbloquear' : 'Bloquear: así no se mueve sin querer'}>
        <button type="button" onClick={(ev) => { ev.stopPropagation(); p.onToggle(uid, 'locked') }} className="w-6 h-6 rounded hover:bg-bg-hover text-xs flex items-center justify-center"><Icon name={locked ? 'lock' : 'unlock'} size={13} /></button>
      </Tip>
    </span>
  )

  const cubeRow = (uid: string, depth: number): JSX.Element | null => {
    const it = byId.get(uid)
    if (!it) return null
    const sel = p.selected.includes(uid)
    return (
      <div key={uid} onClick={(ev) => p.onSelect([uid], ev.shiftKey || ev.ctrlKey)}
        className={`group flex items-center gap-1.5 pr-1 py-1 rounded-lg cursor-pointer text-sm ${sel ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'} ${it.e.hidden ? 'opacity-50' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}>
        <Icon name="cube" size={13} className="text-sky-300/80" />
        {name(uid, it.e.name ?? '', `cubo ${it.i + 1}`)}
        {toggles(uid, it.e.hidden, it.e.locked)}
      </div>
    )
  }

  const groupRow = (g: SGroup, depth: number): JSX.Element => (
    <div key={g.uid}>
      <div onClick={() => p.onSelectGroup(g)}
        className={`group flex items-center gap-1.5 pr-1 py-1 rounded-lg cursor-pointer text-sm font-medium ${p.activeGroup === g.uid ? 'bg-sky-500/20 text-text-primary' : 'text-text-primary hover:bg-bg-hover'} ${g.hidden ? 'opacity-50' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}>
        <Icon name="part" size={13} className="text-amber-300/80" />
        {name(g.uid, g.name, 'pieza')}
        {toggles(g.uid, g.hidden, g.locked)}
      </div>
      {g.children.map((c) => (typeof c === 'string' ? cubeRow(c, depth + 1) : groupRow(c, depth + 1)))}
    </div>
  )

  return (
    <div className="flex flex-col gap-0.5" data-tour="outliner">
      {(p.model.groups ?? []).map((g) => groupRow(g, 0))}
      {els.filter((e) => !inGroups.has(e.uid)).map((e) => cubeRow(e.uid, 0))}
      {els.length === 0 && <p className="text-xs text-text-muted px-2 py-3">Este modelo no tiene cubos propios.</p>}
    </div>
  )
}
