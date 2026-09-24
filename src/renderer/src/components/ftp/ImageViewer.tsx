import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import EditorShell, { type CloseRequest } from './EditorShell'
import { errText } from './shared'

// Visor de imágenes dentro del cuadro: texturas, server-icon.png, capturas…
// Sobre todo texturas de 16×16, así que al ampliar se ven los píxeles tal
// cual en vez de emborronados.

interface Props {
  name: string
  location: string
  /** Devuelve la imagen como data URL. */
  load: () => Promise<string>
  onClose: () => void
  closeRef?: MutableRefObject<CloseRequest | null>
}

const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32]

export default function ImageViewer({ name, location, load, onClose, closeRef }: Props) {
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [fitted, setFitted] = useState(true)
  const [dark, setDark] = useState(true)
  const areaRef = useRef<HTMLDivElement>(null)

  useEffect(() => { load().then(setSrc).catch((e) => setError(errText(e))) }, [])

  /** Lo más grande que cabe entero; las texturas pequeñas se amplían en saltos enteros para no deformar los píxeles. */
  function fitZoom(w: number, h: number): number {
    const area = areaRef.current
    if (!area) return 1
    const z = Math.min((area.clientWidth - 32) / w, (area.clientHeight - 32) / h)
    return z >= 1 ? Math.max(1, Math.floor(z)) : z
  }
  function fit(): void { if (size) { setZoom(fitZoom(size.w, size.h)); setFitted(true) } }
  function setExact(z: number): void { setZoom(z); setFitted(false) }
  function step(dir: 1 | -1): void {
    const next = dir > 0 ? ZOOMS.find((z) => z > zoom + 1e-6) : [...ZOOMS].reverse().find((z) => z < zoom - 1e-6)
    if (next) setExact(next)
  }

  const cell = dark ? '#26262c' : '#e4e4e7'
  return (
    <EditorShell title={name} subtitle={location} onClose={onClose} closeRef={closeRef}
      hint={size && <span className="shrink-0 text-[11px] font-normal text-text-muted bg-bg-hover px-2 py-0.5 rounded-full">{size.w} × {size.h} px</span>}
      onKeyDown={(e) => {
        if (e.key === '+' || e.key === '=') step(1)
        else if (e.key === '-') step(-1)
        else if (e.key === '0') fit()
        else if (e.key === '1') setExact(1)
      }}
      headerExtra={
        <div className="flex items-center gap-1 shrink-0">
          <ToolBtn onClick={() => step(-1)} title="Alejar (−)">−</ToolBtn>
          <span className="text-xs text-text-secondary tabular-nums w-12 text-center">{Math.round(zoom * 100)}%</span>
          <ToolBtn onClick={() => step(1)} title="Acercar (+)">＋</ToolBtn>
          <ToolBtn onClick={fit} title="Ajustar (0)" active={fitted}>Ajustar</ToolBtn>
          <ToolBtn onClick={() => setExact(1)} title="Tamaño real (1)" active={!fitted && zoom === 1}>1:1</ToolBtn>
          <ToolBtn onClick={() => setDark((d) => !d)} title="Fondo claro u oscuro">{dark ? '☀' : '☾'}</ToolBtn>
        </div>
      }>
      <div ref={areaRef}
        onWheel={(e) => { if (src) step(e.deltaY < 0 ? 1 : -1) }}
        className="flex-1 overflow-auto flex items-center justify-center min-h-0"
        style={{
          // Cuadros para que se note lo transparente, como en cualquier editor de imágenes
          backgroundColor: dark ? '#1b1b1f' : '#f4f4f5',
          backgroundImage: `linear-gradient(45deg, ${cell} 25%, transparent 25%, transparent 75%, ${cell} 75%), linear-gradient(45deg, ${cell} 25%, transparent 25%, transparent 75%, ${cell} 75%)`,
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 10px 10px'
        }}>
        {error ? (
          <p className="text-sm text-red-400 bg-bg-secondary/90 px-4 py-2 rounded-lg">{error}</p>
        ) : !src ? (
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        ) : (
          <img src={src} alt={name} draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget
              setSize({ w: img.naturalWidth, h: img.naturalHeight })
              setZoom(fitZoom(img.naturalWidth, img.naturalHeight))
            }}
            style={{
              width: size ? size.w * zoom : undefined,
              height: size ? size.h * zoom : undefined,
              maxWidth: 'none',
              imageRendering: zoom >= 2 ? 'pixelated' : 'auto',
              margin: 16,
              flexShrink: 0
            }} />
        )}
      </div>
    </EditorShell>
  )
}

function ToolBtn({ children, onClick, title, active }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`min-w-[30px] h-8 px-2 rounded-lg border text-sm ${
        active ? 'border-accent/60 text-accent bg-accent/10' : 'border-border text-text-secondary hover:text-text-primary hover:border-accent/40'
      }`}>
      {children}
    </button>
  )
}
