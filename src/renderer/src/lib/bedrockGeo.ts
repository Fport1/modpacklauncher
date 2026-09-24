import * as THREE from 'three'
import { QuadAccumulator } from './mcmodel'

// ─────────────────────────────────────────────────────────────────────────────
// Parser/builder for Minecraft bedrock-style entity geometry (.geo.json).
// This is the format Mojang publishes in bedrock-samples AND the format
// GeckoLib/AzureLib mods embed in their jars — one parser covers both.
// Conversion to render space follows the Blockbench convention:
//   x is mirrored, pivots/rotations adjusted, entity faces north (−z).
// ─────────────────────────────────────────────────────────────────────────────

type Vec3 = [number, number, number]
type UV = [number, number]

/** UV de una cara concreta. Tamaño negativo = imagen volteada en ese eje. */
export interface GeoFaceUV {
  uv: UV
  uv_size?: UV
  /** Giro de la imagen sobre la cara, en grados (0, 90, 180, 270). */
  uv_rotation?: number
  /** Cara sin dibujar. */
  hidden?: boolean
}

export interface GeoCube {
  origin: Vec3
  size: Vec3
  uv?: UV | Record<string, GeoFaceUV>
  inflate?: number
  mirror?: boolean
  pivot?: Vec3
  rotation?: Vec3
}

export interface GeoBone {
  name: string
  parent?: string
  pivot?: Vec3
  /** skeleton rotation — propagates to children */
  rot?: Vec3
  /** legacy bind_pose_rotation — poses only this bone, children stay put */
  bindRot?: Vec3
  mirror?: boolean
  cubes?: GeoCube[]
}

export interface Geometry {
  texW: number
  texH: number
  bones: GeoBone[]
}

// ── Parsing (both 1.8 legacy and 1.12+ formats) ─────────────────────────────

function normBones(raw: any[]): GeoBone[] {
  return (raw ?? []).map((b: any) => ({
    name: b.name,
    parent: b.parent,
    pivot: b.pivot,
    rot: b.rot ?? b.rotation,
    bindRot: b.bindRot ?? b.bind_pose_rotation,
    mirror: b.mirror,
    cubes: (b.cubes ?? []).map((c: any) => ({
      origin: c.origin, size: c.size, uv: c.uv,
      inflate: c.inflate, mirror: c.mirror, pivot: c.pivot, rotation: c.rotation,
    })),
  }))
}

/** Parses a raw .geo.json object. Returns geometries keyed by identifier short name. */
export function parseGeoJson(json: any): Record<string, Geometry> {
  const out: Record<string, Geometry> = {}
  const short = (id: string) => id.replace(/^geometry\./, '').replace(/\.v\d+(\.\d+)*$/, '').replace(/\./g, '_')

  if (Array.isArray(json?.['minecraft:geometry'])) {
    for (const g of json['minecraft:geometry']) {
      if (!g?.bones) continue
      const name = short(g.description?.identifier ?? 'model')
      out[name] = {
        texW: g.description?.texture_width ?? 64,
        texH: g.description?.texture_height ?? 32,
        bones: normBones(g.bones),
      }
    }
    return out
  }
  for (const [key, g] of Object.entries(json ?? {})) {
    if (!key.startsWith('geometry.') || typeof g !== 'object' || !(g as any).bones) continue
    if (key.includes(':')) continue
    out[short(key)] = {
      texW: (g as any).texturewidth ?? 64,
      texH: (g as any).textureheight ?? 32,
      bones: normBones((g as any).bones),
    }
  }
  return out
}

// ── Coordinate conversion helpers ────────────────────────────────────────────

const rad = (d: number) => (d * Math.PI) / 180

/** Applies a bedrock bone/cube rotation (already converted) around a pivot, order Z→Y→X. */
function rotatePoint(p: Vec3, pivot: Vec3, [rx, ry, rz]: Vec3): Vec3 {
  let x = p[0] - pivot[0]
  let y = p[1] - pivot[1]
  let z = p[2] - pivot[2]
  if (rz) {
    const c = Math.cos(rad(rz)); const s = Math.sin(rad(rz))
    ;[x, y] = [x * c - y * s, x * s + y * c]
  }
  if (ry) {
    const c = Math.cos(rad(ry)); const s = Math.sin(rad(ry))
    ;[x, z] = [x * c + z * s, -x * s + z * c]
  }
  if (rx) {
    const c = Math.cos(rad(rx)); const s = Math.sin(rad(rx))
    ;[y, z] = [y * c - z * s, y * s + z * c]
  }
  return [x + pivot[0], y + pivot[1], z + pivot[2]]
}

