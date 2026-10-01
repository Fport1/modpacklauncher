import { useEffect, useState } from 'react'
import {
  createProject, deleteProject, listAll, slugify, updateProject, uploadImage,
  type Fport1Image, type Fport1Project, type Fport1Type, type ProjectInput
} from '../../lib/fport1Content'
import GithubConnect, { GithubLogo, useGithubStatus } from './GithubConnect'
import MarkdownEditor, { imageSnippet } from './MarkdownEditor'
import ImagesTab from './ImagesTab'
import CodeTab, { type CodeForm } from './CodeTab'
import VersionsTab from './VersionsTab'
import { CLOSED_LICENSES, OPEN_LICENSES, SIDES, TYPES, TagInput, cleanErr, inputCls, labelCls } from './studioShared'

// Panel de @fport1 para publicar sus creaciones en la fuente Fport1 de
// Explorar (y en fport1web, que lee el mismo catálogo). Solo se abre con la
// cuenta de GitHub conectada: las versiones van a GitHub Releases y las
// imágenes a su repo público de contenido. El catálogo sigue en Firestore.

export default function Fport1Studio({ mcVersions, onClose, onChanged }: { mcVersions: string[]; onClose: () => void; onChanged: () => void }) {
  const [github, setGithub] = useGithubStatus()
  const [projects, setProjects] = useState<Fport1Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState('')

  const flash = (m: string): void => { setToast(m); setTimeout(() => setToast(t => (t === m ? '' : t)), 3500) }

  async function reload(selectId?: string): Promise<void> {
    setLoading(true); setError('')
    try {
      const list = await listAll()
      setProjects(list)
      if (selectId) setSelectedId(selectId)
      else if (!selectedId && list[0]) setSelectedId(list[0].id)
    } catch (e) {
      setError(/permission/i.test(String(e)) ? 'Firebase no permite publicar con esta cuenta de fport1social.' : 'No se pudieron cargar tus creaciones')
    } finally { setLoading(false) }
  }
  useEffect(() => { if (github?.connected) reload() }, [github?.connected]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const selected = projects.find(p => p.id === selectedId) ?? null
  function changed(selectId?: string): void { reload(selectId); onChanged() }

  const closeBtn = (
    <button onClick={onClose} className="w-9 h-9 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="w-[1180px] max-w-full h-[90vh] bg-bg-secondary border border-border rounded-3xl shadow-2xl flex overflow-hidden" onClick={e => e.stopPropagation()}>
        {github && !github.connected ? (
          // Sin GitHub no hay panel: solo la forma de conectarlo
          <div className="flex-1 flex flex-col">
            <div className="h-14 shrink-0 flex items-center justify-end px-4">{closeBtn}</div>
            <div className="flex-1 overflow-y-auto flex items-start justify-center p-8">
              <div className="max-w-lg w-full space-y-4">
                <div className="text-center">
                  <GithubLogo className="w-12 h-12 mx-auto text-text-primary" />
                  <h2 className="text-xl font-bold text-text-primary mt-3">Conecta GitHub para publicar</h2>
                  <p className="text-sm text-text-muted mt-1">Tus creaciones se publican en GitHub: las versiones en GitHub Releases y las imágenes en un repositorio público. Descargarlas no cuesta nada, y el catálogo sigue apareciendo en Explorar y en la web.</p>
                </div>
                <GithubConnect status={github} onChange={setGithub} />
              </div>
            </div>
          </div>
        ) : (
          <>
            <aside className="w-72 shrink-0 border-r border-border flex flex-col bg-bg-primary/40">
              <div className="p-4 border-b border-border space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-[#a855f7]/20 text-[#c084fc] flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>
                  </div>
                  <div>
                    <p className="text-base font-bold text-text-primary leading-tight">Mis creaciones</p>
                    <p className="text-[11px] text-text-muted">Explorar › Fport1 y la web</p>
                  </div>
                </div>
                {github && <div className="px-2.5 py-2 rounded-xl bg-bg-card border border-border"><GithubConnect status={github} onChange={setGithub} compact /></div>}
                <button onClick={() => setCreating(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#a855f7] hover:bg-[#9333ea] text-white text-sm font-semibold transition-colors shadow-lg shadow-[#a855f7]/25">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                  Nuevo proyecto
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {loading && <p className="text-center text-sm text-text-muted py-8">Cargando…</p>}
                {error && <p className="text-sm text-red-300 p-3">{error}</p>}
                {!loading && !error && projects.length === 0 && <p className="text-center text-sm text-text-muted py-8 px-4">Todavía no has creado nada. Empieza con «Nuevo proyecto».</p>}
                {projects.map(p => (
                  <button key={p.id} onClick={() => { setSelectedId(p.id); setCreating(false) }}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors ${selectedId === p.id && !creating ? 'bg-[#a855f7]/15 ring-1 ring-[#a855f7]/40' : 'hover:bg-bg-hover'}`}>
                    <div className="w-11 h-11 rounded-xl bg-bg-hover overflow-hidden shrink-0 flex items-center justify-center">
                      {p.iconUrl ? <img src={p.iconUrl} alt="" className="w-full h-full object-cover" /> : <span className="text-lg">📦</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-text-primary truncate">{p.title}</p>
                      <p className="text-[11px] text-text-muted truncate">
                        {TYPES.find(t => t.key === p.type)?.label} · {p.latestVersion ? `v${p.latestVersion.versionNumber}` : 'sin versiones'}{p.hosting === 'github' ? ' · GitHub' : ''}
                      </p>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${p.published ? 'bg-green-500/15 text-green-300' : 'bg-bg-hover text-text-muted'}`}>
                      {p.published ? 'Público' : 'Borrador'}
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            <section className="flex-1 flex flex-col min-w-0">
              <div className="h-14 shrink-0 flex items-center justify-end px-4 border-b border-border">{closeBtn}</div>
              {creating ? (
                <NewProject onCancel={() => setCreating(false)} onCreated={id => { setCreating(false); changed(id); flash('Proyecto creado (en borrador)') }} />
              ) : selected && github ? (
                <ProjectEditor key={selected.id} project={selected} mcVersions={mcVersions} flash={flash} github={github}
                  onChanged={() => changed(selected.id)}
                  onDeleted={() => { setSelectedId(null); changed(); flash('Proyecto eliminado') }} />
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-text-muted">{github ? 'Elige un proyecto o crea uno nuevo' : 'Comprobando GitHub…'}</div>
              )}
            </section>
          </>
        )}
        {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl bg-bg-card border border-border text-sm text-text-primary shadow-2xl max-w-xl">{toast}</div>}
      </div>
    </div>
  )
}

function NewProject({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<Fport1Type>('mod')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [openSource, setOpenSource] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function create(): Promise<void> {
    if (!title.trim()) { setErr('Ponle un nombre'); return }
    setBusy(true); setErr('')
    try {
      const input: ProjectInput = {
        title: title.trim(), slug: slugify(title), summary: summary.trim(), description: '', type,
        iconUrl: null, gallery: [], categories: [], tags, clientSide: 'required', serverSide: type === 'mod' ? 'optional' : 'unsupported',
        published: false, featured: false, hosting: 'github', openSource, license: openSource ? OPEN_LICENSES[0] : CLOSED_LICENSES[0],
        links: {}, github: {},
      }
      onCreated(await createProject(input))
    } catch (e) {
      setErr(/permission/i.test(String(e)) ? 'Sin permiso para crear en el catálogo.' : cleanErr(e) || 'No se pudo crear')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-xl mx-auto space-y-5">
        <h2 className="text-xl font-bold text-text-primary">Nuevo proyecto</h2>
        <div>
          <label className={labelCls}>Tipo</label>
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map(t => (
              <button key={t.key} onClick={() => setType(t.key)}
                className={`py-3 rounded-xl border text-sm font-medium transition-colors ${type === t.key ? 'bg-[#a855f7]/20 border-[#a855f7]/60 text-[#e9d5ff]' : 'border-border text-text-secondary hover:bg-bg-hover'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>Nombre</label>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)} maxLength={80} className={inputCls} placeholder="Mi mod increíble" />
          {title && <p className="text-[11px] text-text-muted mt-1">Identificador: {slugify(title)}</p>}
        </div>
        <div>
          <label className={labelCls}>Resumen (una línea)</label>
          <input value={summary} onChange={e => setSummary(e.target.value)} maxLength={160} className={inputCls} placeholder="Qué es y por qué vale la pena" />
        </div>
        <div>
          <label className={labelCls}>Etiquetas</label>
          <TagInput value={tags} onChange={setTags} placeholder="aventura, magia… (Enter para añadir)" />
        </div>
        <div>
          <label className={labelCls}>Código</label>
          <div className="grid grid-cols-2 gap-2">
            {([[true, 'Abierto', 'Repo público con el código'], [false, 'Cerrado', 'Solo se publican los archivos']] as const).map(([v, l, h]) => (
              <button key={l} onClick={() => setOpenSource(v)}
                className={`p-3 rounded-xl border text-left ${openSource === v ? 'bg-[#a855f7]/20 border-[#a855f7]/60' : 'border-border hover:bg-bg-hover'}`}>
                <p className="text-sm font-semibold text-text-primary">{l}</p>
                <p className="text-[11px] text-text-muted">{h}</p>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-text-muted mt-1.5">El repo, la licencia y los enlaces se eligen después, en «Código y GitHub».</p>
        </div>
        {err && <p className="text-sm text-red-300">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
          <button onClick={create} disabled={busy} className="px-5 py-2.5 rounded-xl bg-[#a855f7] hover:bg-[#9333ea] disabled:opacity-50 text-white text-sm font-semibold">
            {busy ? 'Creando…' : 'Crear borrador'}
          </button>
        </div>
      </div>
    </div>
  )
}

type EditorTab = 'info' | 'description' | 'images' | 'code' | 'versions'

interface Form extends CodeForm {
  title: string
  summary: string
  description: string
  categories: string
  tags: string[]
  clientSide: Fport1Project['clientSide']
  serverSide: Fport1Project['serverSide']
  featured: boolean
}

function formOf(p: Fport1Project): Form {
  return {
    title: p.title, summary: p.summary, description: p.description, categories: p.categories.join(', '), tags: p.tags,
    clientSide: p.clientSide, serverSide: p.serverSide, featured: !!p.featured,
    openSource: p.openSource ?? false, license: p.license ?? null, github: p.github ?? {}, links: p.links ?? {}, hosting: p.hosting ?? 'storage',
  }
}

function ProjectEditor({ project, mcVersions, flash, github, onChanged, onDeleted }: {
  project: Fport1Project; mcVersions: string[]; flash: (m: string) => void; github: NonNullable<ReturnType<typeof useGithubStatus>[0]>
  onChanged: () => void; onDeleted: () => void
}) {
  const [tab, setTab] = useState<EditorTab>('info')
  const [base, setBase] = useState(() => formOf(project))
  const [form, setForm] = useState(base)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(base)
  const set = (patch: Partial<Form>): void => setForm(f => ({ ...f, ...patch }))

  // Cuando el proyecto cambia fuera del formulario (imágenes, versiones), se respeta lo que se está editando
  useEffect(() => {
    const fresh = formOf(project)
    setBase(fresh)
    setForm(f => (JSON.stringify(f) === JSON.stringify(base) ? fresh : f))
  }, [project]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(): Promise<void> {
    setSaving(true)
    try {
      const gh = form.github
      const releasesRepo = form.openSource && gh.sourceRepo && !gh.sourcePrivate ? gh.sourceRepo : ''
      const categories = form.categories.split(',').map(c => c.trim().toLowerCase()).filter(Boolean)
      await updateProject(project.id, {
        title: form.title.trim() || project.title, summary: form.summary.trim(), description: form.description,
        categories, tags: form.tags, clientSide: form.clientSide, serverSide: form.serverSide, featured: form.featured,
        openSource: form.openSource, license: form.license, links: Object.fromEntries(Object.entries(form.links).filter(([, v]) => v)),
        hosting: form.hosting, github: { ...(gh.sourceRepo ? { sourceRepo: gh.sourceRepo, sourcePrivate: !!gh.sourcePrivate } : {}), releasesRepo },
      })
      // El repo del código lleva el mismo resumen y etiquetas que la ficha
      if (gh.sourceRepo && github.connected) {
        await window.api.github.updateRepo(gh.sourceRepo, {
          description: form.summary.trim(), homepage: form.links.website || undefined,
          topics: [...form.tags, ...categories, project.type, ...project.loaders, 'minecraft'],
        }).catch(e => flash(`Guardado, pero no se pudo actualizar el repo: ${cleanErr(e)}`))
      }
      setBase(form)
      onChanged(); flash('Guardado')
    } catch (e) { flash(cleanErr(e) || 'No se pudo guardar') }
    finally { setSaving(false) }
  }

  async function togglePublished(): Promise<void> {
    if (!project.published && !project.latestVersion) { flash('Sube al menos una versión antes de publicarlo'); setTab('versions'); return }
    try { await updateProject(project.id, { published: !project.published }); onChanged(); flash(project.published ? 'Ahora es un borrador' : '¡Publicado! Ya aparece en Explorar y en la web') }
    catch { flash('No se pudo cambiar') }
  }

  /** Imagen subida desde el editor de descripción: va también a la galería. */
  async function uploadForDescription(f: File): Promise<Fport1Image | null> {
    try {
      const { url, path } = await uploadImage({ ...project, hosting: form.hosting }, 'gallery', f)
      const img: Fport1Image = { url, path, title: f.name.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ') }
      await updateProject(project.id, { gallery: [...project.gallery, img] })
      onChanged()
      return img
    } catch (e) { flash(cleanErr(e) || 'No se pudo subir'); return null }
  }

  const tabs: [EditorTab, string][] = [
    ['info', 'Ficha'], ['description', 'Descripción'], ['images', `Imágenes${project.gallery.length ? ` (${project.gallery.length})` : ''}`],
    ['code', 'Código y GitHub'], ['versions', 'Versiones'],
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 pt-5 pb-0 border-b border-border">
        {project.bannerUrl && <div className="h-20 -mt-5 -mx-6 mb-4 overflow-hidden"><img src={project.bannerUrl} alt="" className="w-full h-full object-cover opacity-70" /></div>}
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-2xl bg-bg-hover overflow-hidden shrink-0 ring-1 ring-white/10 flex items-center justify-center">
            {project.iconUrl ? <img src={project.iconUrl} alt="" className="w-full h-full object-cover" /> : <span className="text-3xl">📦</span>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xl font-bold text-text-primary truncate">{project.title}</p>
            <p className="text-sm text-text-muted truncate">
              {TYPES.find(t => t.key === project.type)?.label} · {project.downloads.toLocaleString('es')} descargas
              {project.latestVersion && <> · última v{project.latestVersion.versionNumber}</>}
              {' · '}{project.openSource ? 'Código abierto' : 'Código cerrado'}{project.license ? ` · ${project.license.name || project.license.id}` : ''}
            </p>
          </div>
          <button onClick={togglePublished}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${project.published ? 'border border-border text-text-secondary hover:text-text-primary' : 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-600/25'}`}>
            {project.published ? 'Pasar a borrador' : 'Publicar'}
          </button>
        </div>
        <div className="flex gap-1">
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === k ? 'border-[#a855f7] text-[#d8b4fe]' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'info' && (
          <div className="max-w-3xl space-y-4">
            <div>
              <label className={labelCls}>Nombre</label>
              <input value={form.title} onChange={e => set({ title: e.target.value })} maxLength={80} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Resumen (sale en la lista y en GitHub)</label>
              <input value={form.summary} onChange={e => set({ summary: e.target.value })} maxLength={160} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Etiquetas</label>
                <TagInput value={form.tags} onChange={tags => set({ tags })} placeholder="Enter para añadir" />
              </div>
              <div>
                <label className={labelCls}>Categorías de Explorar (separadas por comas)</label>
                <input value={form.categories} onChange={e => set({ categories: e.target.value })} className={inputCls} placeholder="adventure, magic, technology" />
              </div>
            </div>
            {(project.type === 'mod' || project.type === 'modpack') && (
              <div className="grid grid-cols-2 gap-4">
                {(['clientSide', 'serverSide'] as const).map(k => (
                  <div key={k}>
                    <label className={labelCls}>{k === 'clientSide' ? 'En el cliente' : 'En el servidor'}</label>
                    <div className="flex gap-1.5">
                      {SIDES.map(sd => (
                        <button key={sd.key} onClick={() => set({ [k]: sd.key })}
                          className={`flex-1 py-2 rounded-lg text-xs border transition-colors ${form[k] === sd.key ? 'bg-[#a855f7]/20 border-[#a855f7]/60 text-[#e9d5ff]' : 'border-border text-text-secondary hover:bg-bg-hover'}`}>
                          {sd.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2.5 text-sm text-text-secondary cursor-pointer">
              <input type="checkbox" checked={form.featured} onChange={e => set({ featured: e.target.checked })} className="accent-[#a855f7] w-4 h-4" />
              Destacado (sale primero en la lista)
            </label>
            <div className="pt-3 border-t border-border">
              <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-300 hover:text-red-200">Eliminar proyecto</button>
            </div>
          </div>
        )}
        {tab === 'description' && (
          <div className="max-w-6xl">
            <MarkdownEditor value={form.description} onChange={description => set({ description })} gallery={project.gallery} onUploadImage={uploadForDescription} />
          </div>
        )}
        {tab === 'images' && (
          <ImagesTab project={{ ...project, hosting: form.hosting }} flash={flash} onChanged={onChanged}
            onInsert={img => { set({ description: `${form.description.replace(/\s+$/, '')}${form.description.trim() ? '\n\n' : ''}${imageSnippet(img, 'center', 600)}\n` }); setTab('description'); flash('Imagen añadida al final de la descripción: muévela donde quieras') }} />
        )}
        {tab === 'code' && <CodeTab project={project} form={form} onChange={set} github={github} />}
        {tab === 'versions' && <VersionsTab project={project} mcVersions={mcVersions} flash={flash} onChanged={onChanged} dirty={dirty} />}
      </div>

      {(dirty || saving) && tab !== 'versions' && (
        <div className="shrink-0 px-6 py-3 border-t border-border bg-bg-primary/60 flex items-center justify-end gap-3">
          <span className="text-xs text-amber-300 mr-auto">Cambios sin guardar</span>
          <button onClick={() => setForm(base)} disabled={saving} className="px-4 py-2 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary">Descartar</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 rounded-xl bg-[#a855f7] hover:bg-[#9333ea] disabled:opacity-40 text-white text-sm font-semibold">
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center" onClick={() => setConfirmDelete(false)}>
          <div className="w-[400px] rounded-2xl bg-bg-secondary border border-border p-5" onClick={e => e.stopPropagation()}>
            <p className="text-base font-semibold text-text-primary">¿Eliminar «{project.title}»?</p>
            <p className="text-sm text-text-muted mt-1.5">Se borran todas sus versiones (y sus releases de GitHub) y sus imágenes. El repositorio del código no se toca. Quien ya lo instaló lo conserva.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(false)} className="px-4 py-2 rounded-xl border border-border text-sm text-text-secondary">Cancelar</button>
              <button onClick={async () => { setConfirmDelete(false); try { await deleteProject(project); onDeleted() } catch { flash('No se pudo eliminar') } }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-sm text-white font-semibold">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
