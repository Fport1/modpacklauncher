import { useRef, useState } from 'react'
import { removeFile, updateProject, uploadImage, type Fport1Image, type Fport1Project } from '../../lib/fport1Content'
import { cleanErr, inputCls, labelCls } from './studioShared'

// Icono, portada y galería del proyecto. Cada cambio se guarda al momento.
// «Insertar en la descripción» pasa la imagen al editor para colocarla allí.

export default function ImagesTab({ project, flash, onChanged, onInsert }: {
  project: Fport1Project
  flash: (m: string) => void
  onChanged: () => void
  onInsert: (img: Fport1Image) => void
}) {
  const [busy, setBusy] = useState<'' | 'icon' | 'banner' | 'gallery'>('')
  const [edits, setEdits] = useState<Record<string, { title: string; description: string }>>({})
  const galleryRef = useRef<HTMLInputElement>(null)

  async function setSingle(kind: 'icon' | 'banner', f: File): Promise<void> {
    setBusy(kind)
    try {
      const old = kind === 'icon' ? project.iconPath : project.bannerPath
      const { url, path } = await uploadImage(project, kind, f)
      await updateProject(project.id, kind === 'icon' ? { iconUrl: url, iconPath: path } : { bannerUrl: url, bannerPath: path })
      // El icono antiguo de Storage se sobrescribía en la misma ruta; los de GitHub tienen nombre propio
      if (old && old !== path && old.startsWith('gh:')) await removeFile(old)
      onChanged()
    } catch (e) { flash(cleanErr(e) || 'No se pudo subir') }
    finally { setBusy('') }
  }

  async function removeBanner(): Promise<void> {
    if (project.bannerPath) await removeFile(project.bannerPath)
    await updateProject(project.id, { bannerUrl: null, bannerPath: '' }).catch(() => flash('No se pudo quitar'))
    onChanged()
  }

  async function addGallery(files: File[]): Promise<void> {
    setBusy('gallery')
    try {
      const added: Fport1Image[] = []
      for (const f of files) {
        const { url, path } = await uploadImage(project, 'gallery', f)
        added.push({ url, path, title: f.name.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ') })
      }
      await updateProject(project.id, { gallery: [...project.gallery, ...added] })
      onChanged()
    } catch (e) { flash(cleanErr(e) || 'No se pudo subir') }
    finally { setBusy('') }
  }

  async function setGallery(next: Fport1Image[], msg?: string): Promise<void> {
    try { await updateProject(project.id, { gallery: next }); onChanged(); if (msg) flash(msg) }
    catch { flash('No se pudo guardar') }
  }

  async function removeImage(i: number): Promise<void> {
    const g = project.gallery[i]
    if (project.description.includes(g.url) && !confirm('Esta imagen está puesta en la descripción. ¿Borrarla igualmente? (quedaría un hueco)')) return
    await removeFile(g.path)
    await setGallery(project.gallery.filter((_, k) => k !== i))
  }

  function move(i: number, d: -1 | 1): void {
    const g = [...project.gallery]
    const j = i + d
    if (j < 0 || j >= g.length) return
    ;[g[i], g[j]] = [g[j], g[i]]
    setGallery(g)
  }

  function saveText(i: number): void {
    const g = project.gallery[i]
    const e = edits[g.path]
    if (!e || (e.title === (g.title ?? '') && e.description === (g.description ?? ''))) return
    const next = project.gallery.map((x, k) => (k === i ? { ...x, title: e.title.trim() || undefined, description: e.description.trim() || undefined } : x))
    setGallery(next, 'Guardado')
  }

  const where = project.hosting === 'github' ? 'Se guardan en tu repositorio público de contenido de GitHub.' : 'Se guardan en Firebase Storage (proyecto antiguo).'

  return (
    <div className="max-w-4xl space-y-6">
      <p className="text-xs text-text-muted">{where}</p>

      <div className="grid grid-cols-[auto_1fr] gap-6">
        <div>
          <label className={labelCls}>Icono</label>
          <label className="relative block w-32 h-32 rounded-2xl bg-bg-hover overflow-hidden ring-1 ring-white/10 cursor-pointer group">
            {project.iconUrl ? <img src={project.iconUrl} alt="" className="w-full h-full object-cover" /> : <span className="w-full h-full flex items-center justify-center text-4xl">📦</span>}
            <span className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs text-white font-semibold">{busy === 'icon' ? 'Subiendo…' : 'Cambiar'}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { const f = e.target.files?.[0]; if (f) setSingle('icon', f); e.target.value = '' }} />
          </label>
          <p className="text-[11px] text-text-muted mt-1.5">Cuadrado, 256×256 o más</p>
        </div>
        <div>
          <label className={labelCls}>Portada (arriba de la ficha)</label>
          <label className="relative block w-full aspect-[4/1] rounded-2xl bg-bg-hover overflow-hidden ring-1 ring-white/10 cursor-pointer group">
            {project.bannerUrl ? <img src={project.bannerUrl} alt="" className="w-full h-full object-cover" /> : <span className="w-full h-full flex items-center justify-center text-sm text-text-muted">Sin portada · haz clic para subir una</span>}
            <span className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs text-white font-semibold">{busy === 'banner' ? 'Subiendo…' : project.bannerUrl ? 'Cambiar' : 'Subir'}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { const f = e.target.files?.[0]; if (f) setSingle('banner', f); e.target.value = '' }} />
          </label>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[11px] text-text-muted">Ancha, 1600×400 o parecido</p>
            {project.bannerUrl && <button onClick={removeBanner} className="text-[11px] text-red-300 hover:text-red-200">Quitar portada</button>}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-text-primary">Galería</p>
            <p className="text-[11px] text-text-muted">La primera es la destacada. Con las flechas cambias el orden; con «Insertar» la colocas en la descripción.</p>
          </div>
          <button onClick={() => galleryRef.current?.click()} disabled={!!busy} className="px-4 py-2.5 rounded-xl bg-[#a855f7] hover:bg-[#9333ea] disabled:opacity-50 text-white text-sm font-semibold">
            {busy === 'gallery' ? 'Subiendo…' : 'Añadir imágenes'}
          </button>
          <input ref={galleryRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { addGallery(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        </div>
        {project.gallery.length === 0 && <p className="text-center text-sm text-text-muted py-14 border border-dashed border-border rounded-2xl">Sin imágenes todavía</p>}
        <div className="grid grid-cols-2 gap-4">
          {project.gallery.map((g, i) => {
            const e = edits[g.path] ?? { title: g.title ?? '', description: g.description ?? '' }
            const used = project.description.includes(g.url)
            return (
              <div key={g.path} className="rounded-2xl bg-bg-card border border-border overflow-hidden">
                <div className="relative aspect-video bg-bg-hover">
                  <img src={g.url} alt="" className="w-full h-full object-cover" />
                  <div className="absolute top-2 left-2 flex gap-1">
                    {i === 0 && <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#a855f7] text-white font-bold">Destacada</span>}
                    {used && <span className="text-[10px] px-2 py-0.5 rounded-md bg-black/70 text-white">En la descripción</span>}
                  </div>
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button onClick={() => move(i, -1)} disabled={i === 0} title="Antes" className="w-7 h-7 rounded-md bg-black/60 text-white disabled:opacity-30">←</button>
                    <button onClick={() => move(i, 1)} disabled={i === project.gallery.length - 1} title="Después" className="w-7 h-7 rounded-md bg-black/60 text-white disabled:opacity-30">→</button>
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  <input value={e.title} onChange={ev => setEdits(s => ({ ...s, [g.path]: { ...e, title: ev.target.value } }))} onBlur={() => saveText(i)}
                    maxLength={80} className={inputCls} placeholder="Título" />
                  <input value={e.description} onChange={ev => setEdits(s => ({ ...s, [g.path]: { ...e, description: ev.target.value } }))} onBlur={() => saveText(i)}
                    maxLength={200} className={inputCls} placeholder="Descripción (opcional)" />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button onClick={() => onInsert({ ...g, title: e.title || g.title })} className="text-xs px-2.5 py-1.5 rounded-lg bg-[#a855f7]/20 text-[#e9d5ff] hover:bg-[#a855f7]/30">Insertar en la descripción</button>
                    {i > 0 && <button onClick={() => { const n = [...project.gallery]; const [x] = n.splice(i, 1); setGallery([x, ...n], 'Ahora es la destacada') }} className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-text-secondary hover:text-text-primary">Destacar</button>}
                    <span className="flex-1" />
                    <button onClick={() => removeImage(i)} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10">Borrar</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
