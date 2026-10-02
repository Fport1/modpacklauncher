import { useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteVersion, editVersion, listVersions, publishVersion, releaseTag, updateVersion, versionPublishedMs,
  type Channel, type Fport1Dependency, type Fport1Project, type Fport1Version, type VersionInput
} from '../../lib/fport1Content'
import { GithubLogo } from './GithubConnect'
import { CHANNELS, Chips, LOADERS, LOADER_NAMES, TYPES, cleanErr, fmtSize, inputCls, labelCls } from './studioShared'

// Versiones del proyecto (release/beta/alpha). Con alojamiento GitHub, cada
// versión es una release del repo que toque, con el archivo adjunto.
//
// - Lo que se va escribiendo se guarda como borrador (por proyecto y versión)
//   mientras el launcher esté abierto: cambiar de pestaña o cerrar el panel no
//   lo pierde.
// - Al elegir el archivo, el launcher lo lee y rellena número de versión,
//   loaders, versiones de Minecraft y dependencias (se pueden corregir).
// - Las versiones de Minecraft salen de la lista oficial: releases recientes,
//   y con un botón las antiguas o las snapshots. No se puede escribir cualquier cosa.

interface Draft {
  file: File | null
  versionNumber: string
  name: string
  channel: Channel
  loaders: string[]
  gameVersions: string[]
  changelog: string
  deps: Fport1Dependency[]
  /** Campos que la persona ya cambió (lo detectado del archivo no los pisa) */
  touched: string[]
  detected?: string
}

/** Borradores en memoria mientras el launcher siga abierto: «<proyecto>:new» o «<proyecto>:<versión>» */
const drafts = new Map<string, Draft>()

type McVersion = { id: string; type: string; releaseTime: string }
let mcCache: Promise<McVersion[]> | null = null
const mcVersionsOnce = (): Promise<McVersion[]> => (mcCache ??= window.api.launcher.getMcVersions().catch(() => { mcCache = null; return [] }))

/** Qué falta para poder subir versiones, o null si se puede. */
function blocked(project: Fport1Project): string | null {
  if (project.hosting !== 'github') return null
  if (project.openSource && !project.github?.releasesRepo) return 'Es de código abierto pero aún no tiene repo público: elígelo o créalo en «Código y GitHub» y guarda.'
  return null
}

const depText = (d: Fport1Dependency): string => (d.source === 'modrinth' ? '' : d.source === 'curseforge' ? 'cf:' : 'f1:') + d.projectId

