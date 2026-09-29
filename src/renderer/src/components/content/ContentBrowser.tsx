import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ExploreDetail, { type DetailTab } from '../explore/ExploreDetail'
import { nav } from '../../nav'
import { catLabel } from '../../lib/categoryNames'
import {
  DEFAULT_FILTERS, SOURCE_INFO, bestVersion, compatibility, resolveRefs, searchSource, sourceCategories, sourceVersions, sourcesFor,
  type ContentKind, type ProjectRef, type SearchContext, type SearchFilters, type SortKey, type SourceCategory, type SourceId,
  type SourceResult, type SourceVersion
} from '../../lib/contentSources'

// Explorador para instalar en un destino (una instancia, un mundo o un
// servidor). Una sola ventana con todas las fuentes que sirven para ese
// destino: se cambia de fuente arriba a la derecha y todas se comportan igual
// (filtros, ficha completa, versiones, dependencias, historial con el ratón).

export interface InstalledEntry { filename: string; versionId?: string }
/** Lo instalado en el destino, por «fuente:id». */
export type InstalledIndex = Record<string, InstalledEntry>

export interface BrowseTarget {
  title: string
  subtitle: string
  kind: ContentKind
  minecraft: string
  loader: string
  serverSide?: boolean
  installed: InstalledIndex
  /** Descarga e instala una versión; debe lanzar un error si no puede. */
  install: (v: SourceVersion, ref: ProjectRef) => Promise<void>
  /** Borra un archivo instalado (para cambiar de versión). */
  remove?: (filename: string) => Promise<void>
  /** Pregunta antes de instalar; false = se cancela. */
  confirmInstall?: (ref: ProjectRef, v: SourceVersion) => Promise<boolean>
  /** Se llama tras cada instalación para recargar la lista de quien abre. */
  onChanged?: () => void
}

interface Props {
  target: BrowseTarget
  initialSource?: SourceId
  initialDetail?: ProjectRef
  initialTab?: DetailTab
  onClose: () => void
}

type Entry = { type: 'list' } | { type: 'detail'; ref: ProjectRef }

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'relevance', label: 'Relevancia' }, { key: 'downloads', label: 'Descargas' }, { key: 'follows', label: 'Seguidores' },
  { key: 'newest', label: 'Más nuevo' }, { key: 'updated', label: 'Actualizado' },
]
const KIND_LABEL: Record<ContentKind, string> = { mod: 'mods', resourcepack: 'resource packs', shader: 'shaders', datapack: 'datapacks', plugin: 'plugins', modpack: 'modpacks' }
const LOADER_NAMES: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', paper: 'Paper', spigot: 'Spigot', bukkit: 'Bukkit', purpur: 'Purpur', folia: 'Folia', velocity: 'Velocity', bungeecord: 'BungeeCord', waterfall: 'Waterfall', datapack: 'Datapack', iris: 'Iris', optifine: 'OptiFine' }
const COMPAT = {
  yes: { label: 'Compatible', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
  maybe: { label: 'Quizá compatible', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  no: { label: 'No compatible', cls: 'bg-red-500/10 text-red-300 border-red-500/30' },
}

function fmtNum(n?: number): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}
function ago(ms?: number): string {
  if (!ms) return ''
  const d = Math.floor((Date.now() - ms) / 86_400_000)
  if (d <= 0) return 'Hoy'
  if (d === 1) return 'Ayer'
  if (d < 30) return `Hace ${d} días`
  if (d < 365) return `Hace ${Math.floor(d / 30)} meses`
  return `Hace ${Math.floor(d / 365)} años`
}
const clean = (e: unknown): string => e instanceof Error ? e.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, '') : String(e)

