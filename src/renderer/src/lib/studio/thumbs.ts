import * as THREE from 'three'
import type { StudioModelEntry } from '../../../../shared/types'
import { buildModel, extrudeItem } from './build'
import { loadView } from './load'
import type { StudioTex } from './textures'

// Miniaturas de la lista de modelos: un único WebGL fuera de pantalla que va dibujando los
// modelos de uno en uno (en cola) con la luz del juego. Se guardan en disco por modelo y fecha
// del archivo, así la segunda vez salen al momento.

const SIZE = 160
let renderer: THREE.WebGLRenderer | null = null
const texCache = new Map<string, Promise<StudioTex | null>>()
const mem = new Map<string, string | null>()
const waiting = new Map<string, Promise<string | null>>()
let queue: Promise<unknown> = Promise.resolve()

function draw(group: THREE.Group, flat: boolean): string {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setSize(SIZE, SIZE)
    renderer.setClearColor(0x000000, 0)
  }
  const scene = new THREE.Scene()
  scene.add(group)
  const box = new THREE.Box3().setFromObject(group)
  if (box.isEmpty()) return ''
  const c = box.getCenter(new THREE.Vector3())
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 200)
  // Como en el inventario: los bloques en isométrico, los objetos planos de frente
  if (flat) cam.position.set(c.x, c.y, c.z + 50)
  else cam.position.set(c.x - 40, c.y + 32, c.z + 40)
  cam.lookAt(c)
  cam.updateMatrixWorld()
  // Encuadre justo: las 8 esquinas de la caja vistas desde la cámara
  const inv = cam.matrixWorldInverse
  let r = 0
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(inv).sub(c.clone().applyMatrix4(inv))
    r = Math.max(r, Math.abs(p.x), Math.abs(p.y))
  }
  r *= 1.06
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r
  cam.updateProjectionMatrix()
  renderer.render(scene, cam)
  const url = renderer.domElement.toDataURL('image/png')
  group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose() })
  return url
}

export function thumbnail(e: StudioModelEntry): Promise<string | null> {
  const key = `${e.id}@${e.mtime}`
  if (mem.has(key)) return Promise.resolve(mem.get(key)!)
  const w = waiting.get(key)
  if (w) return w
  const p = (async () => {
    const disk = await window.api.studio.thumbGet(e.id, `${e.mtime}:v2`).catch(() => null)
    if (disk) return disk
    const job = queue.then(async () => {
      try {
        const v = await loadView(e.id, texCache)
        const m = v.flat ? { ...v.model, elements: extrudeItem(v.model, v.textures) } : v.shape ?? v.model
        if (!m.elements?.length) return null
        const url = draw(buildModel(m, v.textures, true), v.flat)
        if (url) void window.api.studio.thumbSet(e.id, `${e.mtime}:v2`, url).catch(() => {})
        return url || null
      } catch { return null }
    })
    queue = job.catch(() => null)
    return job
  })()
  waiting.set(key, p)
  void p.then((u) => { mem.set(key, u); waiting.delete(key) })
  return p
}

/** Olvida la miniatura de un modelo (al guardarlo cambia la fecha y se hace otra). */
export function forgetTextures(): void { texCache.clear() }
