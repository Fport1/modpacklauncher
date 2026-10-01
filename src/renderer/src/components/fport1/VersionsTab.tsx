import { useEffect, useRef, useState } from 'react'
import {
  deleteVersion, listVersions, parseDependencies, publishVersion, releaseTag, updateVersion, versionPublishedMs,
  type Channel, type Fport1Project, type Fport1Version
} from '../../lib/fport1Content'
import { GithubLogo } from './GithubConnect'
import { CHANNELS, Chips, LOADERS, LOADER_NAMES, TYPES, cleanErr, fmtSize, inputCls, labelCls } from './studioShared'

// Versiones del proyecto (release/beta/alpha). Con alojamiento GitHub, cada
// versión es una release del repo que toque, con el archivo adjunto.

/** Qué falta para poder subir versiones, o null si se puede. */
function blocked(project: Fport1Project): string | null {
  if (project.hosting !== 'github') return null
  if (project.openSource && !project.github?.releasesRepo) return 'Es de código abierto pero aún no tiene repo público: elígelo o créalo en «Código y GitHub» y guarda.'
  return null
}

export default function VersionsTab({ project, mcVersions, flash, onChanged, dirty }: {
  project: Fport1Project; mcVersions: string[]; flash: (m: string) => void; onChanged: () => void; dirty: boolean
}) {
  const [versions, setVersions] = useState<Fport1Version[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editChangelog, setEditChangelog] = useState('')

  async function reload(): Promise<void> {
    setLoading(true)
    try { setVersions(await listVersions(project.id)) } catch { setVersions([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function after(msg: string): void { reload(); onChanged(); flash(msg) }

  const why = blocked(project)

  if (adding) {
    return <NewVersionForm project={project} mcVersions={mcVersions} last={versions[0]}
      onCancel={() => setAdding(false)} onDone={() => { setAdding(false); after('Versión publicada') }} />
  }

  return (
    <div className="max-w-3xl">
      {dirty && <p className="mb-3 text-xs text-amber-300">Tienes cambios sin guardar en la ficha: guárdalos antes de subir una versión para que se publique con ellos.</p>}
      {why && <p className="mb-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">{why}</p>}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-muted">{versions.length} {versions.length === 1 ? 'versión' : 'versiones'}</p>
        <button onClick={() => setAdding(true)} disabled={!!why || dirty}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#a855f7] hover:bg-[#9333ea] disabled:opacity-40 text-white text-sm font-semibold shadow-lg shadow-[#a855f7]/25">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
          Subir versión
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
                <button onClick={() => { setEditing(editing === v.id ? null : v.id); setEditChangelog(v.changelog) }} className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-text-secondary hover:text-text-primary">Notas</button>
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
              {editing === v.id && (
                <div className="mt-3 space-y-2">
                  <textarea value={editChangelog} onChange={e => setEditChangelog(e.target.value)} rows={5} className={`${inputCls} resize-y`} placeholder="Qué cambia en esta versión" />
                  <div className="flex justify-end">
                    <button onClick={() => updateVersion(project.id, v.id, { changelog: editChangelog }).then(() => { setEditing(null); after('Notas guardadas') }).catch(() => flash('No se pudo guardar'))}
                      className="px-4 py-2 rounded-xl bg-[#a855f7] text-white text-sm font-semibold">Guardar notas</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NewVersionForm({ project, mcVersions, last, onCancel, onDone }: {
  project: Fport1Project; mcVersions: string[]; last?: Fport1Version; onCancel: () => void; onDone: () => void
}) {
  const type = TYPES.find(t => t.key === project.type) ?? TYPES[1]
  const [file, setFile] = useState<File | null>(null)
  const [versionNumber, setVersionNumber] = useState('')
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<Channel>('release')
  const [loaders, setLoaders] = useState<string[]>(last?.loaders ?? [])
  const [gameVersions, setGameVersions] = useState<string[]>(last?.gameVersions ?? [])
  const [extraVersion, setExtraVersion] = useState('')
  const [changelog, setChangelog] = useState('')
  const depText = (t: 'required' | 'optional'): string => (last?.dependencies ?? []).filter(d => d.type === t).map(d => (d.source === 'modrinth' ? '' : d.source === 'curseforge' ? 'cf:' : 'f1:') + d.projectId).join(', ')
  const [reqDeps, setReqDeps] = useState(depText('required'))
  const [optDeps, setOptDeps] = useState(depText('optional'))
  const [progress, setProgress] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const allVersions = [...new Set([...gameVersions, ...mcVersions])].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  const onGithub = project.hosting === 'github'
  const repoLabel = project.github?.releasesRepo || 'tu repo de contenido'

  function pickFile(f: File | undefined): void {
    if (!f) return
    const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'))
    if (!type.accept.split(',').includes(ext)) { setErr(`Para ${type.label} se sube un archivo ${type.hint}`); return }
    setErr(''); setFile(f)
    // Sugerir número de versión a partir del nombre del archivo (mimod-1.2.3.jar)
    if (!versionNumber) {
      const m = f.name.match(/(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)(?=\.[a-z]+$)/i)
      if (m) setVersionNumber(m[1])
    }
  }

  async function publish(): Promise<void> {
    if (!file) { setErr('Elige el archivo'); return }
    if (!versionNumber.trim()) { setErr('Pon el número de versión'); return }
    if (!gameVersions.length) { setErr('Marca al menos una versión de Minecraft'); return }
    if (LOADERS[project.type].length && !loaders.length) { setErr('Marca al menos un loader'); return }
    setErr(''); setProgress(0)
    try {
      await publishVersion(project, {
        name: name.trim() || versionNumber.trim(), versionNumber: versionNumber.trim(), channel,
        loaders, gameVersions, changelog,
        dependencies: [...parseDependencies(reqDeps, 'required'), ...parseDependencies(optDeps, 'optional')],
      }, file, setProgress)
      onDone()
    } catch (e) {
      setProgress(null)
      const m = cleanErr(e)
      setErr(/permission|unauthorized/i.test(m) ? 'Sin permiso para guardar la versión en el catálogo (Firestore).' : m || 'No se pudo subir la versión')
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-text-primary">Nueva versión</h3>
        <button onClick={onCancel} disabled={progress !== null} className="text-sm text-text-muted hover:text-text-primary">Cancelar</button>
      </div>

      <div onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files[0]) }}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-[#a855f7] bg-[#a855f7]/10' : file ? 'border-green-500/50 bg-green-500/5' : 'border-border hover:border-[#a855f7]/50'}`}>
        <input ref={fileRef} type="file" accept={type.accept} hidden onChange={e => { pickFile(e.target.files?.[0]); e.target.value = '' }} />
        {file ? (
          <>
            <p className="text-sm font-semibold text-text-primary">📄 {file.name}</p>
            <p className="text-xs text-text-muted mt-1">{fmtSize(file.size)} · haz clic para cambiarlo</p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-text-primary">Arrastra aquí el archivo o haz clic</p>
            <p className="text-xs text-text-muted mt-1">{type.label}: {type.hint}</p>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Número de versión</label>
          <input value={versionNumber} onChange={e => setVersionNumber(e.target.value)} className={inputCls} placeholder="1.0.0" />
          {onGithub && versionNumber.trim() && <p className="text-[11px] text-text-muted mt-1">Release «{releaseTag(project, versionNumber)}» en {repoLabel}</p>}
        </div>
        <div>
          <label className={labelCls}>Nombre (opcional)</label>
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="La gran actualización" />
        </div>
      </div>

      <div>
        <label className={labelCls}>Canal</label>
        <div className="flex gap-2">
          {CHANNELS.map(c => (
            <button key={c.key} onClick={() => setChannel(c.key)}
              className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${channel === c.key ? c.cls : 'border-border text-text-secondary hover:bg-bg-hover'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-muted mt-1.5">Release es la estable; beta y alpha salen marcadas como pruebas{onGithub ? ' (en GitHub, como «pre-release»)' : ''}.</p>
      </div>

      {LOADERS[project.type].length > 0 && (
        <div>
          <label className={labelCls}>Loaders</label>
          <Chips options={LOADERS[project.type]} value={loaders} onChange={setLoaders} names={LOADER_NAMES} />
        </div>
      )}

      <div>
        <label className={labelCls}>Versiones de Minecraft</label>
        <div className="max-h-40 overflow-y-auto rounded-xl border border-border bg-bg-primary p-2">
          <Chips options={allVersions} value={gameVersions} onChange={setGameVersions} />
        </div>
        <div className="flex gap-2 mt-2">
          <input value={extraVersion} onChange={e => setExtraVersion(e.target.value)} className={inputCls} placeholder="Otra versión (p. ej. 26.2 o una snapshot)"
            onKeyDown={e => { if (e.key === 'Enter' && extraVersion.trim()) { setGameVersions(g => [...new Set([...g, extraVersion.trim()])]); setExtraVersion('') } }} />
          <button onClick={() => { if (extraVersion.trim()) { setGameVersions(g => [...new Set([...g, extraVersion.trim()])]); setExtraVersion('') } }}
            className="px-4 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary">Añadir</button>
        </div>
      </div>

      {(project.type === 'mod' || project.type === 'plugin' || project.type === 'shader') && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Dependencias necesarias</label>
            <input value={reqDeps} onChange={e => setReqDeps(e.target.value)} className={inputCls} placeholder="fabric-api, cf:238222, f1:abc" />
          </div>
          <div>
            <label className={labelCls}>Dependencias opcionales</label>
            <input value={optDeps} onChange={e => setOptDeps(e.target.value)} className={inputCls} placeholder="modmenu" />
          </div>
          <p className="col-span-2 -mt-2 text-[11px] text-text-muted">Separadas por comas. Sin prefijo es el slug de Modrinth; <b>cf:</b> para un id de CurseForge y <b>f1:</b> para otra creación tuya.</p>
        </div>
      )}

      <div>
        <label className={labelCls}>Notas de la versión (Markdown){onGithub ? ' · también van a la release' : ''}</label>
        <textarea value={changelog} onChange={e => setChangelog(e.target.value)} rows={5} className={`${inputCls} resize-y`} placeholder="- Nuevo: ...&#10;- Arreglado: ..." />
      </div>

      {err && <p className="text-sm text-red-300">{err}</p>}

      {progress !== null ? (
        <div>
          <div className="h-2.5 rounded-full bg-bg-hover overflow-hidden">
            <div className="h-full bg-[#a855f7] transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="text-xs text-text-muted mt-1.5">{onGithub ? 'Subiendo a GitHub' : 'Subiendo'}… {Math.round(progress * 100)}%</p>
        </div>
      ) : (
        <div className="flex justify-end">
          <button onClick={publish} className="px-6 py-3 rounded-xl bg-[#a855f7] hover:bg-[#9333ea] text-white text-sm font-bold shadow-lg shadow-[#a855f7]/25">
            Publicar versión
          </button>
        </div>
      )}
    </div>
  )
}
