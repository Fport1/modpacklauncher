import { useEffect, useMemo, useState } from 'react'
import type { AdvancementDef, AdvancementProgress } from '../../../../shared/types'
import { useTextures } from '../../lib/mcTextures'
import { McItem, useLang, anyName } from '../../lib/mcItems'
import { errText } from './shared'

// Los logros de un jugador como en el juego: pestañas (Minecraft, Nether, End,
// Aventura, Agricultura), el árbol con sus marcos y, al elegir uno, qué le
// falta. Los criterios salen con su nombre de verdad («Llanura», «Vaca»), no
// con «minecraft:plains». Se pueden dar y quitar logros enteros o criterio a
// criterio; se guarda en advancements/<uuid>.json (players/advancements desde
// la 26.1) dejando el anterior como .bak.

const TAB_ORDER = ['story', 'nether', 'end', 'adventure', 'husbandry']
const STEP_X = 60
const STEP_Y = 56
const NODE = 52

type Entry = { criteria: Record<string, string>; done: boolean }

function textOf(c: unknown, lang: Record<string, string>): string {
  if (typeof c === 'string') return c
  if (c && typeof c === 'object') {
    const o = c as { translate?: string; text?: string; fallback?: string }
    if (o.translate) return lang[o.translate] ?? o.fallback ?? o.translate
    if (o.text) return o.text
  }
  return ''
}

