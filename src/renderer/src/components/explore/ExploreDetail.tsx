import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import ZoomableImage from '../ZoomableImage'
import { dominantColor } from '../../lib/dominantColor'
import {
  SOURCE_INFO, compatibility, resolveRefs, sourceDetail, sourceVersions, versionChangelog,
  type ContentKind, type ProjectDetail, type ProjectRef, type SearchContext, type SourceId, type SourceVersion
} from '../../lib/contentSources'

// Ficha de un proyecto, igual para todas las fuentes (Modrinth, CurseForge,
// Fport1, Hangar y SpigotMC): información, galería, versiones con fecha y
// notas, y dependencias. La usan Explorar y el explorador para instalar en una
// instancia, un mundo o un servidor. Las dependencias abren su propia ficha y
// quien la usa lleva el historial (con los botones del ratón).

export type DetailSource = SourceId
export type DetailRef = ProjectRef
export type DVersion = SourceVersion
export type DetailTab = 'description' | 'gallery' | 'versions' | 'deps'

const YT_IFRAME_RE = /<iframe[^>]*src="https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([\w-]+)[^"]*"[^>]*>\s*<\/iframe>/gi

/** Quita scripts y atributos on* del HTML de las fuentes y cambia vídeos de YouTube por tarjetas. */
function cleanHtml(html: string): string {
  const withCards = html.replace(YT_IFRAME_RE, (_, id: string) =>
    `<a href="https://www.youtube.com/watch?v=${id}" class="yt-card"><img src="https://img.youtube.com/vi/${id}/hqdefault.jpg" alt="YouTube" /><span class="yt-play">▶</span></a>`)
  const doc = new DOMParser().parseFromString(withCards, 'text/html')
  doc.querySelectorAll('script,style,iframe,object,embed,form').forEach((n) => n.remove())
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name) || /^javascript:/i.test(a.value)) el.removeAttribute(a.name)
  })
  return doc.body.innerHTML
}

