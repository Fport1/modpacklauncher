import { useMemo, useState } from 'react'
import type { NbtTag, NbtTagType } from '../../../../shared/types'
import {
  type Key, type Path, type Row, TYPE_BADGE, ADDABLE, ARRAY_ELEMENT, MAX_CHILDREN, isContainer, pathId,
  childrenOf, resolve, setRaw, removeAt, renameAt, addChild, parseValue, displayValue, containerSummary, uuidHint, flatten
} from '../../lib/nbtModel'

// Modo avanzado de un archivo NBT, como NBT Explorer: el árbol tal cual con
// sus tipos. Solo pinta y edita; cargar, guardar y deshacer son de quien lo usa
// (NbtFileView), que lo comparte con el modo sencillo.

interface Props {
  root: NbtTag & { name: string }
  /** Aplica un cambio (sobre una copia) y lo apunta en el historial. */
  mutate: (fn: (root: NbtTag) => void) => boolean
}

export default function NbtTree({ root, mutate }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set([pathId([])]))
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; field: 'value' | 'name'; text: string; error?: string } | null>(null)
  const [adding, setAdding] = useState<{ path: Path; type: NbtTagType; name: string; error?: string } | null>(null)
  const [filter, setFilter] = useState('')

  const rows = useMemo((): Row[] => {
    const q = filter.trim().toLowerCase()
    if (!q) return flatten(root, (id) => open.has(id))
    // Con filtro: todo desplegado, y se quedan las coincidencias con sus antepasados
    const all = flatten(root, () => true)
    const keep = new Set<string>()
    for (const r of all) {
      const text = `${r.key ?? ''} ${isContainer(r.tag.type) ? '' : displayValue(r.tag)}`.toLowerCase()
      if (r.path.length > 0 && text.includes(q)) {
        for (let i = 0; i <= r.path.length; i++) keep.add(pathId(r.path.slice(0, i)))
      }
    }
    return all.filter((r) => keep.has(pathId(r.path))).slice(0, 5000)
  }, [root, open, filter])

  const selectedRow = rows.find((r) => pathId(r.path) === selected) ?? null

  function startEdit(row: Row, field: 'value' | 'name'): void {
    if (field === 'value' && isContainer(row.tag.type)) return
    if (field === 'name' && row.parentType !== 'compound') return
    setSelected(pathId(row.path))
    setEditing({ id: pathId(row.path), field, text: field === 'value' ? displayValue(row.tag) : String(row.key) })
  }

  function commitEdit(row: Row): void {
    if (!editing) return
    if (editing.field === 'value') {
      const parsed = parseValue(row.tag.type, editing.text)
      if (!parsed.ok) { setEditing({ ...editing, error: parsed.error }); return }
      if (displayValue({ type: row.tag.type, value: parsed.value }) !== displayValue(row.tag)) {
        mutate((r) => setRaw(r, row.path, parsed.value))
      }
    } else {
      const to = editing.text.trim()
      if (to === row.key) { setEditing(null); return }
      if (!to) { setEditing({ ...editing, error: 'El nombre no puede estar vacío' }); return }
      const parent = resolve(root, row.path.slice(0, -1))
      if (to in parent.value) { setEditing({ ...editing, error: 'Ya hay una etiqueta con ese nombre' }); return }
      if (mutate((r) => renameAt(r, row.path, to))) setSelected(pathId([...row.path.slice(0, -1), to]))
    }
    setEditing(null)
  }

  function remove(row: Row): void {
    if (row.path.length === 0) return
    mutate((r) => removeAt(r, row.path))
    setSelected(null)
  }

  function startAdd(row: Row): void {
    const t = row.tag
    if (t.type === 'compound') setAdding({ path: row.path, type: 'int', name: '' })
    else if (t.type === 'list' && t.value.value.length === 0) setAdding({ path: row.path, type: 'compound', name: '' })
    else commitAdd(row.path, t.type === 'list' ? t.value.type : ARRAY_ELEMENT[t.type], '')
  }

  function commitAdd(path: Path, type: NbtTagType, childName: string): void {
    const parent = resolve(root, path)
    if (parent.type === 'compound') {
      const n = childName.trim()
      if (!n) { setAdding((a) => a && { ...a, error: 'Ponle un nombre' }); return }
      if (n in parent.value) { setAdding((a) => a && { ...a, error: 'Ya hay una etiqueta con ese nombre' }); return }
    }
    let key: Key = ''
    if (mutate((r) => { key = addChild(r, path, type, childName.trim()) })) {
      setOpen((o) => new Set(o).add(pathId(path)))
      setSelected(pathId([...path, key]))
    }
    setAdding(null)
  }

  function toggleOpen(row: Row): void {
    const id = pathId(row.path)
    setOpen((o) => {
      const n = new Set(o)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (adding || (e.target as HTMLElement).tagName === 'INPUT' || !selectedRow) return
    if (e.key === 'Delete') { e.preventDefault(); remove(selectedRow) }
    else if (e.key === 'F2') { e.preventDefault(); startEdit(selectedRow, 'name') }
    else if (e.key === 'Enter') { e.preventDefault(); startEdit(selectedRow, 'value') }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = rows.indexOf(selectedRow) + (e.key === 'ArrowDown' ? 1 : -1)
      if (rows[i]) setSelected(pathId(rows[i].path))
    } else if (e.key === 'ArrowRight' && isContainer(selectedRow.tag.type)) {
      setOpen((o) => new Set(o).add(pathId(selectedRow.path)))
    } else if (e.key === 'ArrowLeft') {
      const id = pathId(selectedRow.path)
      if (open.has(id) && isContainer(selectedRow.tag.type)) setOpen((o) => { const n = new Set(o); n.delete(id); return n })
      else if (selectedRow.path.length > 0) setSelected(pathId(selectedRow.path.slice(0, -1)))
    }
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0" onKeyDown={onKeyDown}>
      {/* Barra */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-wrap">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar por nombre o valor…"
          className="w-56 bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60" />
        <SmallBtn onClick={() => setOpen(new Set(flatten(root, () => true).filter((r) => isContainer(r.tag.type)).map((r) => pathId(r.path))))}>⊞ Desplegar</SmallBtn>
        <SmallBtn onClick={() => setOpen(new Set([pathId([])]))}>⊟ Plegar</SmallBtn>
        {selectedRow && (
          <>
            {isContainer(selectedRow.tag.type) && <SmallBtn onClick={() => startAdd(selectedRow)}>＋ Añadir dentro</SmallBtn>}
            {!isContainer(selectedRow.tag.type) && <SmallBtn onClick={() => startEdit(selectedRow, 'value')}>✎ Editar</SmallBtn>}
            {selectedRow.parentType === 'compound' && <SmallBtn onClick={() => startEdit(selectedRow, 'name')}>Renombrar</SmallBtn>}
            {selectedRow.path.length > 0 && <SmallBtn danger onClick={() => remove(selectedRow)}>🗑 Borrar</SmallBtn>}
          </>
        )}
      </div>

      {/* Árbol */}
      <div tabIndex={0} className="flex-1 overflow-auto py-1 font-mono text-[13px] outline-none">
        {rows.map((row) => {
          const id = pathId(row.path)
          const badge = TYPE_BADGE[row.tag.type] ?? TYPE_BADGE.end
          const container = isContainer(row.tag.type)
          const isOpen = open.has(id) || !!filter.trim()
          const edit = editing?.id === id ? editing : null
          const label = row.path.length === 0 ? (root.name || '(raíz)') : row.parentType === 'compound' ? String(row.key) : `[${row.key}]`
          const uuid = uuidHint(row.tag)
          return (
            <div key={id}
              onClick={() => setSelected(id)}
              onDoubleClick={() => (container ? toggleOpen(row) : startEdit(row, 'value'))}
              className={`flex items-center gap-1.5 pr-3 py-[3px] cursor-default whitespace-nowrap ${selected === id ? 'bg-accent/15' : 'hover:bg-bg-hover/60'}`}
              style={{ paddingLeft: 10 + row.depth * 18 }}>
              <span className="w-4 text-center text-text-muted select-none"
                onClick={(e) => { e.stopPropagation(); if (container) toggleOpen(row) }}>
                {container ? (isOpen ? '▾' : '▸') : ''}
              </span>
              <span className={`px-1 rounded text-[10px] font-bold min-w-[22px] text-center ${badge.cls}`} title={badge.label}>{badge.text}</span>
              {edit?.field === 'name' ? (
                <InlineInput value={edit.text} error={edit.error}
                  onChange={(t) => setEditing({ ...edit, text: t, error: undefined })}
                  onCommit={() => commitEdit(row)} onCancel={() => setEditing(null)} />
              ) : (
                <span className={row.parentType === 'compound' || row.path.length === 0 ? 'text-text-primary' : 'text-text-muted'}
                  onDoubleClick={(e) => { if (row.parentType === 'compound') { e.stopPropagation(); startEdit(row, 'name') } }}>
                  {label}
                </span>
              )}
              {container ? (
                <span className="text-text-muted text-xs">
                  {row.tag.type === 'list' && row.tag.value.type !== 'end' && `${TYPE_BADGE[row.tag.value.type]?.label ?? row.tag.value.type} · `}
                  {containerSummary(row.tag)}
                  {childrenOf(row.tag).length > MAX_CHILDREN && isOpen && ` (se muestran ${MAX_CHILDREN})`}
                  {uuid && <span className="ml-2 text-text-muted/70">UUID {uuid}</span>}
                </span>
              ) : edit?.field === 'value' ? (
                <>
                  <span className="text-text-muted">:</span>
                  <InlineInput value={edit.text} error={edit.error} wide
                    onChange={(t) => setEditing({ ...edit, text: t, error: undefined })}
                    onCommit={() => commitEdit(row)} onCancel={() => setEditing(null)} />
                </>
              ) : (
                <>
                  <span className="text-text-muted">:</span>
                  <span className={`truncate ${row.tag.type === 'string' ? 'text-amber-200' : 'text-sky-200'}`}>
                    {row.tag.type === 'string' ? `"${row.tag.value}"` : displayValue(row.tag)}
                  </span>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Añadir etiqueta */}
      {adding && (
        <div className="absolute inset-0 z-10 bg-black/50 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setAdding(null) }}>
          <form onSubmit={(e) => { e.preventDefault(); commitAdd(adding.path, adding.type, adding.name) }}
            className="w-full max-w-[420px] bg-bg-secondary border border-border rounded-2xl p-5 shadow-2xl space-y-3">
            <h3 className="text-sm font-bold text-text-primary">Añadir etiqueta</h3>
            <div className="grid grid-cols-3 gap-1.5">
              {ADDABLE.map((t) => (
                <button key={t} type="button" onClick={() => setAdding({ ...adding, type: t })}
                  className={`px-2 py-1.5 rounded-lg border text-xs ${adding.type === t ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:border-accent/40'}`}>
                  {TYPE_BADGE[t].label}
                </button>
              ))}
            </div>
            {resolve(root, adding.path).type === 'compound' && (
              <input autoFocus value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value, error: undefined })}
                placeholder="Nombre"
                className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/60" />
            )}
            {adding.error && <p className="text-xs text-red-400">{adding.error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAdding(null)} className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-secondary">Cancelar</button>
              <button type="submit" className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium">Añadir</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function InlineInput({ value, error, wide, onChange, onCommit, onCancel }: {
  value: string; error?: string; wide?: boolean
  onChange: (v: string) => void; onCommit: () => void; onCancel: () => void
}) {
  return (
    <span className="relative inline-flex items-center">
      <input autoFocus value={value} onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onCommit() }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
        }}
        onBlur={onCancel}
        className={`bg-bg-primary border rounded px-1.5 py-0 text-[13px] font-mono text-text-primary outline-none ${wide ? 'w-72' : 'w-44'} ${error ? 'border-red-500' : 'border-accent/60'}`} />
      {error && <span className="ml-2 text-[11px] text-red-400 font-sans whitespace-nowrap">{error}</span>}
    </span>
  )
}

export function SmallBtn({ children, onClick, danger, disabled, title }: { children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`px-2.5 py-1 rounded-lg border text-xs disabled:opacity-30 ${danger ? 'border-red-500/40 text-red-400 hover:bg-red-500/10' : 'border-border text-text-secondary hover:text-text-primary hover:border-accent/40'}`}>
      {children}
    </button>
  )
}
