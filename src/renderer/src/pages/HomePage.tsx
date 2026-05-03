import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useStore, activeAccount } from '../store'
import type { Instance } from '../../../shared/types'
import { APP_VERSION } from '../../../shared/types'
import UpdateCheckBtn from '../components/UpdateCheckBtn'

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

const NEWS_META: Record<Exclude<AnnType, 'sponsor'>, { label: string; bg: string; text: string; dot: string }> = {
  update:  { label: 'Actualización', bg: 'bg-accent/15',    text: 'text-accent',      dot: 'bg-accent' },
  info:    { label: 'Info',          bg: 'bg-teal-500/15',  text: 'text-teal-400',    dot: 'bg-teal-400' },
  warning: { label: 'Aviso',         bg: 'bg-amber-500/15', text: 'text-amber-400',   dot: 'bg-amber-400' },
  event:   { label: 'Evento',        bg: 'bg-purple-500/15',text: 'text-purple-400',  dot: 'bg-purple-400' },
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
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted/50 border border-border/60 px-1.5 py-px rounded">
                Patrocinado
              </span>
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
  const meta = NEWS_META[ann.type as Exclude<AnnType, 'sponsor'>] ?? NEWS_META.info
  const dateStr = new Date(ann.date).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden flex flex-col hover:border-accent/30 transition-colors">
      {ann.imageUrl && <img src={ann.imageUrl} alt="" className="w-full h-24 object-cover" draggable={false} />}
      <div className="p-3.5 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />{meta.label}
          </span>
          {isNew && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-accent text-white">Nuevo</span>}
          <span className="text-[11px] text-text-muted ml-auto">{dateStr}</span>
        </div>
        <p className="text-sm font-semibold text-text-primary leading-snug">{ann.title}</p>
        <p className="text-xs text-text-secondary leading-relaxed flex-1">{ann.summary}</p>
        {ann.linkUrl && (
          <button
            onClick={() => window.api.shell.openExternal(ann.linkUrl!)}
            className="mt-1 self-start flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-medium transition-colors"
          >
            {ann.linkLabel ?? 'Ver más'}
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
  const account = useStore(activeAccount)
  const { setInstances } = useStore()
  const runningInstances = useStore(s => s.runningInstances)
  const [recent, setRecent] = useState<Instance[]>([])
  const [launching, setLaunching] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [sponsors, setSponsors] = useState<Announcement[]>([])
  const [news, setNews] = useState<Announcement[]>([])
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set())
  const [annLoading, setAnnLoading] = useState(true)

  useEffect(() => {
    window.api.instances.list().then(all => { setInstances(all); setRecent(all.slice(0, 3)) })
  }, [])

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
    if (!account) { setError('Selecciona una cuenta en Ajustes primero.'); return }
    setError('')
    setLaunching(instanceId)
    try { await window.api.launcher.launch(instanceId) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error al lanzar') }
    finally { setLaunching(null) }
  }

  async function kill(instanceId: string) {
    try { await window.api.launcher.kill(instanceId) } catch {}
  }

  const unreadNews = news.filter(a => !seenIds.has(a.id)).length

  return (
    <div className="p-6 overflow-y-auto h-full">
      {/* Welcome */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-1">
            {account ? `Bienvenido, ${account.username}!` : 'Bienvenido a ModpackLauncher'}
          </h1>
          <p className="text-text-secondary text-sm">
            {account ? 'Tus instancias y modpacks están listos.' : 'Agrega una cuenta en Ajustes para empezar a jugar.'}
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
            <h2 className="text-sm font-semibold text-text-primary">Noticias</h2>
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
          { label: 'Instancias', value: useStore.getState().instances.length, to: '/instances' },
          { label: 'Cuenta',    value: account?.username ?? 'Ninguna', to: '/settings' },
          { label: 'Versión',   value: `v${APP_VERSION}`, to: '/settings' }
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
            <h2 className="text-sm font-semibold text-text-primary">Instancias recientes</h2>
            <Link to="/instances" className="text-xs text-accent hover:text-accent-hover">Ver todas</Link>
          </div>
          <div className="space-y-2">
            {recent.map(inst => (
              <div key={inst.id} className="flex items-center gap-4 bg-bg-card border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-bg-hover flex-shrink-0 overflow-hidden">
                  <InstanceIcon instanceId={inst.id} />
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="font-medium text-text-primary truncate">{inst.name}</p>
                  <p className="text-xs text-text-muted">MC {inst.minecraft} · {inst.modloader}</p>
                </div>
                {runningInstances.has(inst.id) ? (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/20 text-green-400 text-xs font-medium rounded-lg border border-green-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />En juego
                    </span>
                    <button onClick={() => kill(inst.id)} className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium rounded-lg border border-red-500/30 transition-colors">
                      Cerrar juego
                    </button>
                  </div>
                ) : (
                  <button onClick={() => play(inst.id)} disabled={!!launching}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white text-sm font-medium rounded-lg transition-colors">
                    {launching === inst.id ? 'Iniciando...' : 'Jugar'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-text-muted mb-3">No hay instancias todavía</p>
          <Link to="/instances" className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">
            Crear primera instancia
          </Link>
        </div>
      )}
    </div>
  )
}
