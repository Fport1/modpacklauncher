import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { SElement, SModel, V3 } from '../../lib/studio/model'
import type { StudioTex } from '../../lib/studio/textures'
import { buildElement } from '../../lib/studio/build'

// La vista 3D del Estudio. Dibuja los cubos del modelo como el juego (1 bloque = 16 px,
// norte hacia −z), deja elegirlos con el ratón, moverlos/cambiar su tamaño/girarlos con las
// flechas y pintar encima. No cambia el modelo: avisa a la página de lo que se hace y la
// página decide (así todo pasa por deshacer/rehacer).

export type Tool = 'select' | 'move' | 'resize' | 'rotate' | 'paint'
export type View = 'iso' | 'front' | 'side' | 'top'

export interface TransformDelta {
  kind: 'move' | 'resize' | 'rotate'
  /** move: desplazamiento; resize: factor por eje; rotate: grados en el eje */
  move?: V3
  scale?: V3
  axis?: 'x' | 'y' | 'z'
  angle?: number
}

interface Props {
  model: SModel
  textures: Map<string, StudioTex>
  selected: string[]
  tool: Tool
  gameLight: boolean
  /** Paso de los movimientos en píxeles (1 en modo fácil) */
  snap: number
  /** Eje de giro permitido (los modelos de bloque solo giran en uno) */
  rotateAxis: 'x' | 'y' | 'z'
  view: { v: View; n: number }
  /** Piezas animándose: cubos, punto de giro y movimiento */
  anim?: { cubes: Set<string>; origin: V3; motion: 'swing' | 'look' | 'spin' } | null
  onSelect: (ids: string[], additive: boolean) => void
  onTransform: (d: TransformDelta, phase: 'live' | 'commit' | 'start') => void
  onPaint: (ref: string, x: number, y: number, phase: 'start' | 'move' | 'end') => void
  onCamera?: () => void
}

/** Borde amarillo del cubo elegido (girado igual que él). */
function outline(e: SElement, color: number): THREE.Object3D {
  const g = new THREE.BoxGeometry(e.to[0] - e.from[0] || 0.01, e.to[1] - e.from[1] || 0.01, e.to[2] - e.from[2] || 0.01)
  const line = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }))
  line.renderOrder = 10
  line.position.set((e.from[0] + e.to[0]) / 2, (e.from[1] + e.to[1]) / 2, (e.from[2] + e.to[2]) / 2)
  if (!e.rotation || e.rotation.angle === 0) return line
  const pivot = new THREE.Group()
  const o = e.rotation.origin
  pivot.position.set(o[0], o[1], o[2])
  line.position.sub(new THREE.Vector3(o[0], o[1], o[2]))
  pivot.rotation[e.rotation.axis] = THREE.MathUtils.degToRad(e.rotation.angle)
  pivot.add(line)
  return pivot
}

function label(text: string, color = '#9fb3c8'): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 64; c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = color
  g.font = 'bold 40px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 32, 34)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }))
  s.scale.set(3, 3, 1)
  return s
}

