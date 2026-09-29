import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import {
  createProject, deleteProject, deleteVersion, listAll, listVersions, publishVersion, removeFile, slugify, parseDependencies,
  updateProject, updateVersion, uploadFile, versionPublishedMs,
  type Channel, type Fport1Project, type Fport1Type, type Fport1Version, type ProjectInput
} from '../../lib/fport1Content'

// Panel de @fport1 para publicar sus creaciones en la fuente Fport1 de
// Explorar: ficha del proyecto, versiones (release/beta/alpha) y galería.

const TYPES: { key: Fport1Type; label: string; accept: string; hint: string }[] = [
  { key: 'modpack', label: 'Modpack', accept: '.fpack,.mrpack', hint: '.fpack (del launcher) o .mrpack' },
  { key: 'mod', label: 'Mod', accept: '.jar', hint: '.jar' },
  { key: 'resourcepack', label: 'Resource Pack', accept: '.zip', hint: '.zip' },
  { key: 'datapack', label: 'Data Pack', accept: '.zip', hint: '.zip' },
  { key: 'shader', label: 'Shader', accept: '.zip', hint: '.zip' },
  { key: 'plugin', label: 'Plugin', accept: '.jar', hint: '.jar (servidores Paper, Spigot, Velocity…)' },
]

const LOADERS: Record<Fport1Type, string[]> = {
  modpack: ['fabric', 'forge', 'neoforge', 'quilt', 'vanilla'],
  mod: ['fabric', 'forge', 'neoforge', 'quilt'],
  resourcepack: [],
  datapack: [],
  shader: ['iris', 'optifine', 'canvas', 'vanilla'],
  plugin: ['paper', 'spigot', 'bukkit', 'purpur', 'folia', 'velocity', 'bungeecord'],
}

const LOADER_NAMES: Record<string, string> = {
  fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', vanilla: 'Vanilla',
  iris: 'Iris', optifine: 'OptiFine', canvas: 'Canvas',
  paper: 'Paper', spigot: 'Spigot', bukkit: 'Bukkit', purpur: 'Purpur', folia: 'Folia', velocity: 'Velocity', bungeecord: 'BungeeCord',
}

