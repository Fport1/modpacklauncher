import { useEffect, useState } from 'react'
import { useStore } from '../store'

type AnnType = 'update' | 'info' | 'warning' | 'event' | 'sponsor'
interface Announcement {
  id: string; type: AnnType; title: string; summary: string
  date: string; imageUrl: string | null; linkUrl: string | null; linkLabel: string | null
  active?: boolean
}

const TYPE_OPTS: { value: AnnType; label: string; color: string }[] = [
  { value: 'update',  label: 'Actualización', color: 'bg-accent/20 text-accent' },
  { value: 'info',    label: 'Info',          color: 'bg-teal-500/20 text-teal-400' },
  { value: 'warning', label: 'Aviso',         color: 'bg-amber-500/20 text-amber-400' },
  { value: 'event',   label: 'Evento',        color: 'bg-purple-500/20 text-purple-400' },
  { value: 'sponsor', label: 'Patrocinador',  color: 'bg-emerald-500/20 text-emerald-400' },
]

function typeColor(t: AnnType) {
  return TYPE_OPTS.find(o => o.value === t)?.color ?? 'bg-border text-text-muted'
}

function emptyAnn(): Announcement {
  return {
    id: '', type: 'info', title: '', summary: '',
    date: new Date().toISOString().slice(0, 10),
    imageUrl: null, linkUrl: null, linkLabel: null
  }
}

