import * as THREE from 'three'
import { QuadAccumulator } from './mcmodel'

// ─────────────────────────────────────────────────────────────────────────────
// OptiFine CEM (.jem) parser — the Custom Entity Models format used by packs
// like Fresh Animations (read by OptiFine or the EMF mod).
// Coordinates are Java model space (y down); invertAxis "xy" is the standard.
// Animations (the "animations" blocks with expressions) are NOT interpreted —
// we render the static base pose.
// ─────────────────────────────────────────────────────────────────────────────

type Vec3 = [number, number, number]
type UV = [number, number]

interface JemBox {
  coordinates?: number[]
  textureOffset?: UV
  sizeAdd?: number
  uvNorth?: [number, number, number, number]
  uvSouth?: [number, number, number, number]
  uvEast?: [number, number, number, number]
  uvWest?: [number, number, number, number]
  uvUp?: [number, number, number, number]
  uvDown?: [number, number, number, number]
}

interface JemPart {
  part?: string
  id?: string
  invertAxis?: string
  translate?: Vec3
  rotate?: Vec3
  mirrorTexture?: string
  boxes?: JemBox[]
  submodels?: JemPart[]
  submodel?: JemPart
  textureSize?: UV
}

export interface JemModel {
  textureSize?: UV
  texture?: string
  models?: JemPart[]
}

export function isJemModel(json: unknown): json is JemModel {
  return !!json && typeof json === 'object' && Array.isArray((json as JemModel).models)
}

const rad = (d: number) => (d * Math.PI) / 180

function rotatePoint(p: Vec3, pivot: Vec3, [rx, ry, rz]: Vec3): Vec3 {
  let x = p[0] - pivot[0]
  let y = p[1] - pivot[1]
  let z = p[2] - pivot[2]
  if (rz) { const c = Math.cos(rad(rz)); const s = Math.sin(rad(rz)); [x, y] = [x * c - y * s, x * s + y * c] }
  if (ry) { const c = Math.cos(rad(ry)); const s = Math.sin(rad(ry)); [x, z] = [x * c + z * s, -x * s + z * c] }
  if (rx) { const c = Math.cos(rad(rx)); const s = Math.sin(rad(rx)); [y, z] = [y * c - z * s, y * s + z * c] }
  return [x + pivot[0], y + pivot[1], z + pivot[2]]
}

type Corners = [Vec3, Vec3, Vec3, Vec3]

function faceCorners(face: string, [x1, y1, z1]: Vec3, [x2, y2, z2]: Vec3): { corners: Corners; normal: Vec3 } {
  switch (face) {
    case 'north': return { corners: [[x2, y2, z1], [x1, y2, z1], [x2, y1, z1], [x1, y1, z1]], normal: [0, 0, -1] }
    case 'south': return { corners: [[x1, y2, z2], [x2, y2, z2], [x1, y1, z2], [x2, y1, z2]], normal: [0, 0, 1] }
    case 'east':  return { corners: [[x2, y2, z2], [x2, y2, z1], [x2, y1, z2], [x2, y1, z1]], normal: [1, 0, 0] }
    case 'west':  return { corners: [[x1, y2, z1], [x1, y2, z2], [x1, y1, z1], [x1, y1, z2]], normal: [-1, 0, 0] }
    case 'up':    return { corners: [[x2, y2, z2], [x1, y2, z2], [x2, y2, z1], [x1, y2, z1]], normal: [0, 1, 0] }
    default:      return { corners: [[x2, y1, z1], [x1, y1, z1], [x2, y1, z2], [x1, y1, z2]], normal: [0, -1, 0] }
  }
}

const FACES = ['up', 'down', 'east', 'north', 'west', 'south'] as const

function boxUVRects(u: number, v: number, w: number, h: number, d: number): Record<string, [number, number, number, number]> {
  return {
    up:    [u + d, v, u + d + w, v + d],
    down:  [u + d + w, v, u + d + 2 * w, v + d],
    east:  [u, v + d, u + d, v + d + h],
    north: [u + d, v + d, u + d + w, v + d + h],
    west:  [u + d + w, v + d, u + d + w + d, v + d + h],
    south: [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h],
  }
}

interface Transform { pivot: Vec3; rot: Vec3 }