const convPivot = (p?: Vec3): Vec3 => p ? [-p[0], p[1], p[2]] : [0, 0, 0]
const convRot = (r?: Vec3): Vec3 => r ? [-r[0], -r[1], r[2]] : [0, 0, 0]
const hasRot = (r: Vec3) => r[0] !== 0 || r[1] !== 0 || r[2] !== 0

// ── Pose fixups ──────────────────────────────────────────────────────────────
// Some models rely on runtime animations for their basic stance (cat/wolf body
// horizontal, enderman head height…). These static poses replicate that.

interface PoseFix { rot?: Vec3; ofs?: Vec3 }

// Only for mobs WITHOUT an official setup/pose animation (those come from
// bedrockAnims and are auto-applied by the mobs tab — don't double up here).
const POSE_FIXUPS: Record<string, Record<string, PoseFix>> = {
  cat: { body: { rot: [90, 0, 0] } },
  polarbear: { body: { rot: [90, 0, 0] } },
  enderman: { head: { ofs: [0, 14, 0] } },
}

/** Bones posed exclusively by animations that we can't show yet — hidden to avoid artifacts. */
const HIDDEN_BONES = /sleep|spikepart/i

function withPose(name: string, geo: Geometry): Geometry {
  const fixes = POSE_FIXUPS[name]
  if (!fixes) return geo
  return {
    ...geo,
    bones: geo.bones.map(b => {
      const fix = fixes[b.name]
      if (!fix) return b
      const bone: GeoBone = { ...b }
      if (fix.rot) bone.bindRot = fix.rot
      if (fix.ofs) {
        const [dx, dy, dz] = fix.ofs
        bone.pivot = bone.pivot ? [bone.pivot[0] + dx, bone.pivot[1] + dy, bone.pivot[2] + dz] : bone.pivot
        bone.cubes = (bone.cubes ?? []).map(c => ({
          ...c,
          origin: c.origin ? [c.origin[0] + dx, c.origin[1] + dy, c.origin[2] + dz] as Vec3 : c.origin,
        }))
      }
      return bone
    }),
  }
}

// ── Box UV (standard unwrap) ─────────────────────────────────────────────────

type Corners = [Vec3, Vec3, Vec3, Vec3] // TL, TR, BL, BR

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

export const FACES = ['up', 'down', 'east', 'north', 'west', 'south'] as const
export type FaceName = typeof FACES[number]

export function boxUVRects(u: number, v: number, w: number, h: number, d: number): Record<string, [number, number, number, number]> {
  return {
    up:    [u + d, v, u + d + w, v + d],
    down:  [u + d + w, v, u + d + 2 * w, v + d],
    east:  [u, v + d, u + d, v + d + h],
    north: [u + d, v + d, u + d + w, v + d + h],
    west:  [u + d + w, v + d, u + d + w + d, v + d + h],
    south: [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h],
  }
}

// ── Builder ──────────────────────────────────────────────────────────────────
// The model is built as a bone hierarchy (one THREE.Group per bone at its
// pivot) so the animation player can move bones at runtime.

/** Runtime handle for one bone. Animations reset to base then add channels. */
export interface BoneHandles {
  outer: THREE.Group
  /** base rotation in radians (converted, XYZ order) */
  baseRot: Vec3
  /** base position (px, relative to parent bone) */
  basePos: Vec3
}

