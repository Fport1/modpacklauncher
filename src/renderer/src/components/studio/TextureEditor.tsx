import { useEffect, useRef, useState } from 'react'
import { BLENDS, activeLayer, frameH, fromHex, hsvToRgb, paletteOf, restore, rgbToHsv, snapshot, toHex, type Blend, type StudioTex, type TexSnap } from '../../lib/studio/textures'
import {
  addLayer, adjustFrom, clearArea, copyArea, deleteLayer, duplicateLayer, flatten, flip, grayscale, invert, mergeDown, moveLayer,
  outlineLayer, pasteAsLayer, replaceColor, rotate90, type PaintTool,
} from '../../lib/studio/paint'
import Icon from './icons'
import Tip from './Tip'

// Editor de texturas al estilo Photoshop, pero en píxeles: herramientas a la izquierda,
// opciones de la herramienta arriba, el lienzo en el centro, y a la derecha el color (con
// selector de tono/saturación/brillo), la paleta y las capas. Los cambios pasan por la página
// (onPaint / onAction) para que todo se pueda deshacer.

export type { PaintTool }

export interface PaintUi {
  color: string
  color2: string
  alpha: number
  size: number
  filled: boolean
  mirror: boolean
  global: boolean
  strength: number
}
export const DEFAULT_UI: PaintUi = { color: '#ffffff', color2: '#000000', alpha: 255, size: 1, filled: false, mirror: false, global: false, strength: 0.4 }

export const PAINT_TOOLS: { id: PaintTool; icon: string; label: string; key: string; tip: string }[] = [
  { id: 'select', icon: 'marquee', label: 'Selección', key: 'M', tip: 'Selección (M): arrastra para marcar un rectángulo. Luego todo se hace solo dentro: pintar, rellenar, voltear, copiar… Haz clic sin arrastrar para quitarla.' },
  { id: 'move', icon: 'move', label: 'Mover', key: 'V', tip: 'Mover (V): arrastra para mover lo seleccionado (o toda la capa si no hay selección).' },
  { id: 'pencil', icon: 'pencil', label: 'Lápiz', key: 'B', tip: 'Lápiz (B): pinta con el color principal. Elige el grosor arriba.' },
  { id: 'eraser', icon: 'eraser', label: 'Goma', key: 'E', tip: 'Goma (E): borra (deja transparente).' },
  { id: 'fill', icon: 'bucket', label: 'Cubo', key: 'G', tip: 'Cubo de pintura (G): rellena los píxeles iguales que se tocan. Con «Todos los iguales» cambia ese color en toda la capa.' },
  { id: 'picker', icon: 'picker', label: 'Cuentagotas', key: 'I', tip: 'Cuentagotas (I): coge el color del píxel que toques.' },
  { id: 'line', icon: 'line', label: 'Línea', key: 'L', tip: 'Línea (L): arrastra de un punto a otro.' },
  { id: 'rect', icon: 'rect', label: 'Rectángulo', key: 'U', tip: 'Rectángulo (U): arrastra. Arriba eliges si va relleno.' },
  { id: 'ellipse', icon: 'ellipse', label: 'Círculo', key: 'O', tip: 'Círculo / elipse (O): arrastra. Arriba eliges si va relleno.' },
  { id: 'lighten', icon: 'sun', label: 'Aclarar', key: 'D', tip: 'Aclarar: pasa por encima para dar luz a lo que ya está pintado.' },
  { id: 'darken', icon: 'moon', label: 'Oscurecer', key: 'S', tip: 'Oscurecer: pasa por encima para hacer sombra.' },
  { id: 'shade', icon: 'shade', label: 'Sombra fría', key: 'H', tip: 'Sombra fría: oscurece y enfría un poco el color, como hacen los artistas de pixel art.' },
  { id: 'noise', icon: 'noise', label: 'Ruido', key: 'N', tip: 'Ruido: cambia un poco la luz de cada píxel al azar, para que no quede plano (el «grano» de las texturas de Minecraft).' },
]

