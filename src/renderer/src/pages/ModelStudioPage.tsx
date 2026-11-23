import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StudioModelEntry, StudioProject } from '../../../shared/types'
import { useStore } from '../store'
import { activeAccount } from '../store'
import Viewport, { type Tool, type TransformDelta, type View } from '../components/studio/Viewport'
import TextureEditor, { DEFAULT_UI, type PaintTool, type PaintUi } from '../components/studio/TextureEditor'
import Icon from '../components/studio/icons'
import { beginStroke, endStroke, moveStroke, type Stroke } from '../lib/studio/paint'
import { extrudeItem } from '../lib/studio/build'
import { loadView } from '../lib/studio/load'
import { thumbnail } from '../lib/studio/thumbs'
import Outliner from '../components/studio/Outliner'
import Inspector from '../components/studio/Inspector'
import Tip from '../components/studio/Tip'
import { LESSONS, Spotlight, TOUR, type StudioEvent } from '../components/studio/Guide'
import {
  DIRS, cloneElement, cubesOf, defaultUv, findGroup, mirrorX, newCube, parseModel, removeFromGroups, resolveTex, serializeModel, uid,
  type SElement, type SGroup, type SModel, type V3,
} from '../lib/studio/model'
import { ANGLES, validate } from '../lib/studio/validate'
import { composite, fromHex, getPixel, loadStack, restore, snapshot, stackToJson, textureToBase64, toHex, touch, type StackJson, type StudioTex, type TexSnap } from '../lib/studio/textures'
import G from '../components/ui/Glyph'

// Estudio de modelos de WinterTales: un Blockbench sencillo dentro del launcher, solo para
// la cuenta del dueño (Sidebar lo enseña solo a esa cuenta y el proceso principal lo
// comprueba en cada llamada). Esta primera versión abre y guarda los modelos JSON de bloque e
// ítem con su textura; las entidades en Java y los scripts vienen después
// (docs/estudio-modelos.md).

const OWNER = 'devora60'

type HistoryEntry =
  | { label: string; kind: 'model'; before: SModel; after: SModel }
  | { label: string; kind: 'tex'; ref: string; before: TexSnap; after: TexSnap; at?: number }

const TOOLS: { id: Tool; icon: string; label: string; tip: string }[] = [
  { id: 'select', icon: 'select', label: 'Elegir', tip: 'Haz clic en un cubo para elegirlo. Con Mayús eliges varios.' },
  { id: 'move', icon: 'move', label: 'Mover', tip: 'Arrastra las flechas de colores para mover el cubo (de píxel en píxel).' },
  { id: 'resize', icon: 'resize', label: 'Tamaño', tip: 'Arrastra los cuadraditos para hacer el cubo más grande o más pequeño.' },
  { id: 'rotate', icon: 'rotate', label: 'Girar', tip: 'Arrastra el aro para girar el cubo. En bloques e ítems solo de 22,5 en 22,5 grados y en un eje.' },
  { id: 'paint', icon: 'brush', label: 'Pintar', tip: 'Pinta directamente sobre el modelo con el color y la herramienta del panel Textura.' },
]

const LESSON_ICON: Record<string, string> = { view: 'rotate', select: 'select', resize: 'resize', paint: 'brush', group: 'part', anim: 'play', save: 'save', layers: 'layers', tools: 'wand' }

const PAINT_LABEL: Record<string, string> = {
  pencil: 'Pintar', eraser: 'Borrar', fill: 'Rellenar', line: 'Línea', rect: 'Rectángulo', ellipse: 'Círculo',
  move: 'Mover píxeles', lighten: 'Aclarar', darken: 'Oscurecer', noise: 'Ruido', shade: 'Sombra',
}

const fmtDate = (t: number): string => new Date(t).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })

/** Nombre del grupo de un modelo: sin los números y variantes del final (poker_table_3 → poker_table). */
const VARIANT = /_(\d+|top|bottom|upper|lower|left|right|on|off|open|closed|lit|snowy|inner|outer|side|end|corner|base|head|foot|north|south|east|west|up|down|post|tip|middle|full|half|empty|filled|active|inactive|powered|unpowered|slab|stairs|wall|inventory|mid|frustum)$/
function groupKey(e: StudioModelEntry): string {
  let n = e.name
  for (let i = 0; i < 4; i++) { const m = n.replace(VARIANT, ''); if (m === n) break; n = m }
  return `${e.kind}/${n}`
}

/** Miniatura en 3D (se hace cuando se ve en pantalla). */
function Thumb({ entry, size = 64 }: { entry: StudioModelEntry; size?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver((es) => {
      if (!es.some((x) => x.isIntersecting)) return
      io.disconnect()
      thumbnail(entry).then((u) => { if (alive) setUrl(u) })
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => { alive = false; io.disconnect() }
  }, [entry.id, entry.mtime])
  return (
    <div ref={ref} className="shrink-0 rounded-lg bg-[#1b2433] flex items-center justify-center overflow-hidden" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
        : url === null ? <Icon name={entry.kind === 'block' ? 'block' : 'item'} size={size / 2.5} className="text-text-muted/50" />
          : <span className="w-3 h-3 rounded-full border-2 border-text-muted/40 border-t-transparent animate-spin" />}
    </div>
  )
}