export function buildBedrockModel(
  geo: Geometry,
  texture: THREE.Texture | null,
  /** actual loaded texture size in px — UVs are mapped in real pixels so Java
   *  textures with extended canvases (64×64 humanoids) line up */
  imgW?: number,
  imgH?: number,
  /** fullbright overlay (enderman/spider eyes, OptiFine _e.png) */
  emissive?: THREE.Texture | null,
  /** cubos a resaltar con un contorno (clave `hueso#indice`), para el editor */
  highlight?: Set<string>
): THREE.Group {
  const texW = imgW ?? geo.texW
  const texH = imgH ?? geo.texH
  const byName = new Map(geo.bones.map(b => [b.name, b]))

  const mat = new THREE.MeshLambertMaterial({
    map: texture ?? undefined,
    color: texture ? 0xffffff : 0x9a9aa8,
    transparent: true,
    alphaTest: 0.05,
    side: THREE.DoubleSide,
  })
  const emMat = emissive
    ? new THREE.MeshBasicMaterial({ map: emissive, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide })
    : null

  const root = new THREE.Group()
  root.scale.setScalar(1 / 16)
  const bones = new Map<string, BoneHandles>()
  // Asas del editor: un grupo por cubo resaltado, en su centro, al que se
  // engancha la herramienta de mover. El contorno cuelga de él, así que se
  // desplaza en vivo mientras se arrastra, antes de reconstruir el modelo.
  const cubeHandles = new Map<string, THREE.Group>()
  const nodes = new Map<string, { outer: THREE.Group; inner: THREE.Group; pivot: Vec3 }>()

  const DEG = Math.PI / 180
  function getNode(name: string): { outer: THREE.Group; inner: THREE.Group; pivot: Vec3 } | null {
    const existing = nodes.get(name)
    if (existing) return existing
    const bone = byName.get(name)
    if (!bone) return null
    const pivot = convPivot(bone.pivot)
    const parent = bone.parent && bone.parent !== name ? getNode(bone.parent) : null
    const parentPivot: Vec3 = parent?.pivot ?? [0, 0, 0]

    const outer = new THREE.Group()
    outer.name = name
    const basePos: Vec3 = [pivot[0] - parentPivot[0], pivot[1] - parentPivot[1], pivot[2] - parentPivot[2]]
    outer.position.set(...basePos)
    const r = convRot(bone.rot)
    const baseRot: Vec3 = [r[0] * DEG, r[1] * DEG, r[2] * DEG]
    outer.rotation.set(...baseRot)

    // bind_pose_rotation poses only this bone's own cubes — children hang off `outer`
    const inner = new THREE.Group()
    const br = convRot(bone.bindRot)
    inner.rotation.set(br[0] * DEG, br[1] * DEG, br[2] * DEG)
    outer.add(inner)
    ;(parent?.outer ?? root).add(outer)

    const node = { outer, inner, pivot }
    nodes.set(name, node)
    bones.set(name.toLowerCase(), { outer, baseRot, basePos })
    return node
  }

  for (const bone of geo.bones) {
    const node = getNode(bone.name)
    if (!node || HIDDEN_BONES.test(bone.name)) continue
    const acc = new QuadAccumulator()

    for (const [cubeIndex, cube] of (bone.cubes ?? []).entries()) {
      const [ox, oy, oz] = cube.origin ?? [0, 0, 0]
      const [sw, sh, sd] = cube.size ?? [0, 0, 0]
      const inf = cube.inflate ?? 0
      // Mirror X: bedrock → render space
      const from: Vec3 = [-(ox + sw) - inf, oy - inf, oz - inf]
      const to: Vec3 = [-ox + inf, oy + sh + inf, oz + sd + inf]
      const mirror = cube.mirror ?? bone.mirror ?? false

      const cubeRot = convRot(cube.rotation)
      // Cube rotations default to the cube's own center when no pivot is given
      // (modern geos like the pig's body omit it)
      const cubePivot = cube.pivot
        ? convPivot(cube.pivot)
        : [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2] as Vec3

      if (highlight?.has(`${bone.name}#${cubeIndex}`)) {
        // Las 8 esquinas de la caja, giradas igual que las caras
        const pts: Vec3[] = []
        for (let i = 0; i < 8; i++) {
          const c: Vec3 = [i & 1 ? to[0] : from[0], i & 2 ? to[1] : from[1], i & 4 ? to[2] : from[2]]
          pts.push(hasRot(cubeRot) ? rotatePoint(c, cubePivot, cubeRot) : c)
        }
        const center: Vec3 = [0, 1, 2].map((k) => pts.reduce((sum, q) => sum + q[k], 0) / 8) as Vec3
        // Aristas: pares de esquinas que difieren en un solo eje, relativas al centro
        const edges: number[] = []
        for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) {
          const b = a | bit
          if (b === a) continue
          for (const q of [pts[a], pts[b]]) edges.push(q[0] - center[0], q[1] - center[1], q[2] - center[2])
        }
        const lineGeo = new THREE.BufferGeometry()
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3))
        const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x22c55e, depthTest: false }))
        lines.renderOrder = 10

        // Mismo espacio que los vértices del cubo: el del hueso, desplazado por el pivote
        const handle = new THREE.Group()
        handle.position.set(center[0] - node.pivot[0], center[1] - node.pivot[1], center[2] - node.pivot[2])
        handle.add(lines)
        node.inner.add(handle)
        cubeHandles.set(`${bone.name}#${cubeIndex}`, handle)
      }

      for (const face of FACES) {
        let rect: [number, number, number, number] | null = null
        let faceRot = 0
        if (Array.isArray(cube.uv)) {
          const rects = boxUVRects(cube.uv[0], cube.uv[1], sw, sh, sd)
          // Mirrored cubes sample east/west from each other's rect
          const key = mirror ? (face === 'east' ? 'west' : face === 'west' ? 'east' : face) : face
          rect = rects[key]
        } else if (cube.uv && typeof cube.uv === 'object') {
          const f = (cube.uv as Record<string, GeoFaceUV>)[face]
          if (!f || f.hidden) continue
          faceRot = f.uv_rotation ?? 0
          const [u1, v1] = f.uv
          const [su, sv] = f.uv_size ?? defaultFaceUVSize(face, sw, sh, sd)
          rect = [u1, v1, u1 + su, v1 + sv]
        }
        if (!rect) continue

        let { corners, normal } = faceCorners(face, from, to)
        if (hasRot(cubeRot)) {
          corners = corners.map(c => rotatePoint(c, cubePivot, cubeRot)) as Corners
          const nEnd = rotatePoint(normal, [0, 0, 0], cubeRot)
          normal = nEnd
        }

        const [u1, v1, u2, v2] = rect
        const n = (u: number, v: number): UV => [u / texW, 1 - v / texH]
        let uvC: [UV, UV, UV, UV] = [n(u1, v1), n(u2, v1), n(u1, v2), n(u2, v2)]
        if (mirror) uvC = [uvC[1], uvC[0], uvC[3], uvC[2]]
        // Cada paso de 90° rota la imagen sobre la cara: la esquina de arriba a
        // la izquierda pasa a mostrar lo que antes estaba abajo a la izquierda.
        const turns = (((Math.round(faceRot / 90)) % 4) + 4) % 4
        for (let t = 0; t < turns; t++) uvC = [uvC[2], uvC[0], uvC[3], uvC[1]]
        acc.addQuad(corners, uvC, normal)
      }
    }

    if (acc.indices.length === 0) continue
    const geometry = acc.toGeometry()
    // Vertices are in model space — shift so they hang off the bone pivot
    geometry.translate(-node.pivot[0], -node.pivot[1], -node.pivot[2])
    node.inner.add(new THREE.Mesh(geometry, mat))
    if (emMat) {
      const emMesh = new THREE.Mesh(geometry, emMat)
      emMesh.scale.setScalar(1.002) // avoid z-fighting with the base layer
      emMesh.renderOrder = 1
      node.inner.add(emMesh)
    }
  }

  root.userData.bones = bones
  root.userData.cubeHandles = cubeHandles
  return root
}

