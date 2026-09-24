import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import EditorShell, { useSaver, type CloseRequest } from './EditorShell'
import McTextInput, { McTextPreview } from './McTextInput'
import { Toggle } from './ScoreboardSimple'
import { DEFAULTS, PROPERTIES, PROPERTY_BY_KEY, SECTIONS, parseProperties, setProperty, type PropMeta } from '../../lib/serverProperties'
import { parseCodes } from '../../lib/mcText'
import { errText } from './shared'

// server.properties dentro del cuadro: en modo sencillo cada opción con su
// explicación y el control que le toca (interruptor, número, lista), y en
// modo texto el archivo tal cual. Los dos editan el mismo contenido.

const ConfigFileEditor = lazy(() => import('../ConfigFileEditor'))

interface Props {
  name: string
  location: string
  load: () => Promise<string>
  save: (content: string) => Promise<void>
  onClose: () => void
  closeRef?: MutableRefObject<CloseRequest | null>
  /** Icono del servidor (server-icon.png) como data URL, o null si no hay. */
  loadIcon?: () => Promise<string | null>
  /** Guarda el icono ya convertido a PNG de 64×64 (o lo quita con null). */
  saveIcon?: (png: Uint8Array | null) => Promise<void>
}

/** El MOTD va con § en el archivo; para editarlo, con & como en todas partes. */
const toCodes = (motd: string): string => motd.replace(/§/g, '&')
const toSection = (codes: string): string => codes.replace(/&([0-9a-fk-or])/gi, '§$1')

/**
 * Cualquier imagen → PNG de 64×64, que es lo único que acepta el servidor.
 * Se recorta al centro para que quede cuadrada sin deformarse.
 */
async function toServerIcon(dataUrl: string): Promise<{ png: Uint8Array; preview: string }> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('No se pudo leer la imagen')); img.src = dataUrl })
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  // Las imágenes pequeñas (pixel art) se amplían sin suavizar; las grandes se reducen suavizando
  ctx.imageSmoothingEnabled = side > 64
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 64, 64)
  const preview = canvas.toDataURL('image/png')
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo convertir'))), 'image/png'))
  return { png: new Uint8Array(await blob.arrayBuffer()), preview }
}

