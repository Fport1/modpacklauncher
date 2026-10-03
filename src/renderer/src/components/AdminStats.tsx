import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import {
  collection, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, Timestamp, where,
} from 'firebase/firestore'
import { socialAuth, socialDb } from '../lib/firebase'

// Estadísticas para vender el launcher: descargas, instalaciones activas,
// usuarios diarios/semanales/mensuales, fport1social, uso del juego y de la IA.
// Todo son datos agregados y anónimos (ver src/main/telemetry.ts). Leer las
// colecciones del launcher exige haber iniciado sesión en Amigos como @fport1.

interface Stats {
  downloads: { total: number; byRelease: { tag: string; n: number }[] } | null
  installs: { total: number; d1: number; d7: number; d30: number }
  social: { users: number; d1: number; d7: number; d30: number; online: number }
  days: { day: string; active: number; new: number; launches: number; playMinutes: number; crashes: number; socialActive: number }[]
  dist: { versions: [string, number][]; os: [string, number][]; lang: [string, number][]; loaders: [string, number][]; socialPct: number; premiumPct: number; avgMinutes: number; retained: number; sample: number }
  ai: { lessons: number; crashSigs: number; topCrashes: { sig: string; mods: string[]; count: number; mc: string; loader: string }[]; aiActions: number }
}

const ago = (days: number): Timestamp => Timestamp.fromDate(new Date(Date.now() - days * 86_400_000))
const count = async (q: Parameters<typeof getCountFromServer>[0]): Promise<number> => (await getCountFromServer(q)).data().count
const top = (m: Record<string, number>, n = 8): [string, number][] => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n)
const fmt = (n: number): string => n.toLocaleString('es')

async function loadStats(): Promise<Stats> {
  const installs = collection(socialDb, 'launcher_installs')
  const presence = collection(socialDb, 'presence')

  const [total, d1, d7, d30, users, s1, s7, s30, online] = await Promise.all([
    count(installs),
    count(query(installs, where('lastSeen', '>=', ago(1)))),
    count(query(installs, where('lastSeen', '>=', ago(7)))),
    count(query(installs, where('lastSeen', '>=', ago(30)))),
    count(collection(socialDb, 'users')),
    count(query(presence, where('lastSeen', '>=', ago(1)))),
    count(query(presence, where('lastSeen', '>=', ago(7)))),
    count(query(presence, where('lastSeen', '>=', ago(30)))),
    count(query(presence, where('lastSeen', '>=', Timestamp.fromDate(new Date(Date.now() - 3 * 60_000))))),
  ])

  // Últimos 30 días
  const dayIds = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10))
  const daySnaps = await Promise.all(dayIds.map((d) => getDoc(doc(socialDb, 'launcher_days', d)).catch(() => null)))
  const days = dayIds.map((day, i) => {
    const x = (daySnaps[i]?.data() ?? {}) as Record<string, number>
    return { day, active: x.active ?? 0, new: x.new ?? 0, launches: x.launches ?? 0, playMinutes: x.playMinutes ?? 0, crashes: x.crashes ?? 0, socialActive: x.socialActive ?? 0 }
  })

  // Reparto entre las instalaciones activas del último mes
  const recent = await getDocs(query(installs, where('lastSeen', '>=', ago(30)), limit(5000)))
  const versions: Record<string, number> = {}, os: Record<string, number> = {}, lang: Record<string, number> = {}, loaders: Record<string, number> = {}
  let social = 0, premium = 0, minutes = 0, retained = 0, aiActions = 0
  recent.forEach((d) => {
    const x = d.data() as Record<string, any>
    versions[x.v ?? '?'] = (versions[x.v ?? '?'] ?? 0) + 1
    os[x.os ?? '?'] = (os[x.os ?? '?'] ?? 0) + 1
    lang[x.sysLang ?? '?'] = (lang[x.sysLang ?? '?'] ?? 0) + 1
    for (const [l, n] of Object.entries((x.loaders ?? {}) as Record<string, number>)) loaders[l] = (loaders[l] ?? 0) + n
    if (x.social) social++
    if (x.premium) premium++
    minutes += x.playMinutes ?? 0
    if ((x.days ?? 0) >= 2) retained++
    aiActions += x.aiActions ?? 0
  })
  const n = recent.size || 1

  const [lessons, crashSigs, topC] = await Promise.all([
    count(collection(socialDb, 'ai_lessons')).catch(() => 0),
    count(collection(socialDb, 'crash_signatures')).catch(() => 0),
    getDocs(query(collection(socialDb, 'crash_signatures'), orderBy('count', 'desc'), limit(8))).catch(() => null),
  ])

  let downloads: Stats['downloads'] = null
  try {
    // Las versiones nuevas se publican en el repositorio de descargas; las viejas siguen en el del código mientras sea público
    type Rel = { tag_name: string; assets: { name: string; download_count: number }[] }
    const repos = ['modpacklauncher-updates', 'modpacklauncher']
    const lists = await Promise.all(repos.map((r) => (window.api.content.getJson(`https://api.github.com/repos/Fport1/${r}/releases?per_page=100`) as Promise<Rel[]>).catch(() => [] as Rel[])))
    // Mientras se publique en los dos, una misma versión suma las descargas de ambos
    const perTag = new Map<string, number>()
    for (const r of lists.flat()) {
      if (!Array.isArray(r.assets)) continue
      const n = r.assets.filter((x) => /\.(exe|dmg|zip|AppImage)$/i.test(x.name)).reduce((t, x) => t + x.download_count, 0)
      perTag.set(r.tag_name, (perTag.get(r.tag_name) ?? 0) + n)
    }
    if (!perTag.size) throw new Error('sin releases')
    const byRelease = [...perTag].map(([tag, n]) => ({ tag, n }))
    downloads = { total: byRelease.reduce((s, r) => s + r.n, 0), byRelease }
  } catch { /* sin red o límite de la API de GitHub */ }

  return {
    downloads,
    installs: { total, d1, d7, d30 },
    social: { users, d1: s1, d7: s7, d30: s30, online },
    days,
    dist: { versions: top(versions), os: top(os), lang: top(lang), loaders: top(loaders), socialPct: Math.round((social / n) * 100), premiumPct: Math.round((premium / n) * 100), avgMinutes: Math.round(minutes / n), retained: Math.round((retained / n) * 100), sample: recent.size },
    ai: { lessons, crashSigs, aiActions, topCrashes: (topC?.docs ?? []).map((d) => ({ sig: d.data().sig, mods: d.data().mods ?? [], count: d.data().count ?? 0, mc: d.data().mc, loader: d.data().loader })) },
  }
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="text-2xl font-bold text-text-primary mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
    </div>
  )
}

