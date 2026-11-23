import * as THREE from 'three'
import { DIRS, defaultUv, resolveTex, type Dir, type SElement, type SModel, type V3 } from './model'
import { frameH, type StudioTex } from './textures'

// Monta en three.js los cubos de un modelo, igual que el juego. Lo usan la vista 3D y las
// miniaturas de la lista.

/** Las 4 esquinas de cada cara: arriba-izquierda, arriba-derecha, abajo-izquierda, abajo-derecha. */
function corners(d: Dir, a: V3, b: V3): V3[] {
  const [x1, y1, z1] = a, [x2, y2, z2] = b
  switch (d) {
    case 'north': return [[x2, y2, z1], [x1, y2, z1], [x2, y1, z1], [x1, y1, z1]]
    case 'south': return [[x1, y2, z2], [x2, y2, z2], [x1, y1, z2], [x2, y1, z2]]
    case 'east': return [[x2, y2, z2], [x2, y2, z1], [x2, y1, z2], [x2, y1, z1]]
    case 'west': return [[x1, y2, z1], [x1, y2, z2], [x1, y1, z1], [x1, y1, z2]]
    case 'up': return [[x1, y2, z1], [x2, y2, z1], [x1, y2, z2], [x2, y2, z2]]
    case 'down': return [[x1, y1, z2], [x2, y1, z2], [x1, y1, z1], [x2, y1, z1]]
  }
}

/** Luz de cada cara como en el juego (arriba la más clara, abajo la más oscura). */
export const SHADE: Record<Dir, number> = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 }

const missing = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 2
  const g = c.getContext('2d')!
  g.fillStyle = '#f800f8'; g.fillRect(0, 0, 1, 1); g.fillRect(1, 1, 1, 1)
  g.fillStyle = '#000'; g.fillRect(1, 0, 1, 1); g.fillRect(0, 1, 1, 1)
  const t = new THREE.CanvasTexture(c)
  t.magFilter = THREE.NearestFilter
  return t
})()

export function buildElement(e: SElement, m: SModel, textures: Map<string, StudioTex>, game: boolean, mats: Map<string, THREE.Material>): THREE.Object3D {
  const pos: number[] = [], uv: number[] = [], groups: { start: number; mat: number }[] = []
  const matList: THREE.Material[] = []
  const faceRefs: (string | null)[] = []
  for (const d of DIRS) {
    const f = e.faces[d]
    if (!f) continue
    const ref = resolveTex(m, f.texture)
    const tex = ref ? textures.get(ref) : undefined
    const shade = game && e.shade !== false ? SHADE[d] : 1
    const key = `${ref ?? 'x'}|${game ? shade : 'ed'}`
    let mat = mats.get(key)
    if (!mat) {
      const map = tex?.three ?? missing
      mat = game
        ? new THREE.MeshBasicMaterial({ map, color: new THREE.Color(shade, shade, shade), alphaTest: 0.1, side: THREE.DoubleSide })
        : new THREE.MeshLambertMaterial({ map, alphaTest: 0.1, side: THREE.DoubleSide })
      mats.set(key, mat)
    }
    let mi = matList.indexOf(mat)
    if (mi < 0) { matList.push(mat); mi = matList.length - 1 }
    const c = corners(d, e.from, e.to)
    const [u1, v1, u2, v2] = f.uv ?? defaultUv(d, e)
    const fh = tex ? frameH(tex) / tex.h : 1
    // UV de las esquinas en el mismo orden; la rotación de la cara las va pasando
    const uvs: [number, number][] = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]] // TL TR BR BL
    const rot = ((f.rotation ?? 0) / 90) & 3
    const r = (i: number): [number, number] => uvs[(i + rot) % 4]
    const cornerUv = [r(0), r(1), r(3), r(2)] // TL TR BL BR
    const toUv = ([u, v]: [number, number]): [number, number] => [u / 16, 1 - (v / 16) * fh]
    const order = [0, 2, 1, 1, 2, 3]
    groups.push({ start: pos.length / 3, mat: mi })
    faceRefs.push(ref)
    for (const k of order) {
      pos.push(...c[k])
      uv.push(...toUv(cornerUv[k]))
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.computeVertexNormals()
  groups.forEach((g, i) => geo.addGroup(g.start, 6, g.mat))
  // Para pintar: qué textura tiene cada grupo de caras
  const mesh = new THREE.Mesh(geo, matList.length ? matList : [new THREE.MeshBasicMaterial({ visible: false })])
  mesh.userData = { uid: e.uid, faceRefs }
  if (!e.rotation || e.rotation.angle === 0) return mesh
  // Giro alrededor de su punto: el cubo cuelga de un pivote colocado en ese punto
  const pivot = new THREE.Group()
  const o = e.rotation.origin
  pivot.position.set(o[0], o[1], o[2])
  mesh.position.set(-o[0], -o[1], -o[2])
  const rad = THREE.MathUtils.degToRad(e.rotation.angle)
  pivot.rotation[e.rotation.axis] = rad
  if (e.rotation.rescale) {
    const s = 1 / Math.cos(Math.abs(rad))
    pivot.scale.set(e.rotation.axis === 'x' ? 1 : s, e.rotation.axis === 'y' ? 1 : s, e.rotation.axis === 'z' ? 1 : s)
  }
  pivot.add(mesh)
  pivot.userData = { uid: e.uid }
  return pivot
}


/** Objetos planos (item/generated): cada píxel opaco es un cubito de 1 píxel de grueso, como en el
 * juego (de z 7,5 a 8,5). Las caras de los lados solo donde el vecino es transparente. */
export function extrudeItem(m: SModel, textures: Map<string, StudioTex>): SElement[] {
  const out: SElement[] = []
  for (let n = 0; n < 5; n++) {
    const key = `layer${n}`
    if (!m.textures[key]) continue
    const ref = resolveTex(m, `#${key}`)
    const t = ref ? textures.get(ref) : undefined
    if (!t) continue
    const fh = frameH(t)
    const d = t.ctx.getImageData(0, 0, t.w, fh).data
    const op = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < t.w && y < fh && d[(y * t.w + x) * 4 + 3] > 0
    const sx = 16 / t.w, sy = 16 / fh
    const z1 = 7.5 - n * 0.01, z2 = 8.5 + n * 0.01
    for (let y = 0; y < fh; y++) for (let x = 0; x < t.w; x++) {
      if (!op(x, y)) continue
      const uv: [number, number, number, number] = [x * sx, y * sy, (x + 1) * sx, (y + 1) * sy]
      const tex = `#${key}`
      const e: SElement = { uid: `flat-${n}-${x}-${y}`, from: [x * sx, 16 - (y + 1) * sy, z1], to: [(x + 1) * sx, 16 - y * sy, z2], faces: {} }
      e.faces.south = { texture: tex, uv }
      e.faces.north = { texture: tex, uv: [uv[2], uv[1], uv[0], uv[3]] }
      if (!op(x - 1, y)) e.faces.west = { texture: tex, uv }
      if (!op(x + 1, y)) e.faces.east = { texture: tex, uv }
      if (!op(x, y - 1)) e.faces.up = { texture: tex, uv }
      if (!op(x, y + 1)) e.faces.down = { texture: tex, uv }
      out.push(e)
    }
  }
  return out
}

/** Todo el modelo como un grupo (para miniaturas). */
export function buildModel(m: SModel, textures: Map<string, StudioTex>, game = true): THREE.Group {
  const g = new THREE.Group()
  const mats = new Map<string, THREE.Material>()
  for (const e of m.elements ?? []) if (!e.hidden) g.add(buildElement(e, m, textures, game, mats))
  return g
}
