import { useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import type { Fport1Image } from '../../lib/fport1Content'
import { inputCls } from './studioShared'

// Descripción en Markdown con barra de formato y vista previa al lado.
// Las imágenes de la galería se colocan donde esté el cursor, con su tamaño y
// alineación (en HTML, que tanto el launcher como la web muestran igual).

type Placement = 'full' | 'center' | 'left' | 'right'

const PLACEMENTS: { key: Placement; label: string; hint: string }[] = [
  { key: 'full', label: 'A todo el ancho', hint: 'Ocupa toda la columna' },
  { key: 'center', label: 'Centrada', hint: 'Centrada, con el ancho que elijas' },
  { key: 'left', label: 'A la izquierda', hint: 'El texto la rodea por la derecha' },
  { key: 'right', label: 'A la derecha', hint: 'El texto la rodea por la izquierda' },
]

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Markdown/HTML que coloca una imagen en la descripción. */
export function imageSnippet(img: { url: string; title?: string }, placement: Placement, width: number): string {
  const alt = esc(img.title ?? '')
  if (placement === 'full') return `![${(img.title ?? '').replace(/[[\]]/g, '')}](${img.url})`
  if (placement === 'center') return `<p align="center"><img src="${img.url}" alt="${alt}" width="${width}"></p>`
  return `<img src="${img.url}" alt="${alt}" width="${width}" align="${placement}">`
}

export default function MarkdownEditor({ value, onChange, gallery, onUploadImage }: {
  value: string
  onChange: (v: string) => void
  gallery: Fport1Image[]
  /** Sube una imagen nueva a la galería y la devuelve */
  onUploadImage: (f: File) => Promise<Fport1Image | null>
}) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const [split, setSplit] = useState(true)
  const [picker, setPicker] = useState(false)
  const [placement, setPlacement] = useState<Placement>('center')
  const [width, setWidth] = useState(600)
  const [uploading, setUploading] = useState(false)
  const html = useMemo(() => String(marked.parse(value || '*Sin descripción todavía*')), [value])

  /** Rodea la selección (o inserta en el cursor) y deja seleccionado lo nuevo. */
  function wrap(before: string, after = '', placeholder = ''): void {
    const el = ta.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    const sel = value.slice(s, e) || placeholder
    const next = value.slice(0, s) + before + sel + after + value.slice(e)
    onChange(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + before.length, s + before.length + sel.length) })
  }

  /** Pone un prefijo al principio de cada línea seleccionada. */
  function linePrefix(prefix: string | ((i: number) => string)): void {
    const el = ta.current
    if (!el) return
    const s = value.lastIndexOf('\n', el.selectionStart - 1) + 1
    const eRaw = value.indexOf('\n', el.selectionEnd)
    const e = eRaw === -1 ? value.length : eRaw
    const lines = value.slice(s, e).split('\n').map((l, i) => (typeof prefix === 'string' ? prefix : prefix(i)) + l)
    onChange(value.slice(0, s) + lines.join('\n') + value.slice(e))
    requestAnimationFrame(() => el.focus())
  }

  function insertBlock(text: string): void {
    const el = ta.current
    const pos = el ? el.selectionStart : value.length
    const pre = value.slice(0, pos), post = value.slice(pos)
    const block = `${pre && !pre.endsWith('\n\n') ? (pre.endsWith('\n') ? '\n' : '\n\n') : ''}${text}\n\n`
    onChange(pre + block + post.replace(/^\n+/, ''))
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(pos + block.length, pos + block.length) } })
  }

  function insertImage(img: { url: string; title?: string }): void {
    insertBlock(imageSnippet(img, placement, width))
    setPicker(false)
  }

  const tools: { label: string; title: string; run: () => void; cls?: string }[] = [
    { label: 'H2', title: 'Título', run: () => linePrefix('## ') },
    { label: 'H3', title: 'Subtítulo', run: () => linePrefix('### ') },
    { label: 'B', title: 'Negrita', run: () => wrap('**', '**', 'texto'), cls: 'font-bold' },
    { label: 'I', title: 'Cursiva', run: () => wrap('*', '*', 'texto'), cls: 'italic' },
    { label: 'S', title: 'Tachado', run: () => wrap('~~', '~~', 'texto'), cls: 'line-through' },
    { label: '•', title: 'Lista', run: () => linePrefix('- ') },
    { label: '1.', title: 'Lista numerada', run: () => linePrefix((i) => `${i + 1}. `) },
    { label: '❝', title: 'Cita', run: () => linePrefix('> ') },
    { label: '</>', title: 'Código', run: () => wrap('`', '`', 'código') },
    { label: '🔗', title: 'Enlace', run: () => wrap('[', '](https://)', 'texto del enlace') },
    { label: '▦', title: 'Tabla', run: () => insertBlock('| Columna | Columna |\n| --- | --- |\n| Dato | Dato |') },
    { label: '―', title: 'Separador', run: () => insertBlock('---') },
    { label: '▶', title: 'Vídeo de YouTube (enlace con miniatura)', run: () => insertBlock('[![Vídeo](https://img.youtube.com/vi/ID_DEL_VIDEO/maxresdefault.jpg)](https://www.youtube.com/watch?v=ID_DEL_VIDEO)') },
  ]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 p-1.5 rounded-xl border border-border bg-bg-primary">
        {tools.map(t => (
          <button key={t.title} type="button" title={t.title} onClick={t.run}
            className={`min-w-[32px] h-8 px-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover ${t.cls ?? ''}`}>{t.label}</button>
        ))}
        <button type="button" onClick={() => setPicker(p => !p)}
          className={`h-8 px-3 rounded-lg text-sm font-semibold ${picker ? 'bg-[#a855f7]/25 text-[#e9d5ff]' : 'text-[#c084fc] hover:bg-bg-hover'}`}>🖼 Imagen</button>
        <span className="flex-1" />
        <button type="button" onClick={() => setSplit(s => !s)} className="h-8 px-3 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover">
          {split ? 'Solo editor' : 'Con vista previa'}
        </button>
      </div>

      {picker && (
        <div className="p-3 rounded-xl border border-[#a855f7]/30 bg-[#a855f7]/5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-text-secondary">Dónde va:</span>
            {PLACEMENTS.map(p => (
              <button key={p.key} type="button" title={p.hint} onClick={() => setPlacement(p.key)}
                className={`px-2.5 py-1 rounded-lg text-xs border ${placement === p.key ? 'bg-[#a855f7]/25 border-[#a855f7]/60 text-[#e9d5ff]' : 'border-border text-text-secondary hover:bg-bg-hover'}`}>{p.label}</button>
            ))}
            {placement !== 'full' && (
              <label className="flex items-center gap-2 text-xs text-text-secondary ml-2">
                Ancho
                <input type="range" min={120} max={900} step={20} value={width} onChange={e => setWidth(Number(e.target.value))} className="accent-[#a855f7]" />
                <span className="w-12 text-text-primary">{width}px</span>
              </label>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <label className={`shrink-0 w-28 aspect-video rounded-lg border-2 border-dashed border-border hover:border-[#a855f7]/60 flex items-center justify-center text-xs text-text-muted cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
              {uploading ? 'Subiendo…' : '+ Subir nueva'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={uploading}
                onChange={async e => {
                  const f = e.target.files?.[0]; e.target.value = ''
                  if (!f) return
                  setUploading(true)
                  try { const img = await onUploadImage(f); if (img) insertImage(img) } finally { setUploading(false) }
                }} />
            </label>
            {gallery.map(g => (
              <button key={g.path} type="button" onClick={() => insertImage(g)} title={g.title || 'Insertar'}
                className="shrink-0 w-28 aspect-video rounded-lg overflow-hidden ring-1 ring-white/10 hover:ring-[#a855f7]">
                <img src={g.url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
          <p className="text-[11px] text-text-muted">Se inserta donde está el cursor. Las imágenes de la galería se suben en la pestaña «Imágenes»; aquí puedes usar una de ellas o subir una nueva.</p>
        </div>
      )}

      <div className={split ? 'grid grid-cols-2 gap-3' : ''}>
        <textarea ref={ta} value={value} onChange={e => onChange(e.target.value)} rows={22}
          className={`${inputCls} font-mono text-[13px] leading-relaxed resize-y min-h-[420px]`} placeholder={'## Qué incluye\n\n- ...'} />
        {split && (
          <div className="modrinth-body min-h-[420px] max-h-[640px] overflow-y-auto rounded-xl border border-border bg-bg-primary p-4" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
      <p className="text-[11px] text-text-muted">Markdown: **negrita**, *cursiva*, ## títulos, - listas, [enlaces](https://…). Se ve igual en el launcher y en la web.</p>
    </div>
  )
}