function Bars({ data, field, color }: { data: Stats['days']; field: keyof Stats['days'][number]; color: string }) {
  const max = Math.max(1, ...data.map((d) => Number(d[field])))
  return (
    <div className="flex items-end gap-[3px] h-24">
      {data.map((d) => (
        <div key={d.day} title={`${d.day}: ${fmt(Number(d[field]))}`} className="flex-1 rounded-t" style={{ height: `${Math.max(2, (Number(d[field]) / max) * 100)}%`, background: color }} />
      ))}
    </div>
  )
}

function Dist({ title, rows }: { title: string; rows: [string, number][] }) {
  const total = rows.reduce((s, r) => s + r[1], 0) || 1
  return (
    <div className="bg-bg-card border border-border rounded-xl p-4">
      <p className="text-[11px] uppercase tracking-wider text-text-muted mb-2">{title}</p>
      <div className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="text-xs">
            <div className="flex justify-between text-text-secondary"><span data-no-translate>{k}</span><span className="tabular-nums">{Math.round((v / total) * 100)} %</span></div>
            <div className="h-1.5 rounded-full bg-bg-hover mt-0.5"><div className="h-full rounded-full bg-accent" style={{ width: `${(v / total) * 100}%` }} /></div>
          </div>
        ))}
        {!rows.length && <p className="text-xs text-text-muted">Sin datos todavía</p>}
      </div>
    </div>
  )
}