export default function VersionsTab({ project, flash, onChanged, dirty }: {
  project: Fport1Project; flash: (m: string) => void; onChanged: () => void; dirty: boolean
}) {
  const [versions, setVersions] = useState<Fport1Version[]>([])
  const [loading, setLoading] = useState(true)
  // null = lista; 'new' = nueva; si no, el id de la versión que se edita
  const [editing, setEditing] = useState<string | null>(() => (drafts.has(`${project.id}:new`) ? 'new' : null))

  async function reload(): Promise<void> {
    setLoading(true)
    try { setVersions(await listVersions(project.id)) } catch { setVersions([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function after(msg: string): void { reload(); onChanged(); flash(msg) }

  const why = blocked(project)
  const pendingDrafts = versions.filter((v) => drafts.has(`${project.id}:${v.id}`)).length

  if (editing) {
    const v = editing === 'new' ? undefined : versions.find((x) => x.id === editing)
    if (editing !== 'new' && !v) return <p className="text-sm text-text-muted">Cargando…</p>
    return <VersionForm key={editing} project={project} version={v} last={versions[0]}
      onCancel={() => setEditing(null)} onDone={(msg) => { setEditing(null); after(msg) }} />
  }

  return (
    <div className="max-w-3xl">
      {dirty && <p className="mb-3 text-xs text-amber-300">Tienes cambios sin guardar en la ficha: guárdalos antes de subir una versión para que se publique con ellos.</p>}
      {why && <p className="mb-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">{why}</p>}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-muted">{versions.length} {versions.length === 1 ? 'versión' : 'versiones'}{pendingDrafts ? ` · ${pendingDrafts} con cambios sin guardar` : ''}</p>
        <button onClick={() => setEditing('new')} disabled={!!why || dirty}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#a855f7] hover:bg-[#9333ea] disabled:opacity-40 text-white text-sm font-semibold shadow-lg shadow-[#a855f7]/25">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
          {drafts.has(`${project.id}:new`) ? 'Seguir con la nueva versión' : 'Subir versión'}
        </button>
      </div>
      {loading && <p className="text-sm text-text-muted py-6 text-center">Cargando…</p>}
      {!loading && versions.length === 0 && (
        <div className="text-center py-14 border border-dashed border-border rounded-2xl">
          <p className="text-3xl mb-2">⬆️</p>
          <p className="text-sm text-text-secondary">Sube la primera versión para poder publicar el proyecto</p>
        </div>
      )}
      <div className="space-y-2.5">
        {versions.map(v => {
          const ch = CHANNELS.find(c => c.key === v.channel) ?? CHANNELS[0]
          const hasDraft = drafts.has(`${project.id}:${v.id}`)
          return (
            <div key={v.id} className="p-4 rounded-2xl bg-bg-card border border-border">
              <div className="flex items-center gap-3">
                <select value={v.channel} onChange={e => updateVersion(project.id, v.id, { channel: e.target.value as Channel }).then(() => after('Canal cambiado')).catch(() => flash('No se pudo cambiar'))}
                  className={`text-xs font-bold px-2 py-1 rounded-lg border outline-none cursor-pointer ${ch.cls}`}>
                  {CHANNELS.map(c => <option key={c.key} value={c.key} className="bg-bg-secondary text-text-primary">{c.label}</option>)}
                </select>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary truncate">{v.name || v.versionNumber} <span className="text-text-muted font-normal">· v{v.versionNumber}</span></p>
                  <p className="text-[11px] text-text-muted truncate">
                    {v.loaders.map(l => LOADER_NAMES[l] ?? l).join(', ') || 'Sin loader'} · {v.gameVersions.join(', ') || '—'}
                    {' · '}{new Date(versionPublishedMs(v) || Date.now()).toLocaleDateString('es')}
                    {' · '}{v.downloads} descargas
                  </p>
                </div>
                <button onClick={() => setEditing(v.id)} className={`text-xs px-2.5 py-1.5 rounded-lg border ${hasDraft ? 'border-amber-500/40 text-amber-300' : 'border-border text-text-secondary hover:text-text-primary'}`}>
                  {hasDraft ? 'Seguir editando' : 'Editar'}
                </button>
                <button onClick={() => { if (confirm(`¿Borrar la versión ${v.versionNumber}?${v.files[0]?.host === 'github' ? ' También se borra su release en GitHub.' : ''}`)) deleteVersion(project.id, v).then(() => after('Versión borrada')).catch(() => flash('No se pudo borrar')) }}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10">Borrar</button>
              </div>
              {v.files.map(f => (
                <p key={f.path} className="mt-2 text-xs text-text-muted flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-bg-hover font-mono">{f.filename}</span>{fmtSize(f.size)}
                  {f.github
                    ? <button onClick={() => window.api.shell.openExternal(f.github!.htmlUrl)} className="flex items-center gap-1 text-[#c084fc] hover:underline"><GithubLogo className="w-3 h-3" />{f.github.repo} · {f.github.tag}</button>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover">Firebase Storage</span>}
                </p>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VersionForm({ project, version, last, onCancel, onDone }: {
  project: Fport1Project; version?: Fport1Version; last?: Fport1Version; onCancel: () => void; onDone: (msg: string) => void
}) {
  const type = TYPES.find(t => t.key === project.type) ?? TYPES[1]
  const key = `${project.id}:${version?.id ?? 'new'}`
  const initial = (): Draft => drafts.get(key) ?? (version
    ? { file: null, versionNumber: version.versionNumber, name: version.name === version.versionNumber ? '' : version.name, channel: version.channel, loaders: version.loaders,
        gameVersions: version.gameVersions, changelog: version.changelog, deps: version.dependencies, touched: ['versionNumber', 'name', 'loaders', 'gameVersions', 'deps'] }
    : { file: null, versionNumber: '', name: '', channel: 'release', loaders: last?.loaders ?? [], gameVersions: last?.gameVersions ?? [], changelog: '', deps: last?.dependencies ?? [], touched: [] })
  const [d, setD] = useState<Draft>(initial)
  const [progress, setProgress] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [mc, setMc] = useState<McVersion[]>([])
  const [showOld, setShowOld] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [depInput, setDepInput] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Todo lo que se escribe queda en el borrador
  const set = (patch: Partial<Draft>, touched?: keyof Draft): void => setD(prev => {
    const next = { ...prev, ...patch, touched: touched && !prev.touched.includes(touched) ? [...prev.touched, touched] : prev.touched }
    drafts.set(key, next)
    return next
  })
  const isDirty = (): boolean => drafts.has(key)
  function discard(): void { drafts.delete(key); onCancel() }

  useEffect(() => { mcVersionsOnce().then(setMc) }, [])

  const releases = useMemo(() => mc.filter(v => v.type === 'release'), [mc])
  const recentCount = 20
  const shown = useMemo(() => {
    const base = showOld ? releases : releases.slice(0, recentCount)
    const snaps = showSnapshots ? mc.filter(v => v.type === 'snapshot').slice(0, 40) : []
    const ids = new Set([...base, ...snaps].map(v => v.id))
    // Las ya marcadas se ven siempre, aunque sean antiguas o snapshots
    for (const g of d.gameVersions) ids.add(g)
    const order = new Map(mc.map((v, i) => [v.id, i]))
    return [...ids].sort((a, b) => (order.get(a) ?? 9999) - (order.get(b) ?? 9999))
  }, [mc, releases, showOld, showSnapshots, d.gameVersions])
  const snapshotIds = useMemo(() => new Set(mc.filter(v => v.type === 'snapshot').map(v => v.id)), [mc])

  async function pickFile(f: File | undefined): Promise<void> {
    if (!f) return
    const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'))
    if (!type.accept.split(',').includes(ext)) { setErr(`Para ${type.label} se sube un archivo ${type.hint}`); return }
    setErr('')
    set({ file: f })
    setAnalyzing(true)
    try {
      const a = await window.api.github.analyzeUpload(f.name, await f.arrayBuffer())
      setD(prev => {
        const t = new Set(prev.touched)
        const next: Draft = { ...prev, file: f }
        const found: string[] = []
        if (a.versionNumber && !t.has('versionNumber')) { next.versionNumber = a.versionNumber; found.push(`versión ${a.versionNumber}`) }
        const loaders = a.loaders.filter(l => LOADERS[project.type].includes(l))
        if (loaders.length && !t.has('loaders')) { next.loaders = loaders; found.push(loaders.map(l => LOADER_NAMES[l] ?? l).join(', ')) }
        if (a.gameVersions.length && !t.has('gameVersions')) { next.gameVersions = a.gameVersions; found.push(`Minecraft ${a.minecraftRange ?? a.gameVersions.join(', ')}`) }
        else if (a.minecraftRange && !a.gameVersions.length) found.push(`Minecraft ${a.minecraftRange} (no se pudo cruzar con la lista)`)
        if (a.dependencies.length && !t.has('deps')) { next.deps = a.dependencies.map(x => ({ source: 'modrinth', projectId: x.id, type: x.type })); found.push(`${a.dependencies.length} dependencias`) }
        next.detected = found.length ? `Leído del archivo: ${found.join(' · ')}.${a.notas.length ? ' ' + a.notas.join(' ') : ''}` : (a.notas.join(' ') || 'El archivo no dice versiones ni dependencias: márcalas tú.')
        drafts.set(key, next)
        return next
      })
    } catch { set({ detected: 'No se pudo leer el archivo: rellena los datos a mano.' }) }
    finally { setAnalyzing(false) }
  }

  function addDep(text: string, type: 'required' | 'optional'): void {
    const t = text.trim()
    if (!t) return
    const m = /^(cf|f1):(.+)$/i.exec(t)
    const id = (m ? m[2] : t).trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_.-]{1,63}$/.test(id)) { setErr('Una dependencia es el slug del proyecto (letras, números y guiones), p. ej. fabric-api, o cf:<id> / f1:<id>'); return }
    const source: Fport1Dependency['source'] = m ? (m[1].toLowerCase() === 'cf' ? 'curseforge' : 'fport1') : 'modrinth'
    set({ deps: [...d.deps.filter(x => x.projectId !== id), { source, projectId: id, type }] }, 'deps')
    setDepInput(''); setErr('')
  }

  async function submit(): Promise<void> {
    if (!version && !d.file) { setErr('Elige el archivo'); return }
    if (!d.versionNumber.trim()) { setErr('Pon el número de versión'); return }
    if (!d.gameVersions.length) { setErr('Marca al menos una versión de Minecraft'); return }
    if (LOADERS[project.type].length && !d.loaders.length) { setErr('Marca al menos un loader'); return }
    setErr(''); setProgress(d.file ? 0 : 1)
    const input: VersionInput = {
      name: d.name.trim() || d.versionNumber.trim(), versionNumber: d.versionNumber.trim(), channel: d.channel,
      loaders: d.loaders, gameVersions: d.gameVersions, changelog: d.changelog, dependencies: d.deps,
    }
    try {
      if (version) await editVersion(project, version, input, d.file, setProgress)
      else await publishVersion(project, input, d.file!, setProgress)
      drafts.delete(key)
      onDone(version ? 'Versión actualizada' : 'Versión publicada')
    } catch (e) {
      setProgress(null)
      const m = cleanErr(e)
      setErr(/permission|unauthorized/i.test(m) ? 'Sin permiso para guardar la versión en el catálogo (Firestore).' : m || 'No se pudo guardar la versión')
    }
  }

  const onGithub = project.hosting === 'github'
  const repoLabel = project.github?.releasesRepo || 'tu repo de contenido'
  const busy = progress !== null

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-text-primary">{version ? `Editar v${version.versionNumber}` : 'Nueva versión'}</h3>
          <p className="text-[11px] text-text-muted">Lo que escribes se guarda como borrador aunque cambies de pestaña o cierres el panel.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onCancel} disabled={busy} className="text-sm text-text-muted hover:text-text-primary">Volver</button>
          {isDirty() && <button onClick={() => { if (confirm('¿Descartar lo que has escrito?')) discard() }} disabled={busy} className="text-sm text-red-300 hover:text-red-200">Descartar</button>}
        </div>
      </div>

      <div onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files[0]) }}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-[#a855f7] bg-[#a855f7]/10' : d.file ? 'border-green-500/50 bg-green-500/5' : 'border-border hover:border-[#a855f7]/50'}`}>
        <input ref={fileRef} type="file" accept={type.accept} hidden onChange={e => { pickFile(e.target.files?.[0]); e.target.value = '' }} />
        {d.file ? (
          <>
            <p className="text-sm font-semibold text-text-primary">📄 {d.file.name}</p>
            <p className="text-xs text-text-muted mt-1">{fmtSize(d.file.size)} · haz clic para cambiarlo</p>
          </>
        ) : version ? (
          <>
            <p className="text-sm font-semibold text-text-primary">Archivo actual: {version.files[0]?.filename ?? '—'}</p>
            <p className="text-xs text-text-muted mt-1">Arrastra uno nuevo o haz clic para sustituirlo (opcional)</p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-text-primary">Arrastra aquí el archivo o haz clic</p>
            <p className="text-xs text-text-muted mt-1">{type.label}: {type.hint}. El launcher lo lee y rellena versiones, loaders y dependencias.</p>
          </>
        )}
      </div>
      {(analyzing || d.detected) && (
        <p className={`text-xs px-3 py-2 rounded-xl ${analyzing ? 'bg-bg-hover text-text-muted' : 'bg-[#a855f7]/10 text-[#e9d5ff]'}`}>{analyzing ? 'Leyendo el archivo…' : d.detected}</p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Número de versión</label>
          <input value={d.versionNumber} onChange={e => set({ versionNumber: e.target.value }, 'versionNumber')} className={inputCls} placeholder="1.0.0" />
          {onGithub && d.versionNumber.trim() && <p className="text-[11px] text-text-muted mt-1">Release «{releaseTag(project, d.versionNumber)}» en {repoLabel}</p>}
        </div>
        <div>
          <label className={labelCls}>Nombre (opcional)</label>
          <input value={d.name} onChange={e => set({ name: e.target.value }, 'name')} className={inputCls} placeholder="La gran actualización" />
        </div>
      </div>

      <div>
        <label className={labelCls}>Canal</label>
        <div className="flex gap-2">
          {CHANNELS.map(c => (
            <button key={c.key} onClick={() => set({ channel: c.key })}
              className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${d.channel === c.key ? c.cls : 'border-border text-text-secondary hover:bg-bg-hover'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-muted mt-1.5">Release es la estable; beta y alpha salen marcadas como pruebas{onGithub ? ' (en GitHub, como «pre-release»)' : ''}.</p>
      </div>

      {LOADERS[project.type].length > 0 && (
        <div>
          <label className={labelCls}>Loaders</label>
          <Chips options={LOADERS[project.type]} value={d.loaders} onChange={v => set({ loaders: v }, 'loaders')} names={LOADER_NAMES} />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-text-secondary">Versiones de Minecraft {d.gameVersions.length > 0 && <span className="text-text-muted font-normal">· {d.gameVersions.length} marcadas</span>}</label>
          <div className="flex items-center gap-3 text-[11px]">
            <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer"><input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} className="accent-[#a855f7]" />Versiones antiguas</label>
            <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer"><input type="checkbox" checked={showSnapshots} onChange={e => setShowSnapshots(e.target.checked)} className="accent-[#a855f7]" />Snapshots</label>
            {d.gameVersions.length > 0 && <button onClick={() => set({ gameVersions: [] }, 'gameVersions')} className="text-text-muted hover:text-text-primary">Quitar todas</button>}
          </div>
        </div>
        <div className="max-h-48 overflow-y-auto rounded-xl border border-border bg-bg-primary p-2">
          {mc.length === 0 ? <p className="text-xs text-text-muted p-2">Cargando la lista oficial de versiones…</p>
            : <Chips options={shown} value={d.gameVersions} onChange={v => set({ gameVersions: v }, 'gameVersions')} names={Object.fromEntries([...snapshotIds].map(id => [id, `${id} (snapshot)`]))} />}
        </div>
        <p className="text-[11px] text-text-muted mt-1.5">Lista oficial de Mojang: se ven las {recentCount} últimas releases; marca «Versiones antiguas» o «Snapshots» para ver el resto.</p>
      </div>

      {(project.type === 'mod' || project.type === 'plugin' || project.type === 'shader' || project.type === 'modpack') && (
        <div>
          <label className={labelCls}>Dependencias</label>
          {d.deps.length === 0 && <p className="text-xs text-text-muted mb-2">{d.file || version ? 'Sin dependencias.' : 'Se rellenan solas al elegir el archivo.'}</p>}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {d.deps.map(x => (
              <span key={x.projectId} className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg border border-border bg-bg-card text-xs">
                <span className="text-text-primary">{depText(x)}</span>
                <button onClick={() => set({ deps: d.deps.map(y => y.projectId === x.projectId ? { ...y, type: y.type === 'required' ? 'optional' : 'required' } : y) }, 'deps')}
                  className={`px-1.5 py-0.5 rounded ${x.type === 'required' ? 'bg-[#a855f7]/20 text-[#e9d5ff]' : 'bg-bg-hover text-text-muted'}`} title="Cambiar entre necesaria y opcional">
                  {x.type === 'required' ? 'necesaria' : 'opcional'}
                </button>
                <button onClick={() => set({ deps: d.deps.filter(y => y.projectId !== x.projectId) }, 'deps')} className="w-5 h-5 rounded hover:bg-white/10 text-text-muted">✕</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={depInput} onChange={e => setDepInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addDep(depInput, 'required') }}
              className={inputCls} placeholder="Añadir otra: slug de Modrinth (fabric-api), cf:<id> o f1:<id>" />
            <button onClick={() => addDep(depInput, 'required')} className="px-3 rounded-xl border border-border text-xs text-text-secondary hover:text-text-primary">Necesaria</button>
            <button onClick={() => addDep(depInput, 'optional')} className="px-3 rounded-xl border border-border text-xs text-text-secondary hover:text-text-primary">Opcional</button>
          </div>
        </div>
      )}

      <div>
        <label className={labelCls}>Notas de la versión (Markdown){onGithub ? ' · también van a la release' : ''}</label>
        <textarea value={d.changelog} onChange={e => set({ changelog: e.target.value })} rows={5} className={`${inputCls} resize-y`} placeholder="- Nuevo: ...&#10;- Arreglado: ..." />
      </div>

      {err && <p className="text-sm text-red-300">{err}</p>}

      {busy ? (
        <div>
          <div className="h-2.5 rounded-full bg-bg-hover overflow-hidden">
            <div className="h-full bg-[#a855f7] transition-all" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
          <p className="text-xs text-text-muted mt-1.5">{d.file ? `${onGithub ? 'Subiendo a GitHub' : 'Subiendo'}… ${Math.round((progress ?? 0) * 100)}%` : 'Guardando…'}</p>
        </div>
      ) : (
        <div className="flex justify-end">
          <button onClick={submit} className="px-6 py-3 rounded-xl bg-[#a855f7] hover:bg-[#9333ea] text-white text-sm font-bold shadow-lg shadow-[#a855f7]/25">
            {version ? (d.file ? 'Guardar y sustituir el archivo' : 'Guardar cambios') : 'Publicar versión'}
          </button>
        </div>
      )}
    </div>
  )
}