function AnnForm({
  initial, onSave, onCancel
}: { initial: Announcement; onSave: (a: Announcement) => void; onCancel: () => void }) {
  const [form, setForm] = useState<Announcement>(initial)
  const set = (k: keyof Announcement, v: string | null) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-5 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">ID único</label>
          <input value={form.id} onChange={e => set('id', e.target.value)}
            className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent font-mono"
            placeholder="mi-anuncio-2025" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Tipo</label>
          <select value={form.type} onChange={e => set('type', e.target.value)}
            className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent">
            {TYPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-text-muted mb-1">Título</label>
        <input value={form.title} onChange={e => set('title', e.target.value)}
          className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          placeholder="Título del anuncio" />
      </div>

      <div>
        <label className="block text-xs text-text-muted mb-1">Resumen</label>
        <textarea value={form.summary} onChange={e => set('summary', e.target.value)}
          rows={2}
          className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent resize-none"
          placeholder="Breve descripción" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Fecha</label>
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
            className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">URL imagen (opcional)</label>
          <input value={form.imageUrl ?? ''} onChange={e => set('imageUrl', e.target.value || null)}
            className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            placeholder="https://..." />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">URL del enlace (opcional)</label>
          <input value={form.linkUrl ?? ''} onChange={e => set('linkUrl', e.target.value || null)}
            className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            placeholder="https://..." />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Texto del enlace (opcional)</label>
          <input value={form.linkLabel ?? ''} onChange={e => set('linkLabel', e.target.value || null)}
            className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            placeholder="Ver más" />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={() => onSave(form)}
          disabled={!form.id.trim() || !form.title.trim()}
          className="px-4 py-1.5 bg-accent hover:bg-accent/90 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
          Guardar
        </button>
        <button onClick={onCancel}
          className="px-4 py-1.5 border border-border text-text-secondary hover:text-text-primary text-sm rounded-lg transition-colors">
          Cancelar
        </button>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const settings = useStore(s => s.settings)
  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [pubMsg, setPubMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    window.api.announcements.fetch()
      .then(data => { setItems(data as Announcement[]); setDirty(false) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function saveEdit(ann: Announcement) {
    if (isNew) {
      setItems(prev => [...prev, ann])
    } else {
      setItems(prev => prev.map(a => a.id === editing!.id ? ann : a))
    }
    setEditing(null)
    setIsNew(false)
    setDirty(true)
  }

  function deleteItem(id: string) {
    setItems(prev => prev.filter(a => a.id !== id))
    setDirty(true)
  }

  function startEdit(ann: Announcement) {
    setEditing(ann)
    setIsNew(false)
  }

  function startNew() {
    setEditing(emptyAnn())
    setIsNew(true)
  }

  async function publish() {
    if (!settings.githubToken) {
      setPubMsg({ ok: false, text: 'Configura el token de GitHub en Ajustes primero.' })
      return
    }
    setPublishing(true)
    setPubMsg(null)
    try {
      await window.api.admin.publishAnnouncements(items)
      setDirty(false)
      setPubMsg({ ok: true, text: '¡Publicado! Los cambios ya son visibles en el launcher.' })
    } catch (e: unknown) {
      setPubMsg({ ok: false, text: e instanceof Error ? e.message : 'Error al publicar' })
    } finally {
      setPublishing(false)
    }
  }

  function moveItem(idx: number, dir: -1 | 1) {
    const next = [...items]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    setItems(next)
    setDirty(true)
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Panel Admin</h1>
          <p className="text-xs text-text-muted mt-0.5">Gestiona los anuncios y patrocinadores del launcher</p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded-lg">Cambios sin publicar</span>}
          <button
            onClick={publish}
            disabled={publishing || !dirty}
            className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent/90 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {publishing ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.2" /><path d="M21 12a9 9 0 00-9-9" />
                </svg>
                Publicando...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                </svg>
                Publicar en GitHub
              </>
            )}
          </button>
        </div>
      </div>

      {pubMsg && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${pubMsg.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
          {pubMsg.text}
        </div>
      )}

      {!settings.githubToken && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-sm">
          Para publicar, configura el <strong>Token de GitHub</strong> en Ajustes → Creación de Modpacks.
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-14 bg-bg-card border border-border rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((ann, idx) => (
            <div key={ann.id}>
              <div className={`flex items-center gap-3 border rounded-xl px-4 py-3 transition-colors ${ann.active === false ? 'bg-bg-primary border-border/40 opacity-60' : 'bg-bg-card border-border hover:border-border/60'}`}>
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveItem(idx, -1)} disabled={idx === 0}
                    className="text-text-muted hover:text-text-primary disabled:opacity-20 transition-colors leading-none">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                  </button>
                  <button onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1}
                    className="text-text-muted hover:text-text-primary disabled:opacity-20 transition-colors leading-none">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${typeColor(ann.type)}`}>
                  {TYPE_OPTS.find(o => o.value === ann.type)?.label ?? ann.type}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{ann.title}</p>
                  <p className="text-xs text-text-muted truncate">
                    {ann.id} · {ann.date}
                    {ann.active === false && <span className="ml-2 text-amber-400/80">· oculto</span>}
                  </p>
                </div>
                <button
                  onClick={() => { setItems(prev => prev.map(a => a.id === ann.id ? { ...a, active: ann.active === false } : a)); setDirty(true) }}
                  title={ann.active === false ? 'Mostrar' : 'Ocultar'}
                  className={`p-1.5 transition-colors rounded-lg hover:bg-bg-hover ${ann.active === false ? 'text-amber-400 hover:text-amber-300' : 'text-text-muted hover:text-text-primary'}`}>
                  {ann.active === false ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
                <button onClick={() => startEdit(ann)}
                  className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-bg-hover">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button onClick={() => deleteItem(ann.id)}
                  className="p-1.5 text-text-muted hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                  </svg>
                </button>
              </div>
              {editing && !isNew && editing.id === ann.id && (
                <div className="mt-2">
                  <AnnForm initial={editing} onSave={saveEdit} onCancel={() => setEditing(null)} />
                </div>
              )}
            </div>
          ))}

          {items.length === 0 && (
            <div className="text-center py-10 border border-dashed border-border rounded-xl text-text-muted text-sm">
              Sin anuncios. Agrega uno con el botón de abajo.
            </div>
          )}

          {isNew && editing && (
            <div className="mt-2">
              <AnnForm initial={editing} onSave={saveEdit} onCancel={() => { setEditing(null); setIsNew(false) }} />
            </div>
          )}

          {!isNew && (
            <button onClick={startNew}
              className="w-full py-2.5 border border-dashed border-border rounded-xl text-sm text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors flex items-center justify-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Agregar anuncio / patrocinador
            </button>
          )}
        </div>
      )}
    </div>
  )
}