export default function ModelStudioPage() {
  const account = useStore(activeAccount)
  const isOwner = account?.type === 'microsoft' && account.username.toLowerCase() === OWNER
  const instances = useStore((s) => s.instances)

  const [project, setProject] = useState<StudioProject | null>(null)
  const [entries, setEntries] = useState<StudioModelEntry[] | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'block' | 'item' | 'cubes' | 'script'>('cubes')
  const [grouped, setGrouped] = useState(() => localStorage.getItem('studio-grouped') !== '0')
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [entry, setEntry] = useState<StudioModelEntry | null>(null)
  const [error, setError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOwner) return
    window.api.studio.project().then(setProject).catch((e) => setError(String(e?.message ?? e)))
    window.api.studio.list().then(setEntries).catch((e) => setError(String(e?.message ?? e)))
  }, [isOwner])

  const q = search.trim().toLowerCase()
  const shown = useMemo(() => (entries ?? []).filter((e) => (!q || e.id.includes(q))
    && (filter === 'all' || (filter === 'block' && e.kind === 'block') || (filter === 'item' && e.kind === 'item') || (filter === 'cubes' && e.elements > 0) || (filter === 'script' && e.generatedBy.length > 0))), [entries, q, filter])
  const groups = useMemo(() => {
    const m = new Map<string, StudioModelEntry[]>()
    for (const e of shown) { const k = groupKey(e); m.set(k, [...(m.get(k) ?? []), e]) }
    return [...m.entries()].map(([key, list]) => ({ key, name: key.split('/')[1], list: list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }))
  }, [shown])

  if (!isOwner) {
    return <div className="h-full flex items-center justify-center text-text-muted">Esta herramienta no está disponible.</div>
  }

  if (entry) return <Editor entry={entry} onClose={() => { setEntry(null); window.api.studio.list().then(setEntries).catch(() => {}) }} />

  const card = (e: StudioModelEntry): JSX.Element => (
    <button key={e.id} type="button" onClick={() => setEntry(e)}
      className="flex items-center gap-3 text-left rounded-xl border border-border bg-bg-card hover:border-accent/60 p-2">
      <Thumb entry={e} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium text-text-primary truncate flex items-center gap-1.5"><Icon name={e.kind === 'block' ? 'block' : 'item'} size={14} className="text-text-muted" />{e.name}</p>
        <p className="text-[11px] text-text-muted truncate">
          {e.elements > 0 ? `${e.elements} cubo${e.elements === 1 ? '' : 's'}` : e.parent ? `usa ${e.parent.replace(/^minecraft:/, '')}` : 'sin cubos'}
        </p>
        {e.generatedBy.length > 0 && (
          <p className={`text-[11px] truncate flex items-center gap-1 ${e.handEdited ? 'text-green-300' : 'text-amber-300'}`}>
            <Icon name={e.handEdited ? 'hand' : 'script'} size={12} />{e.handEdited ? 'editado a mano' : e.generatedBy[0]}
          </p>
        )}
      </div>
    </button>
  )

  const og = openGroup ? groups.find((g) => g.key === openGroup) : null

  return (
    <div className="h-full flex flex-col min-h-0 p-6 gap-4">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2"><Icon name="cube" size={26} className="text-accent" />Estudio de modelos</h1>
          <p className="text-sm text-text-muted mt-1">Cambia la forma y los colores de los bloques y objetos de WinterTales. Elige uno para empezar.</p>
        </div>
        <div className="text-xs text-text-muted space-y-1 text-right">
          <p className="flex items-center gap-1 justify-end"><Icon name="folder" size={13} /><span className="font-mono text-text-secondary">{project?.dir ?? '…'}</span>{project && !project.exists && <span className="text-red-400"> (no se encuentra)</span>}</p>
          <div className="flex items-center gap-2 justify-end">
            <button type="button" className="underline hover:text-text-primary" onClick={async () => { const d = await window.api.studio.pickProject(); if (d) { setProject(await window.api.studio.setProject(d)); setEntries(await window.api.studio.list()) } }}>Cambiar carpeta</button>
            <Tip text="Donde se copian los cambios al pulsar «Probar en el juego». Si no eliges ninguna, la primera con WinterTales en sus mods." side="bottom">
              <select value={project?.testInstanceId ?? ''} onChange={async (e) => { await window.api.studio.setTestInstance(e.target.value || null); setProject(await window.api.studio.project()) }}
                className="bg-bg-primary border border-border rounded-lg px-2 py-1 text-xs text-text-primary">
                <option value="">Instancia de prueba: automática</option>
                {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Tip>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-80">
          <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setOpenGroup(null) }} placeholder="Buscar (poker, roulette, sword…)"
            className="w-full bg-bg-primary border border-border rounded-xl pl-9 pr-3 py-2 text-sm text-text-primary outline-none focus:border-accent" />
        </div>
        {([['cubes', 'Con forma propia'], ['all', 'Todos'], ['block', 'Bloques'], ['item', 'Objetos'], ['script', 'Hechos por script']] as const).map(([id, l]) => (
          <button key={id} type="button" onClick={() => { setFilter(id); setOpenGroup(null) }}
            className={`px-3 py-1.5 rounded-xl text-sm border ${filter === id ? 'bg-accent/20 border-accent text-text-primary' : 'border-border text-text-secondary hover:text-text-primary'}`}>{l}</button>
        ))}
        <Tip text="Juntar las variantes de un mismo modelo (poker_table_0…5, _top/_bottom, _on/_off…) en una sola tarjeta.">
          <label className="flex items-center gap-1.5 text-sm text-text-secondary px-2"><input type="checkbox" checked={grouped} onChange={(e) => { setGrouped(e.target.checked); setOpenGroup(null); localStorage.setItem('studio-grouped', e.target.checked ? '1' : '0') }} />Agrupar variantes</label>
        </Tip>
        <span className="text-xs text-text-muted">{shown.length} modelos{grouped ? ` en ${groups.length} grupos` : ''}</span>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {og && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setOpenGroup(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary"><Icon name="back" size={15} />Todos</button>
          <p className="text-sm text-text-primary font-semibold">{og.name}</p><span className="text-xs text-text-muted">{og.list.length} variantes</span>
        </div>
      )}

      <div ref={scroller} className="flex-1 overflow-y-auto grid gap-2 content-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {og ? og.list.map(card) : grouped ? groups.map((g) => g.list.length === 1 ? card(g.list[0]) : (
          <button key={g.key} type="button" onClick={() => { setOpenGroup(g.key); scroller.current?.scrollTo({ top: 0 }) }}
            className="flex items-center gap-3 text-left rounded-xl border border-border bg-bg-card hover:border-accent/60 p-2 relative">
            <div className="relative w-16 h-16 shrink-0">
              {g.list.slice(0, 3).reverse().map((e, i, arr) => (
                <div key={e.id} className="absolute rounded-lg ring-1 ring-black/40" style={{ left: (arr.length - 1 - i) * 5, top: (arr.length - 1 - i) * 5 }}><Thumb entry={e} size={56 - (arr.length - 1) * 2} /></div>
              ))}
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium text-text-primary truncate flex items-center gap-1.5"><Icon name="layers" size={14} className="text-text-muted" />{g.name}</p>
              <p className="text-[11px] text-text-muted truncate">{g.list.length} variantes: {g.list.map((e) => e.name.slice(g.name.length).replace(/^_/, '') || 'base').join(', ')}</p>
            </div>
            <span className="absolute top-2 right-2 text-[11px] px-1.5 py-0.5 rounded-md bg-accent/20 text-accent font-semibold">{g.list.length}</span>
          </button>
        )) : shown.map(card)}
        {!entries && <p className="text-sm text-text-muted">Cargando modelos…</p>}
      </div>
    </div>
  )
}

// ── El editor de un modelo ──────────────────────────────────────────────────