function defaultFaceUVSize(face: string, w: number, h: number, d: number): UV {
  if (face === 'up' || face === 'down') return [w, d]
  if (face === 'east' || face === 'west') return [d, h]
  return [w, h]
}

// ── Bundled vanilla dataset (lazy-loaded chunk) ──────────────────────────────

let datasetPromise: Promise<Record<string, Geometry>> | null = null

export function loadVanillaGeometries(): Promise<Record<string, Geometry>> {
  if (!datasetPromise) {
    datasetPromise = import('./bedrockGeo.json').then(m => (m.default ?? m) as unknown as Record<string, Geometry>)
  }
  return datasetPromise
}

/** Finds a geometry for a name, preferring the _v2 revision (matches current Java textures).
 *  Applies static pose fixups for models that rely on runtime animations. */
export function findGeometry(data: Record<string, Geometry>, name: string): { name: string; geo: Geometry } | null {
  for (const cand of [`${name}_v2`, name]) {
    if (data[cand]) return { name: cand, geo: withPose(name, data[cand]) }
  }
  return null
}

/** Candidate geometry names for an entity texture path like assets/minecraft/textures/entity/cow/cold_cow.png */
export function geometryCandidatesForTexture(assetPath: string): string[] {
  const m = assetPath.match(/textures\/entity\/(.+)\.png$/)
  if (!m) return []
  const parts = m[1].split('/')
  const stem = parts[parts.length - 1]
  const dirs = parts.slice(0, -1)
  const cands: string[] = [stem]
  // cold_cow → cow_cold (variant prefix ↔ suffix), temperate_pig → pig
  const seg = stem.split('_')
  if (seg.length === 2) cands.push(`${seg[1]}_${seg[0]}`, seg[1])
  if (seg.length > 2) cands.push(seg.slice(1).join('_'))
  for (const d of [...dirs].reverse()) cands.push(d)
  return [...new Set(cands)]
}