interface Props {
  tex: StudioTex | null
  refs: string[]
  current: string | null
  onPickRef: (ref: string) => void
  tool: PaintTool
  onTool: (t: PaintTool) => void
  ui: PaintUi
  onUi: (u: Partial<PaintUi>) => void
  overlays: { x: number; y: number; w: number; h: number; label: string }[]
  version: number
  onPaint: (ref: string, x: number, y: number, phase: 'start' | 'move' | 'end') => void
  /** Cambio de un golpe sobre la textura actual (con deshacer) */
  onAction: (label: string, fn: (t: StudioTex) => void) => void
  wide: boolean
  onWide: (w: boolean) => void
}

let clipboard: { img: ImageData; x: number; y: number } | null = null

export default function TextureEditor(p: Props) {
  const view = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(16)
  const [grid, setGrid] = useState(true)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [adjust, setAdjust] = useState<{ base: TexSnap; h: number; s: number; l: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [ants, setAnts] = useState(0)
  const [, force] = useState(0)
  const painting = useRef(false)
  const tex = p.tex
  const fh = tex ? frameH(tex) : 0

  // Hormigas de la selección
  useEffect(() => { const t = setInterval(() => setAnts((a) => (a + 1) % 8), 120); return () => clearInterval(t) }, [])

  useEffect(() => {
    const c = view.current
    if (!c || !tex) return
    c.width = tex.w * zoom
    c.height = fh * zoom
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    for (let y = 0; y < fh; y++) for (let x = 0; x < tex.w; x++) {
      g.fillStyle = (x + y) % 2 ? '#3a3f4b' : '#2c303a'
      g.fillRect(x * zoom, y * zoom, zoom, zoom)
    }
    g.drawImage(tex.canvas, 0, 0, tex.w, fh, 0, 0, tex.w * zoom, fh * zoom)
    if (grid && zoom >= 8) {
      g.strokeStyle = 'rgba(255,255,255,0.08)'
      g.lineWidth = 1
      for (let x = 0; x <= tex.w; x++) { g.beginPath(); g.moveTo(x * zoom + 0.5, 0); g.lineTo(x * zoom + 0.5, fh * zoom); g.stroke() }
      for (let y = 0; y <= fh; y++) { g.beginPath(); g.moveTo(0, y * zoom + 0.5); g.lineTo(tex.w * zoom, y * zoom + 0.5); g.stroke() }
    }
    if (p.ui.mirror) {
      g.strokeStyle = 'rgba(56,189,248,0.6)'
      g.setLineDash([4, 4])
      g.beginPath(); g.moveTo((tex.w / 2) * zoom, 0); g.lineTo((tex.w / 2) * zoom, fh * zoom); g.stroke()
      g.setLineDash([])
    }
    g.lineWidth = 2
    g.font = '11px sans-serif'
    for (const o of p.overlays) {
      g.strokeStyle = '#facc15'
      g.strokeRect(o.x * zoom + 1, o.y * zoom + 1, o.w * zoom - 2, o.h * zoom - 2)
      g.fillStyle = '#facc15'
      g.fillText(o.label, o.x * zoom + 4, o.y * zoom + 13)
    }
    const sel = tex.selection
    if (sel) {
      g.lineWidth = 1.5
      g.setLineDash([4, 4])
      g.lineDashOffset = -ants
      g.strokeStyle = '#ffffff'
      g.strokeRect(sel.x * zoom + 0.5, sel.y * zoom + 0.5, sel.w * zoom - 1, sel.h * zoom - 1)
      g.lineDashOffset = -ants + 4
      g.strokeStyle = '#000000'
      g.strokeRect(sel.x * zoom + 0.5, sel.y * zoom + 0.5, sel.w * zoom - 1, sel.h * zoom - 1)
      g.setLineDash([])
    }
    if (hover) {
      const n = ['pencil', 'eraser', 'lighten', 'darken', 'noise', 'shade', 'line'].includes(p.tool) ? p.ui.size : 1
      const off = Math.floor((n - 1) / 2)
      g.lineWidth = 1.5
      g.strokeStyle = '#ffffff'
      g.strokeRect((hover.x - off) * zoom + 1, (hover.y - off) * zoom + 1, n * zoom - 2, n * zoom - 2)
    }
  }, [tex, zoom, p.version, p.overlays, hover, fh, grid, ants, p.ui.mirror, p.tool, p.ui.size])

  // Zoom que quepa en el hueco (al cambiar de textura o de tamaño del panel)
  const area = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = area.current
    if (!el || !tex) return
    const fit = (): void => { const s = Math.min(el.clientWidth, el.clientHeight || el.clientWidth) - 20; if (s > 40) setZoom(Math.max(2, Math.min(48, Math.floor(s / Math.max(tex.w, fh))))) }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tex?.ref, p.wide])

  const pixel = (ev: React.PointerEvent): { x: number; y: number } | null => {
    if (!tex) return null
    const r = view.current!.getBoundingClientRect()
    const x = Math.floor(((ev.clientX - r.left) / r.width) * tex.w)
    const y = Math.floor(((ev.clientY - r.top) / r.height) * fh)
    return { x: Math.max(0, Math.min(tex.w - 1, x)), y: Math.max(0, Math.min(fh - 1, y)) }
  }

  const setColor = (c: string): void => {
    p.onUi({ color: c })
    setRecent((r) => [c, ...r.filter((x) => x !== c)].slice(0, 12))
  }

  // Atajos de teclado (como Photoshop)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if ((ev.target as HTMLElement)?.closest('input, textarea, select') || !tex) return
      const k = ev.key.toLowerCase()
      if (ev.ctrlKey || ev.metaKey) {
        if (k === 'c' && tex.selection) { clipboard = copyArea(tex, ev.shiftKey); ev.preventDefault() }
        else if (k === 'x' && tex.selection && tex.editable) { clipboard = copyArea(tex, false); p.onAction('Cortar', clearArea); ev.preventDefault() }
        else if (k === 'v' && clipboard && tex.editable) { p.onAction('Pegar', (t) => pasteAsLayer(t, clipboard!)); p.onTool('move'); ev.preventDefault() }
        else if (k === 'd') { tex.selection = null; force((n) => n + 1); ev.preventDefault() }
        else if (k === 'a') { tex.selection = { x: 0, y: 0, w: tex.w, h: tex.h }; force((n) => n + 1); ev.preventDefault() }
        return
      }
      if (k === 'delete' || k === 'backspace') { if (tex.editable) p.onAction('Borrar', clearArea); ev.preventDefault(); return }
      if (k === 'x') { p.onUi({ color: p.ui.color2, color2: p.ui.color }); return }
      if (k === '[') { p.onUi({ size: Math.max(1, p.ui.size - 1) }); return }
      if (k === ']') { p.onUi({ size: Math.min(4, p.ui.size + 1) }); return }
      const t = PAINT_TOOLS.find((x) => x.key.toLowerCase() === k)
      if (t) p.onTool(t.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const palette = tex ? paletteOf(tex, 24) : []
  const act = (label: string, fn: (t: StudioTex) => void): void => { if (tex?.editable) p.onAction(label, fn) }
  const showSize = ['pencil', 'eraser', 'lighten', 'darken', 'noise', 'shade', 'line'].includes(p.tool)
  const showStrength = ['lighten', 'darken', 'noise', 'shade'].includes(p.tool)
  const al = tex ? activeLayer(tex) : null

  const toolBtn = (t: (typeof PAINT_TOOLS)[number]): JSX.Element => (
    <Tip key={t.id} text={t.tip} side={p.wide ? 'right' : 'bottom'}>
      <button type="button" onClick={() => p.onTool(t.id)} aria-label={t.label}
        className={`w-9 h-9 rounded-lg flex items-center justify-center border ${p.tool === t.id ? 'bg-accent text-white border-accent' : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-hover'}`}>
        <Icon name={t.icon} size={18} />
      </button>
    </Tip>
  )
  const iconBtn = (icon: string, tip: string, onClick: () => void, disabled = false): JSX.Element => (
    <Tip key={tip} text={tip}>
      <button type="button" disabled={disabled} onClick={onClick} className="w-8 h-8 rounded-lg flex items-center justify-center border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30"><Icon name={icon} size={16} /></button>
    </Tip>
  )

  // ── Bloques de la interfaz ──
  const optionsBar = (
    <div className="flex items-center gap-2 flex-wrap text-xs text-text-secondary min-h-[32px]">
      <span className="font-semibold text-text-primary">{PAINT_TOOLS.find((t) => t.id === p.tool)?.label}</span>
      {showSize && (
        <span className="flex items-center gap-1">Grosor
          {[1, 2, 3, 4].map((n) => <button key={n} type="button" onClick={() => p.onUi({ size: n })} className={`w-6 h-6 rounded ${p.ui.size === n ? 'bg-accent text-white' : 'bg-bg-hover'}`}>{n}</button>)}
        </span>
      )}
      {(p.tool === 'rect' || p.tool === 'ellipse') && (
        <label className="flex items-center gap-1"><input type="checkbox" checked={p.ui.filled} onChange={(e) => p.onUi({ filled: e.target.checked })} />Relleno</label>
      )}
      {p.tool === 'fill' && <label className="flex items-center gap-1"><input type="checkbox" checked={p.ui.global} onChange={(e) => p.onUi({ global: e.target.checked })} />Todos los iguales</label>}
      {showStrength && <label className="flex items-center gap-1">Fuerza<input type="range" min={0} max={1} step={0.05} value={p.ui.strength} onChange={(e) => p.onUi({ strength: Number(e.target.value) })} className="w-20" /></label>}
      {['pencil', 'eraser', 'line', 'rect', 'ellipse', 'lighten', 'darken', 'noise', 'shade'].includes(p.tool) && (
        <Tip text="Simetría: lo que pintas a un lado se repite al otro (línea azul).">
          <button type="button" onClick={() => p.onUi({ mirror: !p.ui.mirror })} className={`flex items-center gap-1 px-2 h-6 rounded ${p.ui.mirror ? 'bg-sky-500 text-white' : 'bg-bg-hover'}`}><Icon name="mirror" size={14} />Simetría</button>
        </Tip>
      )}
      <span className="flex-1" />
      {iconBtn('grid', grid ? 'Ocultar la cuadrícula' : 'Ver la cuadrícula', () => setGrid((g) => !g))}
      {iconBtn('zoomOut', 'Alejar (o rueda del ratón)', () => setZoom((z) => Math.max(2, Math.round(z / 1.5))))}
      {iconBtn('zoomIn', 'Acercar (o rueda del ratón)', () => setZoom((z) => Math.min(64, Math.round(z * 1.5))))}
      {iconBtn(p.wide ? 'shrink' : 'expand', p.wide ? 'Panel normal' : 'Ampliar el editor de texturas', () => p.onWide(!p.wide))}
    </div>
  )

  const canvasArea = (
    <div ref={area} className="flex-1 min-h-[220px] overflow-auto rounded-lg bg-black/30 p-2 flex items-center justify-center" data-tour="texture-canvas" onPointerLeave={() => setHover(null)}
      onWheel={(e) => { if (!tex) return; setZoom((z) => Math.max(2, Math.min(64, Math.round(e.deltaY < 0 ? z * 1.25 + 0.5 : z / 1.25)))) }}>
      {tex ? (
        <canvas ref={view} className="block" style={{ imageRendering: 'pixelated', cursor: p.tool === 'move' ? 'move' : 'crosshair' }}
          onPointerDown={(ev) => {
            const px = pixel(ev); if (!px || !p.current) return
            painting.current = true
            ;(ev.target as HTMLElement).setPointerCapture(ev.pointerId)
            p.onPaint(p.current, px.x, px.y, 'start')
          }}
          onPointerMove={(ev) => {
            const px = pixel(ev)
            setHover(px)
            if (painting.current && px && p.current) p.onPaint(p.current, px.x, px.y, 'move')
          }}
          onPointerUp={() => { if (painting.current) { painting.current = false; p.onPaint('', 0, 0, 'end') } }} />
      ) : <p className="text-sm text-text-muted p-4">Elige una textura.</p>}
    </div>
  )

  const colorBlock = (
    <section className="space-y-2" data-tour="paint-tools-color">
      <div className="flex items-center gap-3">
        <div className="relative w-14 h-14 shrink-0">
          <Tip text="Color secundario. Pulsa X para cambiarlo por el principal."><button type="button" onClick={() => p.onUi({ color: p.ui.color2, color2: p.ui.color })} className="absolute right-0 bottom-0 w-9 h-9 rounded-md border-2 border-white/60" style={{ background: p.ui.color2 }} /></Tip>
          <Tip text="Color principal (con el que pintas)"><span className="absolute left-0 top-0 w-9 h-9 rounded-md border-2 border-white shadow" style={{ background: p.ui.color, opacity: p.ui.alpha / 255 }} /></Tip>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <input value={p.ui.color} onChange={(e) => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) setColor(e.target.value.toLowerCase()) }}
            className="w-full bg-bg-primary border border-border rounded-md px-2 py-1 text-xs font-mono text-text-primary" />
          <label className="flex items-center gap-1 text-[11px] text-text-muted">Opacidad
            <input type="range" min={0} max={255} value={p.ui.alpha} onChange={(e) => p.onUi({ alpha: Number(e.target.value) })} className="flex-1" />
            <span className="w-8 text-right">{Math.round((p.ui.alpha / 255) * 100)}%</span>
          </label>
        </div>
      </div>
      <HsvPicker color={p.ui.color} onChange={setColor} />
      {recent.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          <span className="text-[10px] text-text-muted w-full">Usados hace poco</span>
          {recent.map((c) => <button key={c} type="button" title={c} onClick={() => setColor(c)} className="w-5 h-5 rounded border border-black/40" style={{ background: c }} />)}
        </div>
      )}
      {palette.length > 0 && (
        <div className="flex gap-1 flex-wrap" data-tour="paint-tools">
          <span className="text-[10px] text-text-muted w-full">En esta textura</span>
          {palette.map((c) => (
            <button key={c} type="button" title={`${c} (clic derecho: reemplazarlo por el color principal en la capa)`} onClick={() => setColor(c)}
              onContextMenu={(e) => { e.preventDefault(); act(`Reemplazar ${c}`, (t) => replaceColor(t, fromHex(c), fromHex(p.ui.color))) }}
              className={`w-5 h-5 rounded border ${p.ui.color === c ? 'border-white' : 'border-black/40'}`} style={{ background: c }} />
          ))}
        </div>
      )}
    </section>
  )

  const imageMenu = tex && (
    <section className="space-y-1.5">
      <p className="text-[11px] font-semibold text-text-muted uppercase flex items-center gap-1"><Icon name="image" size={13} />Imagen {tex.selection ? '(selección)' : '(capa entera)'}</p>
      <div className="flex gap-1 flex-wrap">
        {iconBtn('flipH', 'Voltear de izquierda a derecha', () => act('Voltear', (t) => flip(t, 'h')), !tex.editable)}
        {iconBtn('flipV', 'Voltear de arriba abajo', () => act('Voltear', (t) => flip(t, 'v')), !tex.editable)}
        {iconBtn('rot90', 'Girar 90° (la selección tiene que ser cuadrada)', () => act('Girar 90°', (t) => { rotate90(t) }), !tex.editable)}
        {iconBtn('sliders', 'Tono, saturación y brillo…', () => setAdjust({ base: snapshot(tex), h: 0, s: 0, l: 0 }), !tex.editable)}
        {iconBtn('gray', 'Pasar a gris', () => act('Gris', grayscale), !tex.editable)}
        {iconBtn('invert', 'Invertir colores', () => act('Invertir', invert), !tex.editable)}
        {iconBtn('replace', 'Reemplazar el color secundario por el principal en la capa', () => act('Reemplazar color', (t) => replaceColor(t, fromHex(p.ui.color2), fromHex(p.ui.color))), !tex.editable)}
        {iconBtn('outline', 'Contorno de 1 píxel alrededor de lo dibujado (con el color principal)', () => act('Contorno', (t) => outlineLayer(t, fromHex(p.ui.color, p.ui.alpha))), !tex.editable)}
        {iconBtn('copy', 'Copiar la selección (Ctrl+C) y pegarla como capa nueva', () => { if (!tex.selection) tex.selection = { x: 0, y: 0, w: tex.w, h: tex.h }; clipboard = copyArea(tex, false); act('Pegar', (t) => pasteAsLayer(t, clipboard!)); p.onTool('move') }, !tex.editable)}
        {iconBtn('trash', 'Borrar lo seleccionado (Supr)', () => act('Borrar', clearArea), !tex.editable)}
      </div>
      {adjust && (
        <div className="rounded-lg border border-border bg-bg-primary p-2 space-y-1.5">
          {([['h', 'Tono', -180, 180, 1], ['s', 'Saturación', -1, 1, 0.02], ['l', 'Brillo', -1, 1, 0.02]] as const).map(([k, l, min, max, step]) => (
            <label key={k} className="flex items-center gap-2 text-[11px] text-text-secondary">
              <span className="w-16">{l}</span>
              <input type="range" min={min} max={max} step={step} value={adjust[k]} className="flex-1"
                onChange={(e) => { const n = { ...adjust, [k]: Number(e.target.value) }; setAdjust(n); adjustFrom(tex, n.base, n.h, n.s, n.l); force((x) => x + 1) }} />
            </label>
          ))}
          <div className="flex justify-end gap-2">
            <button type="button" className="text-xs text-text-muted" onClick={() => { restore(tex, adjust.base); setAdjust(null); force((x) => x + 1) }}>Cancelar</button>
            <button type="button" className="text-xs px-2 py-1 rounded bg-accent text-white" onClick={() => { const a = adjust; restore(tex, a.base); p.onAction('Tono/saturación/brillo', (t) => adjustFrom(t, a.base, a.h, a.s, a.l)); setAdjust(null) }}>Aplicar</button>
          </div>
        </div>
      )}
    </section>
  )

  const layersPanel = tex && (
    <section className="space-y-1.5" data-tour="layers">
      <p className="text-[11px] font-semibold text-text-muted uppercase flex items-center gap-1"><Icon name="layers" size={13} />Capas</p>
      <div className="rounded-lg border border-border overflow-hidden">
        {[...tex.layers].map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
          <div key={l.id} onClick={() => { tex.active = i; force((x) => x + 1) }}
            className={`flex items-center gap-1.5 px-1.5 py-1 cursor-pointer text-xs ${i === tex.active ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'}`}>
            <button type="button" title={l.visible ? 'Ocultar capa' : 'Ver capa'} onClick={(e) => { e.stopPropagation(); act(l.visible ? 'Ocultar capa' : 'Ver capa', (t) => { t.layers[i].visible = !t.layers[i].visible }) }}
              className="w-6 h-6 flex items-center justify-center"><Icon name={l.visible ? 'eye' : 'eyeOff'} size={14} /></button>
            <LayerThumb canvas={l.canvas} version={p.version} />
            {renaming === l.id ? (
              <input autoFocus defaultValue={l.name} onClick={(e) => e.stopPropagation()}
                onBlur={(e) => { const n = e.target.value.trim() || l.name; setRenaming(null); act('Renombrar capa', (t) => { t.layers[i].name = n }) }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className="flex-1 min-w-0 bg-bg-primary border border-accent rounded px-1 text-xs text-text-primary" />
            ) : <span className="flex-1 min-w-0 truncate" onDoubleClick={() => setRenaming(l.id)}>{l.name}</span>}
            {l.opacity < 1 && <span className="text-[10px] text-text-muted">{Math.round(l.opacity * 100)}%</span>}
            <button type="button" title={l.lockAlpha ? 'Pintar en cualquier sitio' : 'Bloquear lo transparente: solo se pinta sobre lo que ya hay'}
              onClick={(e) => { e.stopPropagation(); act('Bloqueo de transparencia', (t) => { t.layers[i].lockAlpha = !t.layers[i].lockAlpha || undefined }) }}
              className={`w-6 h-6 flex items-center justify-center ${l.lockAlpha ? 'text-amber-300' : 'opacity-40'}`}><Icon name={l.lockAlpha ? 'lock' : 'unlock'} size={13} /></button>
          </div>
        ))}
      </div>
      {al && (
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <select value={al.blend} onChange={(e) => act('Modo de capa', (t) => { activeLayer(t).blend = e.target.value as Blend })} className="bg-bg-primary border border-border rounded px-1 py-0.5 text-[11px] text-text-primary">
            {BLENDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          <input type="range" min={0} max={1} step={0.05} value={al.opacity} className="flex-1" title="Opacidad de la capa"
            onChange={(e) => { const v = Number(e.target.value); act('Opacidad de capa', (t) => { activeLayer(t).opacity = v }) }} />
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
        {iconBtn('plus', 'Capa nueva (encima de la elegida)', () => act('Capa nueva', addLayer), !tex.editable)}
        {iconBtn('copy', 'Duplicar la capa', () => act('Duplicar capa', duplicateLayer), !tex.editable)}
        {iconBtn('up', 'Subir la capa', () => act('Subir capa', (t) => moveLayer(t, 1)), !tex.editable)}
        {iconBtn('down', 'Bajar la capa', () => act('Bajar capa', (t) => moveLayer(t, -1)), !tex.editable)}
        {iconBtn('merge', 'Combinar con la de abajo', () => act('Combinar capas', (t) => { mergeDown(t) }), !tex.editable || tex.active === 0)}
        {iconBtn('layers', 'Acoplar todas en una', () => act('Acoplar', flatten), !tex.editable || tex.layers.length < 2)}
        {iconBtn('trash', 'Borrar la capa', () => act('Borrar capa', (t) => { deleteLayer(t) }), !tex.editable || tex.layers.length < 2)}
      </div>
      <p className="text-[10px] text-text-muted leading-snug">En el juego se ve la mezcla de las capas visibles. Las capas se guardan aparte para seguir editándolas.</p>
    </section>
  )

  return (
    <div className="flex flex-col gap-2 min-h-0 h-full">
      <div className="flex items-center gap-2">
        <select value={p.current ?? ''} onChange={(e) => p.onPickRef(e.target.value)} data-tour="texture-pick"
          className="flex-1 min-w-0 bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary outline-none">
          {p.refs.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      {tex && !tex.editable && (
        <p className="text-[11px] text-amber-300 bg-amber-500/10 rounded-lg px-2 py-1.5">Esta textura es de Minecraft, no del mod: se puede ver, pero no pintar.</p>
      )}
      {p.wide ? (
        <div className="flex-1 min-h-0 flex gap-3">
          <div className="grid grid-cols-2 gap-1 content-start">{PAINT_TOOLS.map(toolBtn)}</div>
          <div className="flex-1 min-w-0 flex flex-col gap-2">{optionsBar}{canvasArea}
            {tex && <p className="text-[11px] text-text-muted">{tex.w}×{tex.h} px{fh !== tex.h ? ` (animada: ${tex.h / fh} fotogramas)` : ''}{hover ? ` · píxel ${hover.x}, ${hover.y}` : ''}{tex.selection ? ` · selección ${tex.selection.w}×${tex.selection.h}` : ''}</p>}
          </div>
          <div className="w-56 shrink-0 overflow-y-auto space-y-4 pr-1">{colorBlock}{layersPanel}{imageMenu}</div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          <div className="flex gap-0.5 flex-wrap">{PAINT_TOOLS.map(toolBtn)}</div>
          {optionsBar}
          <div className="h-[290px] flex">{canvasArea}</div>
          {tex && <p className="text-[11px] text-text-muted">{tex.w}×{tex.h} px{hover ? ` · píxel ${hover.x}, ${hover.y}` : ''}{tex.selection ? ` · selección ${tex.selection.w}×${tex.selection.h}` : ''}</p>}
          {colorBlock}{layersPanel}{imageMenu}
        </div>
      )}
    </div>
  )
}

function LayerThumb({ canvas, version }: { canvas: HTMLCanvasElement; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.clearRect(0, 0, 24, 24)
    g.fillStyle = '#2c303a'; g.fillRect(0, 0, 24, 24)
    g.drawImage(canvas, 0, 0, canvas.width, Math.min(canvas.height, canvas.width), 0, 0, 24, 24)
  })
  void version
  return <canvas ref={ref} width={24} height={24} className="w-6 h-6 rounded border border-black/40" style={{ imageRendering: 'pixelated' }} />
}

/** Selector de color: cuadro de saturación/brillo y barra de tono. */
function HsvPicker({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const sv = useRef<HTMLCanvasElement>(null)
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(fromHex(color)))
  useEffect(() => {
    const cur = toHex([...hsvToRgb(...hsv), 255])
    if (cur !== color) setHsv(rgbToHsv(fromHex(color)))
  }, [color])
  useEffect(() => {
    const c = sv.current
    if (!c) return
    const g = c.getContext('2d')!
    const [r, gg, b] = hsvToRgb(hsv[0], 1, 1)
    g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(0, 0, c.width, c.height)
    const white = g.createLinearGradient(0, 0, c.width, 0); white.addColorStop(0, '#fff'); white.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = white; g.fillRect(0, 0, c.width, c.height)
    const black = g.createLinearGradient(0, 0, 0, c.height); black.addColorStop(0, 'rgba(0,0,0,0)'); black.addColorStop(1, '#000')
    g.fillStyle = black; g.fillRect(0, 0, c.width, c.height)
  }, [hsv[0]])
  const set = (h: number, s: number, v: number): void => {
    setHsv([h, s, v])
    onChange(toHex([...hsvToRgb(h, s, v), 255]))
  }
  const drag = (el: HTMLElement, ev: React.PointerEvent, fn: (fx: number, fy: number) => void): void => {
    const move = (e: PointerEvent | React.PointerEvent): void => {
      const r = el.getBoundingClientRect()
      fn(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))
    }
    move(ev)
    const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <canvas ref={sv} width={220} height={110} className="w-full h-[110px] rounded-md cursor-crosshair block"
          onPointerDown={(e) => drag(e.currentTarget, e, (fx, fy) => set(hsv[0], fx, 1 - fy))} />
        <span className="absolute w-3 h-3 rounded-full border-2 border-white shadow pointer-events-none -translate-x-1/2 -translate-y-1/2" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }} />
      </div>
      <div className="relative h-3 rounded-full cursor-pointer" style={{ background: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
        onPointerDown={(e) => drag(e.currentTarget, e, (fx) => set(fx * 359.9, hsv[1] || 1, hsv[2] || 1))}>
        <span className="absolute top-1/2 w-3 h-3 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ left: `${(hsv[0] / 360) * 100}%` }} />
      </div>
    </div>
  )
}