function Editor({ entry, onClose }: { entry: StudioModelEntry; onClose: () => void }) {
  const [model, setModel] = useState<SModel | null>(null)
  const [original, setOriginal] = useState<SModel | null>(null)
  /** Cubos heredados del padre (si el modelo no tiene propios), solo para verlos */
  const [inherited, setInherited] = useState<SModel | null>(null)
  const [textures, setTextures] = useState<Map<string, StudioTex>>(new Map())
  const [texVersion, setTexVersion] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [paintTool, setPaintTool] = useState<PaintTool>('pencil')
  const [ui, setUi] = useState<PaintUi>(DEFAULT_UI)
  const setColor = (c: string): void => setUi((u) => ({ ...u, color: c }))
  const [wide, setWide] = useState(() => localStorage.getItem('studio-wide') === '1')
  const [flat, setFlat] = useState(false)
  const [advanced, setAdvanced] = useState(() => localStorage.getItem('studio-advanced') === '1')
  const [gameLight, setGameLight] = useState(false)
  const [view, setView] = useState<{ v: View; n: number }>({ v: 'iso', n: 0 })
  const [anim, setAnim] = useState<{ cubes: Set<string>; origin: V3; motion: 'swing' | 'look' | 'spin' } | null>(null)
  const [panel, setPanel] = useState<'cube' | 'texture'>('cube')
  const [texRef, setTexRef] = useState<string | null>(null)
  const [past, setPast] = useState<HistoryEntry[]>([])
  const [future, setFuture] = useState<HistoryEntry[]>([])
  const [modelDirty, setModelDirty] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null)
  const [draft, setDraft] = useState<{ savedAt: number; data: { model: string; textures: Record<string, string | StackJson> } } | null>(null)
  const [saveAsk, setSaveAsk] = useState<{ scripts: string[] } | null>(null)
  const [comparing, setComparing] = useState(false)
  const [texScripts, setTexScripts] = useState<Record<string, { scripts: string[]; handEdited: boolean }>>({})
  const [tour, setTour] = useState<number | null>(() => (localStorage.getItem('studio-tour-done') ? null : 0))
  const [lesson, setLesson] = useState<{ i: number; step: number } | null>(null)
  const [learnOpen, setLearnOpen] = useState(false)
  const [doneLessons, setDoneLessons] = useState<string[]>(() => JSON.parse(localStorage.getItem('studio-lessons') ?? '[]'))
  const base = useRef<SModel | null>(null)
  const stroke = useRef<Stroke | null>(null)
  const vpHost = useRef<HTMLDivElement>(null)
  // Vista 3D estrecha (p. ej. con el editor de texturas ampliado): botones solo con icono
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const el = vpHost.current
    if (!el) return
    const ro = new ResizeObserver(() => setCompact(el.clientWidth < 620))
    ro.observe(el)
    return () => ro.disconnect()
  })

  const emit = useCallback((ev: StudioEvent) => {
    setLesson((l) => {
      if (!l) return l
      const st = LESSONS[l.i].steps[l.step]
      if (st.waitFor !== ev) return l
      if (l.step + 1 < LESSONS[l.i].steps.length) return { ...l, step: l.step + 1 }
      const id = LESSONS[l.i].id
      setDoneLessons((d) => { const n = [...new Set([...d, id])]; localStorage.setItem('studio-lessons', JSON.stringify(n)); return n })
      setStatus({ kind: 'ok', text: `¡Lección «${LESSONS[l.i].title}» terminada!` })
      return null
    })
  }, [])

  // ── Cargar ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { model: m, shape, flat: isFlat, textures: loaded, refs } = await loadView(entry.id)
        if (cancelled) return
        setModel(m)
        setOriginal(structuredClone(m))
        setInherited(shape)
        setFlat(isFlat)
        setTextures(loaded)
        setTexRef(refs.find((r) => loaded.get(r)?.editable) ?? refs[0] ?? null)
        window.api.studio.generatedBy(refs).then(setTexScripts).catch(() => {})
        // Borrador de la otra vez, si es más nuevo que el archivo
        const d = await window.api.studio.draftGet(entry.id) as { savedAt: number; data: { model: string; textures: Record<string, string | StackJson> } } | null
        if (d && d.savedAt > entry.mtime) setDraft(d)
      } catch (e) {
        setStatus({ kind: 'error', text: `No se pudo abrir: ${(e as Error).message}` })
      }
    })()
    return () => { cancelled = true }
  }, [entry.id])

  // Los avisos de abajo se van solos (los errores se quedan hasta hacer clic)
  useEffect(() => {
    if (!status || status.kind === 'error') return
    const t = setTimeout(() => setStatus(null), 7000)
    return () => clearTimeout(t)
  }, [status])

  const flatShape = useMemo(() => (model && flat ? { ...model, elements: extrudeItem(model, textures) } : null), [model, flat, textures, texVersion])
  const shown = model ? (model.elements ? model : flatShape ?? inherited ?? model) : null
  const shapeReadOnly = !!model && !model.elements
  const texDirty = [...textures.values()].some((t) => t.dirty)
  const dirty = modelDirty || texDirty

  // ── Historial ──
  const push = (h: HistoryEntry): void => {
    setPast((p) => [...p.slice(-999), h])
    setFuture([])
  }
  const edit = useCallback((label: string, fn: (m: SModel) => void) => {
    setModel((cur) => {
      if (!cur) return cur
      const next = structuredClone(cur)
      fn(next)
      push({ label, kind: 'model', before: cur, after: next })
      return next
    })
    setModelDirty(true)
  }, [])

  function undo(): void {
    const h = past[past.length - 1]
    if (!h) return
    setPast((p) => p.slice(0, -1))
    setFuture((f) => [...f, h])
    if (h.kind === 'model') { setModel(h.before); setModelDirty(true) }
    else { const t = textures.get(h.ref); if (t) { restore(t, h.before); setTexVersion((v) => v + 1) } }
    setStatus({ kind: 'info', text: `Deshecho: ${h.label}` })
  }
  function redo(): void {
    const h = future[future.length - 1]
    if (!h) return
    setFuture((f) => f.slice(0, -1))
    setPast((p) => [...p, h])
    if (h.kind === 'model') { setModel(h.after); setModelDirty(true) }
    else { const t = textures.get(h.ref); if (t) { restore(t, h.after); setTexVersion((v) => v + 1) } }
    setStatus({ kind: 'info', text: `Rehecho: ${h.label}` })
  }

  // ── Borrador automático cada pocos segundos si hay cambios ──
  useEffect(() => {
    if (!dirty || !model) return
    const t = setTimeout(() => {
      const tex: Record<string, string | StackJson> = {}
      for (const [r, x] of textures) if (x.dirty) tex[r] = x.layers.length > 1 ? stackToJson(x) : x.canvas.toDataURL('image/png')
      void window.api.studio.draftSet(entry.id, { model: serializeModel(model), textures: tex })
    }, 4000)
    return () => clearTimeout(t)
  }, [model, texVersion, dirty])

  async function restoreDraft(): Promise<void> {
    if (!draft) return
    const m = parseModel(draft.data.model)
    push({ label: 'Recuperar borrador', kind: 'model', before: model!, after: m })
    setModel(m)
    setModelDirty(true)
    for (const [ref, data] of Object.entries(draft.data.textures)) {
      const t = textures.get(ref)
      if (!t) continue
      const before = snapshot(t)
      if (typeof data === 'string') {
        const img = new Image(); img.src = data; await img.decode()
        t.layers = [t.layers[0]]; t.active = 0
        t.layers[0].ctx.clearRect(0, 0, t.w, t.h); t.layers[0].ctx.drawImage(img, 0, 0)
      } else await loadStack(t, data)
      touch(t)
      push({ label: 'Recuperar borrador', kind: 'tex', ref, before, after: snapshot(t) })
    }
    setTexVersion((v) => v + 1)
    setDraft(null)
    setStatus({ kind: 'ok', text: 'Recuperados los cambios sin guardar de la otra vez.' })
  }

  // ── Selección ──
  const select = (ids: string[], additive: boolean): void => {
    const free = ids.filter((id) => !shown?.elements?.find((e) => e.uid === id)?.hidden)
    setSelected((s) => (additive ? [...new Set([...s, ...free])].filter((id) => !(s.includes(id) && free.includes(id))) : free))
    setActiveGroup(null)
    if (free.length) emit('select')
  }

  // ── Mover / tamaño / girar con las flechas ──
  const applyDelta = (b: SModel, d: TransformDelta): SModel => {
    const n = structuredClone(b)
    for (const e of n.elements ?? []) {
      if (!selected.includes(e.uid) || e.locked) continue
      if (d.kind === 'move' && d.move) {
        for (let k = 0; k < 3; k++) { e.from[k] += d.move[k]; e.to[k] += d.move[k]; if (e.rotation) e.rotation.origin[k] += d.move[k] }
      } else if (d.kind === 'resize' && d.scale) {
        const step = advanced ? 0.25 : 1
        for (let k = 0; k < 3; k++) {
          const c = (e.from[k] + e.to[k]) / 2
          const s = Math.max(0, Math.round(((e.to[k] - e.from[k]) * d.scale[k]) / step) * step)
          e.from[k] = Math.round((c - s / 2) / step) * step
          e.to[k] = e.from[k] + s
        }
      } else if (d.kind === 'rotate' && d.axis && d.angle !== undefined) {
        const cur = e.rotation && e.rotation.axis === d.axis ? e.rotation.angle : 0
        const a = Math.max(-45, Math.min(45, cur + d.angle))
        const snapped = ANGLES.reduce((x, y) => (Math.abs(y - a) < Math.abs(x - a) ? y : x), 0)
        e.rotation = { origin: e.rotation?.origin ?? [(e.from[0] + e.to[0]) / 2, (e.from[1] + e.to[1]) / 2, (e.from[2] + e.to[2]) / 2], axis: d.axis, angle: snapped, rescale: e.rotation?.rescale }
      }
    }
    return n
  }
  const onTransform = (d: TransformDelta, phase: 'start' | 'live' | 'commit'): void => {
    if (!model || shapeReadOnly) return
    if (phase === 'start') { base.current = model; return }
    if (!base.current) return
    const next = applyDelta(base.current, d)
    setModel(next)
    if (phase === 'commit') {
      push({ label: d.kind === 'move' ? 'Mover' : d.kind === 'resize' ? 'Cambiar tamaño' : 'Girar', kind: 'model', before: base.current, after: next })
      base.current = null
      setModelDirty(true)
      emit(d.kind)
    }
  }

  // ── Pintar (en la textura o sobre el modelo) ──
  const onPaint = (ref: string, x: number, y: number, phase: 'start' | 'move' | 'end'): void => {
    if (phase === 'end') {
      const st = stroke.current
      stroke.current = null
      if (!st) return
      const t = textures.get(st.ref)
      if (!t) return
      const after = endStroke(t, st)
      setTexVersion((v) => v + 1)
      if (after) { push({ label: PAINT_LABEL[st.tool] ?? 'Pintar', kind: 'tex', ref: st.ref, before: st.before, after }); emit('paint') }
      return
    }
    const t = textures.get(ref)
    if (!t) return
    if (paintTool === 'picker') {
      if (phase === 'start') { const c = getPixel(t, x, y); if (c[3] > 0) setColor(toHex(c)) }
      return
    }
    if (!t.editable) {
      if (phase === 'start') setStatus({ kind: 'info', text: `${ref} es de Minecraft: no se puede pintar. Usa una textura del mod.` })
      return
    }
    const opts = { color: fromHex(ui.color, ui.alpha), size: ui.size, filled: ui.filled, mirror: ui.mirror, global: ui.global, strength: ui.strength }
    if (phase === 'start') stroke.current = beginStroke(t, paintTool, x, y, opts)
    else if (stroke.current && stroke.current.ref === ref) moveStroke(t, stroke.current, x, y, opts)
    setTexRef(ref)
    setTexVersion((v) => v + 1)
  }
  /** Cambio de un golpe en una textura (menú Imagen, capas…), con deshacer. Los seguidos iguales se juntan. */
  const onTexAction = (label: string, fn: (t: StudioTex) => void): void => {
    const t = texRef ? textures.get(texRef) : undefined
    if (!t || !t.editable) return
    const before = snapshot(t)
    fn(t)
    touch(t)
    const after = snapshot(t)
    const now = Date.now()
    const last = past[past.length - 1]
    if (last && last.kind === 'tex' && last.ref === t.ref && last.label === label && last.at && now - last.at < 1200) {
      setPast((p) => [...p.slice(0, -1), { ...last, after, at: now }])
    } else push({ label, kind: 'tex', ref: t.ref, before, after, at: now })
    setTexVersion((v) => v + 1)
    if (/capa/i.test(label)) emit('layer')
  }

  // ── Acciones con cubos ──
  const sel1 = shown?.elements?.find((e) => selected.length === 1 && e.uid === selected[0]) ?? null
  const firstTex = model ? `#${Object.keys(model.textures).find((k) => k !== 'particle') ?? Object.keys(model.textures)[0] ?? 'missing'}` : '#missing'
  const addCube = (): void => {
    const c = newCube(firstTex)
    edit('Añadir cubo', (m) => { m.elements = [...(m.elements ?? []), c] })
    setSelected([c.uid])
  }
  const duplicate = (): void => {
    const ids: string[] = []
    edit('Duplicar', (m) => {
      for (const e of (m.elements ?? []).filter((x) => selected.includes(x.uid))) {
        const c = cloneElement(e)
        c.from[1] += 1; c.to[1] += 1
        if (c.rotation) c.rotation.origin[1] += 1
        m.elements!.push(c)
        ids.push(c.uid)
      }
    })
    setSelected(ids)
  }
  const mirror = (): void => {
    const ids: string[] = []
    edit('Espejo', (m) => {
      for (const e of (m.elements ?? []).filter((x) => selected.includes(x.uid))) { const c = mirrorX(e); m.elements!.push(c); ids.push(c.uid) }
    })
    setSelected(ids)
  }
  const remove = (): void => {
    edit('Borrar', (m) => {
      m.elements = (m.elements ?? []).filter((e) => !selected.includes(e.uid))
      for (const id of selected) removeFromGroups(m.groups, id)
    })
    setSelected([])
  }
  const makeGroup = (): void => {
    const els = (model?.elements ?? []).filter((e) => selected.includes(e.uid))
    if (!els.length) return
    const min = [0, 1, 2].map((k) => Math.min(...els.map((e) => e.from[k])))
    const max = [0, 1, 2].map((k) => Math.max(...els.map((e) => e.to[k])))
    const g: SGroup = { uid: uid('g'), name: `pieza ${(model?.groups?.length ?? 0) + 1}`, origin: [(min[0] + max[0]) / 2, max[1], (min[2] + max[2]) / 2], children: [...selected] }
    edit('Hacer pieza', (m) => { for (const id of selected) removeFromGroups(m.groups, id); m.groups = [...(m.groups ?? []), g] })
    setActiveGroup(g.uid)
    emit('group')
  }
  const group = model ? findGroup(model.groups, activeGroup ?? '') : null

  // Al elegir un cubo, el editor de texturas enseña la suya (si se puede pintar)
  useEffect(() => {
    if (!sel1 || !shown) return
    const refs = Object.values(sel1.faces).map((f) => (f ? resolveTex(shown, f.texture) : null)).filter((r): r is string => !!r && !!textures.get(r))
    const pick = refs.find((r) => textures.get(r)?.editable) ?? refs[0]
    if (pick) setTexRef(pick)
  }, [sel1?.uid])

  // ── Avisos ──
  const issues = useMemo(() => {
    if (!model) return []
    const sizes = new Map([...textures].filter(([, t]) => t.editable).map(([r, t]) => [r, { w: t.w, h: t.h }]))
    return validate(model, sizes)
  }, [model, textures])

  // ── Guardar ──
  const modelScripts = entry.generatedBy
  async function save(handEdited?: boolean): Promise<boolean> {
    if (!model) return false
    // Hecho por un script y aún no marcado: preguntar primero
    const editedTex = [...textures.values()].filter((t) => t.dirty && t.editable)
    const scriptsInvolved = [...new Set([...(modelDirty ? modelScripts : []), ...editedTex.flatMap((t) => texScripts[t.ref]?.scripts ?? [])])]
    const alreadyHand = (!modelDirty || entry.handEdited) && editedTex.every((t) => texScripts[t.ref]?.handEdited)
    if (handEdited === undefined && scriptsInvolved.length && !alreadyHand) { setSaveAsk({ scripts: scriptsInvolved }); return false }
    try {
      const backups: string[] = []
      if (modelDirty) {
        const r = await window.api.studio.saveModel(entry.id, serializeModel(model), handEdited ? { handEdited: true } : {})
        if (r.backup) backups.push(r.backup)
      }
      for (const t of editedTex) {
        const b64 = await textureToBase64(t)
        const r = await window.api.studio.saveTexture(t.ref, b64, handEdited && texScripts[t.ref]?.scripts.length ? { handEdited: true } : {})
        if (r.backup) backups.push(r.backup)
        t.fileB64 = b64
        await window.api.studio.layersSet(t.ref, t.layers.length > 1 ? { fileB64: b64, stack: stackToJson(t) } : null).catch(() => {})
        t.dirty = false
      }
      setModelDirty(false)
      setTexVersion((v) => v + 1)
      await window.api.studio.draftClear(entry.id)
      setStatus({ kind: 'ok', text: `Guardado${handEdited ? ' como versión editada a mano (los scripts no la tocarán)' : ''}.${backups.length ? ' Copia de lo anterior guardada.' : ''}` })
      emit('save')
      return true
    } catch (e) {
      setStatus({ kind: 'error', text: `No se pudo guardar: ${(e as Error).message}` })
      return false
    }
  }

  async function testInGame(): Promise<void> {
    if (dirty && !(await save())) return
    try {
      const texRefs = [...textures.values()].filter((t) => t.editable).map((t) => t.ref)
      const r = await window.api.studio.testInGame([entry.id], texRefs)
      setStatus({ kind: 'ok', text: `Copiado a «${r.instance}» (${r.files} archivos, en el resource pack «WinterTales-estudio»). En el juego pulsa F3+T para verlo.` })
      emit('test')
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    }
  }

  // «Antes y después»: mientras se mantiene pulsado, el modelo y las texturas de cuando se abrió
  const startCompare = (): void => {
    setComparing(true)
    for (const t of textures.values()) if (t.dirty) { t.ctx.putImageData(t.original, 0, 0); t.three.needsUpdate = true }
  }
  const endCompare = (): void => {
    setComparing(false)
    for (const t of textures.values()) if (t.dirty) composite(t)
  }

  // ── Teclado ──
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if ((ev.target as HTMLElement)?.closest('input, textarea, select')) return
      const k = ev.key.toLowerCase()
      if ((ev.ctrlKey || ev.metaKey) && k === 'z' && !ev.shiftKey) { ev.preventDefault(); undo() }
      else if ((ev.ctrlKey || ev.metaKey) && (k === 'y' || (k === 'z' && ev.shiftKey))) { ev.preventDefault(); redo() }
      else if ((ev.ctrlKey || ev.metaKey) && k === 's') { ev.preventDefault(); void save() }
      else if (panel === 'texture') return
      else if ((ev.ctrlKey || ev.metaKey) && k === 'd') { ev.preventDefault(); duplicate() }
      else if (k === 'delete' && selected.length) remove()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const close = (): void => {
    if (dirty && !window.confirm('Hay cambios sin guardar. Se quedan en un borrador y podrás recuperarlos al volver a abrir este modelo. ¿Salir?')) return
    onClose()
  }

  // Trozos de la textura que usan las caras de lo elegido (en amarillo en el editor de texturas)
  const overlays = useMemo(() => {
    const t = texRef ? textures.get(texRef) : undefined
    if (!t || !shown) return []
    const fh = t.h > t.w && t.h % t.w === 0 ? t.w : t.h
    const out: { x: number; y: number; w: number; h: number; label: string }[] = []
    for (const e of shown.elements ?? []) {
      if (!selected.includes(e.uid)) continue
      for (const d of DIRS) {
        const f = e.faces[d]
        if (!f || resolveTex(shown, f.texture) !== texRef) continue
        const [u1, v1, u2, v2] = f.uv ?? defaultUv(d, e)
        const sx = t.w / 16, sy = fh / 16
        out.push({ x: Math.min(u1, u2) * sx, y: Math.min(v1, v2) * sy, w: Math.max(1, Math.abs(u2 - u1) * sx), h: Math.max(1, Math.abs(v2 - v1) * sy), label: d[0].toUpperCase() })
      }
    }
    return out
  }, [selected, shown, texRef, textures])

  if (!model || !shown) {
    return <div className="h-full flex items-center justify-center text-text-muted">{status?.text ?? 'Abriendo el modelo…'}</div>
  }

  const texRefs = [...textures.keys()]
  const errors = issues.filter((i) => i.level === 'error').length
  const lessonStep = lesson ? LESSONS[lesson.i].steps[lesson.step] : null

  return (
    <div className="h-full flex flex-col min-h-0 select-none">
      {/* Barra de arriba */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-wrap">
        <Tip text="Volver a la lista de modelos (los cambios sin guardar quedan en un borrador)."><button type="button" onClick={close} className="flex items-center gap-1.5 px-3 h-10 rounded-xl border border-border text-text-secondary hover:text-text-primary"><Icon name="back" />Modelos</button></Tip>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-text-primary truncate flex items-center gap-1.5"><Icon name={entry.kind === 'block' ? 'block' : 'item'} size={16} className="text-text-muted" />{entry.name}{dirty && <G n="dot" size={8} className="text-amber-400" title="Sin guardar" />}</p>
          <p className="text-[11px] text-text-muted truncate">{entry.file}</p>
        </div>
        <Tip text="Fácil: lo básico con botones grandes. Avanzado: además los números exactos, el punto de giro y el trozo de textura de cada cara.">
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(['Fácil', 'Avanzado'] as const).map((m, i) => (
              <button key={m} type="button" onClick={() => { setAdvanced(i === 1); localStorage.setItem('studio-advanced', i ? '1' : '0') }}
                className={`px-3 h-10 text-sm ${advanced === (i === 1) ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}>{m}</button>
            ))}
          </div>
        </Tip>
        <Tip text="Lecciones cortas para aprender cada cosa practicando, y el tutorial del principio."><button type="button" data-tour="learn" onClick={() => setLearnOpen(true)} className="flex items-center gap-1.5 px-3 h-10 rounded-xl border border-sky-400/40 text-sky-300 hover:bg-sky-500/10"><Icon name="learn" />Aprender</button></Tip>
        <div className="flex rounded-xl border border-border overflow-hidden" data-tour="undo">
          <Tip text={past.length ? `Deshacer: ${past[past.length - 1].label} (Ctrl+Z)` : 'Nada que deshacer'}><button type="button" onClick={undo} disabled={!past.length} className="flex items-center gap-1.5 px-3 h-10 text-text-primary disabled:opacity-30 hover:bg-bg-hover"><Icon name="undo" />Deshacer</button></Tip>
          <Tip text={future.length ? `Rehacer: ${future[future.length - 1].label} (Ctrl+Y)` : 'Nada que rehacer'}><button type="button" onClick={redo} disabled={!future.length} className="px-3 h-10 text-text-primary disabled:opacity-30 hover:bg-bg-hover border-l border-border"><Icon name="redo" /></button></Tip>
        </div>
        <Tip text="Escribe el modelo y las texturas cambiadas en el mod. Antes hace una copia de lo que había (Ctrl+S)."><button type="button" data-tour="save" onClick={() => save()} disabled={!dirty} className="flex items-center gap-1.5 px-4 h-10 rounded-xl bg-accent text-white font-medium disabled:opacity-40"><Icon name="save" />Guardar</button></Tip>
        <Tip text="Guarda y copia los cambios a tu instancia de prueba como resource pack. En el juego pulsa F3+T para verlos, sin recompilar."><button type="button" data-tour="test" onClick={testInGame} className="flex items-center gap-1.5 px-4 h-10 rounded-xl bg-green-600 text-white font-medium"><Icon name="play" />Probar en el juego</button></Tip>
      </div>

      {(modelScripts.length > 0 || draft || shapeReadOnly) && (
        <div className="px-4 py-2 space-y-1.5 border-b border-border">
          {modelScripts.length > 0 && (
            <p className={`text-sm rounded-xl px-3 py-2 ${entry.handEdited ? 'bg-green-500/10 text-green-200' : 'bg-amber-500/10 text-amber-200'}`}>
              {entry.handEdited
                ? `Es una versión editada a mano: ${modelScripts.join(', ')} no la sobrescribe.`
                : `Este modelo lo crea el script ${modelScripts.join(', ')}. Si lo vuelves a ejecutar, borra los cambios hechos aquí. Al guardar te ofreceré guardarlo como «versión editada a mano» para que el script no lo pise.`}
            </p>
          )}
          {draft && (
            <p className="text-sm rounded-xl px-3 py-2 bg-sky-500/10 text-sky-100 flex items-center gap-3 flex-wrap">
              <Icon name="sparkle" size={16} />Hay cambios sin guardar de la otra vez ({fmtDate(draft.savedAt)}).
              <button type="button" onClick={restoreDraft} className="px-3 py-1 rounded-lg bg-sky-500 text-white text-sm">Recuperarlos</button>
              <button type="button" onClick={() => { setDraft(null); void window.api.studio.draftClear(entry.id) }} className="text-sm underline">Descartar</button>
            </p>
          )}
          {shapeReadOnly && (
            <p className="text-sm rounded-xl px-3 py-2 bg-bg-card text-text-secondary flex items-center gap-3 flex-wrap">
              {flat ? 'Es un objeto plano: su forma sale de los píxeles de la textura (con su grosor, como en el juego). Píntalo en «Textura».' : `Este modelo no tiene forma propia: usa la de «${model.parent}». Aquí puedes pintar sus texturas.`}
              {inherited?.elements && (
                <button type="button" className="px-3 py-1 rounded-lg border border-border text-text-primary text-sm" onClick={() => edit('Copiar la forma', (m) => { m.elements = structuredClone(inherited.elements!).map((e) => ({ ...e, uid: uid() })) })}>
                  Copiar su forma aquí para cambiarla
                </button>
              )}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Izquierda: lista de piezas y cubos */}
        <div className={`w-52 xl:w-64 shrink-0 border-r border-border flex-col min-h-0 ${panel === 'texture' && wide ? 'hidden' : 'flex'}`}>
          <div className="p-2 flex gap-1.5">
            <Tip text="Añade un cubo nuevo de 4×4×4 en el centro." className="flex-1"><button type="button" onClick={addCube} disabled={shapeReadOnly} className="w-full h-10 rounded-xl bg-accent/15 text-accent font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"><Icon name="plus" />Cubo</button></Tip>
          </div>
          <div className="flex-1 overflow-y-auto px-1.5 pb-2">
            {flat ? <p className="text-xs text-text-muted px-2 py-3 leading-relaxed">Objeto plano: cada píxel de la textura es un cubito de 1 píxel de grueso. Cambia la forma pintando o borrando píxeles.</p> : <Outliner model={shown} selected={selected} activeGroup={activeGroup}
              onSelect={select}
              onSelectGroup={(g) => { setActiveGroup(g.uid); setSelected(cubesOf(g)); emit('group') }}
              onToggle={(id, what) => edit(what === 'hidden' ? 'Ocultar' : 'Bloquear', (m) => {
                const e = m.elements?.find((x) => x.uid === id)
                if (e) { e[what] = !e[what] || undefined; return }
                const g = findGroup(m.groups, id)
                if (g) { g[what] = !g[what] || undefined; for (const c of cubesOf(g)) { const ce = m.elements?.find((x) => x.uid === c); if (ce) ce[what] = g[what] } }
              })}
              onRename={(id, name) => edit('Renombrar', (m) => { const e = m.elements?.find((x) => x.uid === id); if (e) e.name = name; const g = findGroup(m.groups, id); if (g) g.name = name })} />}
          </div>
        </div>

        {/* Centro: vista 3D */}
        <div className="flex-1 relative min-w-0" ref={vpHost}>
          <Viewport model={comparing && original ? (original.elements ? original : shown) : shown} textures={textures} selected={comparing ? [] : selected}
            tool={shapeReadOnly && tool !== 'paint' ? 'select' : tool} gameLight={gameLight} snap={advanced ? 0.25 : 1}
            rotateAxis={sel1?.rotation?.axis ?? 'y'} view={view} anim={anim}
            onSelect={select} onTransform={onTransform} onPaint={onPaint} onCamera={() => emit('camera')} />
          <div className="absolute top-3 left-3 flex flex-col gap-1.5" data-tour="tools">
            {TOOLS.map((t) => (
              <Tip key={t.id} text={t.tip} side="right">
                <button type="button" onClick={() => { setTool(t.id); if (t.id === 'paint') setPanel('texture'); emit(`tool-${t.id}` as StudioEvent) }}
                  className={`${compact ? 'w-10 justify-center' : 'w-24 px-2.5'} h-10 rounded-xl text-sm flex items-center gap-1.5 shadow ${tool === t.id ? 'bg-accent text-white' : 'bg-bg-secondary/90 text-text-primary hover:bg-bg-hover'}`}>
                  <Icon name={t.icon} size={17} />{!compact && t.label}
                </button>
              </Tip>
            ))}
          </div>
          <div className={`absolute top-3 right-3 flex gap-1.5 ${compact ? 'flex-col items-end' : ''}`} data-tour="views">
            {([['iso', '3D'], ['front', 'Frente'], ['side', 'Lado'], ['top', 'Arriba']] as const).map(([v, l]) => (
              <Tip key={v} text={v === 'iso' ? 'Vista en perspectiva' : `Mirar el modelo desde ${l.toLowerCase()}`}>
                <button type="button" onClick={() => { setView((x) => ({ v, n: x.n + 1 })); emit('camera') }} className="px-2.5 h-9 rounded-lg bg-bg-secondary/90 text-sm text-text-primary hover:bg-bg-hover shadow">{l}</button>
              </Tip>
            ))}
          </div>
          <div className="absolute bottom-3 left-3 flex gap-1.5">
            <Tip text="Muestra el modelo con la luz del juego: cada lado del cubo un poco más oscuro, como en Minecraft." side="top">
              <button type="button" onClick={() => setGameLight((g) => !g)} className={`flex items-center gap-1.5 px-3 h-9 rounded-lg text-sm shadow ${gameLight ? 'bg-amber-500 text-black' : 'bg-bg-secondary/90 text-text-primary'}`}><Icon name="sun" size={16} />{!compact && 'Como en el juego'}</button>
            </Tip>
            <Tip text="Mantén pulsado para ver cómo era antes de tus cambios." side="top">
              <button type="button" onPointerDown={startCompare} onPointerUp={endCompare} onPointerLeave={() => comparing && endCompare()} className={`flex items-center gap-1.5 px-3 h-9 rounded-lg text-sm shadow ${comparing ? 'bg-sky-500 text-white' : 'bg-bg-secondary/90 text-text-primary'}`}><Icon name="compare" size={16} />{!compact && 'Antes / después'}</button>
            </Tip>
          </div>
          {status && (
            <div className={`absolute bottom-3 right-3 max-w-md px-3 py-2 rounded-xl text-sm shadow-lg ${status.kind === 'error' ? 'bg-red-600/90 text-white' : status.kind === 'ok' ? 'bg-green-600/90 text-white' : 'bg-bg-secondary/95 text-text-primary'}`}
              onClick={() => setStatus(null)}>{status.kind === 'ok' && <G n="party" className="mr-1" />}{status.kind === 'error' && <G n="warning" className="mr-1" />}{status.text}</div>
          )}
        </div>

        {/* Derecha: el cubo o la textura, y los avisos */}
        <div className={`${panel === 'texture' && wide ? 'w-[min(760px,62vw)]' : 'w-80 xl:w-[360px]'} shrink-0 border-l border-border flex flex-col min-h-0`}>
          <div className="flex p-2 gap-1.5">
            {([['cube', 'cube', 'Cubo'], ['texture', 'palette', 'Textura']] as const).map(([id, ic, l]) => (
              <button key={id} type="button" onClick={() => setPanel(id)} className={`flex-1 h-10 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 ${panel === id ? 'bg-accent/20 text-text-primary border border-accent' : 'border border-border text-text-secondary'}`}><Icon name={ic} size={16} />{l}</button>
            ))}
          </div>
          <div className={`flex-1 px-3 pb-3 min-h-0 ${panel === 'texture' ? 'flex flex-col' : 'overflow-y-auto'}`}>
            {panel === 'cube' ? (
              <div className="space-y-4">
                {shapeReadOnly ? <p className="text-sm text-text-muted">{flat ? 'Es un objeto plano: su forma sale de la textura. Píntala en la pestaña «Textura».' : 'Copia la forma aquí (arriba) para poder cambiar los cubos.'}</p> : (
                  <Inspector model={model} cube={sel1} count={selected.length} advanced={advanced}
                    onEdit={(label, fn) => {
                      edit(label, (m) => { for (const e of m.elements ?? []) if (selected.includes(e.uid) && !e.locked) fn(e, m) })
                      emit(label === 'Mover' ? 'move' : label === 'Cambiar tamaño' ? 'resize' : label === 'Girar' ? 'rotate' : 'select')
                    }}
                    onDuplicate={duplicate} onMirror={mirror} onDelete={remove} onGroup={makeGroup} />
                )}
                {group && (
                  <section className="rounded-xl border border-sky-400/30 bg-sky-500/5 p-3 space-y-2">
                    <p className="text-sm font-semibold text-text-primary flex items-center gap-1.5"><Icon name="part" size={16} />Pieza «{group.name}»</p>
                    <div data-tour="pivot" className="space-y-1.5">
                      <p className="text-xs text-text-muted">Punto de giro: {group.origin.join(', ')} (donde gira, como un hombro o un cuello)</p>
                      <div className="flex flex-wrap gap-1">
                        {([['X', 0], ['Y', 1], ['Z', 2]] as const).map(([n, k]) => (
                          <span key={n} className="flex items-center gap-0.5">
                            <Tip text={`Mover el punto de giro en ${n}`}><button type="button" className="w-7 h-8 rounded-lg border border-border text-text-primary" onClick={() => { edit('Mover punto de giro', (m) => { const g = findGroup(m.groups, group.uid); if (g) g.origin[k] -= 1 }); emit('pivot') }}>−</button></Tip>
                            <span className="text-xs text-text-secondary w-4 text-center">{n}</span>
                            <Tip text={`Mover el punto de giro en ${n}`}><button type="button" className="w-7 h-8 rounded-lg border border-border text-text-primary" onClick={() => { edit('Mover punto de giro', (m) => { const g = findGroup(m.groups, group.uid); if (g) g.origin[k] += 1 }); emit('pivot') }}>+</button></Tip>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div data-tour="anim" className="flex flex-wrap gap-1.5">
                      {([['swing', 'Balancear'], ['look', 'Mirar'], ['spin', 'Girar']] as const).map(([mo, l]) => (
                        <Tip key={mo} text="Mueve la pieza alrededor de su punto de giro, para comprobar que está bien puesto (solo se ve aquí).">
                          <button type="button" onClick={() => { setAnim({ cubes: new Set(cubesOf(group)), origin: group.origin, motion: mo }); emit('anim') }} className="px-2.5 h-8 rounded-lg border border-border text-sm text-text-primary hover:bg-bg-hover">{l}</button>
                        </Tip>
                      ))}
                      {anim && <button type="button" onClick={() => setAnim(null)} className="px-2.5 h-8 rounded-lg bg-bg-hover text-sm text-text-primary"><G n="stop" /> Parar</button>}
                    </div>
                  </section>
                )}
              </div>
            ) : (
              <TextureEditor tex={texRef ? textures.get(texRef) ?? null : null} refs={texRefs} current={texRef} onPickRef={setTexRef}
                tool={paintTool} onTool={setPaintTool} ui={ui} onUi={(u) => setUi((x) => ({ ...x, ...u }))} overlays={overlays} version={texVersion} onPaint={onPaint}
                onAction={onTexAction} wide={wide} onWide={(w) => { setWide(w); localStorage.setItem('studio-wide', w ? '1' : '0') }} />
            )}
          </div>
          {issues.length > 0 && (
            <div className="max-h-[35%] overflow-y-auto border-t border-border p-2 space-y-1.5">
              <p className="text-xs font-semibold text-text-muted px-1">{errors ? <><G n="warning" /> {errors} cosa{errors === 1 ? '' : 's'} que no funcionará{errors === 1 ? '' : 'n'} en Minecraft</> : 'Avisos'}</p>
              {issues.map((i) => (
                <div key={i.id} className={`rounded-xl px-2.5 py-2 text-xs ${i.level === 'error' ? 'bg-red-500/10 text-red-100' : 'bg-amber-500/10 text-amber-100'}`}>
                  <p onClick={() => i.cube && setSelected([i.cube])} className={i.cube ? 'cursor-pointer' : ''}>{i.text}</p>
                  {i.fix && <button type="button" onClick={() => edit(`Arreglar: ${i.fixLabel}`, i.fix!)} className="mt-1.5 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white"><G n="wand" /> Arreglarlo por mí: {i.fixLabel}</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Guardar algo hecho por un script */}
      {saveAsk && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
          <div className="w-[min(520px,100%)] rounded-2xl bg-bg-secondary border border-border p-5 space-y-3">
            <p className="text-lg font-semibold text-text-primary">Esto lo crea un script</p>
            <p className="text-sm text-text-secondary">Lo que has cambiado lo genera <b>{saveAsk.scripts.join(', ')}</b>. Si guardas normal, la próxima vez que se ejecute ese script borrará tus cambios.</p>
            <p className="text-sm text-text-secondary">Si lo guardas como <b>versión editada a mano</b>, se apunta en <span className="font-mono">tools/hand-edited.json</span> y los scripts lo dejarán como está.</p>
            <div className="flex flex-col gap-2 pt-1">
              <button type="button" onClick={async () => { setSaveAsk(null); await save(true) }} className="h-11 rounded-xl bg-accent text-white font-medium"><G n="hand" /> Guardar como versión editada a mano (recomendado)</button>
              <button type="button" onClick={async () => { setSaveAsk(null); await save(false) }} className="h-10 rounded-xl border border-border text-text-primary">Guardar normal (el script lo podrá pisar)</button>
              <button type="button" onClick={() => setSaveAsk(null)} className="h-9 text-sm text-text-muted">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Aprender */}
      {learnOpen && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setLearnOpen(false) }}>
          <div className="w-[min(560px,100%)] rounded-2xl bg-bg-secondary border border-border p-5 space-y-3">
            <p className="text-lg font-semibold text-text-primary"><G n="graduation" /> Aprender</p>
            <p className="text-sm text-text-muted">Lecciones cortas: te digo qué hacer y paso solo al siguiente paso cuando lo haces.</p>
            <div className="grid gap-2">
              {LESSONS.map((l, i) => (
                <button key={l.id} type="button" onClick={() => { setLearnOpen(false); setLesson({ i, step: 0 }) }}
                  className="flex items-center gap-3 text-left px-3 py-2.5 rounded-xl border border-border hover:border-sky-400/60 hover:bg-sky-500/5">
                  <span className="w-9 h-9 rounded-lg bg-sky-500/15 text-sky-300 flex items-center justify-center"><Icon name={LESSON_ICON[l.id] ?? 'learn'} size={18} /></span>
                  <span className="flex-1 text-sm text-text-primary">{i + 1}. {l.title}</span>
                  {doneLessons.includes(l.id) && <span className="text-green-400 text-sm"><G n="check" /> Hecha</span>}
                </button>
              ))}
            </div>
            <div className="flex justify-between pt-1">
              <button type="button" onClick={() => { setLearnOpen(false); setTour(0) }} className="text-sm text-sky-300 underline">Ver el tutorial del principio otra vez</button>
              <button type="button" onClick={() => setLearnOpen(false)} className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-primary">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {tour !== null && (
        <Spotlight step={TOUR[tour]} index={tour} total={TOUR.length}
          onNext={() => { if (tour + 1 < TOUR.length) setTour(tour + 1); else { setTour(null); localStorage.setItem('studio-tour-done', '1') } }}
          onSkip={() => { setTour(null); localStorage.setItem('studio-tour-done', '1') }} />
      )}
      {lesson && lessonStep && (
        <Spotlight step={lessonStep} index={lesson.step} total={LESSONS[lesson.i].steps.length} waiting
          onNext={() => setLesson((l) => l && (l.step + 1 < LESSONS[l.i].steps.length ? { ...l, step: l.step + 1 } : null))}
          onSkip={() => setLesson(null)} />
      )}
    </div>
  )
}
