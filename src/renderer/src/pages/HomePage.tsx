import { useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore, activeAccount } from '../store'
import type { Instance } from '../../../shared/types'
import { APP_VERSION } from '../../../shared/types'
import UpdateCheckBtn from '../components/UpdateCheckBtn'
import { useT } from '../i18n'
import LauncherAiModal from '../components/ai/LauncherAiModal'

const SEEN_KEY = 'launcher:seen-announcements'
function getSeenIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')) } catch { return new Set() }
}
function markSeen(ids: string[]) {
  const seen = getSeenIds()
  ids.forEach(id => seen.add(id))
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]))
}

type AnnType = 'update' | 'info' | 'warning' | 'event' | 'sponsor'
interface Announcement {
  id: string; type: AnnType; title: string; summary: string
  date: string; imageUrl: string | null; linkUrl: string | null; linkLabel: string | null
}

const NEWS_TYPE_KEYS = {
  update:  'home_news_update',
  info:    'home_news_info',
  warning: 'home_news_warning',
  event:   'home_news_event',
} as const

const NEWS_META_STYLE: Record<Exclude<AnnType, 'sponsor'>, { bg: string; text: string; dot: string }> = {
  update:  { bg: 'bg-accent/15',    text: 'text-accent',      dot: 'bg-accent' },
  info:    { bg: 'bg-teal-500/15',  text: 'text-teal-400',    dot: 'bg-teal-400' },
  warning: { bg: 'bg-amber-500/15', text: 'text-amber-400',   dot: 'bg-amber-400' },
  event:   { bg: 'bg-purple-500/15',text: 'text-purple-400',  dot: 'bg-purple-400' },
}

function SponsorLabel() {
  const t = useT()
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted/50 border border-border/60 px-1.5 py-px rounded">
      {t('sponsored')}
    </span>
  )
}

// ── Sponsor banner ──────────────────────────────────────────────────────────