export default function ContentBrowser({ target, initialSource, initialDetail, initialTab, onClose }: Props) {
  const ctx: SearchContext = useMemo(() => ({ kind: target.kind, minecraft: target.minecraft, loader: target.loader, serverSide: target.serverSide }),
    [target.kind, target.minecraft, target.loader, target.serverSide])
  const sources = sourcesFor(ctx)
  const [source, setSource] = useState<SourceId>(initialSource && sources.includes(initialSource) ? initialSource : sources[0])
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<SearchFilters>({ ...DEFAULT_FILTERS })
  const [hideInstalled, setHideInstalled] = useState(false)
  const [categories, setCategories] = useState<SourceCategory[]>([])
  const [results, setResults] = useState<SourceResult[]>([])
  const [page, setPage] = useState(0)
  const [more, setMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [installed, setInstalled] = useState<InstalledIndex>(target.installed)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)
  const [stableOnly, setStableOnly] = useState(false)
  const req = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setInstalled((prev) => ({ ...target.installed, ...prev })) }, [target.installed])
  useEffect(() => { window.api.settings.get().then((s) => setStableOnly(s.modInstallChannel === 'stable')).catch(() => {}) }, [])

  // ── Historial (lista ↔ fichas), también con los botones del ratón ──
  const [hist, setHist] = useState<{ list: Entry[]; idx: number }>(() =>
    initialDetail ? { list: [{ type: 'list' }, { type: 'detail', ref: initialDetail }], idx: 1 } : { list: [{ type: 'list' }], idx: 0 })
  const histRef = useRef(hist)
  histRef.current = hist
  const viewState = useRef(new Map<number, { tab: DetailTab; scroll: number }>(initialDetail && initialTab ? [[1, { tab: initialTab, scroll: 0 }]] : []))
  const listScroll = useRef(0)
  const entry = hist.list[hist.idx]
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  function go(step: -1 | 1): boolean {
    const h = histRef.current
    const next = h.idx + step
    if (next < 0 || next >= h.list.length) return false
    if (h.list[h.idx].type === 'list') listScroll.current = listRef.current?.scrollTop ?? 0
    setHist({ ...h, idx: next })
    return true
  }
  function openDetail(ref: ProjectRef): void {
    const h = histRef.current
    if (h.list[h.idx].type === 'list') listScroll.current = listRef.current?.scrollTop ?? 0
    for (const k of [...viewState.current.keys()]) if (k > h.idx) viewState.current.delete(k)
    setHist({ list: [...h.list.slice(0, h.idx + 1), { type: 'detail', ref }], idx: h.idx + 1 })
  }
  useEffect(() => nav.pushOverlay((dir) => {
    if (dir === 'back') { if (!go(-1)) onCloseRef.current(); return true }
    go(1)
    return true
  }), [])
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  useLayoutEffect(() => {
    if (entry.type === 'list' && listRef.current) listRef.current.scrollTop = listScroll.current
  }, [entry])

  // ── Categorías y búsqueda ──
  useEffect(() => {
    setCategories([])
    sourceCategories(source, ctx).then(setCategories).catch(() => setCategories([]))
  }, [source, ctx])

  useEffect(() => {
    const id = ++req.current
    const t = setTimeout(async () => {
      setLoading(true); setError('')
      try {
        const r = await searchSource(source, ctx, q.trim(), 0, filters)
        if (id !== req.current) return
        setResults(r); setPage(0); setMore(r.length >= 20)
        listScroll.current = 0
        if (listRef.current) listRef.current.scrollTop = 0
      } catch {
        if (id === req.current) { setResults([]); setError(`No se pudo buscar en ${SOURCE_INFO[source].label}`) }
      } finally { if (id === req.current) setLoading(false) }
    }, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [source, q, filters, ctx])

  async function loadMore(): Promise<void> {
    if (loading || !more) return
    setLoading(true)
    try {
      const r = await searchSource(source, ctx, q.trim(), page + 1, filters)
      setResults((prev) => [...prev, ...r.filter((x) => !prev.some((y) => y.id === x.id))]); setPage(page + 1); setMore(r.length >= 20)
    } catch { setMore(false) }
    finally { setLoading(false) }
  }

  function changeSource(s: SourceId): void {
    setSource(s)
    setFilters((f) => ({ ...f, categories: [], excluded: [] }))
    // Volver a la lista al cambiar de fuente
    setHist((h) => ({ list: [...h.list.slice(0, h.idx + 1), { type: 'list' }], idx: h.idx + 1 }))
  }

  const flash = (text: string, ok: boolean): void => { setToast({ text, ok }); setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4500) }

  // ── Instalar (con dependencias necesarias y cambio de versión) ──
  async function install(ref: ProjectRef, chosen?: SourceVersion): Promise<void> {
    const key = `${ref.source}:${ref.id}`
    if (busy) return
    setBusy(key)
    try {
      const v = chosen ?? bestVersion(ctx, await sourceVersions(ref.source, ctx, ref.id), stableOnly)
      if (!v) throw new Error(`No hay ninguna versión de «${ref.title}» para descargar`)
      if (!v.url && !v.cf && v.externalUrl) { window.api.shell.openExternal(v.externalUrl); return }
      if (compatibility(ctx, v.platforms, v.gameVersions) === 'no' &&
        !confirm(`«${ref.title}» ${v.number} no parece compatible con Minecraft ${ctx.minecraft}${ctx.loader && ctx.kind === 'mod' ? ` (${ctx.loader})` : ''}. ¿Instalar igualmente?`)) return
      if (target.confirmInstall && !(await target.confirmInstall(ref, v))) return

      const prev = installed[key]
      const newly: InstalledIndex = {}
      // Dependencias necesarias que el destino todavía no tiene
      const required = v.deps.filter((d) => d.type === 'required')
      if (required.length) {
        const refs = await resolveRefs(required).catch(() => ({} as Record<string, ProjectRef>))
        for (const d of required) {
          const dref = refs[`${d.source}:${d.id}`] ?? { source: d.source, id: d.id, title: d.id, icon: null, summary: '' }
          const dkey = `${dref.source}:${dref.id}`
          if (installed[dkey] || newly[dkey]) continue
          const dv = bestVersion(ctx, await sourceVersions(dref.source, ctx, dref.id).catch(() => []), stableOnly)
          if (!dv || (!dv.url && !dv.cf)) continue
          try { await target.install(dv, dref); newly[dkey] = { filename: dv.filename, versionId: dv.id } } catch { /* sigue con el resto */ }
        }
      }
      await target.install(v, ref)
      if (prev?.filename && prev.filename !== v.filename && target.remove) await target.remove(prev.filename).catch(() => {})
      newly[key] = { filename: v.filename, versionId: v.id }
      setInstalled((m) => ({ ...m, ...newly }))
      const extra = Object.keys(newly).length - 1
      flash(`«${ref.title}» ${prev ? 'cambiado a' : 'instalado:'} ${v.number}${extra > 0 ? ` (+${extra} dependencia${extra > 1 ? 's' : ''})` : ''}`, true)
      target.onChanged?.()
    } catch (e) {
      flash(clean(e), false)
    } finally { setBusy(null) }
  }

  const visible = hideInstalled ? results.filter((r) => !installed[`${r.source}:${r.id}`]) : results
  const accent = SOURCE_INFO[source].color
  const catIcons = useMemo(() => new Map(categories.filter((c) => c.icon).map((c) => [c.id, c.icon!])), [categories])
  const catName = (c: SourceCategory): string => (source === 'modrinth' ? catLabel(c.label) : c.label)
  const topCats = categories.filter((c) => !c.parent)
  const childCats = (id: string): SourceCategory[] => categories.filter((c) => c.parent === id)

  function toggleCat(id: string, mode: 'include' | 'exclude'): void {
    setFilters((f) => {
      const single = source !== 'modrinth' && source !== 'fport1'
      if (mode === 'exclude') {
        const ex = f.excluded.includes(id) ? f.excluded.filter((x) => x !== id) : [...f.excluded, id]
        return { ...f, excluded: ex, categories: f.categories.filter((x) => x !== id) }
      }
      const has = f.categories.includes(id)
      const cats = has ? f.categories.filter((x) => x !== id) : single ? [id] : [...f.categories, id]
      return { ...f, categories: cats, excluded: f.excluded.filter((x) => x !== id) }
    })
  }

  const header = (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border flex-shrink-0">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${accent}22`, color: accent }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
      </div>
      <div className="min-w-0">
        <p className="text-base font-bold text-text-primary truncate">{target.title}</p>
        <p className="text-xs text-text-muted truncate">{target.subtitle}</p>
      </div>
      <div className="flex items-center gap-1 ml-2">
        <button onClick={() => go(-1)} disabled={hist.idx === 0} title="Atrás (botón del ratón)"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover disabled:opacity-25">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <button onClick={() => go(1)} disabled={hist.idx >= hist.list.length - 1} title="Adelante (botón del ratón)"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover disabled:opacity-25">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>
      <div className="ml-auto flex items-center gap-1 p-1 rounded-2xl bg-bg-primary border border-border">
        {sources.map((s) => (
          <button key={s} onClick={() => changeSource(s)}
            className={`px-3.5 py-1.5 rounded-xl text-sm font-semibold transition-all ${source === s ? 'text-white shadow-md' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`}
            style={source === s ? { background: SOURCE_INFO[s].color } : undefined}>
            {SOURCE_INFO[s].label}
          </button>
        ))}
      </div>
      <button onClick={onClose} className="w-9 h-9 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-5" onClick={onClose}>
      <div className="relative w-[min(1320px,96vw)] h-[92vh] bg-bg-secondary border border-border rounded-3xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {header}

        {/* Ficha */}
        {entry.type === 'detail' && (
          <ExploreDetail
            key={hist.idx}
            target={entry.ref}
            kind={target.kind}
            ctx={ctx}
            installed={installed[`${entry.ref.source}:${entry.ref.id}`] ?? null}
            busy={busy === `${entry.ref.source}:${entry.ref.id}`}
            canGoBack={hist.idx > 0}
            canGoForward={hist.idx < hist.list.length - 1}
            onBack={() => go(-1)}
            onForward={() => go(1)}
            onOpen={openDetail}
            onInstall={(v) => install(entry.ref, v)}
            catLabel={catLabel}
            catIcons={entry.ref.source === 'modrinth' ? catIcons : undefined}
            initialTab={viewState.current.get(hist.idx)?.tab}
            initialScroll={viewState.current.get(hist.idx)?.scroll}
            onViewChange={(tab, scroll) => viewState.current.set(hist.idx, { tab, scroll })}
          />
        )}

        {/* Lista (se queda montada para no perder la posición) */}
        <div className={`flex-1 flex min-h-0 ${entry.type === 'detail' ? 'hidden' : ''}`}>
          <aside className="w-64 flex-shrink-0 border-r border-border overflow-y-auto p-4 space-y-5 bg-bg-primary/30">
            <section className="space-y-2">
              {target.minecraft && (
                <label className="flex items-center gap-2.5 text-sm text-text-secondary cursor-pointer">
                  <input type="checkbox" checked={filters.onlyCompatible} onChange={(e) => setFilters((f) => ({ ...f, onlyCompatible: e.target.checked }))} className="w-4 h-4 accent-[#22c55e]" />
                  Solo compatibles ({target.minecraft}{target.kind === 'mod' || target.kind === 'plugin' ? ` · ${LOADER_NAMES[target.loader] ?? target.loader}` : ''})
                </label>
              )}
              <label className="flex items-center gap-2.5 text-sm text-text-secondary cursor-pointer">
                <input type="checkbox" checked={hideInstalled} onChange={(e) => setHideInstalled(e.target.checked)} className="w-4 h-4 accent-[#22c55e]" />
                Ocultar lo instalado
              </label>
            </section>

            {source === 'modrinth' && target.kind === 'mod' && (
              <section>
                <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Entorno</p>
                <div className="flex gap-1 p-1 rounded-xl bg-bg-card border border-border">
                  {([['any', 'Todos'], ['client', 'Cliente'], ['server', 'Servidor']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setFilters((f) => ({ ...f, environment: k }))}
                      className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-colors ${filters.environment === k ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-primary'}`}>{l}</button>
                  ))}
                </div>
              </section>
            )}

            {categories.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">Categorías</p>
                  {(filters.categories.length > 0 || filters.excluded.length > 0) && (
                    <button onClick={() => setFilters((f) => ({ ...f, categories: [], excluded: [] }))} className="text-[11px] hover:underline" style={{ color: accent }}>Limpiar</button>
                  )}
                </div>
                <div className="space-y-0.5">
                  {topCats.map((c) => {
                    const on = filters.categories.includes(c.id)
                    const off = filters.excluded.includes(c.id)
                    const kids = childCats(c.id)
                    return (
                      <div key={c.id}>
                        <div className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${on ? 'bg-accent/10' : off ? 'bg-red-500/10' : 'hover:bg-bg-hover'}`}>
                          <button onClick={() => toggleCat(c.id, 'include')} className="flex-1 flex items-center gap-2 text-left min-w-0">
                            {c.icon && <span className={`w-4 h-4 shrink-0 [&>svg]:w-full [&>svg]:h-full ${on ? 'text-accent' : off ? 'text-red-400' : 'text-text-muted'}`} dangerouslySetInnerHTML={{ __html: c.icon }} />}
                            {c.iconUrl && <img src={c.iconUrl} alt="" className="w-4 h-4 shrink-0 rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                            <span className={`text-sm truncate capitalize ${on ? 'text-accent font-medium' : off ? 'text-red-300 line-through' : 'text-text-secondary'}`}>{catName(c)}</span>
                          </button>
                          {source === 'modrinth' && (
                            <button onClick={() => toggleCat(c.id, 'exclude')} title="Excluir"
                              className={`w-5 h-5 rounded flex items-center justify-center text-[11px] ${off ? 'text-red-400' : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400'}`}>⊘</button>
                          )}
                        </div>
                        {kids.length > 0 && (
                          <div className="ml-5 space-y-0.5">
                            {kids.map((k) => (
                              <button key={k.id} onClick={() => toggleCat(k.id, 'include')}
                                className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left text-xs transition-colors ${filters.categories.includes(k.id) ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'}`}>
                                {k.iconUrl && <img src={k.iconUrl} alt="" className="w-3.5 h-3.5 rounded" />}
                                <span className="truncate">{k.label}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </aside>

          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border/60">
              <div className="flex-1 relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted/60" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar ${KIND_LABEL[target.kind]} en ${SOURCE_INFO[source].label}…`}
                  className="w-full bg-bg-primary border border-border focus:border-accent/60 rounded-xl pl-10 pr-3 py-2.5 text-sm text-text-primary outline-none" />
              </div>
              <select value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as SortKey }))}
                className="bg-bg-primary border border-border rounded-xl px-3 py-2.5 text-sm text-text-secondary outline-none cursor-pointer">
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>

            <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-2.5" onScroll={(e) => {
              const el = e.currentTarget
              if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) loadMore()
            }}>
              {error && <p className="text-center text-sm text-red-300 py-10">{error}</p>}
              {!loading && !error && visible.length === 0 && (
                <p className="text-center text-sm text-text-muted py-14">
                  Sin resultados{filters.onlyCompatible && target.minecraft ? ' compatibles — prueba a quitar «Solo compatibles»' : ''}
                </p>
              )}
              {visible.map((r) => {
                const key = `${r.source}:${r.id}`
                const inst = installed[key]
                const compat = compatibility(ctx, r.platforms, r.gameVersions)
                const ref: ProjectRef = { source: r.source, id: r.id, title: r.title, icon: r.icon, summary: r.summary }
                return (
                  <div key={key} onClick={() => openDetail(ref)}
                    className="group flex items-center gap-4 p-4 rounded-2xl bg-bg-card border border-border hover:border-accent/40 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg">
                    <div className="w-16 h-16 rounded-2xl bg-bg-hover overflow-hidden shrink-0 ring-1 ring-white/5">
                      {r.icon ? <img src={r.icon} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /> : <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[15px] font-bold text-text-primary truncate group-hover:underline">{r.title}</p>
                        {r.author && <span className="text-xs text-text-muted truncate">por {r.author}</span>}
                      </div>
                      <p className="text-[13px] text-text-secondary line-clamp-1 mt-0.5">{r.summary}</p>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-semibold ${COMPAT[compat].cls}`}>{COMPAT[compat].label}</span>
                        {r.platforms.filter((x) => x !== 'datapack').slice(0, 3).map((x) => (
                          <span key={x} className="text-[10px] px-1.5 py-0.5 rounded-md bg-bg-hover border border-border text-text-secondary">{LOADER_NAMES[x] ?? x}</span>
                        ))}
                        {r.categories.slice(0, 3).map((c) => {
                          const svg = r.source === 'modrinth' ? catIcons.get(c) : undefined
                          return (
                            <span key={c} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-bg-hover/60 border border-border/60 text-text-muted capitalize">
                              {svg && <span className="w-3 h-3 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} />}
                              {r.source === 'modrinth' ? catLabel(c) : c}
                            </span>
                          )
                        })}
                        <span className="ml-auto flex items-center gap-3 text-[11px] text-text-muted">
                          <span className="flex items-center gap-1"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>{fmtNum(r.downloads)}</span>
                          {r.updated && <span>{ago(r.updated)}</span>}
                        </span>
                      </div>
                    </div>
                    {inst ? (
                      <span className="shrink-0 px-3.5 py-2 rounded-xl text-sm font-semibold bg-green-500/15 text-green-300 border border-green-500/30">✓ Instalado</span>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); install(ref) }} disabled={!!busy}
                        className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-transform active:scale-95" style={{ background: accent }}>
                        {busy === key
                          ? <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 11-6.2-8.56" /></svg>
                          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>}
                        Instalar
                      </button>
                    )}
                  </div>
                )
              })}
              {loading && <p className="text-center text-sm text-text-muted py-4">Cargando…</p>}
            </div>
          </div>
        </div>

        {toast && (
          <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-10 px-4 py-2.5 rounded-xl border text-sm shadow-2xl ${toast.ok ? 'bg-green-600/20 border-green-600/40 text-green-200' : 'bg-red-600/20 border-red-600/40 text-red-200'}`}>
            {toast.text}
          </div>
        )}
      </div>
    </div>
  )
}
