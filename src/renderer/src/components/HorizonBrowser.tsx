import { useEffect, useMemo, useState } from 'react'
import type { HorizonModInstalled, HorizonModProject } from '../../../shared/types'
import { useStore } from '../store'
import G from './ui/Glyph'

// Explorar → Horizon: el registro de mods de Horizon (el mismo índice que usa su launcher) para
// instalar en una instancia Horizon. Texturas, shaders y mods .hmod se instalan aquí; los mods
// nativos (código Rust dentro del juego) necesitan compilar Horizon con ellos y de momento solo se
// enseñan, con el enlace a su página.

type Tab = 'mod' | 'native-mod' | 'shader' | 'resourcepack' | 'modpack'
const TABS: { key: Tab; label: string; icon: JSX.Element }[] = [
  { key: 'native-mod', label: 'Mods nativos', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></svg> },
  { key: 'mod', label: 'Mods (.hmod)', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg> },
  { key: 'shader', label: 'Shaders', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg> },
  { key: 'resourcepack', label: 'Texturas', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 00-2.82 0L6 21"/></svg> },
  { key: 'modpack', label: 'Modpacks', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg> },
]
const ACCENT = '#f97316'
const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} k` : String(n))
const kb = (n: number): string => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function Stars({ value }: { value?: number }) {
  if (value === undefined) return null
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-300" title={`${value.toFixed(1)} de 5`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>
      <span className="text-[11px]">{value.toFixed(1)}</span>
    </span>
  )
}

export default function HorizonBrowser() {
  const instances = useStore((s) => s.instances).filter((i) => i.kind === 'horizon')
  const [all, setAll] = useState<HorizonModProject[] | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('native-mod')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'downloads' | 'rating' | 'updated' | 'name'>('downloads')
  const [category, setCategory] = useState('')
  const [instanceId, setInstanceId] = useState<string>(() => localStorage.getItem('ml-horizon-mods-instance') ?? '')
  const [installed, setInstalled] = useState<HorizonModInstalled[]>([])
  const [open, setOpen] = useState<HorizonModProject | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const inst = instances.find((i) => i.id === instanceId) ?? instances[0]
  useEffect(() => { if (inst) localStorage.setItem('ml-horizon-mods-instance', inst.id) }, [inst?.id])

  useEffect(() => {
    window.api.horizonMods.index().then(setAll).catch((e) => setError(`No se pudo leer el registro de Horizon: ${e?.message ?? e}`))
  }, [])
  const refreshInstalled = (): void => { if (inst) window.api.horizonMods.installed(inst.id).then(setInstalled).catch(() => setInstalled([])) }
  useEffect(refreshInstalled, [inst?.id])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of all ?? []) c[p.kind] = (c[p.kind] ?? 0) + 1
    return c
  }, [all])
  const categories = useMemo(() => [...new Set((all ?? []).filter((p) => p.kind === tab).flatMap((p) => p.categories))].sort(), [all, tab])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (all ?? [])
      .filter((p) => p.kind === tab && (!category || p.categories.includes(category))
        && (!s || p.name.toLowerCase().includes(s) || p.summary.toLowerCase().includes(s) || p.tags.some((t) => t.includes(s)) || p.authors.some((a) => a.toLowerCase().includes(s))))
      .sort((a, b) => sort === 'downloads' ? b.downloads - a.downloads
        : sort === 'rating' ? (b.rating ?? 0) - (a.rating ?? 0)
          : sort === 'updated' ? b.updated.localeCompare(a.updated) : a.name.localeCompare(b.name))
  }, [all, tab, q, sort, category])

  const isInstalled = (id: string): HorizonModInstalled | undefined => installed.find((x) => x.id === id)

  async function install(p: HorizonModProject, version?: string): Promise<void> {
    if (!inst) { setMsg({ ok: false, text: 'Crea primero una instancia Horizon: en Instancias, «Nueva» y luego «Horizon».' }); return }
    setBusy(p.id)
    try {
      const r = await window.api.horizonMods.install(inst.id, p.id, version)
      setMsg({ ok: true, text: `${p.name} ${r.version} instalado en «${inst.name}».${p.kind === 'resourcepack' ? ' Actívalo en Opciones, en Paquetes de recursos.' : p.kind === 'shader' ? ' Elígelo en Opciones, en Shaders.' : ''}` })
      refreshInstalled()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally { setBusy(null) }
  }
  async function remove(p: HorizonModProject): Promise<void> {
    if (!inst) return
    setBusy(p.id)
    await window.api.horizonMods.remove(inst.id, p.id).catch(() => {})
    setBusy(null)
    refreshInstalled()
  }

  const action = (p: HorizonModProject, big = false): JSX.Element => {
    const ins = isInstalled(p.id)
    const cls = big ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'
    if (!p.installable) {
      return (
        <button type="button" onClick={(e) => { e.stopPropagation(); void window.api.shell.openExternal(`https://playhorizon.dev/mods/${p.id}`) }}
          title="Los mods nativos se compilan dentro del juego. De momento se instalan con el launcher oficial de Horizon."
          className={`${cls} rounded-lg border border-border text-text-secondary hover:text-text-primary`}>Ver en playhorizon.dev <G n="external" /></button>
      )
    }
    if (busy === p.id) return <span className={`${cls} text-text-muted`}>Un momento…</span>
    if (ins) {
      const newer = p.versions[0] && p.versions[0].version !== ins.version
      return (
        <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {newer && <button type="button" onClick={() => install(p)} className={`${cls} rounded-lg font-semibold text-white`} style={{ background: ACCENT }}>Actualizar a {p.versions[0].version}</button>}
          <span className={`${cls} rounded-lg bg-green-500/15 text-green-300`}><G n="check" /> {ins.version}</span>
          <button type="button" onClick={() => remove(p)} className={`${cls} rounded-lg border border-border text-text-secondary hover:text-red-300`}>Quitar</button>
        </span>
      )
    }
    return <button type="button" onClick={(e) => { e.stopPropagation(); void install(p) }} className={`${cls} rounded-lg font-semibold text-white`} style={{ background: ACCENT }}>Instalar</button>
  }

  // ── Ficha de un proyecto ──
  if (open) {
    const p = open
    return (
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <button type="button" onClick={() => setOpen(null)} className="text-sm text-text-secondary hover:text-text-primary mb-4"><G n="arrowLeft" /> Volver al registro de Horizon</button>
        <div className="flex items-start gap-4">
          {p.icon ? <img src={p.icon} alt="" className="w-20 h-20 rounded-2xl object-cover bg-bg-card" style={{ imageRendering: 'pixelated' }} /> : <div className="w-20 h-20 rounded-2xl bg-bg-card" />}
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold text-text-primary">{p.name}</h2>
            <p className="text-sm text-text-muted">por {p.authors.join(', ')}{p.license ? ` · ${p.license}` : ''}</p>
            <p className="text-sm text-text-secondary mt-1">{p.summary}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
              <span><G n="download" /> {fmt(p.downloads)}</span><Stars value={p.rating} />{p.updated && <span>Actualizado {p.updated}</span>}
              {p.source && <button type="button" className="underline" onClick={() => window.api.shell.openExternal(p.source!)}>Código / origen <G n="external" /></button>}
            </div>
          </div>
          <div className="shrink-0">{action(p, true)}</div>
        </div>
        {!p.installable && (
          <p className="mt-4 text-sm rounded-xl px-3 py-2 bg-amber-500/10 text-amber-200">
            Es un mod <b>nativo</b>: su código Rust se compila dentro del juego. El launcher oficial de Horizon recompila el juego entero en tu PC para cada combinación de mods nativos; aquí todavía no, así que de momento se instala desde su launcher o su web.
          </p>
        )}
        {p.screenshots.length > 0 && (
          <div className="flex gap-2 overflow-x-auto mt-5 pb-2">
            {p.screenshots.map((s) => <img key={s} src={s} alt="" className="h-44 rounded-xl border border-border" />)}
          </div>
        )}
        <div className="mt-5 grid gap-5" style={{ gridTemplateColumns: 'minmax(0,1fr) 280px' }}>
          <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">{p.description || p.summary}</div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-text-muted uppercase">Versiones</p>
            {p.versions.map((v) => (
              <div key={v.version} className="rounded-xl border border-border bg-bg-card px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary flex-1">{v.version}</span>
                  {p.installable && <button type="button" onClick={() => install(p, v.version)} className="text-xs underline text-text-secondary hover:text-text-primary">Instalar esta</button>}
                </div>
                <p className="text-[11px] text-text-muted">{v.published} · Minecraft {v.game || '26.3'} · {kb(v.file.size)}{v.side ? ` · ${v.side === 'both' ? 'cliente y servidor' : v.side}` : ''}</p>
                {v.changelog && <p className="text-[11px] text-text-secondary mt-1 line-clamp-3">{v.changelog}</p>}
              </div>
            ))}
            {p.categories.length > 0 && <p className="text-[11px] text-text-muted pt-2">Categorías: {p.categories.join(', ')}</p>}
          </div>
        </div>
        {msg && <Toast msg={msg} onClose={() => setMsg(null)} />}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => { setTab(t.key); setCategory('') }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${tab === t.key ? '' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
            style={tab === t.key ? { borderColor: ACCENT, color: ACCENT } : undefined}>
            {t.icon}{t.label}<span className="text-[11px] opacity-60">{counts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="px-6 py-3 flex flex-wrap items-center gap-2 border-b border-border/50">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el registro de Horizon…"
          className="flex-1 min-w-[220px] bg-bg-card border border-border rounded-xl px-3 py-2 text-sm text-text-primary outline-none focus:border-[#f97316]" />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="bg-bg-card border border-border rounded-xl px-2 py-2 text-sm text-text-primary">
          <option value="downloads">Más descargados</option><option value="rating">Mejor valorados</option><option value="updated">Recientes</option><option value="name">Nombre</option>
        </select>
        {categories.length > 0 && (
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="bg-bg-card border border-border rounded-xl px-2 py-2 text-sm text-text-primary">
            <option value="">Todas las categorías</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select value={inst?.id ?? ''} onChange={(e) => setInstanceId(e.target.value)} className="bg-bg-card border border-border rounded-xl px-2 py-2 text-sm text-text-primary" title="Instancia Horizon donde se instala">
          {instances.length === 0 && <option value="">Sin instancias Horizon</option>}
          {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>
      {tab === 'native-mod' && (
        <p className="mx-6 mt-3 text-xs rounded-xl px-3 py-2 bg-amber-500/10 text-amber-200">Los mods nativos se compilan dentro del juego (Rust). Aquí puedes verlos todos; de momento se instalan con el launcher oficial de Horizon.</p>
      )}
      {error && <p className="px-6 py-3 text-sm text-red-400">{error}</p>}
      <div className="flex-1 overflow-y-auto px-6 py-4 grid gap-3 content-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {!all && !error && <p className="text-sm text-text-muted">Cargando el registro de Horizon…</p>}
        {all && list.length === 0 && <p className="text-sm text-text-muted">Nada coincide.</p>}
        {list.map((p) => (
          <div key={p.id} role="button" tabIndex={0} onClick={() => setOpen(p)} onKeyDown={(e) => e.key === 'Enter' && setOpen(p)}
            className="flex gap-3 rounded-2xl border border-border bg-bg-card hover:border-[#f97316]/60 p-3 cursor-pointer text-left">
            {p.icon ? <img src={p.icon} alt="" loading="lazy" className="w-14 h-14 rounded-xl object-cover bg-bg-primary shrink-0" style={{ imageRendering: 'pixelated' }} /> : <div className="w-14 h-14 rounded-xl bg-bg-primary shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate">{p.name}</p>
              <p className="text-[11px] text-text-muted truncate">por {p.authors.join(', ')}</p>
              <p className="text-xs text-text-secondary line-clamp-2 mt-0.5">{p.summary}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-text-muted"><G n="download" /> {fmt(p.downloads)}</span>
                <Stars value={p.rating} />
                <span className="flex-1" />
                {action(p)}
              </div>
            </div>
          </div>
        ))}
      </div>
      {msg && <Toast msg={msg} onClose={() => setMsg(null)} />}
    </div>
  )
}

function Toast({ msg, onClose }: { msg: { ok: boolean; text: string }; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, msg.ok ? 6000 : 12000); return () => clearTimeout(t) }, [msg])
  return (
    <div onClick={onClose} className={`fixed bottom-5 right-5 z-[100] max-w-md px-4 py-3 rounded-xl text-sm shadow-xl cursor-pointer ${msg.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>{msg.text}</div>
  )
}
