import { useEffect, useMemo, useRef, useState } from 'react'
import { FACES, type FaceName, type Geometry, type GeoFaceUV } from '../lib/bedrockGeo'
import {
  applyGeoOverride, currentFaces, cubeKey,
  type BoneOverride, type CubeOverride, type FaceOverride, type GeoOverride
} from '../lib/modelOverrides'

type Vec3 = [number, number, number]
type Vec2 = [number, number]

export type EditorSelection =
  | { kind: 'bone'; bone: string }
  | { kind: 'cube'; bone: string; index: number }

const FACE_LABEL: Record<FaceName, string> = {
  up: 'Arriba', down: 'Abajo', north: 'Norte', south: 'Sur', east: 'Este', west: 'Oeste'
}

interface Props {
  geo: Geometry
  geoName: string
  override: GeoOverride
  onChange: (next: GeoOverride) => void
  selection: EditorSelection | null
  onSelect: (s: EditorSelection | null) => void
  texture: { dataUrl: string; w: number; h: number } | null
  onReset: () => void
  hasBundled: boolean
  saving: boolean
}

export default function ModelEditor({
  geo, geoName, override, onChange, selection, onSelect, texture, onReset, hasBundled, saving
}: Props) {
  const [face, setSelFace] = useState<FaceName>('north')
  const [confirmReset, setConfirmReset] = useState(false)

  // Geometría con los ajustes aplicados: es de donde sale el UV actual de cada
  // cara, venga de caja o de caras sueltas.
  const edited = useMemo(() => applyGeoOverride(geo, override), [geo, override])

  const selBone = selection ? geo.bones.find((b) => b.name === selection.bone) : undefined
  const boneOv: BoneOverride = selection ? override.bones?.[selection.bone] ?? {} : {}
  const cubeOv: CubeOverride =
    selection?.kind === 'cube' ? override.cubes?.[cubeKey(selection.bone, selection.index)] ?? {} : {}

  const editedCube = selection?.kind === 'cube'
    ? edited.bones.find((b) => b.name === selection.bone)?.cubes?.[selection.index]
    : undefined
  const originalCube = selection?.kind === 'cube' ? selBone?.cubes?.[selection.index] : undefined
  const mirror = cubeOv.mirror ?? originalCube?.mirror ?? selBone?.mirror ?? false
  const faces = editedCube ? currentFaces(editedCube, mirror) : null

  // ── Actualizaciones inmutables del ajuste ──
  function setBone(patch: Partial<BoneOverride>): void {
    if (selection?.kind !== 'bone') return
    onChange({ ...override, bones: { ...override.bones, [selection.bone]: { ...boneOv, ...patch } } })
  }
  function setCube(patch: Partial<CubeOverride>): void {
    if (selection?.kind !== 'cube') return
    const key = cubeKey(selection.bone, selection.index)
    onChange({ ...override, cubes: { ...override.cubes, [key]: { ...cubeOv, ...patch } } })
  }
  function setFace(which: FaceName, patch: Partial<FaceOverride>): void {
    const prev = cubeOv.faces?.[which] ?? {}
    setCube({ faces: { ...cubeOv.faces, [which]: { ...prev, ...patch } } })
  }

  /** Estado absoluto de una cara, para escribirlo entero al intercambiar. */
  function snapshot(f: GeoFaceUV): FaceOverride {
    return {
      uv: [...f.uv] as Vec2,
      size: [...(f.uv_size ?? [0, 0])] as Vec2,
      rotation: ((f.uv_rotation ?? 0) as FaceOverride['rotation']),
      hidden: f.hidden ?? false
    }
  }
  function swapWith(other: FaceName): void {
    if (!faces || other === face) return
    setCube({
      faces: { ...cubeOv.faces, [face]: snapshot(faces[other]), [other]: snapshot(faces[face]) }
    })
  }

  const hasEdits = (name: string, index?: number): boolean =>
    index === undefined ? !!override.bones?.[name] : !!override.cubes?.[cubeKey(name, index)]

  return (
    <div className="w-80 shrink-0 flex flex-col bg-bg-secondary border border-border rounded-xl overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-text-primary">Editar modelo</p>
          <p className="text-[10px] text-text-muted truncate">
            {geoName}{hasBundled && ' · con ajustes de la app'}
          </p>
        </div>
        <span className="text-[10px] text-text-muted">{saving ? 'Guardando…' : 'Guardado'}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Árbol de huesos y cubos */}
        <div className="p-1 border-b border-border max-h-52 overflow-y-auto">
          {geo.bones.map((bone) => (
            <div key={bone.name}>
              <button
                onClick={() => onSelect({ kind: 'bone', bone: bone.name })}
                className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-[11px] transition-colors ${
                  selection?.kind === 'bone' && selection.bone === bone.name
                    ? 'bg-accent/20 text-accent' : 'text-text-primary hover:bg-bg-primary'
                }`}
              >
                <span className="text-text-muted">▸</span>
                <span className="truncate flex-1">{bone.name}</span>
                {hasEdits(bone.name) && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
              </button>
              {(bone.cubes ?? []).map((_, i) => (
                <button
                  key={i}
                  onClick={() => onSelect({ kind: 'cube', bone: bone.name, index: i })}
                  className={`w-full flex items-center gap-1.5 pl-6 pr-2 py-0.5 rounded text-left text-[10px] transition-colors ${
                    selection?.kind === 'cube' && selection.bone === bone.name && selection.index === i
                      ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-bg-primary hover:text-text-primary'
                  }`}
                >
                  <span className="flex-1">cubo {i + 1}</span>
                  {hasEdits(bone.name, i) && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                </button>
              ))}
            </div>
          ))}
        </div>

        {!selection && (
          <p className="text-[11px] text-text-muted p-4 leading-relaxed">
            Elige un hueso para moverlo o girarlo con todo lo que cuelga de él, o un cubo
            para ajustarlo por separado y corregir sus caras. El cubo seleccionado sale
            marcado en verde en la vista.
          </p>
        )}

        {selection?.kind === 'bone' && (
          <Section title="Hueso">
            <Vec3Field label="Mover" value={boneOv.offset ?? [0, 0, 0]} step={0.5}
              onChange={(v) => setBone({ offset: v })} />
            <Vec3Field label="Girar (°)" value={boneOv.rotation ?? [0, 0, 0]} step={5}
              onChange={(v) => setBone({ rotation: v })} />
          </Section>
        )}

        {selection?.kind === 'cube' && (
          <>
            <Section title="Cubo">
              <Vec3Field label="Mover" value={cubeOv.offset ?? [0, 0, 0]} step={0.5}
                onChange={(v) => setCube({ offset: v })} />
              <Vec3Field label="Girar (°)" value={cubeOv.rotation ?? [0, 0, 0]} step={5}
                onChange={(v) => setCube({ rotation: v })} />
              <div className="flex items-center gap-3 text-[11px]">
                <label className="flex items-center gap-1.5 text-text-muted">
                  Inflar
                  <NumberBox value={cubeOv.inflate ?? originalCube?.inflate ?? 0} step={0.25}
                    onChange={(v) => setCube({ inflate: v })} />
                </label>
                <label className="flex items-center gap-1.5 text-text-muted cursor-pointer ml-auto">
                  <input type="checkbox" checked={mirror} onChange={(e) => setCube({ mirror: e.target.checked })} />
                  Espejo
                </label>
              </div>
            </Section>

            {faces && (
              <Section title="Caras">
                <div className="grid grid-cols-3 gap-1">
                  {FACES.map((f) => (
                    <button key={f} onClick={() => setSelFace(f)}
                      className={`px-1.5 py-1 rounded text-[10px] border transition-colors ${
                        face === f ? 'border-accent/60 bg-accent/15 text-accent' : 'border-border text-text-muted hover:text-text-primary'
                      } ${faces[f].hidden ? 'line-through opacity-60' : ''}`}>
                      {FACE_LABEL[f]}
                    </button>
                  ))}
                </div>

                {texture && (
                  <UVCanvas texture={texture} faces={faces} selected={face}
                    onMove={(uv) => setFace(face, { uv })} />
                )}

                <div className="grid grid-cols-4 gap-1">
                  <LabeledNumber label="U" value={faces[face].uv[0]} step={1}
                    onChange={(v) => setFace(face, { uv: [v, faces[face].uv[1]] })} />
                  <LabeledNumber label="V" value={faces[face].uv[1]} step={1}
                    onChange={(v) => setFace(face, { uv: [faces[face].uv[0], v] })} />
                  <LabeledNumber label="Ancho" value={faces[face].uv_size?.[0] ?? 0} step={1}
                    onChange={(v) => setFace(face, { size: [v, faces[face].uv_size?.[1] ?? 0] })} />
                  <LabeledNumber label="Alto" value={faces[face].uv_size?.[1] ?? 0} step={1}
                    onChange={(v) => setFace(face, { size: [faces[face].uv_size?.[0] ?? 0, v] })} />
                </div>

                <div className="flex flex-wrap gap-1">
                  <SmallButton onClick={() => setFace(face, {
                    rotation: ((((faces[face].uv_rotation ?? 0) + 90) % 360) as FaceOverride['rotation'])
                  })}>↻ Girar 90°</SmallButton>
                  <SmallButton onClick={() => {
                    const [u, v] = faces[face].uv
                    const [w, h] = faces[face].uv_size ?? [0, 0]
                    setFace(face, { uv: [u + w, v], size: [-w, h] })
                  }}>⇆ Voltear H</SmallButton>
                  <SmallButton onClick={() => {
                    const [u, v] = faces[face].uv
                    const [w, h] = faces[face].uv_size ?? [0, 0]
                    setFace(face, { uv: [u, v + h], size: [w, -h] })
                  }}>⇅ Voltear V</SmallButton>
                  <SmallButton onClick={() => setFace(face, { hidden: !faces[face].hidden })}>
                    {faces[face].hidden ? 'Mostrar' : 'Ocultar'}
                  </SmallButton>
                </div>

                <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  Intercambiar con
                  <select value="" onChange={(e) => swapWith(e.target.value as FaceName)}
                    className="flex-1 bg-bg-primary border border-border rounded px-1.5 py-0.5 text-[11px] text-text-primary">
                    <option value="">elige cara…</option>
                    {FACES.filter((f) => f !== face).map((f) => (
                      <option key={f} value={f}>{FACE_LABEL[f]}</option>
                    ))}
                  </select>
                </label>
                <p className="text-[10px] text-text-muted leading-snug">
                  Arrastra el recuadro verde sobre la textura para mover la región de esta cara.
                </p>
              </Section>
            )}
          </>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border flex items-center gap-2">
        {confirmReset ? (
          <>
            <span className="text-[11px] text-text-muted flex-1">¿Borrar tus ajustes de este mob?</span>
            <SmallButton danger onClick={() => { onReset(); setConfirmReset(false); onSelect(null) }}>Sí</SmallButton>
            <SmallButton onClick={() => setConfirmReset(false)}>No</SmallButton>
          </>
        ) : (
          <SmallButton onClick={() => setConfirmReset(true)}>Restablecer este mob</SmallButton>
        )}
      </div>
    </div>
  )
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-3 border-b border-border space-y-2.5">
      <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">{title}</p>
      {children}
    </div>
  )
}

function SmallButton({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={`px-2 py-1 rounded border text-[10px] transition-colors ${
        danger ? 'border-red-500/40 text-red-400 hover:bg-red-500/10' : 'border-border text-text-muted hover:text-text-primary hover:border-accent/50'
      }`}>
      {children}
    </button>
  )
}

function NumberBox({ value, step, onChange }: { value: number; step: number; onChange: (v: number) => void }) {
  // Borrador local: sin él, escribir "-" o "0." se reinterpreta como número y
  // borra lo tecleado a mitad.
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])

  return (
    <input
      type="number" step={step} value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        const n = parseFloat(e.target.value)
        if (Number.isFinite(n)) onChange(n)
      }}
      // Sin esto, desplazar el panel con la rueda sobre un campo enfocado
      // cambia su valor sin querer
      onWheel={(e) => e.currentTarget.blur()}
      className="w-14 bg-bg-primary border border-border rounded px-1.5 py-0.5 text-[11px] text-text-primary outline-none focus:border-accent/60 tabular-nums"
    />
  )
}

function LabeledNumber({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5 text-[9px] text-text-muted">
      {label}
      <NumberBox value={value} step={step} onChange={onChange} />
    </label>
  )
}

function Vec3Field({ label, value, step, onChange }: { label: string; value: Vec3; step: number; onChange: (v: Vec3) => void }) {
  const axis = ['X', 'Y', 'Z'] as const
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-text-muted">{label}</span>
        {(value[0] !== 0 || value[1] !== 0 || value[2] !== 0) && (
          <button onClick={() => onChange([0, 0, 0])} className="text-[9px] text-text-muted hover:text-accent">
            a cero
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {axis.map((a, i) => (
          <div key={a} className="flex items-center gap-0.5">
            <button onClick={() => { const v = [...value] as Vec3; v[i] -= step; onChange(v) }}
              className="w-4 h-5 rounded text-[10px] text-text-muted hover:text-text-primary hover:bg-bg-primary">−</button>
            <div className="flex-1 flex flex-col items-center">
              <span className="block text-[8px] text-text-muted leading-none mb-0.5">{a}</span>
              <NumberBox value={value[i]} step={step} onChange={(n) => { const v = [...value] as Vec3; v[i] = n; onChange(v) }} />
            </div>
            <button onClick={() => { const v = [...value] as Vec3; v[i] += step; onChange(v) }}
              className="w-4 h-5 rounded text-[10px] text-text-muted hover:text-text-primary hover:bg-bg-primary">+</button>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Textura con la región de cada cara dibujada encima. La cara seleccionada va
 * en verde y se puede arrastrar para cambiar qué trozo del PNG muestra.
 */
function UVCanvas({ texture, faces, selected, onMove }: {
  texture: { dataUrl: string; w: number; h: number }
  faces: Record<FaceName, GeoFaceUV>
  selected: FaceName
  onMove: (uv: Vec2) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const drag = useRef<{ x: number; y: number; uv: Vec2 } | null>(null)
  const WIDTH = 272
  const scale = WIDTH / texture.w
  const height = Math.round(texture.h * scale)

  useEffect(() => {
    const img = new Image()
    img.onload = () => { imgRef.current = img; draw() }
    img.src = texture.dataUrl
  }, [texture.dataUrl])

  useEffect(() => { draw() }, [faces, selected])

  function draw(): void {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    for (const f of FACES) {
      const face = faces[f]
      if (face.hidden) continue
      const [u, v] = face.uv
      const [w, h] = face.uv_size ?? [0, 0]
      // Los tamaños negativos (caras volteadas) se dibujan normalizados
      const x = Math.min(u, u + w) * scale
      const y = Math.min(v, v + h) * scale
      const isSel = f === selected
      ctx.strokeStyle = isSel ? '#22c55e' : 'rgba(255,255,255,0.35)'
      ctx.lineWidth = isSel ? 2 : 1
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(w) * scale, Math.abs(h) * scale)
      if (isSel) {
        ctx.fillStyle = 'rgba(34,197,94,0.15)'
        ctx.fillRect(x, y, Math.abs(w) * scale, Math.abs(h) * scale)
      }
    }
  }

  return (
    <div className="rounded-md overflow-hidden border border-border bg-[repeating-conic-gradient(#1e1e28_0%_25%,#16161e_0%_50%)] bg-[length:12px_12px]">
      <canvas
        ref={canvasRef} width={WIDTH} height={height}
        className="block cursor-move"
        style={{ imageRendering: 'pixelated' }}
        onMouseDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, uv: [...faces[selected].uv] as Vec2 }
        }}
        onMouseMove={(e) => {
          const d = drag.current
          if (!d) return
          // Se mueve en píxeles enteros de la textura, que es como se pintan
          const du = Math.round((e.clientX - d.x) / scale)
          const dv = Math.round((e.clientY - d.y) / scale)
          onMove([d.uv[0] + du, d.uv[1] + dv])
        }}
        onMouseUp={() => { drag.current = null }}
        onMouseLeave={() => { drag.current = null }}
      />
    </div>
  )
}