export default function Viewport(p: Props) {
  const host = useRef<HTMLDivElement>(null)
  const props = useRef(p)
  props.current = p
  const s = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; orbit: OrbitControls
    gizmo: TransformControls; proxy: THREE.Object3D; root: THREE.Group; overlay: THREE.Group
    mats: Map<string, THREE.Material>; meshes: THREE.Object3D[]; dragging: boolean; painting: boolean
    start: { pos: THREE.Vector3; rot: THREE.Euler; scale: THREE.Vector3 } | null
  } | null>(null)

  // Escena: una vez
  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0x1b2433)
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(20, 40, 30)
    scene.add(sun)
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000)
    camera.position.set(30, 26, 34)
    const orbit = new OrbitControls(camera, renderer.domElement)
    orbit.target.set(0, 6, 0)
    orbit.enableDamping = true
    orbit.addEventListener('change', () => props.current.onCamera?.())

    // Rejilla de píxeles (1 bloque = 16) y el contorno del bloque
    const grid = new THREE.GridHelper(48, 48, 0x3a4a63, 0x26324a)
    scene.add(grid)
    const block = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(16, 16, 16)), new THREE.LineBasicMaterial({ color: 0x5b7099, transparent: true, opacity: 0.6 }))
    block.position.set(0, 8, 0)
    scene.add(block)
    const n = label('N'); n.position.set(0, 0.5, -11); scene.add(n)
    const so = label('S'); so.position.set(0, 0.5, 11); scene.add(so)
    const e = label('E'); e.position.set(11, 0.5, 0); scene.add(e)
    const w = label('O'); w.position.set(-11, 0.5, 0); scene.add(w)

    // El modelo va desplazado para que el bloque (0..16) quede centrado en la rejilla
    const root = new THREE.Group()
    root.position.set(-8, 0, -8)
    scene.add(root)
    const overlay = new THREE.Group()
    root.add(overlay)

    const proxy = new THREE.Object3D()
    root.add(proxy)
    const gizmo = new TransformControls(camera, renderer.domElement)
    gizmo.setSize(0.9)
    gizmo.attach(proxy)
    scene.add(gizmo)
    const state = { renderer, scene, camera, orbit, gizmo, proxy, root, overlay, mats: new Map(), meshes: [] as THREE.Object3D[], dragging: false, painting: false, start: null as null | { pos: THREE.Vector3; rot: THREE.Euler; scale: THREE.Vector3 } }
    s.current = state

    gizmo.addEventListener('dragging-changed', (ev) => {
      const on = (ev as unknown as { value: boolean }).value
      orbit.enabled = !on
      state.dragging = on
      const pr = props.current
      const kind = pr.tool === 'resize' ? 'resize' : pr.tool === 'rotate' ? 'rotate' : 'move'
      if (on) {
        state.start = { pos: proxy.position.clone(), rot: proxy.rotation.clone(), scale: proxy.scale.clone() }
        pr.onTransform({ kind }, 'start')
      } else if (state.start) {
        pr.onTransform(delta(kind), 'commit')
        state.start = null
      }
    })
    const delta = (kind: TransformDelta['kind']): TransformDelta => {
      const st = state.start!
      const pr = props.current
      if (kind === 'move') {
        const d = proxy.position.clone().sub(st.pos)
        const r = (v: number): number => Math.round(v / pr.snap) * pr.snap
        return { kind, move: [r(d.x), r(d.y), r(d.z)] }
      }
      if (kind === 'resize') return { kind, scale: [proxy.scale.x / st.scale.x, proxy.scale.y / st.scale.y, proxy.scale.z / st.scale.z] }
      const a = pr.rotateAxis
      return { kind, axis: a, angle: Math.round(THREE.MathUtils.radToDeg(proxy.rotation[a] - st.rot[a]) / 22.5) * 22.5 }
    }
    gizmo.addEventListener('objectChange', () => {
      if (!state.start) return
      const pr = props.current
      pr.onTransform(delta(pr.tool === 'resize' ? 'resize' : pr.tool === 'rotate' ? 'rotate' : 'move'), 'live')
    })

    // Elegir y pintar con el ratón
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let down: { x: number; y: number } | null = null
    const hit = (ev: PointerEvent): THREE.Intersection | null => {
      const r = renderer.domElement.getBoundingClientRect()
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const hits = ray.intersectObjects(state.meshes, true).filter((h) => (h.object as THREE.Mesh).isMesh && (h.object.userData as { uid?: string }).uid)
      return hits[0] ?? null
    }
    const paintAt = (ev: PointerEvent, phase: 'start' | 'move'): void => {
      const h = hit(ev)
      if (!h || !h.uv || h.face === undefined || h.face === null) return
      const mesh = h.object as THREE.Mesh
      const geo = mesh.geometry as THREE.BufferGeometry
      const grp = geo.groups.find((g) => h.faceIndex !== undefined && h.faceIndex! * 3 >= g.start && h.faceIndex! * 3 < g.start + g.count)
      const idx = grp ? geo.groups.indexOf(grp) : -1
      const ref = (mesh.userData as { faceRefs: (string | null)[] }).faceRefs[idx]
      const tex = ref ? props.current.textures.get(ref) : undefined
      if (!tex || !ref) return
      const x = Math.min(tex.w - 1, Math.max(0, Math.floor(h.uv.x * tex.w)))
      const y = Math.min(tex.h - 1, Math.max(0, Math.floor((1 - h.uv.y) * tex.h)))
      props.current.onPaint(ref, x, y, phase)
    }
    const onDown = (ev: PointerEvent): void => {
      if (ev.button !== 0 || state.dragging) return
      down = { x: ev.clientX, y: ev.clientY }
      if (props.current.tool === 'paint' && hit(ev)) {
        state.painting = true
        orbit.enabled = false
        paintAt(ev, 'start')
      }
    }
    const onMove = (ev: PointerEvent): void => { if (state.painting) paintAt(ev, 'move') }
    const onUp = (ev: PointerEvent): void => {
      if (state.painting) {
        state.painting = false
        orbit.enabled = true
        props.current.onPaint('', 0, 0, 'end')
        down = null
        return
      }
      if (!down || state.dragging) { down = null; return }
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4
      down = null
      if (moved || props.current.tool === 'paint') return
      const h = hit(ev)
      props.current.onSelect(h ? [(h.object.userData as { uid: string }).uid] : [], ev.shiftKey || ev.ctrlKey)
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)

    const resize = (): void => {
      const { clientWidth: cw, clientHeight: ch } = el
      renderer.setSize(cw, ch)
      camera.aspect = cw / Math.max(1, ch)
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    let frame = 0
    const clock = new THREE.Clock()
    const loop = (): void => {
      frame = requestAnimationFrame(loop)
      orbit.update()
      // Animación de prueba de una pieza alrededor de su punto de giro
      const a = props.current.anim
      const t = clock.getElapsedTime()
      if (a && state.root.userData.anim) {
        const wrap = state.root.userData.anim as THREE.Group
        const amt = Math.sin(t * 4)
        wrap.rotation.set(0, 0, 0)
        if (a.motion === 'swing') wrap.rotation.x = amt * 0.7
        else if (a.motion === 'look') wrap.rotation.y = amt * 0.6
        else wrap.rotation.y = t * 2
      }
      renderer.render(scene, camera)
    }
    loop()
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('pointerup', onUp)
      gizmo.dispose()
      orbit.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
      s.current = null
    }
  }, [])

  // Modelo: se vuelve a montar cuando cambia
  useEffect(() => {
    const st = s.current
    if (!st) return
    for (const o of st.meshes) st.root.remove(o)
    if (st.root.userData.anim) { st.root.remove(st.root.userData.anim as THREE.Object3D); st.root.userData.anim = null }
    st.meshes = []
    st.overlay.clear()
    // Materiales nuevos si cambia la luz (las texturas se comparten)
    st.mats.forEach((m) => m.dispose())
    st.mats.clear()
    const els = p.model.elements ?? []
    const anim = p.anim
    let wrap: THREE.Group | null = null
    if (anim) {
      // Las piezas animadas cuelgan de un pivote en su punto de giro
      wrap = new THREE.Group()
      wrap.position.set(anim.origin[0], anim.origin[1], anim.origin[2])
      const inner = new THREE.Group()
      inner.position.set(-anim.origin[0], -anim.origin[1], -anim.origin[2])
      wrap.add(inner)
      wrap.userData.inner = inner
      st.root.add(wrap)
      st.root.userData.anim = wrap
    }
    for (const e of els) {
      if (e.hidden) continue
      const obj = buildElement(e, p.model, p.textures, p.gameLight, st.mats)
      if (wrap && anim?.cubes.has(e.uid)) (wrap.userData.inner as THREE.Group).add(obj)
      else st.root.add(obj)
      st.meshes.push(obj)
    }
    const sel = new Set(p.selected)
    for (const e of els) if (sel.has(e.uid) && !e.hidden) st.overlay.add(outline(e, 0xfacc15))
  }, [p.model, p.textures, p.gameLight, p.selected, p.anim])

  // Flechas: en el centro de lo elegido, del tipo de la herramienta
  useEffect(() => {
    const st = s.current
    if (!st || st.dragging) return
    const els = (p.model.elements ?? []).filter((e) => p.selected.includes(e.uid) && !e.locked)
    const active = els.length > 0 && (p.tool === 'move' || p.tool === 'resize' || p.tool === 'rotate')
    st.gizmo.visible = active
    st.gizmo.enabled = active
    if (!active) return
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (const e of els) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], e.from[k]); max[k] = Math.max(max[k], e.to[k]) }
    const one = els.length === 1 ? els[0] : null
    const pivot = p.tool === 'rotate' && one?.rotation ? one.rotation.origin : null
    st.proxy.position.set(pivot ? pivot[0] : (min[0] + max[0]) / 2, pivot ? pivot[1] : (min[1] + max[1]) / 2, pivot ? pivot[2] : (min[2] + max[2]) / 2)
    st.proxy.rotation.set(0, 0, 0)
    if (one?.rotation && p.tool === 'rotate') st.proxy.rotation[one.rotation.axis] = THREE.MathUtils.degToRad(one.rotation.angle)
    st.proxy.scale.set(1, 1, 1)
    st.gizmo.setMode(p.tool === 'resize' ? 'scale' : p.tool === 'rotate' ? 'rotate' : 'translate')
    st.gizmo.setTranslationSnap(p.snap)
    st.gizmo.setRotationSnap(THREE.MathUtils.degToRad(22.5))
    st.gizmo.setScaleSnap(null)
    st.gizmo.showX = p.tool !== 'rotate' || p.rotateAxis === 'x'
    st.gizmo.showY = p.tool !== 'rotate' || p.rotateAxis === 'y'
    st.gizmo.showZ = p.tool !== 'rotate' || p.rotateAxis === 'z'
  }, [p.model, p.selected, p.tool, p.snap, p.rotateAxis])

  // Vistas: frontal, lateral, desde arriba, en perspectiva
  useEffect(() => {
    const st = s.current
    if (!st) return
    const pos: Record<View, [number, number, number]> = { iso: [30, 26, 34], front: [0, 8, 44], side: [44, 8, 0], top: [0, 50, 0.01] }
    st.camera.position.set(...pos[p.view.v])
    st.orbit.target.set(0, p.view.v === 'top' ? 0 : 6, 0)
    st.orbit.update()
  }, [p.view.n])

  return <div ref={host} className="absolute inset-0" data-tour="viewport" />
}

/** Foto de lo que se ve (para las capturas de las pruebas). */
export function snapshotCanvas(el: HTMLElement | null): string | null {
  const c = el?.querySelector('canvas')
  return c ? c.toDataURL('image/png') : null
}