export default function PropertiesFileView({ name, location, load, save, onClose, closeRef, loadIcon, saveIcon }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [loadError, setLoadError] = useState('')
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [icon, setIcon] = useState<string | null>(null)
  const [iconMsg, setIconMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const contentRef = useRef(content)
  contentRef.current = content

  useEffect(() => {
    load().then((t) => { setContent(t); setSaved(t) }).catch((e) => setLoadError(errText(e)))
    loadIcon?.().then(setIcon).catch(() => {})
  }, [])

  const saver = useSaver(async () => {
    const c = contentRef.current ?? ''
    await save(c)
    setSaved(c)
  }, '✓ Guardado. Los cambios se aplican al reiniciar el servidor')
  const saveRef = useRef(saver.run)
  saveRef.current = saver.run

  const values = useMemo(() => parseProperties(content ?? ''), [content])
  const change = (key: string, value: string): void => setContent((c) => setProperty(c ?? '', key, value))

  const q = search.trim().toLowerCase()
  const matches = (key: string, meta?: PropMeta): boolean =>
    !q || key.includes(q) || !!meta?.label.toLowerCase().includes(q) || !!meta?.desc.toLowerCase().includes(q)

  const known = PROPERTIES.filter((p) => (showAll || values.has(p.key)) && matches(p.key, p))
  const unknown = [...values.keys()].filter((k) => !PROPERTY_BY_KEY.has(k) && matches(k)).sort()
  const motd = values.get('motd') ?? ''
  const missingCount = PROPERTIES.filter((p) => !values.has(p.key)).length

  async function pickIcon(): Promise<void> {
    if (!saveIcon) return
    setIconMsg(null)
    const file = await window.api.ftp.pickImage()
    if (!file) return
    try {
      const { png, preview } = await toServerIcon(await window.api.ftp.localReadImage(file))
      await saveIcon(png)
      setIcon(preview)
      setIconMsg({ ok: true, text: '✓ Icono guardado (64×64). Se verá al reiniciar el servidor.' })
    } catch (e) {
      setIconMsg({ ok: false, text: `No se pudo poner el icono: ${errText(e)}` })
    }
  }

  async function removeIcon(): Promise<void> {
    if (!saveIcon) return
    try {
      await saveIcon(null)
      setIcon(null)
      setIconMsg({ ok: true, text: 'Icono quitado.' })
    } catch (e) {
      setIconMsg({ ok: false, text: errText(e) })
    }
  }

  const spinner = <div className="flex-1 flex items-center justify-center"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>

  return (
    <EditorShell title={name} subtitle={location} dirty={content !== null && content !== saved} onSave={saver.run}
      saving={saver.saving} status={saver.status} onClose={onClose} closeRef={closeRef} code={mode === 'advanced'}
      headerExtra={
        <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
          {(['simple', 'advanced'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`px-2.5 h-8 text-xs ${mode === m ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}>
              {m === 'simple' ? 'Sencillo' : 'Texto'}
            </button>
          ))}
        </div>
      }>
      {loadError ? <p className="p-6 text-sm text-red-400">{loadError}</p> : content === null ? spinner : mode === 'advanced' ? (
        <div className="relative flex-1 min-h-0">
          <div className="absolute inset-0">
            <Suspense fallback={spinner}>
              <ConfigFileEditor language="ini" value={content} onChange={setContent}
                onMount={(editor, monaco) => {
                  editor.addAction({
                    id: 'save-properties', label: 'Guardar', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
                    run: () => { saveRef.current() }
                  })
                }}
                loadingNode={spinner} />
            </Suspense>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="sticky top-0 z-[1] px-4 py-2 bg-bg-primary/95 backdrop-blur border-b border-border flex items-center gap-3 flex-wrap">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar opción…"
              className="flex-1 min-w-[150px] max-w-xs bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60" />
            {missingCount > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                Ver también las {missingCount} opciones que no están en el archivo
              </label>
            )}
          </div>
          <div className="p-4 space-y-6">
            {SECTIONS.map((section) => {
              const items = section === 'Otras opciones' ? [] : known.filter((p) => p.section === section)
              const extra = section === 'Otras opciones' ? unknown : []
              if (items.length === 0 && extra.length === 0) return null
              return (
                <section key={section} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{section}</h3>
                  {items.map((meta) => meta.type === 'motd' ? (
                    <div key={meta.key} className="p-3 rounded-lg bg-bg-card border border-border space-y-2 min-w-0">
                      <p className="text-sm text-text-primary">{meta.label}</p>
                      <p className="text-[11px] text-text-muted">{meta.desc} Pulsa Enter para pasar a la segunda línea.</p>
                      <McTextInput multiline value={toCodes(motd)} onChange={(codes) => change('motd', toSection(codes))} placeholder="&6&lMi servidor" />
                      {/* Como en la lista de servidores del juego */}
                      <div className="flex gap-3 p-2 rounded bg-[#0f0f0f] border border-black min-w-0">
                        <div className="shrink-0 flex flex-col items-center gap-1">
                          {icon ? <img src={icon} alt="" className="w-16 h-16" style={{ imageRendering: 'pixelated' }} /> : <div className="w-16 h-16 bg-[#2a2a2a] flex items-center justify-center text-[10px] text-white/40 text-center">sin icono</div>}
                        </div>
                        <div className="min-w-0 text-sm leading-snug overflow-hidden">
                          <p className="text-white font-mono">Servidor de Minecraft</p>
                          {toCodes(motd).split('\n').slice(0, 2).map((line, i) => (
                            <p key={i} className="truncate"><McTextPreview segments={parseCodes(line)} empty=" " /></p>
                          ))}
                        </div>
                      </div>
                      {saveIcon && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <button type="button" onClick={pickIcon}
                            className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:text-text-primary hover:border-accent/50">
                            🖼 {icon ? 'Cambiar icono' : 'Poner icono'}
                          </button>
                          {icon && <button type="button" onClick={removeIcon} className="text-xs text-text-muted hover:text-red-400">Quitar</button>}
                          <span className="text-[11px] text-text-muted">Cualquier imagen: el launcher la recorta y la deja en 64×64.</span>
                        </div>
                      )}
                      {iconMsg && <p className={`text-[11px] ${iconMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{iconMsg.text}</p>}
                    </div>
                  ) : (
                    <PropRow key={meta.key} meta={meta} missing={!values.has(meta.key)}
                      value={values.get(meta.key) ?? DEFAULTS[meta.key] ?? ''} onChange={(v) => change(meta.key, v)} />
                  ))}
                  {extra.map((key) => (
                    <PropRow key={key} meta={{ key, label: key, desc: '', type: 'text', section }} value={values.get(key) ?? ''} onChange={(v) => change(key, v)} />
                  ))}
                </section>
              )
            })}
            {known.length === 0 && unknown.length === 0 && <p className="text-sm text-text-muted text-center py-6">Nada coincide con la búsqueda.</p>}
          </div>
        </div>
      )}
    </EditorShell>
  )
}

function PropRow({ meta, value, onChange, missing }: { meta: PropMeta; value: string; onChange: (v: string) => void; missing?: boolean }) {
  const note = missing ? ' · no está en el archivo: se añadirá al cambiarla' : ''
  if (meta.type === 'bool') {
    return (
      <div className={missing ? 'opacity-60 hover:opacity-100' : ''}>
        <Toggle label={meta.label} hint={(meta.desc || meta.key) + note} value={value === 'true'} onChange={(v) => onChange(v ? 'true' : 'false')} />
      </div>
    )
  }
  const invalid = meta.type === 'int' && value !== '' && (!/^-?\d+$/.test(value) ||
    (meta.min !== undefined && Number(value) < meta.min) || (meta.max !== undefined && Number(value) > meta.max))
  return (
    <div className={`flex items-center gap-x-3 gap-y-2 flex-wrap px-3 py-2 rounded-lg bg-bg-card border border-border ${missing ? 'opacity-60 hover:opacity-100' : ''}`}>
      <div className="flex-1 min-w-[180px]">
        <p className="text-sm text-text-primary">{meta.label}</p>
        <p className="text-[11px] text-text-muted">{meta.desc || <span className="font-mono">{meta.key}</span>}{note}</p>
        {invalid && <p className="text-[11px] text-red-400">Número entre {meta.min ?? '…'} y {meta.max ?? '…'}</p>}
      </div>
      {meta.type === 'enum' ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="flex-1 sm:flex-none min-w-[140px] max-w-full bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary">
          {!meta.options!.some(([v]) => v === value) && <option value={value}>{value || '(vacío)'}</option>}
          {meta.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : (
        <input type={meta.type === 'password' ? 'password' : 'text'} value={value} onChange={(e) => onChange(e.target.value)}
          className={`${meta.type === 'int' ? 'w-28 text-right' : 'flex-1 min-w-[160px]'} bg-bg-primary border rounded-lg px-2.5 py-1.5 text-sm text-text-primary outline-none ${invalid ? 'border-red-500' : 'border-border focus:border-accent/60'}`} />
      )}
    </div>
  )
}