const CHANNELS: { key: Channel; label: string; cls: string }[] = [
  { key: 'release', label: 'Release', cls: 'bg-green-500/15 text-green-300 border-green-500/40' },
  { key: 'beta', label: 'Beta', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  { key: 'alpha', label: 'Alpha', cls: 'bg-red-500/15 text-red-300 border-red-500/40' },
]

const SIDES = [
  { key: 'required', label: 'Necesario' },
  { key: 'optional', label: 'Opcional' },
  { key: 'unsupported', label: 'No hace falta' },
] as const

const inputCls = 'w-full bg-bg-primary border border-border focus:border-[#a855f7] rounded-xl px-3 py-2 text-sm text-text-primary outline-none transition-colors'
const labelCls = 'block text-xs font-semibold text-text-secondary mb-1.5'

function fmtSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function Chips({ options, value, onChange, names }: { options: string[]; value: string[]; onChange: (v: string[]) => void; names?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = value.includes(o)
        return (
          <button key={o} type="button" onClick={() => onChange(on ? value.filter(x => x !== o) : [...value, o])}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${on ? 'bg-[#a855f7]/25 border-[#a855f7]/60 text-[#e9d5ff]' : 'border-border text-text-secondary hover:bg-bg-hover'}`}>
            {on && '✓ '}{names?.[o] ?? o}
          </button>
        )
      })}
    </div>
  )
}

export default function Fport1Studio({ mcVersions, onClose, onChanged }: { mcVersions: string[]; onClose: () => void; onChanged: () => void }) {
  const [projects, setProjects] = useState<Fport1Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState('')

  const flash = (m: string): void => { setToast(m); setTimeout(() => setToast(t => (t === m ? '' : t)), 3000) }

  async function reload(selectId?: string): Promise<void> {
    setLoading(true); setError('')
    try {
      const list = await listAll()
      setProjects(list)
      if (selectId) setSelectedId(selectId)
      else if (!selectedId && list[0]) setSelectedId(list[0].id)
    } catch (e) {
      setError(/permission/i.test(String(e)) ? 'Firebase aún no permite publicar. Faltan las reglas de fport1_projects en fport1web.' : 'No se pudieron cargar tus creaciones')
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const selected = projects.find(p => p.id === selectedId) ?? null

  function changed(selectId?: string): void { reload(selectId); onChanged() }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="w-[1080px] max-w-full h-[88vh] bg-bg-secondary border border-border rounded-3xl shadow-2xl flex overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Lista de proyectos */}
        <aside className="w-72 shrink-0 border-r border-border flex flex-col bg-bg-primary/40">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-10 h-10 rounded-xl bg-[#a855f7]/20 text-[#c084fc] flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>
              </div>
              <div>
                <p className="text-base font-bold text-text-primary leading-tight">Mis creaciones</p>
                <p className="text-[11px] text-text-muted">Lo que publiques aquí aparece en Explorar › Fport1</p>
              </div>
            </div>
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
              <button key={p.id} onClick={() => setSelectedId(p.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors ${selectedId === p.id ? 'bg-[#a855f7]/15 ring-1 ring-[#a855f7]/40' : 'hover:bg-bg-hover'}`}>
                <div className="w-11 h-11 rounded-xl bg-bg-hover overflow-hidden shrink-0 flex items-center justify-center">
                  {p.iconUrl ? <img src={p.iconUrl} alt="" className="w-full h-full object-cover" /> : <span className="text-lg">📦</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary truncate">{p.title}</p>
                  <p className="text-[11px] text-text-muted truncate">
                    {TYPES.find(t => t.key === p.type)?.label} · {p.latestVersion ? `v${p.latestVersion.versionNumber}` : 'sin versiones'}
                  </p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${p.published ? 'bg-green-500/15 text-green-300' : 'bg-bg-hover text-text-muted'}`}>
                  {p.published ? 'Público' : 'Borrador'}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Detalle */}
        <section className="flex-1 flex flex-col min-w-0">
          <div className="h-14 shrink-0 flex items-center justify-end px-4 border-b border-border">
            <button onClick={onClose} className="w-9 h-9 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          {creating ? (
            <NewProject onCancel={() => setCreating(false)} onCreated={id => { setCreating(false); changed(id); flash('Proyecto creado (en borrador)') }} />
          ) : selected ? (
            <ProjectEditor key={selected.id} project={selected} mcVersions={mcVersions} flash={flash}
              onChanged={() => changed(selected.id)}
              onDeleted={() => { setSelectedId(null); changed(); flash('Proyecto eliminado') }} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-text-muted">Elige un proyecto o crea uno nuevo</div>
          )}
        </section>

        {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl bg-bg-card border border-border text-sm text-text-primary shadow-2xl">{toast}</div>}
      </div>
    </div>
  )
}

function NewProject({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<Fport1Type>('modpack')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function create(): Promise<void> {
    if (!title.trim()) { setErr('Ponle un nombre'); return }
    setBusy(true); setErr('')
    try {
      const input: ProjectInput = {
        title: title.trim(), slug: slugify(title), summary: summary.trim(), description: '', type,
        iconUrl: null, gallery: [], categories: [], clientSide: 'required', serverSide: type === 'mod' ? 'optional' : 'unsupported',
        published: false, featured: false,
      }
      onCreated(await createProject(input))
    } catch (e) {
      setErr(/permission/i.test(String(e)) ? 'Sin permiso: faltan las reglas de fport1_projects en fport1web.' : 'No se pudo crear')
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
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)} maxLength={80} className={inputCls} placeholder="Mi modpack increíble" />
          {title && <p className="text-[11px] text-text-muted mt-1">Identificador: {slugify(title)}</p>}
        </div>
        <div>
          <label className={labelCls}>Resumen (una línea)</label>
          <input value={summary} onChange={e => setSummary(e.target.value)} maxLength={160} className={inputCls} placeholder="Qué es y por qué vale la pena" />
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

type EditorTab = 'info' | 'versions' | 'gallery'

function ProjectEditor({ project, mcVersions, flash, onChanged, onDeleted }: {
  project: Fport1Project; mcVersions: string[]; flash: (m: string) => void; onChanged: () => void; onDeleted: () => void
}) {
  const [tab, setTab] = useState<EditorTab>('info')
  const [form, setForm] = useState({
    title: project.title, summary: project.summary, description: project.description,
    categories: project.categories.join(', '), clientSide: project.clientSide, serverSide: project.serverSide,
    featured: !!project.featured,
  })
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [iconBusy, setIconBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const iconRef = useRef<HTMLInputElement>(null)
  const dirty = form.title !== project.title || form.summary !== project.summary || form.description !== project.description ||
    form.categories !== project.categories.join(', ') || form.clientSide !== project.clientSide || form.serverSide !== project.serverSide ||
    form.featured !== !!project.featured

  async function save(): Promise<void> {
    setSaving(true)
    try {
      await updateProject(project.id, {
        title: form.title.trim() || project.title,
        summary: form.summary.trim(),
        description: form.description,
        categories: form.categories.split(',').map(c => c.trim().toLowerCase()).filter(Boolean),
        clientSide: form.clientSide, serverSide: form.serverSide, featured: form.featured,
      })
      onChanged(); flash('Guardado')
    } catch { flash('No se pudo guardar') }
    finally { setSaving(false) }
  }

  async function togglePublished(): Promise<void> {
    if (!project.published && !project.latestVersion) { flash('Sube al menos una versión antes de publicarlo'); setTab('versions'); return }
    try { await updateProject(project.id, { published: !project.published }); onChanged(); flash(project.published ? 'Ahora es un borrador' : '¡Publicado! Ya aparece en Explorar') }
    catch { flash('No se pudo cambiar') }
  }

  async function uploadIcon(f: File): Promise<void> {
    setIconBusy(true)
    try {
      const url = await uploadFile(`fport1/projects/${project.id}/icon`, f, f.type)
      await updateProject(project.id, { iconUrl: url })
      onChanged()
    } catch { flash('No se pudo subir el icono') }
    finally { setIconBusy(false) }
  }

  const bodyHtml = useMemo(() => (preview ? String(marked.parse(form.description || '*Sin descripción*')) : ''), [preview, form.description])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Cabecera del proyecto */}
      <div className="px-6 pt-5 pb-0 border-b border-border">
        <div className="flex items-center gap-4 mb-4">
          <button onClick={() => iconRef.current?.click()} title="Cambiar icono"
            className="relative w-20 h-20 rounded-2xl bg-bg-hover overflow-hidden shrink-0 group ring-1 ring-white/10">
            {project.iconUrl ? <img src={project.iconUrl} alt="" className="w-full h-full object-cover" /> : <span className="text-3xl">📦</span>}
            <span className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs text-white font-semibold">
              {iconBusy ? 'Subiendo…' : 'Cambiar'}
            </span>
          </button>
          <input ref={iconRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadIcon(f); e.target.value = '' }} />
          <div className="flex-1 min-w-0">
            <p className="text-xl font-bold text-text-primary truncate">{project.title}</p>
            <p className="text-sm text-text-muted">
              {TYPES.find(t => t.key === project.type)?.label} · {project.downloads.toLocaleString('es')} descargas
              {project.latestVersion && <> · última v{project.latestVersion.versionNumber}</>}
            </p>
          </div>
          <button onClick={togglePublished}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${project.published ? 'border border-border text-text-secondary hover:text-text-primary' : 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-600/25'}`}>
            {project.published ? 'Pasar a borrador' : 'Publicar'}
          </button>
        </div>
        <div className="flex gap-1">
          {([['info', 'Ficha'], ['versions', 'Versiones'], ['gallery', `Galería${project.gallery.length ? ` (${project.gallery.length})` : ''}`]] as [EditorTab, string][]).map(([k, l]) => (
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Nombre</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} maxLength={80} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Categorías (separadas por comas)</label>
                <input value={form.categories} onChange={e => setForm(f => ({ ...f, categories: e.target.value }))} className={inputCls} placeholder="adventure, magic, technology" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Resumen</label>
              <input value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} maxLength={160} className={inputCls} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-text-secondary">Descripción (Markdown)</label>
                <button onClick={() => setPreview(p => !p)} className="text-xs text-[#c084fc] hover:underline">{preview ? 'Editar' : 'Vista previa'}</button>
              </div>
              {preview ? (
                <div className="modrinth-body min-h-[260px] rounded-xl border border-border bg-bg-primary p-4" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
              ) : (
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={12}
                  className={`${inputCls} font-mono text-[13px] leading-relaxed resize-y`} placeholder={'## Qué incluye\n\n- ...'} />
              )}
            </div>
            {(project.type === 'mod' || project.type === 'modpack') && (
              <div className="grid grid-cols-2 gap-4">
                {(['clientSide', 'serverSide'] as const).map(k => (
                  <div key={k}>
                    <label className={labelCls}>{k === 'clientSide' ? 'En el cliente' : 'En el servidor'}</label>
                    <div className="flex gap-1.5">
                      {SIDES.map(sd => (
                        <button key={sd.key} onClick={() => setForm(f => ({ ...f, [k]: sd.key }))}
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
              <input type="checkbox" checked={form.featured} onChange={e => setForm(f => ({ ...f, featured: e.target.checked }))} className="accent-[#a855f7] w-4 h-4" />
              Destacado (sale primero en la lista)
            </label>
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-300 hover:text-red-200">Eliminar proyecto</button>
              <button onClick={save} disabled={!dirty || saving}
                className="px-5 py-2.5 rounded-xl bg-[#a855f7] hover:bg-[#9333ea] disabled:opacity-40 text-white text-sm font-semibold">
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        )}

        {tab === 'versions' && <VersionsTab project={project} mcVersions={mcVersions} flash={flash} onChanged={onChanged} />}
        {tab === 'gallery' && <GalleryTab project={project} flash={flash} onChanged={onChanged} />}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center" onClick={() => setConfirmDelete(false)}>
          <div className="w-[380px] rounded-2xl bg-bg-secondary border border-border p-5" onClick={e => e.stopPropagation()}>
            <p className="text-base font-semibold text-text-primary">¿Eliminar «{project.title}»?</p>
            <p className="text-sm text-text-muted mt-1.5">Se borran todas sus versiones y archivos. Quien ya lo instaló lo conserva.</p>
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

function VersionsTab({ project, mcVersions, flash, onChanged }: { project: Fport1Project; mcVersions: string[]; flash: (m: string) => void; onChanged: () => void }) {
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

  if (adding) {
    return <NewVersionForm project={project} mcVersions={mcVersions} last={versions[0]}
      onCancel={() => setAdding(false)} onDone={() => { setAdding(false); after('Versión publicada') }} />
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-muted">{versions.length} {versions.length === 1 ? 'versión' : 'versiones'}</p>
        <button onClick={() => setAdding(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#a855f7] hover:bg-[#9333ea] text-white text-sm font-semibold shadow-lg shadow-[#a855f7]/25">
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
                <button onClick={() => { if (confirm(`¿Borrar la versión ${v.versionNumber}?`)) deleteVersion(project.id, v).then(() => after('Versión borrada')).catch(() => flash('No se pudo borrar')) }}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10">Borrar</button>
              </div>
              {v.files.map(f => (
                <p key={f.path} className="mt-2 text-xs text-text-muted flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-bg-hover font-mono">{f.filename}</span>{fmtSize(f.size)}
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
  const [reqDeps, setReqDeps] = useState((last?.dependencies ?? []).filter(d => d.type === 'required').map(d => (d.source === 'modrinth' ? '' : d.source === 'curseforge' ? 'cf:' : 'f1:') + d.projectId).join(', '))
  const [optDeps, setOptDeps] = useState((last?.dependencies ?? []).filter(d => d.type === 'optional').map(d => (d.source === 'modrinth' ? '' : d.source === 'curseforge' ? 'cf:' : 'f1:') + d.projectId).join(', '))
  const [progress, setProgress] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const allVersions = [...new Set([...gameVersions, ...mcVersions])].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

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
      await publishVersion(project.id, {
        name: name.trim() || versionNumber.trim(), versionNumber: versionNumber.trim(), channel,
        loaders, gameVersions, changelog,
        dependencies: [...parseDependencies(reqDeps, 'required'), ...parseDependencies(optDeps, 'optional')],
      }, file, setProgress)
      onDone()
    } catch (e) {
      setProgress(null)
      setErr(/permission|unauthorized/i.test(String(e)) ? 'Sin permiso para subir: faltan las reglas de Storage/Firestore de fport1 en fport1web.' : 'No se pudo subir la versión')
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
        <p className="text-[11px] text-text-muted mt-1.5">Release es la estable; beta y alpha salen marcadas como pruebas.</p>
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
        <label className={labelCls}>Notas de la versión</label>
        <textarea value={changelog} onChange={e => setChangelog(e.target.value)} rows={5} className={`${inputCls} resize-y`} placeholder="- Nuevo: ...&#10;- Arreglado: ..." />
      </div>

      {err && <p className="text-sm text-red-300">{err}</p>}

      {progress !== null ? (
        <div>
          <div className="h-2.5 rounded-full bg-bg-hover overflow-hidden">
            <div className="h-full bg-[#a855f7] transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="text-xs text-text-muted mt-1.5">Subiendo… {Math.round(progress * 100)}%</p>
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

function GalleryTab({ project, flash, onChanged }: { project: Fport1Project; flash: (m: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  async function add(files: File[]): Promise<void> {
    setBusy(true)
    try {
      const added: Fport1Project['gallery'] = []
      for (const f of files) {
        const path = `fport1/projects/${project.id}/gallery/${Date.now()}-${f.name.replace(/[^\w.-]+/g, '_')}`
        added.push({ url: await uploadFile(path, f, f.type), path })
      }
      await updateProject(project.id, { gallery: [...project.gallery, ...added] })
      onChanged()
    } catch { flash('No se pudo subir') }
    finally { setBusy(false) }
  }

  async function remove(i: number): Promise<void> {
    const g = project.gallery[i]
    try {
      await removeFile(g.path)
      await updateProject(project.id, { gallery: project.gallery.filter((_, k) => k !== i) })
      onChanged()
    } catch { flash('No se pudo borrar') }
  }

  async function makeFirst(i: number): Promise<void> {
    const g = [...project.gallery]
    const [item] = g.splice(i, 1)
    await updateProject(project.id, { gallery: [item, ...g] }).catch(() => flash('No se pudo cambiar'))
    onChanged()
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-muted">La primera imagen es la destacada</p>
        <button onClick={() => ref.current?.click()} disabled={busy} className="px-4 py-2.5 rounded-xl bg-[#a855f7] hover:bg-[#9333ea] disabled:opacity-50 text-white text-sm font-semibold">
          {busy ? 'Subiendo…' : 'Añadir imágenes'}
        </button>
        <input ref={ref} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { add(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      </div>
      {project.gallery.length === 0 && <p className="text-center text-sm text-text-muted py-14 border border-dashed border-border rounded-2xl">Sin imágenes todavía</p>}
      <div className="grid grid-cols-3 gap-3">
        {project.gallery.map((g, i) => (
          <div key={g.path} className="relative group aspect-video rounded-xl overflow-hidden bg-bg-hover ring-1 ring-white/5">
            <img src={g.url} alt="" className="w-full h-full object-cover" />
            {i === 0 && <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-md bg-[#a855f7] text-white font-bold">Destacada</span>}
            <div className="absolute inset-x-0 bottom-0 p-2 flex justify-end gap-1.5 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              {i > 0 && <button onClick={() => makeFirst(i)} className="text-[11px] px-2 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white">Destacar</button>}
              <button onClick={() => remove(i)} className="text-[11px] px-2 py-1 rounded-md bg-red-600/80 hover:bg-red-600 text-white">Borrar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
