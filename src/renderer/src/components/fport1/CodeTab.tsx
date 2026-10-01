import { useEffect, useState } from 'react'
import type { GithubRepo, GithubStatus } from '../../../../shared/types'
import type { Fport1Github, Fport1Hosting, Fport1License, Fport1Links, Fport1Project } from '../../lib/fport1Content'
import { GithubLogo } from './GithubConnect'
import { CLOSED_LICENSES, OPEN_LICENSES, cleanErr, inputCls, labelCls } from './studioShared'

// Código abierto o cerrado, licencia, repositorio de GitHub y enlaces.
// Lo que se cambia aquí va al formulario del proyecto y se guarda con
// «Guardar cambios»; crear un repo sí ocurre al momento en GitHub.

export interface CodeForm {
  openSource: boolean
  license: Fport1License | null
  github: Fport1Github
  links: Fport1Links
  hosting: Fport1Hosting
}

const CONTENT_REPO = 'fport1-contenido'

export default function CodeTab({ project, form, onChange, github }: {
  project: Fport1Project
  form: CodeForm
  onChange: (patch: Partial<CodeForm>) => void
  github: GithubStatus | null
}) {
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [owners, setOwners] = useState<string[]>([])
  const [loadErr, setLoadErr] = useState('')
  const [mode, setMode] = useState<'pick' | 'create' | null>(null)
  const [filter, setFilter] = useState('')
  const [newRepo, setNewRepo] = useState({ owner: '', name: project.slug, private: !form.openSource })
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')

  useEffect(() => {
    if (!mode || repos) return
    window.api.github.repos().then(r => { setRepos(r.repos); setOwners(r.owners); setNewRepo(n => ({ ...n, owner: n.owner || r.owners[0] || '' })) })
      .catch(e => setLoadErr(cleanErr(e)))
  }, [mode, repos])

  const licenses = form.openSource ? OPEN_LICENSES : CLOSED_LICENSES
  const isCustom = form.license?.id === 'custom'
  const current = form.github.sourceRepo
  const contentRepo = github?.login ? `${github.login}/${CONTENT_REPO}` : CONTENT_REPO
  const releasesWhere = form.openSource && current && !form.github.sourcePrivate ? current : contentRepo

  function setOpen(open: boolean): void {
    // Al cambiar, la licencia pasa a una del otro grupo, y un repo privado no vale para código abierto
    const lic = (open ? OPEN_LICENSES : CLOSED_LICENSES).some(l => l.id === form.license?.id) || isCustom ? form.license : (open ? OPEN_LICENSES[0] : CLOSED_LICENSES[0])
    const gh = open && form.github.sourcePrivate ? {} : form.github
    onChange({ openSource: open, license: lic, github: gh, links: { ...form.links, source: open && gh.sourceRepo ? `https://github.com/${gh.sourceRepo}` : undefined } })
    setNewRepo(n => ({ ...n, private: !open }))
  }

  function pickRepo(r: { fullName: string; private: boolean }): void {
    const url = `https://github.com/${r.fullName}`
    onChange({
      github: { sourceRepo: r.fullName, sourcePrivate: r.private },
      links: form.openSource && !r.private ? { ...form.links, source: url, issues: form.links.issues || `${url}/issues` } : { ...form.links, source: undefined },
    })
    setMode(null)
  }

  async function create(): Promise<void> {
    if (!newRepo.name.trim()) return
    setCreating(true); setCreateErr('')
    try {
      const r = await window.api.github.createRepo({
        owner: newRepo.owner || undefined, name: newRepo.name.trim(), private: form.openSource ? false : newRepo.private,
        description: project.summary, license: form.openSource ? form.license?.id : undefined, topics: [...project.tags, ...project.categories, project.type, 'minecraft'],
      })
      setRepos(list => [r, ...(list ?? [])])
      pickRepo(r)
    } catch (e) { setCreateErr(cleanErr(e)) }
    finally { setCreating(false) }
  }

  const shown = (repos ?? []).filter(r => (!form.openSource || !r.private) && r.fullName.toLowerCase().includes(filter.toLowerCase()) && !r.fullName.endsWith(`/${CONTENT_REPO}`))

  return (
    <div className="max-w-3xl space-y-6">
      {form.hosting === 'storage' && (
        <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-3">
          <span className="text-lg">⚠</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-100">Este proyecto guarda sus archivos en Firebase Storage</p>
            <p className="text-xs text-amber-200/80 mt-0.5">Si lo pasas a GitHub, las versiones e imágenes nuevas irán a GitHub (sin coste de descargas). Lo ya subido sigue funcionando donde está.</p>
          </div>
          <button onClick={() => onChange({ hosting: 'github' })} className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold shrink-0">Pasar a GitHub</button>
        </div>
      )}

      <div>
        <label className={labelCls}>Código</label>
        <div className="grid grid-cols-2 gap-3">
          {([[true, 'Código abierto', 'El código está en un repo público; cualquiera puede verlo según la licencia.'], [false, 'Código cerrado', 'El código es privado (o no está en GitHub). Solo se publican los archivos para descargar.']] as const).map(([open, title, hint]) => (
            <button key={title} onClick={() => setOpen(open)}
              className={`p-4 rounded-2xl border text-left transition-colors ${form.openSource === open ? 'bg-[#a855f7]/15 border-[#a855f7]/60' : 'border-border hover:bg-bg-hover'}`}>
              <p className="text-sm font-semibold text-text-primary">{form.openSource === open ? '● ' : '○ '}{title}</p>
              <p className="text-[11px] text-text-muted mt-1">{hint}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Licencia</label>
        <select value={form.license?.id ?? ''} onChange={e => {
          const id = e.target.value
          onChange({ license: id === 'custom' ? { id: 'custom', name: '', url: '' } : licenses.find(l => l.id === id) ?? null })
        }} className={inputCls}>
          {licenses.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          <option value="custom">Otra (escribe nombre y enlace)</option>
        </select>
        {isCustom && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input value={form.license?.name ?? ''} onChange={e => onChange({ license: { ...form.license!, name: e.target.value } })} className={inputCls} placeholder="Nombre de la licencia" />
            <input value={form.license?.url ?? ''} onChange={e => onChange({ license: { ...form.license!, url: e.target.value } })} className={inputCls} placeholder="https://… (texto de la licencia)" />
          </div>
        )}
      </div>

      <div>
        <label className={labelCls}>Repositorio del código en GitHub {form.openSource ? '' : '(opcional)'}</label>
        {current ? (
          <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-bg-card">
            <GithubLogo className="w-6 h-6 text-text-primary" />
            <div className="flex-1 min-w-0">
              <button onClick={() => window.api.shell.openExternal(`https://github.com/${current}`)} className="text-sm font-semibold text-text-primary hover:underline truncate">{current}</button>
              <p className="text-[11px] text-text-muted">{form.github.sourcePrivate ? 'Privado: no se enseña en la ficha' : 'Público'}</p>
            </div>
            <button onClick={() => setMode('pick')} className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:text-text-primary">Cambiar</button>
            <button onClick={() => onChange({ github: {}, links: { ...form.links, source: undefined } })} className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:text-red-300">Quitar</button>
          </div>
        ) : !mode && (
          <div className="flex gap-2">
            <button onClick={() => setMode('pick')} className="px-4 py-2 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary">Elegir uno que ya tengo</button>
            <button onClick={() => setMode('create')} className="px-4 py-2 rounded-xl bg-[#24292f] hover:bg-[#32383f] border border-white/10 text-white text-sm font-semibold">Crear repo nuevo</button>
          </div>
        )}

        {mode && (
          <div className="mt-2 p-3 rounded-xl border border-border bg-bg-primary space-y-3">
            <div className="flex gap-1">
              {(['pick', 'create'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${mode === m ? 'bg-[#a855f7]/25 text-[#e9d5ff]' : 'text-text-secondary hover:bg-bg-hover'}`}>
                  {m === 'pick' ? 'Elegir existente' : 'Crear nuevo'}
                </button>
              ))}
              <span className="flex-1" />
              <button onClick={() => setMode(null)} className="text-xs text-text-muted hover:text-text-primary px-2">Cancelar</button>
            </div>
            {loadErr && <p className="text-xs text-red-300">{loadErr}</p>}
            {mode === 'pick' && (
              <>
                <input value={filter} onChange={e => setFilter(e.target.value)} className={inputCls} placeholder="Buscar repositorio…" />
                <div className="max-h-56 overflow-y-auto space-y-1">
                  {!repos && !loadErr && <p className="text-xs text-text-muted py-3 text-center">Cargando tus repos…</p>}
                  {repos && shown.length === 0 && <p className="text-xs text-text-muted py-3 text-center">{form.openSource ? 'No hay repos públicos que coincidan' : 'No hay repos que coincidan'}</p>}
                  {shown.map(r => (
                    <button key={r.fullName} onClick={() => pickRepo(r)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-bg-hover text-left">
                      <span className="text-sm text-text-primary truncate flex-1">{r.fullName}</span>
                      {r.license && <span className="text-[10px] text-text-muted">{r.license}</span>}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.private ? 'bg-amber-500/15 text-amber-300' : 'bg-green-500/15 text-green-300'}`}>{r.private ? 'Privado' : 'Público'}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {mode === 'create' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <select value={newRepo.owner} onChange={e => setNewRepo(n => ({ ...n, owner: e.target.value }))} className={`${inputCls} w-44`}>
                    {owners.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <span className="self-center text-text-muted">/</span>
                  <input value={newRepo.name} onChange={e => setNewRepo(n => ({ ...n, name: e.target.value.replace(/[^\w.-]+/g, '-') }))} className={inputCls} placeholder="nombre-del-repo" />
                </div>
                <div className="flex gap-2">
                  {([[false, 'Público'], [true, 'Privado']] as const).map(([priv, label]) => (
                    <button key={label} disabled={form.openSource && priv} onClick={() => setNewRepo(n => ({ ...n, private: priv }))}
                      className={`flex-1 py-2 rounded-lg text-xs border disabled:opacity-30 ${newRepo.private === priv ? 'bg-[#a855f7]/20 border-[#a855f7]/60 text-[#e9d5ff]' : 'border-border text-text-secondary hover:bg-bg-hover'}`}>{label}</button>
                  ))}
                </div>
                <p className="text-[11px] text-text-muted">
                  {form.openSource ? 'Código abierto: el repo es público. ' : ''}Se crea con un README{form.openSource && form.license && form.license.id !== 'custom' ? `, la licencia ${form.license.name}` : ''} y las etiquetas del proyecto.
                  {github && !github.canPrivate && newRepo.private ? ' Tu conexión solo permite repos públicos.' : ''}
                </p>
                {createErr && <p className="text-xs text-red-300">{createErr}</p>}
                <div className="flex justify-end">
                  <button onClick={create} disabled={creating || !newRepo.name.trim()} className="px-4 py-2 rounded-lg bg-[#24292f] hover:bg-[#32383f] border border-white/10 text-white text-sm font-semibold disabled:opacity-50">
                    {creating ? 'Creando…' : `Crear ${newRepo.private && !form.openSource ? 'privado' : 'público'}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {form.hosting === 'github' && (
        <div className="p-4 rounded-2xl border border-border bg-bg-card">
          <p className="text-sm font-semibold text-text-primary">Dónde se publican las versiones</p>
          <p className="text-xs text-text-muted mt-1">
            En las Releases de <b className="text-text-secondary">{releasesWhere}</b>.{' '}
            {releasesWhere === contentRepo
              ? form.openSource
                ? 'Elige el repo público del código para publicarlas allí.'
                : 'Es tu repo público de contenido: solo contiene los archivos para descargar; el código sigue privado.'
              : 'Junto al código, con la etiqueta v<versión>.'}
          </p>
        </div>
      )}

      <div>
        <label className={labelCls}>Enlaces de la ficha</label>
        <div className="grid grid-cols-2 gap-2">
          {([
            ['source', 'Código fuente', 'https://github.com/…'], ['issues', 'Reportar errores', 'https://github.com/…/issues'],
            ['wiki', 'Wiki o guía', 'https://…'], ['discord', 'Discord', 'https://discord.gg/…'],
            ['website', 'Página web', 'https://…'], ['donate', 'Donaciones', 'https://ko-fi.com/…'],
          ] as [keyof Fport1Links, string, string][]).map(([k, label, ph]) => (
            <div key={k}>
              <p className="text-[11px] text-text-muted mb-1">{label}</p>
              <input value={form.links[k] ?? ''} onChange={e => onChange({ links: { ...form.links, [k]: e.target.value || undefined } })}
                disabled={k === 'source' && !form.openSource} className={`${inputCls} disabled:opacity-40`} placeholder={k === 'source' && !form.openSource ? 'Código cerrado' : ph} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