function fmtNum(n?: number): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}
const fmtDate = (ms?: number): string => (ms ? new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const fmtSize = (n?: number): string => (!n ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
function ago(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000)
  if (d <= 0) return 'hoy'
  if (d === 1) return 'ayer'
  if (d < 30) return `hace ${d} días`
  if (d < 365) return `hace ${Math.floor(d / 30)} meses`
  return `hace ${Math.floor(d / 365)} años`
}

/** Resume una lista de versiones de Minecraft: 1.20 – 1.21.1 */
function summarizeVersions(vs: string[]): string {
  const release = vs.filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  if (!release.length) return vs.slice(0, 3).join(', ')
  if (release.length <= 3) return release.join(', ')
  return `${release[0]} – ${release[release.length - 1]}`
}

const LOADER_NAMES: Record<string, string> = {
  fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', iris: 'Iris', optifine: 'OptiFine', canvas: 'Canvas',
  vanilla: 'Vanilla', datapack: 'Datapack', minecraft: 'Minecraft', paper: 'Paper', spigot: 'Spigot', bukkit: 'Bukkit', purpur: 'Purpur', folia: 'Folia',
  velocity: 'Velocity', waterfall: 'Waterfall', bungeecord: 'BungeeCord',
}
const CHANNEL: Record<string, { label: string; cls: string }> = {
  release: { label: 'Release', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
  beta: { label: 'Beta', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  alpha: { label: 'Alpha', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
}
const SIDE: Record<string, string> = { required: 'Necesario', optional: 'Opcional', unsupported: 'No hace falta', unknown: '—' }

const BODY_CLS = `text-[14px] text-text-secondary leading-relaxed
  [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-text-primary [&_h1]:mt-7 [&_h1]:mb-3
  [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-text-primary [&_h2]:mt-6 [&_h2]:mb-2.5
  [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-5 [&_h3]:mb-2
  [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_li]:mb-1
  [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2
  [&_code]:bg-bg-card [&_code]:text-accent [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs
  [&_pre]:bg-bg-card [&_pre]:p-4 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:mb-4 [&_pre]:text-xs
  [&_img]:rounded-xl [&_img]:max-w-full [&_img]:inline-block [&_img]:my-2
  [&_blockquote]:border-l-4 [&_blockquote]:border-accent/40 [&_blockquote]:pl-4 [&_blockquote]:text-text-muted [&_blockquote]:my-3
  [&_hr]:border-border [&_hr]:my-6 [&_strong]:text-text-primary
  [&_table]:w-full [&_table]:border-collapse [&_table]:mb-4 [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:bg-bg-card [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2
  [&_.yt-card]:relative [&_.yt-card]:block [&_.yt-card]:max-w-xl [&_.yt-card]:no-underline [&_.yt-play]:absolute [&_.yt-play]:inset-0 [&_.yt-play]:flex [&_.yt-play]:items-center [&_.yt-play]:justify-center [&_.yt-play]:text-5xl [&_.yt-play]:text-white`

const COMPAT = {
  yes: { label: 'Compatible', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
  maybe: { label: 'Quizá', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  no: { label: 'No compatible', cls: 'bg-red-500/10 text-red-300 border-red-500/30' },
}

interface Props {
  target: DetailRef
  /** Tipo de contenido (para Hangar y los filtros). */
  kind?: ContentKind
  /** Destino de la instalación: marca compatibles y filtra versiones por defecto. */
  ctx?: SearchContext
  /** Estado de lo instalado en el destino. */
  installed?: { versionId?: string; filename?: string } | null
  busy?: boolean
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onOpen: (ref: DetailRef) => void
  onInstall: (version?: DVersion) => void
  catLabel?: (c: string) => string
  catIcons?: Map<string, string>
  /** Pestaña y desplazamiento guardados (historial). */
  initialTab?: DetailTab
  initialScroll?: number
  onViewChange?: (tab: DetailTab, scroll: number) => void
}

export default function ExploreDetail(p: Props) {
  const { target, ctx } = p
  const kind: ContentKind = p.kind ?? ctx?.kind ?? 'mod'
  const vctx: SearchContext = ctx ?? { kind, minecraft: '', loader: '' }
  const [tab, setTab] = useState<DetailTab>(p.initialTab ?? 'description')
  const [data, setData] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState('')
  const [versions, setVersions] = useState<DVersion[] | null>(null)
  const [refs, setRefs] = useState<Record<string, ProjectRef>>({})
  const [color, setColor] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [vMc, setVMc] = useState('')
  const [vLoader, setVLoader] = useState('')
  const [vChannel, setVChannel] = useState('')
  const [onlyCompat, setOnlyCompat] = useState(!!ctx?.minecraft)
  const [openLog, setOpenLog] = useState<string | null>(null)
  const [logs, setLogs] = useState<Record<string, string>>({})
  const bodyRef = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  const onViewChange = useRef(p.onViewChange)
  onViewChange.current = p.onViewChange

  useEffect(() => {
    let alive = true
    setData(null); setError(''); setVersions(null); setRefs({}); setColor(null); setOpenLog(null)
    restored.current = false
    sourceDetail(target.source, target.id).then((d) => { if (alive) setData(d) }).catch(() => { if (alive) setError('No se pudo cargar la ficha') })
    sourceVersions(target.source, vctx, target.id).then((v) => { if (alive) setVersions(v) }).catch(() => { if (alive) setVersions([]) })
    return () => { alive = false }
  }, [target.source, target.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Volver a la misma posición (historial) cuando ya hay contenido que desplazar
  useLayoutEffect(() => {
    if (restored.current || !data || !bodyRef.current) return
    restored.current = true
    bodyRef.current.scrollTop = p.initialScroll ?? 0
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const icon = data?.icon ?? target.icon
  useEffect(() => {
    if (!icon) return
    let alive = true
    dominantColor(icon).then((c) => { if (alive) setColor(c) })
    return () => { alive = false }
  }, [icon])

  // Dependencias de la versión que se instalaría (la mejor para el destino) o la más nueva
  const depVersion = useMemo(() => {
    if (!versions?.length) return undefined
    if (ctx?.minecraft) return versions.find((v) => compatibility(vctx, v.platforms, v.gameVersions) === 'yes') ?? versions[0]
    return versions[0]
  }, [versions]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!depVersion?.deps.length) return
    resolveRefs(depVersion.deps).then(setRefs).catch(() => {})
  }, [depVersion?.id])

  const body = useMemo(() => (data?.body ? cleanHtml(data.body) : ''), [data?.body])
  const mcOptions = useMemo(() => [...new Set((versions ?? []).flatMap((v) => v.gameVersions))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })), [versions])
  const loaderOptions = useMemo(() => [...new Set((versions ?? []).flatMap((v) => v.platforms))], [versions])
  const filtered = (versions ?? []).filter((v) =>
    (!vMc || v.gameVersions.includes(vMc)) && (!vLoader || v.platforms.includes(vLoader)) && (!vChannel || v.channel === vChannel) &&
    (!onlyCompat || !ctx || compatibility(vctx, v.platforms, v.gameVersions) !== 'no'))

  function changeTab(t: DetailTab): void {
    setTab(t)
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    onViewChange.current?.(t, 0)
  }

  async function toggleLog(v: DVersion): Promise<void> {
    if (openLog === v.id) { setOpenLog(null); return }
    setOpenLog(v.id)
    if (logs[v.id] === undefined) {
      const text = await versionChangelog(target.source, v)
      setLogs((m) => ({ ...m, [v.id]: v.changelogIsHtml ? cleanHtml(text || '<p>Sin notas.</p>') : cleanHtml(String(marked.parse(text || 'Sin notas.'))) }))
    }
  }

  const tint = (a: number): string => (color ? color.replace('rgb(', 'rgba(').replace(')', `, ${a})`) : `rgba(34,197,94,${a * 0.4})`)
  const accent = SOURCE_INFO[target.source].color
  const deps = depVersion?.deps ?? []
  const installedVersion = p.installed?.versionId ? versions?.find((v) => v.id === p.installed!.versionId) : undefined

  const tabs: { key: DetailTab; label: string; count?: number }[] = [
    { key: 'description', label: 'Descripción' },
    { key: 'gallery', label: 'Galería', count: data?.gallery.length },
    { key: 'versions', label: 'Versiones', count: versions?.length },
    { key: 'deps', label: 'Dependencias', count: deps.length },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Cabecera con el color del icono */}
      <div className="relative flex-shrink-0 border-b border-border overflow-hidden"
        style={{ background: `linear-gradient(115deg, ${tint(0.34)} 0%, ${tint(0.1)} 50%, transparent 90%)` }}>
        {data?.banner && (
          <>
            <img src={data.banner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40 pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-r from-bg-primary/90 via-bg-primary/50 to-transparent pointer-events-none" />
          </>
        )}
        <div className="relative flex items-center gap-1 px-6 pt-4">
          <button onClick={p.onBack} disabled={!p.canGoBack} title="Atrás (botón del ratón)"
            className="flex items-center gap-1.5 pl-2 pr-3 h-8 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-black/20 disabled:opacity-30 transition-colors">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6" /></svg>
            Volver
          </button>
          <button onClick={p.onForward} disabled={!p.canGoForward} title="Adelante (botón del ratón)"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-black/20 disabled:opacity-30 transition-colors">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6" /></svg>
          </button>
          <span className="ml-2 text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md" style={{ color: accent, background: `${accent}1f` }}>{SOURCE_INFO[target.source].label}</span>
        </div>
        <div className="relative flex items-center gap-5 px-6 pt-3 pb-5">
          <div className="w-24 h-24 rounded-3xl bg-bg-hover overflow-hidden flex-shrink-0 ring-1 ring-white/10" style={{ boxShadow: `0 10px 34px ${tint(0.45)}` }}>
            {icon ? <img src={icon} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-4xl">📦</div>}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-text-primary truncate">{data?.title ?? target.title}</h1>
            <p className="text-sm text-text-secondary mt-1 line-clamp-2">{data?.summary ?? target.summary}</p>
            <div className="flex items-center gap-4 mt-2.5 text-xs text-text-muted flex-wrap">
              {data?.authors.length ? (
                <span className="flex items-center gap-1.5">
                  {data.authors[0].avatar && <img src={data.authors[0].avatar} alt="" className="w-5 h-5 rounded-full" />}
                  <span>por {data.authors.slice(0, 3).map((a, i) => (
                    <span key={a.name + i}>{i > 0 && ', '}{a.url
                      ? <button onClick={() => window.api.shell.openExternal(a.url!)} className="text-text-secondary hover:text-text-primary hover:underline">{a.name}</button>
                      : <span className="text-text-secondary">{a.name}</span>}</span>
                  ))}</span>
                </span>
              ) : null}
              <span className="flex items-center gap-1"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>{fmtNum(data?.downloads)} descargas</span>
              {!!data?.follows && <span className="flex items-center gap-1 text-red-300/80"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>{fmtNum(data.follows)}</span>}
              {data?.updated && <span>Actualizado el {fmtDate(data.updated)}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            {p.installed ? (
              <>
                <span className="flex items-center gap-2 px-4 py-2 rounded-xl border border-green-500/40 bg-green-500/10 text-green-300 text-sm font-semibold">
                  ✓ Instalado{installedVersion ? ` · ${installedVersion.number}` : ''}
                </span>
                <button onClick={() => changeTab('versions')} className="text-xs text-text-muted hover:text-text-primary hover:underline">Cambiar de versión</button>
              </>
            ) : (
              <button onClick={() => p.onInstall()} disabled={p.busy}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl text-white text-sm font-bold shadow-lg transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-60"
                style={{ background: accent, boxShadow: `0 8px 24px ${accent}55` }}>
                {p.busy
                  ? <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 11-6.2-8.56" /></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>}
                {p.busy ? 'Instalando…' : 'Instalar'}
              </button>
            )}
            {data?.pageUrl && (
              <button onClick={() => window.api.shell.openExternal(data.pageUrl!)} className="text-xs text-text-muted hover:text-text-primary hover:underline">
                Ver en {SOURCE_INFO[target.source].label} ↗
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-1 px-6">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => changeTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === t.key ? 'text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
              style={tab === t.key ? { borderColor: accent } : undefined}>
              {t.label}
              {t.count !== undefined && t.count > 0 && <span className="text-[11px] px-1.5 rounded-md bg-black/25 text-text-muted">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        <div ref={bodyRef} className="flex-1 overflow-y-auto" onScroll={(e) => onViewChange.current?.(tab, e.currentTarget.scrollTop)}>
          {error && <p className="text-center text-sm text-red-300 py-16">{error}</p>}
          {!data && !error && (
            <div className="flex items-center justify-center gap-2 py-20 text-text-muted text-sm">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9" /></svg>
              Cargando…
            </div>
          )}

          {data && tab === 'description' && (
            <div className={`px-8 py-6 max-w-4xl ${BODY_CLS}`}
              onClick={(e) => {
                const a = (e.target as HTMLElement).closest('a')
                if (a?.href) { e.preventDefault(); window.api.shell.openExternal(a.href) }
              }}
              dangerouslySetInnerHTML={{ __html: body || '<p>Sin descripción.</p>' }} />
          )}

          {data && tab === 'gallery' && (
            <div className="p-6">
              {data.gallery.length === 0 ? <p className="text-center text-sm text-text-muted py-16">Sin imágenes</p> : (
                <div className="columns-2 xl:columns-3 gap-3">
                  {data.gallery.map((g, i) => (
                    <button key={i} onClick={() => setLightbox(i)} className="group relative mb-3 block w-full overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5">
                      <img src={g.url} alt="" loading="lazy" className="w-full group-hover:scale-[1.04] transition-transform duration-300" />
                      {(g.title || g.description) && (
                        <div className="absolute inset-x-0 bottom-0 p-3 text-left bg-gradient-to-t from-black/85 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          {g.title && <p className="text-sm font-semibold text-white">{g.title}</p>}
                          {g.description && <p className="text-xs text-white/70 line-clamp-2">{g.description}</p>}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'versions' && (
            <div className="p-6">
              <div className="flex items-center gap-2 flex-wrap mb-4">
                {ctx?.minecraft && (
                  <button onClick={() => setOnlyCompat((v) => !v)}
                    className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${onlyCompat ? 'bg-green-500/15 border-green-500/40 text-green-300' : 'border-border text-text-secondary hover:text-text-primary'}`}>
                    {onlyCompat ? '✓ ' : ''}Solo compatibles con {ctx.minecraft}{ctx.loader && ctx.loader !== 'vanilla' && kind !== 'datapack' ? ` · ${LOADER_NAMES[ctx.loader] ?? ctx.loader}` : ''}
                  </button>
                )}
                <select value={vMc} onChange={(e) => setVMc(e.target.value)} className="bg-bg-card border border-border rounded-xl px-3 py-2 text-sm text-text-secondary outline-none">
                  <option value="">Todas las versiones de MC</option>
                  {mcOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                {loaderOptions.length > 1 && (
                  <select value={vLoader} onChange={(e) => setVLoader(e.target.value)} className="bg-bg-card border border-border rounded-xl px-3 py-2 text-sm text-text-secondary outline-none">
                    <option value="">Todos los loaders</option>
                    {loaderOptions.map((l) => <option key={l} value={l}>{LOADER_NAMES[l] ?? l}</option>)}
                  </select>
                )}
                <div className="flex gap-1 p-1 rounded-xl bg-bg-card border border-border">
                  {([['', 'Todas'], ['release', 'Release'], ['beta', 'Beta'], ['alpha', 'Alpha']] as [string, string][]).map(([k, l]) => (
                    <button key={k} onClick={() => setVChannel(k)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${vChannel === k ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-primary'}`}>{l}</button>
                  ))}
                </div>
                <span className="ml-auto text-xs text-text-muted">{filtered.length} de {versions?.length ?? 0}</span>
              </div>
              {versions === null && <p className="text-center text-sm text-text-muted py-10">Cargando versiones…</p>}
              {versions && filtered.length === 0 && (
                <p className="text-center text-sm text-text-muted py-10">
                  Ninguna versión con esos filtros{onlyCompat && ctx ? ' — prueba a quitar «Solo compatibles»' : ''}
                </p>
              )}
              <div className="space-y-2">
                {filtered.slice(0, 150).map((v) => {
                  const c = ctx ? compatibility(vctx, v.platforms, v.gameVersions) : null
                  const isInstalled = !!p.installed?.versionId && p.installed.versionId === v.id
                  const external = !v.url && !v.cf && v.externalUrl
                  return (
                    <div key={v.id} className={`rounded-2xl border bg-bg-card overflow-hidden ${isInstalled ? 'border-green-500/40' : 'border-border'}`}>
                      <div className="flex items-center gap-3 p-3.5">
                        <span className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${CHANNEL[v.channel]?.cls}`}>{CHANNEL[v.channel]?.label}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-text-primary truncate">{v.name}{v.number !== v.name && <span className="text-text-muted font-normal"> · {v.number}</span>}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap text-[11px] text-text-muted">
                            <span className="flex items-center gap-1 text-text-secondary" title={new Date(v.date).toLocaleString('es')}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                              {fmtDate(v.date)} <span className="text-text-muted">({ago(v.date)})</span>
                            </span>
                            {v.platforms.map((l) => <span key={l} className="px-1.5 py-0.5 rounded-md bg-bg-hover border border-border text-text-secondary">{LOADER_NAMES[l] ?? l}</span>)}
                            {v.gameVersions.length > 0 && <span>MC {summarizeVersions(v.gameVersions)}</span>}
                            {v.downloads !== undefined && <span>· {fmtNum(v.downloads)} descargas</span>}
                            {v.size ? <span>· {fmtSize(v.size)}</span> : null}
                          </div>
                        </div>
                        {c && <span className={`text-[10px] px-1.5 py-0.5 rounded-md border ${COMPAT[c].cls}`}>{COMPAT[c].label}</span>}
                        <button onClick={() => toggleLog(v)} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:text-text-primary">
                          {openLog === v.id ? 'Ocultar notas' : 'Notas'}
                        </button>
                        {isInstalled ? (
                          <span className="px-3 py-1.5 rounded-lg text-xs font-bold text-green-300 bg-green-500/15 border border-green-500/30">Instalada</span>
                        ) : (
                          <button onClick={() => (external ? window.api.shell.openExternal(v.externalUrl!) : p.onInstall(v))} disabled={p.busy}
                            className="px-4 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50" style={{ background: accent }}>
                            {external ? 'Abrir web' : p.installed ? 'Cambiar a esta' : 'Instalar'}
                          </button>
                        )}
                      </div>
                      {openLog === v.id && (
                        <div className={`px-5 pb-4 pt-1 border-t border-border/60 max-h-80 overflow-y-auto ${BODY_CLS} text-[13px]`}
                          onClick={(e) => { const a = (e.target as HTMLElement).closest('a'); if (a?.href) { e.preventDefault(); window.api.shell.openExternal(a.href) } }}
                          dangerouslySetInnerHTML={{ __html: logs[v.id] ?? '<p>Cargando…</p>' }} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {tab === 'deps' && (
            <div className="p-6 space-y-6">
              {deps.length === 0 && <p className="text-center text-sm text-text-muted py-16">{versions === null ? 'Cargando…' : 'No necesita nada más'}</p>}
              {depVersion && deps.length > 0 && <p className="text-xs text-text-muted -mb-3">De la versión {depVersion.number} ({fmtDate(depVersion.date)})</p>}
              {([['required', 'Necesarias', 'Se instalan solas al instalar este proyecto', 'text-red-300'],
                ['optional', 'Opcionales', 'Añaden funciones si las tienes', 'text-text-secondary'],
                ['incompatible', 'Incompatibles', 'No las uses junto a este proyecto', 'text-amber-300'],
                ['embedded', 'Incluidas', 'Ya vienen dentro del archivo', 'text-text-muted']] as const).map(([type, label, hint, cls]) => {
                const list = deps.filter((d) => d.type === type)
                if (!list.length) return null
                return (
                  <div key={type}>
                    <p className={`text-xs font-bold uppercase tracking-wider ${cls}`}>{label} · {list.length}</p>
                    <p className="text-[11px] text-text-muted mb-2.5">{hint}</p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {list.map((d) => {
                        const ref = refs[`${d.source}:${d.id}`]
                        return (
                          <button key={`${d.source}:${d.id}`} onClick={() => ref && p.onOpen(ref)} disabled={!ref}
                            className="flex items-center gap-3 p-3 rounded-2xl bg-bg-card border border-border hover:border-accent/40 hover:-translate-y-0.5 transition-all text-left disabled:opacity-60">
                            <div className="w-12 h-12 rounded-xl bg-bg-hover overflow-hidden shrink-0">
                              {ref?.icon && <img src={ref.icon} alt="" className="w-full h-full object-cover" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-text-primary truncate">{ref?.title ?? d.id}</p>
                              <p className="text-[11px] text-text-muted line-clamp-1">{ref?.summary ?? 'Cargando…'}</p>
                            </div>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0" style={{ color: SOURCE_INFO[d.source].color, background: `${SOURCE_INFO[d.source].color}1f` }}>{SOURCE_INFO[d.source].label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Lateral: compatibilidad, información y enlaces */}
        {data && (
          <aside className="w-72 flex-shrink-0 border-l border-border overflow-y-auto p-5 space-y-5 bg-bg-secondary/40">
            <section>
              <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Compatibilidad</p>
              {ctx?.minecraft && versions && (() => {
                const any = versions.some((v) => compatibility(vctx, v.platforms, v.gameVersions) === 'yes')
                return (
                  <p className={`mb-2.5 text-xs px-2.5 py-1.5 rounded-lg border ${any ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
                    {any ? `Tiene versión para ${ctx.minecraft}` : `No hay versión para ${ctx.minecraft}${ctx.loader && ctx.loader !== 'vanilla' && kind !== 'datapack' ? ` con ${LOADER_NAMES[ctx.loader] ?? ctx.loader}` : ''}`}
                  </p>
                )
              })()}
              {data.gameVersions.length > 0 && (
                <div className="mb-2.5">
                  <p className="text-xs text-text-muted mb-1">Minecraft</p>
                  <div className="flex flex-wrap gap-1">
                    {data.gameVersions.filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v)).slice(0, 12).map((v) => (
                      <span key={v} className={`text-[11px] px-1.5 py-0.5 rounded-md border ${v === ctx?.minecraft ? 'bg-green-500/15 border-green-500/40 text-green-300' : 'bg-bg-card border-border text-text-secondary'}`}>{v}</span>
                    ))}
                    {data.gameVersions.length > 12 && <span className="text-[11px] text-text-muted px-1">+{data.gameVersions.length - 12}</span>}
                  </div>
                </div>
              )}
              {data.loaders.length > 0 && (
                <div className="mb-2.5">
                  <p className="text-xs text-text-muted mb-1">Plataformas</p>
                  <div className="flex flex-wrap gap-1">
                    {data.loaders.map((l) => <span key={l} className="text-[11px] px-2 py-0.5 rounded-md bg-bg-card border border-border text-text-secondary">{LOADER_NAMES[l] ?? l}</span>)}
                  </div>
                </div>
              )}
              {(data.clientSide || data.serverSide) && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-bg-card border border-border"><p className="text-text-muted">Cliente</p><p className="text-text-primary font-medium">{SIDE[data.clientSide ?? 'unknown'] ?? data.clientSide}</p></div>
                  <div className="p-2 rounded-lg bg-bg-card border border-border"><p className="text-text-muted">Servidor</p><p className="text-text-primary font-medium">{SIDE[data.serverSide ?? 'unknown'] ?? data.serverSide}</p></div>
                </div>
              )}
            </section>

            {data.categories.length > 0 && (
              <section>
                <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Categorías</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.categories.map((c) => {
                    const svg = p.catIcons?.get(c)
                    return (
                      <span key={c} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-bg-card border border-border text-text-secondary capitalize">
                        {svg && <span className="w-3.5 h-3.5 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} />}
                        {p.catLabel ? p.catLabel(c) : c}
                      </span>
                    )
                  })}
                </div>
              </section>
            )}

            {!!data.tags?.length && (
              <section>
                <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Etiquetas</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.tags.map((t) => <span key={t} className="text-xs px-2 py-1 rounded-lg bg-[#a855f7]/10 border border-[#a855f7]/25 text-[#d8b4fe]">#{t}</span>)}
                </div>
              </section>
            )}

            <section>
              <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Información</p>
              {data.openSource !== undefined && (
                <p className={`mb-2 inline-block text-[11px] px-2 py-0.5 rounded-md ${data.openSource ? 'bg-green-500/15 text-green-300' : 'bg-bg-card border border-border text-text-secondary'}`}>
                  {data.openSource ? 'Código abierto' : 'Código cerrado'}
                </p>
              )}
              <dl className="text-xs space-y-1.5">
                <div className="flex justify-between gap-2"><dt className="text-text-muted">Publicado</dt><dd className="text-text-secondary">{fmtDate(data.created)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-text-muted">Actualizado</dt><dd className="text-text-secondary">{fmtDate(data.updated)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-text-muted">Descargas</dt><dd className="text-text-secondary">{(data.downloads ?? 0).toLocaleString('es')}</dd></div>
                {versions && <div className="flex justify-between gap-2"><dt className="text-text-muted">Versiones</dt><dd className="text-text-secondary">{versions.length}</dd></div>}
                {versions?.[0] && <div className="flex justify-between gap-2"><dt className="text-text-muted">Última versión</dt><dd className="text-text-secondary truncate max-w-[140px]" title={versions[0].number}>{fmtDate(versions[0].date)}</dd></div>}
                {data.license && (
                  <div className="flex justify-between gap-2"><dt className="text-text-muted">Licencia</dt>
                    <dd className="text-right">{data.license.url
                      ? <button onClick={() => window.api.shell.openExternal(data.license!.url!)} className="text-accent hover:underline">{data.license.name}</button>
                      : <span className="text-text-secondary">{data.license.name}</span>}</dd>
                  </div>
                )}
              </dl>
            </section>

            {data.links.length > 0 && (
              <section>
                <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Enlaces</p>
                <div className="space-y-1">
                  {data.links.map((l) => (
                    <button key={l.url} onClick={() => window.api.shell.openExternal(l.url)}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
                      {l.label}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14 21 3" /></svg>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {data.authors.length > 1 && (
              <section>
                <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Autores</p>
                <div className="space-y-1.5">
                  {data.authors.map((a, i) => (
                    <div key={a.name + i} className="flex items-center gap-2 text-sm text-text-secondary">
                      {a.avatar ? <img src={a.avatar} alt="" className="w-6 h-6 rounded-full" /> : <span className="w-6 h-6 rounded-full bg-bg-hover" />}
                      {a.name}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        )}
      </div>

      {lightbox !== null && data?.gallery[lightbox] && (
        <ZoomableImage
          src={data.gallery[lightbox].full ?? data.gallery[lightbox].url}
          alt={data.gallery[lightbox].title ?? undefined}
          onClose={() => setLightbox(null)}
          onPrev={lightbox > 0 ? () => setLightbox((i) => Math.max(0, (i ?? 1) - 1)) : undefined}
          onNext={lightbox < data.gallery.length - 1 ? () => setLightbox((i) => Math.min(data.gallery.length - 1, (i ?? 0) + 1)) : undefined}
          counter={`${lightbox + 1} / ${data.gallery.length}`}
        />
      )}
    </div>
  )
}