/** Fecha como la escribe el juego: 2026-10-28 13:05:00 -0500 */
function mcDate(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${sign}${p(Math.floor(Math.abs(off) / 60))}${p(Math.abs(off) % 60)}`
}

/** Grupos de criterios: hace falta uno de cada grupo (sin requirements, todos). */
const groupsOf = (def: AdvancementDef): string[][] => def.requirements?.length ? def.requirements : def.criteria.map((c) => [c])
const isDone = (def: AdvancementDef, e: Entry | undefined): boolean =>
  !!e && groupsOf(def).every((g) => g.some((c) => c in e.criteria))

interface Props {
  worldDir: string
  uuid: string
  /** El mundo está en el servidor conectado (worldDir es su ruta allí) */
  remote?: boolean
  playerName?: string
  onClose: () => void
}

export default function AdvancementsView({ worldDir, uuid, remote, playerName, onClose }: Props) {
  const io = remote ? window.api.world.remote : window.api.world
  const lang = useLang()
  const [defs, setDefs] = useState<AdvancementDef[] | null>(null)
  const [progress, setProgress] = useState<AdvancementProgress | null>(null)
  const [saved, setSaved] = useState<string>('')
  const [tab, setTab] = useState('story')
  const [selId, setSelId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([window.api.mc.advancements(), io.readAdvancements(worldDir, uuid)])
      .then(([d, p]) => { setDefs(d); setProgress(p); setSaved(JSON.stringify(p)) })
      .catch((e) => setStatus({ kind: 'error', text: errText(e) }))
  }, [worldDir, uuid, remote])

  const dirty = !!progress && JSON.stringify(progress) !== saved
  const byId = useMemo(() => new Map((defs ?? []).map((d) => [d.id, d])), [defs])
  const tabs = useMemo(() => {
    const roots = (defs ?? []).filter((d) => !d.parent && d.display)
    return roots.sort((a, b) => (TAB_ORDER.indexOf(a.tab) + 1 || 99) - (TAB_ORDER.indexOf(b.tab) + 1 || 99))
  }, [defs])

  const entry = (id: string): Entry | undefined => {
    const e = progress?.[id]
    return typeof e === 'object' ? e : undefined
  }

  // ── Árbol: profundidad en x, hojas en orden en y; el padre a la altura de su primer hijo ──
  const layout = useMemo(() => {
    const list = (defs ?? []).filter((d) => d.tab === tab && d.display)
    const children = new Map<string, AdvancementDef[]>()
    for (const d of list) if (d.parent) children.set(d.parent, [...(children.get(d.parent) ?? []), d])
    for (const arr of children.values()) arr.sort((a, b) => a.id.localeCompare(b.id))
    const pos = new Map<string, { x: number; y: number }>()
    let row = 0
    const place = (d: AdvancementDef, depth: number): number => {
      const kids = children.get(d.id) ?? []
      if (!kids.length) { pos.set(d.id, { x: depth, y: row }); return row++ }
      const ys = kids.map((k) => place(k, depth + 1))
      const y = ys[0]
      pos.set(d.id, { x: depth, y })
      return y
    }
    const root = list.find((d) => !d.parent)
    if (root) place(root, 0)
    return { list, pos, rows: row, cols: Math.max(0, ...[...pos.values()].map((p) => p.x)) + 1 }
  }, [defs, tab])

  const root = tabs.find((t) => t.tab === tab)
  const bgKey = (root?.display?.background ?? '').replace(/^minecraft:/, '').replace(/^textures\//, '').replace(/\.png$/, '')
  const sprites = useTextures(['task', 'goal', 'challenge'].flatMap((f) => [`gui/sprites/advancements/${f}_frame_obtained`, `gui/sprites/advancements/${f}_frame_unobtained`]).concat(bgKey ? [bgKey] : []))

  function update(id: string, fn: (e: Entry | undefined, def: AdvancementDef) => Entry | null): void {
    const def = byId.get(id)
    if (!def || !progress) return
    const next = { ...progress }
    const res = fn(entry(id), def)
    if (!res || Object.keys(res.criteria).length === 0) delete next[id]
    else next[id] = { ...res, done: isDone(def, res) }
    setProgress(next)
    setStatus(null)
  }
  const grant = (id: string): void => update(id, (e, def) => {
    const criteria = { ...(e?.criteria ?? {}) }
    for (const c of def.criteria) criteria[c] ??= mcDate()
    return { criteria, done: true }
  })
  const revoke = (id: string): void => update(id, () => null)
  const toggleCriterion = (id: string, c: string): void => update(id, (e) => {
    const criteria = { ...(e?.criteria ?? {}) }
    if (c in criteria) delete criteria[c]
    else criteria[c] = mcDate()
    return { criteria, done: false }
  })
  /** Dar o quitar todos los de la pestaña */
  function allInTab(give: boolean): void {
    if (!progress) return
    const next = { ...progress }
    for (const d of layout.list) {
      if (give) {
        const e = entry(d.id)
        const criteria = { ...(e?.criteria ?? {}) }
        for (const c of d.criteria) criteria[c] ??= mcDate()
        next[d.id] = { criteria, done: true }
      } else delete next[d.id]
    }
    setProgress(next)
  }

  async function save(): Promise<void> {
    if (!progress) return
    setSaving(true)
    try {
      await io.writeAdvancements(worldDir, uuid, progress)
      setSaved(JSON.stringify(progress))
      setStatus({ kind: 'ok', text: '✓ Guardado. El archivo anterior queda como .json.bak' })
    } catch (e) {
      setStatus({ kind: 'error', text: errText(e) })
    } finally { setSaving(false) }
  }

  function close(): void {
    if (dirty && !window.confirm('Hay cambios en los logros sin guardar. ¿Cerrar sin guardar?')) return
    onClose()
  }

  const sel = selId ? byId.get(selId) : null
  const hov = hoverId ? byId.get(hoverId) : null
  const tabDone = layout.list.filter((d) => isDone(d, entry(d.id))).length

  return (
    <div className="fixed inset-0 z-[150] bg-black/75 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="w-[min(1100px,100%)] h-[min(720px,100%)] bg-[#c6c6c6] rounded-md flex flex-col overflow-hidden" style={{ border: '3px solid', borderColor: '#fff #555 #555 #fff' }}>
        {/* Cabecera */}
        <div className="flex items-center gap-3 px-3 py-2 bg-[#c6c6c6]">
          <p className="text-[15px] font-semibold text-[#3f3f3f]">Logros{playerName ? ` de ${playerName}` : ''}</p>
          <span className="text-xs text-[#555]">{tabDone}/{layout.list.length} en esta pestaña</span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-[#3f3f3f] cursor-pointer">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Resaltar lo que falta
          </label>
          <button type="button" onClick={() => allInTab(true)} className="px-2 h-7 text-xs rounded bg-[#8b8b8b] text-white hover:bg-[#9b9b9b]">Dar todos</button>
          <button type="button" onClick={() => allInTab(false)} className="px-2 h-7 text-xs rounded bg-[#8b8b8b] text-white hover:bg-[#9b9b9b]">Quitar todos</button>
          <button type="button" onClick={save} disabled={!dirty || saving} className="px-3 h-7 text-xs rounded bg-accent text-white disabled:opacity-40">{saving ? 'Guardando…' : 'Guardar'}</button>
          <button type="button" onClick={close} className="w-7 h-7 rounded text-[#3f3f3f] hover:bg-black/10" title="Cerrar">✕</button>
        </div>
        {status && <p className={`px-3 pb-1 text-xs ${status.kind === 'ok' ? 'text-green-800' : 'text-red-700'}`}>{status.text}</p>}
        <p className="px-3 pb-1 text-[11px] text-[#6b4a00]">⚠ Guarda con el juego o el servidor cerrados: si no, el juego sobrescribe los logros al salir.</p>

        {/* Pestañas */}
        <div className="flex gap-1 px-3">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => { setTab(t.tab); setSelId(null) }} title={textOf(t.display!.title, lang)}
              className={`w-12 h-11 flex items-center justify-center rounded-t ${tab === t.tab ? 'bg-[#2b2b2b]' : 'bg-[#8b8b8b] hover:bg-[#9b9b9b]'}`}>
              <McItem id={t.display!.icon} size={26} />
            </button>
          ))}
          {root && <p className="self-center ml-2 text-sm font-semibold text-[#3f3f3f]">{textOf(root.display!.title, lang)}</p>}
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Árbol */}
          <div className="flex-1 overflow-auto relative bg-[#2b2b2b]"
            style={sprites[bgKey] ? { backgroundImage: `url(${sprites[bgKey]})`, backgroundSize: '32px 32px', imageRendering: 'pixelated' } : undefined}>
            {!defs || !progress ? (
              <div className="p-6 text-sm text-white/70">{status?.kind === 'error' ? status.text : 'Cargando logros…'}</div>
            ) : (
              <div className="relative" style={{ width: layout.cols * STEP_X + 40, height: layout.rows * STEP_Y + 40 }}>
                <svg className="absolute inset-0 pointer-events-none" width={layout.cols * STEP_X + 40} height={layout.rows * STEP_Y + 40}>
                  {layout.list.filter((d) => d.parent && layout.pos.has(d.parent)).map((d) => {
                    const a = layout.pos.get(d.parent!)!, b = layout.pos.get(d.id)!
                    const x1 = 20 + a.x * STEP_X + NODE / 2, y1 = 20 + a.y * STEP_Y + NODE / 2
                    const x2 = 20 + b.x * STEP_X + NODE / 2, y2 = 20 + b.y * STEP_Y + NODE / 2
                    const mx = (x1 + x2) / 2
                    const path = `M${x1},${y1} H${mx} V${y2} H${x2}`
                    return (
                      <g key={d.id}>
                        <path d={path} stroke="#000" strokeWidth={6} fill="none" />
                        <path d={path} stroke="#fff" strokeWidth={2} fill="none" />
                      </g>
                    )
                  })}
                </svg>
                {layout.list.map((d) => {
                  const p = layout.pos.get(d.id)
                  if (!p) return null
                  const done = isDone(d, entry(d.id))
                  const frame = sprites[`gui/sprites/advancements/${d.display!.frame}_frame_${done ? 'obtained' : 'unobtained'}`]
                  return (
                    <button key={d.id} type="button"
                      onClick={() => setSelId(d.id)} onMouseEnter={() => setHoverId(d.id)} onMouseLeave={() => setHoverId(null)}
                      className={`absolute flex items-center justify-center ${selId === d.id ? 'outline outline-2 outline-white' : ''}`}
                      style={{
                        left: 20 + p.x * STEP_X, top: 20 + p.y * STEP_Y, width: NODE, height: NODE,
                        backgroundImage: frame ? `url(${frame})` : undefined, backgroundSize: '100% 100%', imageRendering: 'pixelated',
                        opacity: onlyMissing && done ? 0.35 : 1,
                        filter: !done && !onlyMissing ? 'saturate(0.85)' : undefined,
                      }}>
                      <McItem id={d.display!.icon} size={30} />
                      {d.display!.hidden && !done && <span className="absolute -top-1 -right-1 text-[10px]" title="Logro oculto en el juego">👁</span>}
                    </button>
                  )
                })}
              </div>
            )}
            {hov && <AdvTooltip def={hov} entry={entry(hov.id)} lang={lang} />}
          </div>

          {/* Detalle */}
          <div className="w-[320px] shrink-0 bg-[#c6c6c6] border-l-2 border-[#555] flex flex-col min-h-0">
            {!sel ? (
              <p className="p-4 text-sm text-[#3f3f3f]">Elige un logro para ver qué le falta, darlo o quitarlo.</p>
            ) : (
              <AdvDetail def={sel} entry={entry(sel.id)} lang={lang}
                onGrant={() => grant(sel.id)} onRevoke={() => revoke(sel.id)} onToggle={(c) => toggleCriterion(sel.id, c)} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Nombre bonito de un criterio: «minecraft:plains» → «Llanura»; «get_stone» → «Get stone». */
function criterionName(c: string, lang: Record<string, string>): string {
  if (c.includes(':')) return anyName(lang, c)
  const named = anyName(lang, `minecraft:${c}`)
  if (named !== c.split(/[_/]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')) return named
  return c.replace(/_/g, ' ').replace(/^./, (s) => s.toUpperCase())
}

function AdvTooltip({ def, entry, lang }: { def: AdvancementDef; entry?: Entry; lang: Record<string, string> }) {
  const done = isDone(def, entry)
  const groups = groupsOf(def)
  const have = groups.filter((g) => g.some((c) => entry && c in entry.criteria)).length
  const color = def.display!.frame === 'challenge' ? '#aa00aa' : '#55ff55'
  return (
    <div className="absolute left-2 bottom-2 w-fit max-w-[360px] pointer-events-none">
      <div className="px-3 py-2 rounded" style={{ background: done ? '#0a5f8a' : '#1e1e1e', border: '2px solid #000' }}>
        <p className="text-[14px] text-white font-semibold">{textOf(def.display!.title, lang)}</p>
        <p className="text-[12px]" style={{ color }}>{textOf(def.display!.description, lang)}</p>
        {groups.length > 1 && <p className="text-[11px] text-white/80 mt-0.5">{have}/{groups.length}</p>}
      </div>
    </div>
  )
}

function AdvDetail({ def, entry, lang, onGrant, onRevoke, onToggle }: {
  def: AdvancementDef; entry?: Entry; lang: Record<string, string>
  onGrant: () => void; onRevoke: () => void; onToggle: (c: string) => void
}) {
  const done = isDone(def, entry)
  const groups = groupsOf(def)
  const missing = groups.filter((g) => !g.some((c) => entry && c in entry.criteria))
  const frameName = { task: 'Logro', goal: 'Meta', challenge: 'Desafío' }[def.display!.frame]
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="p-3 space-y-1.5 border-b-2 border-[#555]">
        <div className="flex items-center gap-2">
          <McItem id={def.display!.icon} size={28} />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-[#2b2b2b] leading-tight">{textOf(def.display!.title, lang)}</p>
            <p className="text-[11px] text-[#555]">{frameName}{def.display!.hidden ? ' · oculto' : ''} · {done ? 'conseguido' : `faltan ${missing.length} de ${groups.length}`}</p>
          </div>
        </div>
        <p className="text-[12px] text-[#3f3f3f]">{textOf(def.display!.description, lang)}</p>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onGrant} disabled={done} className="px-2.5 h-7 text-xs rounded bg-green-700 text-white disabled:opacity-40">Dar logro</button>
          <button type="button" onClick={onRevoke} disabled={!entry} className="px-2.5 h-7 text-xs rounded bg-red-700 text-white disabled:opacity-40">Quitar</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {groups.length > 1 && <p className="px-1 pb-1 text-[11px] text-[#555]">Clic en un criterio para marcarlo o desmarcarlo.</p>}
        {/* Primero lo que falta */}
        {[...groups].sort((a, b) => Number(a.some((c) => !!entry && c in entry.criteria)) - Number(b.some((c) => !!entry && c in entry.criteria))).map((g) => (
          <div key={g.join('|')}>
            {g.map((c) => {
              const has = !!entry && c in entry.criteria
              return (
                <button key={c} type="button" onClick={() => onToggle(c)}
                  className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded text-[12.5px] hover:bg-black/10 ${has ? 'text-[#1d5e1d]' : 'text-[#7a1f1f]'}`}
                  title={has ? `Conseguido el ${entry!.criteria[c]}` : 'Le falta'}>
                  <span className="w-4 shrink-0">{has ? '✓' : '✕'}</span>
                  <span className="flex-1 truncate">{criterionName(c, lang)}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