function SponsorBanner({ sponsors }: { sponsors: Announcement[] }) {
  const [idx, setIdx] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (sponsors.length <= 1) return
    timer.current = setInterval(() => setIdx(i => (i + 1) % sponsors.length), 7000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [sponsors.length])

  if (sponsors.length === 0) return null
  const s = sponsors[idx]

  return (
    <div className="mb-6">
      <div className="relative rounded-xl overflow-hidden border border-border bg-bg-card group">
        {/* Background image or gradient */}
        {s.imageUrl ? (
          <img src={s.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-20" draggable={false} />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-r from-accent/10 via-transparent to-purple-500/10" />
        )}

        <div className="relative flex items-center gap-4 px-5 py-4">
          {/* Ad icon */}
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-bg-hover border border-border flex items-center justify-center">
            {s.imageUrl ? (
              <img src={s.imageUrl} alt="" className="w-full h-full object-cover rounded-lg" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted/50">
                <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
              </svg>
            )}
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <SponsorLabel />
            </div>
            <p className="text-sm font-semibold text-text-primary truncate">{s.title}</p>
            <p className="text-xs text-text-secondary truncate">{s.summary}</p>
          </div>

          {/* CTA */}
          {s.linkUrl && (
            <button
              onClick={() => window.api.shell.openExternal(s.linkUrl!)}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent/90 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {s.linkLabel ?? 'Ver más'}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>
              </svg>
            </button>
          )}
        </div>

        {/* Dots indicator for multiple sponsors */}
        {sponsors.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 pb-2">
            {sponsors.map((_, i) => (
              <button
                key={i}
                onClick={() => { setIdx(i); if (timer.current) { clearInterval(timer.current); timer.current = setInterval(() => setIdx(j => (j + 1) % sponsors.length), 7000) } }}
                className={`w-1.5 h-1.5 rounded-full transition-all ${i === idx ? 'bg-accent w-3' : 'bg-text-muted/30 hover:bg-text-muted/50'}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── News card ───────────────────────────────────────────────────────────────

function NewsCard({ ann, isNew }: { ann: Announcement; isNew: boolean }) {
  const t = useT()
  const typeKey = ann.type as Exclude<AnnType, 'sponsor'>
  const style = NEWS_META_STYLE[typeKey] ?? NEWS_META_STYLE.info
  const label = NEWS_TYPE_KEYS[typeKey] ? t(NEWS_TYPE_KEYS[typeKey]) : ann.type
  const locale = useStore(s => s.settings?.language === 'en' ? 'en' : 'es')
  const dateStr = new Date(ann.date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden flex flex-col hover:border-accent/30 transition-colors">
      {ann.imageUrl && <img src={ann.imageUrl} alt="" className="w-full h-24 object-cover" draggable={false} />}
      <div className="p-3.5 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />{label}
          </span>
          {isNew && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-accent text-white">{t('new')}</span>}
          <span className="text-[11px] text-text-muted ml-auto">{dateStr}</span>
        </div>
        <p className="text-sm font-semibold text-text-primary leading-snug">{ann.title}</p>
        <p className="text-xs text-text-secondary leading-relaxed flex-1">{ann.summary}</p>
        {ann.linkUrl && (
          <button
            onClick={() => window.api.shell.openExternal(ann.linkUrl!)}
            className="mt-1 self-start flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-medium transition-colors"
          >
            {ann.linkLabel ?? t('see_more')}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}


// ── Instance icon ────────────────────────────────────────────────────────────

function useInstanceIcon(instanceId: string | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!instanceId) { setSrc(null); return }
    window.api.instances.getIcon(instanceId).then(setSrc).catch(() => setSrc(null))
  }, [instanceId])
  return src
}

function InstanceIcon({ instanceId, className = '' }: { instanceId: string; className?: string }) {
  const src = useInstanceIcon(instanceId)
  return src
    ? <img src={src} className={`w-full h-full object-cover ${className}`} draggable={false} />
    : <div className={`w-full h-full animate-pulse bg-bg-hover ${className}`} />
}

const LOADER_LABEL: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', vanilla: 'Vanilla' }

function timeAgo(ms?: number): string {
  if (!ms) return 'Nunca jugada'
  const m = Math.round((Date.now() - ms) / 60_000)
  if (m < 1) return 'Hace un momento'
  if (m < 60) return `Hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `Hace ${h} h`
  const d = Math.round(h / 24)
  if (d < 30) return d === 1 ? 'Ayer' : `Hace ${d} días`
  return new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

function playtimeText(ms?: number): string | null {
  if (!ms || ms < 60_000) return null
  const h = ms / 3_600_000
  return h < 1 ? `${Math.round(ms / 60_000)} min jugados` : `${h < 10 ? h.toFixed(1) : Math.round(h)} h jugadas`
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const t = useT()
  const navigate = useNavigate()
  const account = useStore(activeAccount)
  const { setInstances, updateInstance, setOpenDetailInstanceId } = useStore()
  const instances = useStore(s => s.instances)
  const runningInstances = useStore(s => s.runningInstances)
  const [launching, setLaunching] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [sponsors, setSponsors] = useState<Announcement[]>([])
  const [news, setNews] = useState<Announcement[]>([])
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set())
  const [annLoading, setAnnLoading] = useState(true)
  const [updateMap, setUpdateMap] = useState<Map<string, boolean>>(new Map())
  const [aiOpen, setAiOpen] = useState(false)

  useEffect(() => { window.api.instances.list().then(setInstances) }, [])

  // Las más recientes primero (las nunca jugadas, por fecha de creación)
  const recent = [...instances].sort((a, b) => (b.lastPlayed ?? b.createdAt ?? 0) - (a.lastPlayed ?? a.createdAt ?? 0)).slice(0, 6)
  const featured = recent[0]
  const featuredIcon = useInstanceIcon(featured?.id)

  // Background modpack update checks for recent instances
  useEffect(() => {
    const toCheck = recent.filter(i => i.modpackUrl)
    if (toCheck.length === 0) return
    let cancelled = false
    for (const inst of toCheck) {
      window.api.modpacks.checkUpdate(inst.id, inst.modpackUrl!)
        .then(r => {
          if (!cancelled) setUpdateMap(prev => { const n = new Map(prev); n.set(inst.id, r.hasUpdate); return n })
        })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [recent.map(i => i.id).join(',')])

  useEffect(() => {
    const seen = getSeenIds()
    setSeenIds(new Set(seen))
    window.api.announcements.fetch()
      .then(data => {
        const visible = data.filter((a: any) => a.active !== false)
        setSponsors(visible.filter(a => a.type === 'sponsor'))
        setNews(visible.filter(a => a.type !== 'sponsor'))
        setTimeout(() => {
          markSeen(data.map(a => a.id))
          setSeenIds(new Set(data.map(a => a.id)))
        }, 4000)
      })
      .catch(() => {})
      .finally(() => setAnnLoading(false))
  }, [])

  async function play(instanceId: string) {
    if (!account) { setError(t('home_no_account_error')); return }
    setError('')
    setLaunching(instanceId)
    try { await window.api.launcher.launch(instanceId) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error al lanzar') }
    finally { setLaunching(null) }
  }

  async function kill(instanceId: string) {
    try { await window.api.launcher.kill(instanceId) } catch {}
  }

  async function updateModpack(inst: Instance) {
    if (!inst.modpackUrl) return
    try {
      const r = await window.api.modpacks.update(inst.id, inst.modpackUrl)
      updateInstance({ ...inst, modpackVersion: r.manifest.version })
      setUpdateMap(prev => { const n = new Map(prev); n.set(inst.id, false); return n })
    } catch { /* ignore */ }
  }

  function openDetails(id: string) { setOpenDetailInstanceId(id); navigate('/instances') }

  const unreadNews = news.filter(a => !seenIds.has(a.id)).length

  const playButton = (inst: Instance, big?: boolean) => runningInstances.has(inst.id) ? (
    <div className="flex items-center gap-2">
      <span className={`flex items-center gap-1.5 bg-green-500/20 text-green-400 font-medium rounded-xl border border-green-500/30 ${big ? 'px-4 py-3 text-sm' : 'px-2.5 py-1 text-xs'}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />{t('in_game')}
      </span>
      <button onClick={(e) => { e.stopPropagation(); kill(inst.id) }}
        className={`bg-red-500/20 hover:bg-red-500/30 text-red-400 font-medium rounded-xl border border-red-500/30 transition-colors ${big ? 'px-4 py-3 text-sm' : 'px-3 py-1.5 text-xs'}`}>
        {t('stop_game')}
      </button>
    </div>
  ) : (
    <button onClick={(e) => { e.stopPropagation(); play(inst.id) }} disabled={!!launching}
      className={`flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-accent/20 ${big ? 'px-8 py-3 text-base' : 'px-4 py-1.5 text-sm'}`}>
      <svg width={big ? 16 : 12} height={big ? 16 : 12} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      {launching === inst.id ? t('playing') : t('play')}
    </button>
  )

  const actions: { label: string; hint: string; icon: JSX.Element; onClick: () => void; tint: string }[] = [
    { label: 'Nueva instancia', hint: 'Vanilla, Fabric, NeoForge…', tint: '#22c55e', onClick: () => navigate('/instances'),
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg> },
    { label: 'Explorar', hint: 'Mods, packs y shaders', tint: '#3b82f6', onClick: () => navigate('/discover'),
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg> },
    { label: 'Modpacks', hint: 'Instalar o compartir', tint: '#a855f7', onClick: () => navigate('/modpacks'),
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></svg> },
    { label: 'IA del launcher', hint: 'Ayuda, modelos y archivos', tint: '#d97757', onClick: () => setAiOpen(true),
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M10 2.5c.4 3.9 2.1 5.6 6 6-3.9.4-5.6 2.1-6 6-.4-3.9-2.1-5.6-6-6 3.9-.4 5.6-2.1 6-6Z" /><path d="M18 12.5c.25 2.3 1.2 3.25 3.5 3.5-2.3.25-3.25 1.2-3.5 3.5-.25-2.3-1.2-3.25-3.5-3.5 2.3-.25 3.25-1.2 3.5-3.5Z" /></svg> },
  ]

  return (
    <div className="h-full overflow-y-auto">
      {/* ── Cabecera: seguir jugando ── */}
      <div className="relative overflow-hidden border-b border-border">
        {featuredIcon && <img src={featuredIcon} alt="" className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-40 pointer-events-none" draggable={false} />}
        <div className="absolute inset-0 bg-gradient-to-r from-bg-primary via-bg-primary/80 to-bg-primary/30 pointer-events-none" />
        <div className="relative px-8 pt-7 pb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-text-primary">
                {account ? t('home_welcome', { name: account.username }) : t('home_welcome_default')}
              </h1>
              <p className="text-text-secondary text-sm mt-0.5">{account ? t('home_subtitle') : t('home_subtitle_noaccount')}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-muted px-2 py-1 rounded-lg bg-black/20 border border-border">v{APP_VERSION}</span>
              <UpdateCheckBtn />
            </div>
          </div>

          {featured ? (
            <div className="flex items-center gap-6 p-5 rounded-3xl bg-black/25 border border-white/10 backdrop-blur-sm cursor-pointer hover:border-white/20 transition-colors"
              onClick={() => openDetails(featured.id)}>
              <div className="w-24 h-24 rounded-3xl overflow-hidden flex-shrink-0 ring-1 ring-white/10 shadow-2xl">
                <InstanceIcon instanceId={featured.id} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-widest text-accent mb-1">{featured.lastPlayed ? 'Seguir jugando' : 'Tu instancia más nueva'}</p>
                <p className="text-3xl font-bold text-text-primary truncate">{featured.name}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap text-xs text-text-secondary">
                  <span className="px-2 py-0.5 rounded-md bg-black/30 border border-white/10">MC {featured.minecraft}</span>
                  <span className="px-2 py-0.5 rounded-md bg-black/30 border border-white/10">{LOADER_LABEL[featured.modloader] ?? featured.modloader}</span>
                  <span className="text-text-muted">{timeAgo(featured.lastPlayed)}</span>
                  {playtimeText(featured.playtime) && <span className="text-text-muted">· {playtimeText(featured.playtime)}</span>}
                  {updateMap.get(featured.id) && (
                    <button onClick={(e) => { e.stopPropagation(); updateModpack(featured) }}
                      className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25">{t('update')}</button>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                {playButton(featured, true)}
                <span className="text-[11px] text-text-muted">Haz clic en la tarjeta para ver los detalles</span>
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-3xl bg-black/25 border border-dashed border-white/15 text-center">
              <p className="text-lg font-semibold text-text-primary">{t('home_no_instances')}</p>
              <Link to="/instances" className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition-colors">
                {t('home_create_first')}
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {error && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">{error}</div>}

        {/* ── Accesos rápidos ── */}
        <div className="grid grid-cols-4 gap-3">
          {actions.map(a => (
            <button key={a.label} onClick={a.onClick}
              className="group flex items-center gap-3 p-3.5 rounded-2xl bg-bg-card border border-border hover:border-white/20 text-left transition-colors"
              style={{ background: `linear-gradient(135deg, ${a.tint}14, transparent 70%)` }}>
              <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105" style={{ background: `${a.tint}26`, color: a.tint }}>{a.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text-primary">{a.label}</span>
                <span className="block text-[11px] text-text-muted truncate">{a.hint}</span>
              </span>
            </button>
          ))}
        </div>

        {!annLoading && sponsors.length > 0 && <SponsorBanner sponsors={sponsors} />}

        <div className="grid grid-cols-3 gap-6">
          {/* ── Tus instancias ── */}
          <section className="col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-text-primary">{t('home_recent')}</h2>
              <Link to="/instances" className="text-xs text-accent hover:text-accent-hover">{t('see_all')}</Link>
            </div>
            {recent.length > 1 ? (
              <div className="grid grid-cols-2 gap-3">
                {recent.slice(1).map(inst => (
                  <div key={inst.id} onClick={() => openDetails(inst.id)}
                    className="group flex items-center gap-3 p-3 rounded-2xl bg-bg-card border border-border hover:border-accent/40 cursor-pointer transition-colors">
                    <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 ring-1 ring-white/5">
                      <InstanceIcon instanceId={inst.id} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{inst.name}</p>
                      <p className="text-[11px] text-text-muted truncate">MC {inst.minecraft} · {LOADER_LABEL[inst.modloader] ?? inst.modloader} · {timeAgo(inst.lastPlayed)}</p>
                      {updateMap.get(inst.id) && (
                        <button onClick={(e) => { e.stopPropagation(); updateModpack(inst) }}
                          className="mt-1 text-[10px] bg-amber-500/10 border border-amber-500/30 text-amber-400 px-1.5 py-px rounded-full hover:bg-amber-500/20">{t('update')}</button>
                      )}
                    </div>
                    {playButton(inst)}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted py-8 text-center border border-dashed border-border rounded-2xl">
                {featured ? 'Cuando tengas más instancias aparecerán aquí.' : t('home_no_instances')}
              </p>
            )}
          </section>

          {/* ── Noticias ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-text-primary">{t('home_news')}</h2>
              {unreadNews > 0 && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-accent text-white leading-none">{unreadNews}</span>}
            </div>
            {annLoading ? (
              <div className="space-y-3">
                {[0, 1].map(i => (
                  <div key={i} className="bg-bg-card border border-border rounded-xl p-4 flex flex-col gap-2 animate-pulse">
                    <div className="h-3 w-24 bg-bg-hover rounded-full" />
                    <div className="h-4 w-full bg-bg-hover rounded-full" />
                    <div className="h-3 w-3/4 bg-bg-hover rounded-full" />
                  </div>
                ))}
              </div>
            ) : news.length ? (
              <div className="space-y-3">{news.map(ann => <NewsCard key={ann.id} ann={ann} isNew={!seenIds.has(ann.id)} />)}</div>
            ) : (
              <p className="text-sm text-text-muted py-8 text-center border border-dashed border-border rounded-2xl">Sin novedades por ahora</p>
            )}
          </section>
        </div>
      </div>

      {aiOpen && <LauncherAiModal onClose={() => setAiOpen(false)} />}
    </div>
  )
}
