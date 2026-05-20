import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useStore, activeAccount } from '../store'
import type { Instance } from '../../../shared/types'
import { APP_VERSION } from '../../../shared/types'
import UpdateCheckBtn from '../components/UpdateCheckBtn'
import { useT } from '../i18n'

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

function InstanceIcon({ instanceId }: { instanceId: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    window.api.instances.getIcon(instanceId).then(setSrc).catch(() => setSrc(null))
  }, [instanceId])
  return src
    ? <img src={src} className="w-full h-full object-cover rounded-lg" draggable={false} />
    : <div className="w-full h-full rounded-lg animate-pulse bg-bg-hover" />
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const t = useT()
  const account = useStore(activeAccount)
  const { setInstances, updateInstance } = useStore()
  const runningInstances = useStore(s => s.runningInstances)
  const [recent, setRecent] = useState<Instance[]>([])
  const [launching, setLaunching] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [sponsors, setSponsors] = useState<Announcement[]>([])
  const [news, setNews] = useState<Announcement[]>([])
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set())
  const [annLoading, setAnnLoading] = useState(true)
  const [updateMap, setUpdateMap] = useState<Map<string, boolean>>(new Map())

  useEffect(() => {
    window.api.instances.list().then(all => { setInstances(all); setRecent(all.slice(0, 3)) })
  }, [])

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

  const unreadNews = news.filter(a => !seenIds.has(a.id)).length

  return (
    <div className="p-6 overflow-y-auto h-full">
      {/* Welcome */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-1">
            {account ? t('home_welcome', { name: account.username }) : t('home_welcome_default')}
          </h1>
          <p className="text-text-secondary text-sm">
            {account ? t('home_subtitle') : t('home_subtitle_noaccount')}
          </p>
        </div>
        <UpdateCheckBtn />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>
      )}

      {/* ── Sponsors ── */}
      {!annLoading && sponsors.length > 0 && <SponsorBanner sponsors={sponsors} />}

      {/* ── Noticias ── */}
      {(annLoading || news.length > 0) && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-text-primary">{t('home_news')}</h2>
            {unreadNews > 0 && (
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-accent text-white leading-none">{unreadNews}</span>
            )}
          </div>
          {annLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map(i => (
                <div key={i} className="bg-bg-card border border-border rounded-xl p-4 flex flex-col gap-2 animate-pulse">
                  <div className="h-3 w-24 bg-bg-hover rounded-full" />
                  <div className="h-4 w-full bg-bg-hover rounded-full" />
                  <div className="h-3 w-3/4 bg-bg-hover rounded-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className={`grid gap-3 ${news.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {news.map(ann => <NewsCard key={ann.id} ann={ann} isNew={!seenIds.has(ann.id)} />)}
            </div>
          )}
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: t('home_instances'), value: useStore.getState().instances.length, to: '/instances' },
          { label: t('home_account'),    value: account?.username ?? t('home_none_account'), to: '/settings' },
          { label: t('home_version'),   value: `v${APP_VERSION}`, to: '/settings' }
        ].map(stat => (
          <Link key={stat.label} to={stat.to} className="bg-bg-card border border-border rounded-xl p-4 hover:border-accent/40 transition-colors">
            <p className="text-xs text-text-muted mb-1">{stat.label}</p>
            <p className="text-lg font-semibold text-text-primary truncate">{stat.value}</p>
          </Link>
        ))}
      </div>

      {/* Recent instances */}
      {recent.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text-primary">{t('home_recent')}</h2>
            <Link to="/instances" className="text-xs text-accent hover:text-accent-hover">{t('see_all')}</Link>
          </div>
          <div className="space-y-2">
            {recent.map(inst => (
              <div key={inst.id} className="flex items-center gap-4 bg-bg-card border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-bg-hover flex-shrink-0 overflow-hidden">
                  <InstanceIcon instanceId={inst.id} />
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="font-medium text-text-primary truncate">{inst.name}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-text-muted">MC {inst.minecraft} · {inst.modloader}</p>
                    {updateMap.get(inst.id) && (
                      <button
                        onClick={() => updateModpack(inst)}
                        className="inline-flex items-center gap-1 text-[10px] bg-amber-500/10 border border-amber-500/30 text-amber-400 px-1.5 py-px rounded-full hover:bg-amber-500/20 transition-colors"
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                        {t('update')}
                      </button>
                    )}
                  </div>
                </div>
                {runningInstances.has(inst.id) ? (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/20 text-green-400 text-xs font-medium rounded-lg border border-green-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />{t('in_game')}
                    </span>
                    <button onClick={() => kill(inst.id)} className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium rounded-lg border border-red-500/30 transition-colors">
                      {t('stop_game')}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => play(inst.id)} disabled={!!launching}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white text-sm font-medium rounded-lg transition-colors">
                    {launching === inst.id ? t('playing') : t('play')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-text-muted mb-3">{t('home_no_instances')}</p>
          <Link to="/instances" className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">
            {t('home_create_first')}
          </Link>
        </div>
      )}
    </div>
  )
}