export default function AdminStats() {
  const [user, setUser] = useState<User | null>(socialAuth.currentUser)
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => onAuthStateChanged(socialAuth, setUser), [])

  async function refresh(): Promise<void> {
    setLoading(true); setError('')
    try { setStats(await loadStats()) }
    catch (e) { setError(e instanceof Error && /permission/i.test(e.message) ? 'Sin permiso: inicia sesión en Amigos con la cuenta @fport1 y comprueba que las reglas de fport1web estén publicadas.' : String(e instanceof Error ? e.message : e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (user) refresh() }, [user?.uid])

  function copySummary(): void {
    if (!stats) return
    const s = stats
    const txt = [
      '# Modpack Launcher by Fport1 — métricas',
      `Fecha: ${new Date().toLocaleDateString('es')}`,
      s.downloads ? `Descargas totales: ${fmt(s.downloads.total)}` : '',
      `Instalaciones registradas: ${fmt(s.installs.total)}`,
      `Usuarios activos: ${fmt(s.installs.d1)} diarios · ${fmt(s.installs.d7)} semanales · ${fmt(s.installs.d30)} mensuales`,
      `Retención (usan el launcher 2+ días): ${s.dist.retained} %`,
      `Minutos de juego medios por usuario activo: ${fmt(s.dist.avgMinutes)}`,
      `fport1social: ${fmt(s.social.users)} cuentas · ${fmt(s.social.d7)} activas esta semana · ${fmt(s.social.online)} conectadas ahora`,
      `Con cuenta premium de Minecraft: ${s.dist.premiumPct} % · con fport1social en el launcher: ${s.dist.socialPct} %`,
      `Sistemas: ${s.dist.os.map(([k, v]) => `${k} ${v}`).join(', ')}`,
      `Loaders: ${s.dist.loaders.map(([k, v]) => `${k} ${v}`).join(', ')}`,
      `IA: ${fmt(s.ai.aiActions)} acciones · ${fmt(s.ai.lessons)} lecciones compartidas · ${fmt(s.ai.crashSigs)} tipos de crash conocidos`,
    ].filter(Boolean).join('\n')
    navigator.clipboard.writeText(txt).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  if (!user) {
    return <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-sm text-amber-200">Para ver las estadísticas inicia sesión en Amigos con la cuenta @fport1.</div>
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">Datos anónimos y agregados. Las instalaciones cuentan desde la versión 1.10.1.</p>
        <div className="flex gap-2">
          <button onClick={copySummary} disabled={!stats} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:text-text-primary disabled:opacity-40">{copied ? 'Copiado ✓' : 'Copiar resumen'}</button>
          <button onClick={refresh} disabled={loading} className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-semibold disabled:opacity-60">{loading ? 'Cargando…' : 'Actualizar'}</button>
        </div>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {stats && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Kpi label="Descargas" value={stats.downloads ? fmt(stats.downloads.total) : '—'} hint="Instaladores en GitHub" />
            <Kpi label="Activos hoy" value={fmt(stats.installs.d1)} hint={`${fmt(stats.installs.d7)} semana · ${fmt(stats.installs.d30)} mes`} />
            <Kpi label="Instalaciones" value={fmt(stats.installs.total)} hint={`Retención ${stats.dist.retained} %`} />
            <Kpi label="fport1social" value={fmt(stats.social.users)} hint={`${fmt(stats.social.d7)} activos · ${fmt(stats.social.online)} ahora`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-bg-card border border-border rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Usuarios activos por día (30 días)</p>
              <Bars data={stats.days} field="active" color="var(--color-accent, #22c55e)" />
            </div>
            <div className="bg-bg-card border border-border rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Instalaciones nuevas por día</p>
              <Bars data={stats.days} field="new" color="#60a5fa" />
            </div>
            <div className="bg-bg-card border border-border rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Minutos de juego por día</p>
              <Bars data={stats.days} field="playMinutes" color="#a78bfa" />
            </div>
            <div className="bg-bg-card border border-border rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Crashes por día</p>
              <Bars data={stats.days} field="crashes" color="#f87171" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Dist title="Versión del launcher" rows={stats.dist.versions} />
            <Dist title="Sistema" rows={stats.dist.os} />
            <Dist title="Idioma del sistema" rows={stats.dist.lang} />
            <Dist title="Loaders" rows={stats.dist.loaders} />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Kpi label="Con cuenta premium" value={`${stats.dist.premiumPct} %`} />
            <Kpi label="Con fport1social" value={`${stats.dist.socialPct} %`} />
            <Kpi label="Minutos por usuario" value={fmt(stats.dist.avgMinutes)} hint="Activos del último mes" />
            <Kpi label="Acciones de la IA" value={fmt(stats.ai.aiActions)} hint={`${fmt(stats.ai.lessons)} lecciones · ${fmt(stats.ai.crashSigs)} crashes conocidos`} />
          </div>
          {stats.ai.topCrashes.length > 0 && (
            <div className="bg-bg-card border border-border rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Crashes más comunes</p>
              <div className="space-y-2" data-no-translate>
                {stats.ai.topCrashes.map((c, i) => (
                  <div key={i} className="text-xs">
                    <p className="text-text-primary truncate">{c.sig}</p>
                    <p className="text-text-muted">{c.count}× · {c.loader} {c.mc}{c.mods.length ? ` · ${c.mods.join(', ')}` : ''}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stats.downloads && (
            <div className="bg-bg-card border border-border rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Descargas por versión</p>
              <div className="flex flex-wrap gap-2" data-no-translate>
                {stats.downloads.byRelease.slice(0, 20).map((r) => <span key={r.tag} className="px-2 py-1 rounded-lg bg-bg-hover text-xs text-text-secondary">{r.tag} · {fmt(r.n)}</span>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