function emitPart(
  acc: QuadAccumulator,
  part: JemPart,
  parentTransforms: Transform[],
  texW: number,
  texH: number
): void {
  const invert = part.invertAxis ?? 'xy'
  const ix = invert.includes('x') ? -1 : 1
  const iy = invert.includes('y') ? -1 : 1
  const iz = invert.includes('z') ? -1 : 1
  const t = part.translate ?? [0, 0, 0]
  const pivot: Vec3 = [t[0] * ix, t[1] * iy, t[2] * iz]
  const rot = part.rotate ?? [0, 0, 0]
  const transforms: Transform[] = [
    ...(rot[0] || rot[1] || rot[2] ? [{ pivot, rot: [-rot[0], -rot[1], rot[2]] as Vec3 }] : []),
    ...parentTransforms,
  ]
  const mirrorU = (part.mirrorTexture ?? '').includes('u')

  for (const box of part.boxes ?? []) {
    const c = box.coordinates
    if (!c || c.length < 6) continue
    const [bx, by, bz, sw, sh, sd] = c
    const inf = box.sizeAdd ?? 0
    // Java y-down → render y-up (+ axis inversion)
    const xs = [bx * ix, (bx + sw) * ix].sort((a, b) => a - b)
    const ys = [by * iy, (by + sh) * iy].sort((a, b) => a - b)
    const zs = [bz * iz, (bz + sd) * iz].sort((a, b) => a - b)
    const from: Vec3 = [xs[0] - inf, ys[0] - inf, zs[0] - inf]
    const to: Vec3 = [xs[1] + inf, ys[1] + inf, zs[1] + inf]

    for (const face of FACES) {
      let rect: [number, number, number, number] | null = null
      const perFace = {
        north: box.uvNorth, south: box.uvSouth, east: box.uvEast,
        west: box.uvWest, up: box.uvUp, down: box.uvDown,
      }[face]
      if (perFace) rect = perFace
      else if (box.textureOffset) {
        const rects = boxUVRects(box.textureOffset[0], box.textureOffset[1], Math.abs(sw), Math.abs(sh), Math.abs(sd))
        rect = rects[face]
      }
      if (!rect) continue

      let { corners, normal } = faceCorners(face, from, to)
      if (transforms.length > 0) {
        corners = corners.map(p => {
          let q = p
          for (const tr of transforms) q = rotatePoint(q, tr.pivot, tr.rot)
          return q
        }) as Corners
        let nEnd: Vec3 = normal
        let nOrg: Vec3 = [0, 0, 0]
        for (const tr of transforms) {
          nEnd = rotatePoint(nEnd, [0, 0, 0], tr.rot)
          nOrg = rotatePoint(nOrg, [0, 0, 0], tr.rot)
        }
        normal = [nEnd[0] - nOrg[0], nEnd[1] - nOrg[1], nEnd[2] - nOrg[2]]
      }

      const [u1, v1, u2, v2] = rect
      const n = (u: number, v: number): UV => [u / texW, 1 - v / texH]
      let uvC: [UV, UV, UV, UV] = [n(u1, v1), n(u2, v1), n(u1, v2), n(u2, v2)]
      if (mirrorU) uvC = [uvC[1], uvC[0], uvC[3], uvC[2]]
      acc.addQuad(corners, uvC, normal)
    }
  }

  for (const sub of part.submodels ?? []) emitPart(acc, sub, transforms, texW, texH)
  if (part.submodel) emitPart(acc, part.submodel, transforms, texW, texH)
}

export function buildJemModel(jem: JemModel, texture: THREE.Texture | null, imgW?: number, imgH?: number): THREE.Group {
  const texW = imgW ?? jem.textureSize?.[0] ?? 64
  const texH = imgH ?? jem.textureSize?.[1] ?? 32
  const acc = new QuadAccumulator()
  for (const part of jem.models ?? []) {
    const partTexW = part.textureSize?.[0] ?? texW
    const partTexH = part.textureSize?.[1] ?? texH
    emitPart(acc, part, [], partTexW, partTexH)
  }
  const geometry = acc.toGeometry()
  geometry.scale(1 / 16, 1 / 16, 1 / 16)
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox!
  geometry.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2)

  const mat = new THREE.MeshLambertMaterial({
    map: texture ?? undefined,
    color: texture ? 0xffffff : 0x9a9aa8,
    transparent: true,
    alphaTest: 0.05,
    side: THREE.DoubleSide,
  })
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geometry, mat))
  return group
}
