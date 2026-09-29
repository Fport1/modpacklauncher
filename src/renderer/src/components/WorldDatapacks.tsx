import { useEffect, useState } from 'react'
import ContentBrowser, { type InstalledIndex } from './content/ContentBrowser'
import { resolveDownloadUrl } from '../lib/contentSources'

// Datapacks de un mundo: activar, desactivar, añadir (archivo, arrastrando o
// desde Modrinth / CurseForge / Fport1) y borrar.

type Pack = Awaited<ReturnType<typeof window.api.worldDatapacks.list>>[number]

const BUILTIN_NAMES: Record<string, string> = {
  vanilla: 'Vanilla',
  bundle: 'Bundles (experimental)',
  trade_rebalance: 'Rebalanceo de aldeanos (experimental)',
  update_1_20: 'Actualización 1.20 (experimental)',
  update_1_21: 'Actualización 1.21 (experimental)',
  winter_drop: 'Winter Drop (experimental)',
  minecart_improvements: 'Mejoras de vagonetas (experimental)',
  redstone_experiments: 'Experimentos de redstone',
}

function fmtSize(n: number): string {
  if (!n) return 'Carpeta'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function WorldDatapacks({ instanceId, minecraft, world, onClose }: { instanceId: string; minecraft: string; world: string; onClose: () => void }) {
  const [packs, setPacks] = useState<Pack[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [installed, setInstalled] = useState<InstalledIndex>({})
  const [dragOver, setDragOver] = useState(false)
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)

  const flash = (text: string, ok = true): void => { setToast({ text, ok }); setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3500) }
  const clean = (e: unknown): string => e instanceof Error ? e.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, '') : String(e)

  async function reload(): Promise<void> {
    setLoading(true); setError('')
    try {
      setPacks(await window.api.worldDatapacks.list(instanceId, world))
      window.api.modrinth.getInstalledModsMeta(instanceId, minecraft, '', `saves/${world}/datapacks`, ['.zip'])
        .then((meta) => {
          const idx: InstalledIndex = {}
          for (const [filename, m] of Object.entries(meta)) {
            if (m.source === 'curseforge' && m.cfModId) idx[`curseforge:${m.cfModId}`] = { filename, versionId: m.cfFileId ? String(m.cfFileId) : undefined }
            else if (m.source === 'fport1' && m.f1ProjectId) idx[`fport1:${m.f1ProjectId}`] = { filename, versionId: m.f1VersionId }
            else if (m.projectId) idx[`modrinth:${m.projectId}`] = { filename, versionId: m.installedVersionId }
          }
          setInstalled(idx)
        })
        .catch(() => {})
    }
    catch (e) { setError(clean(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [instanceId, world]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(p: Pack): Promise<void> {
    setBusy(p.id)
    try {
      await window.api.worldDatapacks.setEnabled(instanceId, world, p.id, !p.enabled)
      setPacks((list) => list.map((x) => (x.id === p.id ? { ...x, enabled: !x.enabled } : x)))
    } catch (e) { flash(clean(e), false) }
    finally { setBusy(null) }
  }

  async function remove(p: Pack): Promise<void> {
    if (!p.filename || !confirm(`¿Borrar el datapack «${p.filename}» de este mundo?`)) return
    try { await window.api.worldDatapacks.remove(instanceId, world, p.filename); reload() }
    catch (e) { flash(clean(e), false) }
  }

  async function addPaths(paths: string[]): Promise<void> {
    try {
      const added = await window.api.worldDatapacks.add(instanceId, world, paths)
      if (added.length) { flash(`Añadido: ${added.join(', ')}`); reload() }
    } catch (e) { flash(clean(e), false) }
  }

  const filePacks = packs.filter((p) => !p.builtIn)
  const builtIn = packs.filter((p) => p.builtIn)

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="relative w-[760px] max-w-full h-[80vh] bg-bg-secondary border border-border rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true) } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false)
          const paths = Array.from(e.dataTransfer.files).map((f) => (f as File & { path?: string }).path).filter((x): x is string => !!x)
          if (paths.length) addPaths(paths)
        }}>
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div className="w-11 h-11 rounded-xl bg-accent/15 text-accent flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" /><path d="M14 2v6h6M10 13l-2 2 2 2M14 17l2-2-2-2" /></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-text-primary truncate">Datapacks de «{world}»</p>
            <p className="text-xs text-text-muted">Los cambios se aplican la próxima vez que abras el mundo</p>
          </div>
          <button onClick={() => window.api.worldDatapacks.pick(instanceId, world).then((a) => { if (a.length) { flash(`Añadido: ${a.join(', ')}`); reload() } }).catch((e) => flash(clean(e), false))}
            className="px-3.5 py-2 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover">Desde archivo</button>
          <button onClick={() => setSearching(true)}
            className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold shadow-sm shadow-accent/30">Buscar datapacks</button>
          <button onClick={onClose} className="w-9 h-9 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && <p className="text-center text-sm text-text-muted py-10">Cargando…</p>}
          {error && <p className="text-center text-sm text-red-300 py-10">{error}</p>}
          {!loading && !error && (
            <>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">En la carpeta del mundo · {filePacks.length}</p>
                {filePacks.length === 0 ? (
                  <div className="text-center py-10 border border-dashed border-border rounded-2xl">
                    <p className="text-3xl mb-2">📦</p>
                    <p className="text-sm text-text-secondary">Este mundo no tiene datapacks</p>
                    <p className="text-xs text-text-muted mt-1">Arrastra aquí un .zip o una carpeta, o búscalos en Modrinth, CurseForge y Fport1</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filePacks.map((p) => (
                      <div key={p.id} className={`group flex items-center gap-3 p-3 rounded-2xl border bg-bg-card transition-opacity ${p.enabled ? 'border-border' : 'border-border opacity-60'}`}>
                        <div className="w-12 h-12 rounded-xl bg-bg-hover overflow-hidden shrink-0 flex items-center justify-center" style={{ imageRendering: 'pixelated' }}>
                          {p.iconBase64 ? <img src={p.iconBase64} alt="" className="w-full h-full object-cover" /> : <span className="text-xl">📦</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-text-primary truncate">{p.filename}</p>
                          <p className="text-xs text-text-muted truncate">{p.description || 'Sin descripción'} · {fmtSize(p.size)}</p>
                        </div>
                        <button onClick={() => remove(p)} title="Borrar"
                          className="w-8 h-8 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 flex items-center justify-center">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                        </button>
                        <button onClick={() => toggle(p)} disabled={busy === p.id} title={p.enabled ? 'Desactivar' : 'Activar'}
                          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${p.enabled ? 'bg-accent' : 'bg-border'}`}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${p.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {builtIn.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Integrados en Minecraft</p>
                  <div className="space-y-1.5">
                    {builtIn.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-bg-card border border-border">
                        <span className="text-lg">🧱</span>
                        <p className="flex-1 text-sm text-text-primary">{BUILTIN_NAMES[p.id] ?? p.id}</p>
                        <button onClick={() => toggle(p)} disabled={busy === p.id || p.id === 'vanilla'} title={p.id === 'vanilla' ? 'Siempre activo' : undefined}
                          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${p.enabled ? 'bg-accent' : 'bg-border'}`}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${p.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {dragOver && (
          <div className="absolute inset-3 z-10 rounded-2xl border-2 border-dashed border-accent bg-accent/10 flex items-center justify-center pointer-events-none">
            <p className="text-lg font-semibold text-white bg-bg-secondary/90 px-5 py-3 rounded-2xl">Suelta para añadir al mundo</p>
          </div>
        )}
        {toast && (
          <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl border text-sm shadow-2xl ${toast.ok ? 'bg-green-600/20 border-green-600/40 text-green-200' : 'bg-red-600/20 border-red-600/40 text-red-200'}`}>{toast.text}</div>
        )}
      </div>

      {searching && (
        <div onClick={(e) => e.stopPropagation()}>
          <ContentBrowser
            target={{
              title: 'Buscar datapacks',
              subtitle: `Para el mundo «${world}» · Minecraft ${minecraft}`,
              kind: 'datapack', minecraft, loader: '',
              installed,
              install: async (v) => {
                if (v.cf) { await window.api.curseforge.installMod(instanceId, v.cf.modId, v.cf.fileId, `saves/${world}/datapacks`); return }
                const url = await resolveDownloadUrl(v)
                if (!url) throw new Error('El autor no permite descargarlo fuera de su web')
                await window.api.modrinth.installMod(instanceId, url, v.filename, `saves/${world}/datapacks`)
              },
              remove: (filename) => window.api.worldDatapacks.remove(instanceId, world, filename),
              onChanged: reload,
            }}
            onClose={() => setSearching(false)}
          />
        </div>
      )}
    </div>
  )
}
