import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// Minecraft block/item model format parser + three.js builder.
// Reference: https://minecraft.wiki/w/Model
// ─────────────────────────────────────────────────────────────────────────────

/** Reads an asset file (returns base64) — provided by the page, resolves pack→vanilla. */
export type AssetReader = (path: string) => Promise<string | null>

export function b64ToText(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

function splitRef(ref: string): [string, string] {
  const clean = ref.trim()
  const idx = clean.indexOf(':')
  return idx === -1 ? ['minecraft', clean] : [clean.slice(0, idx), clean.slice(idx + 1)]
}

/** "minecraft:block/stone" → "assets/minecraft/models/block/stone.json" */
export function modelRefToPath(ref: string): string {
  const [ns, p] = splitRef(ref)
  return `assets/${ns}/models/${p}.json`
}

/** "minecraft:block/stone" → "assets/minecraft/textures/block/stone.png" */
export function textureRefToPath(ref: string): string {
  const [ns, p] = splitRef(ref)
  return `assets/${ns}/textures/${p}.png`
}

// ── Model resolution (parent chain) ──────────────────────────────────────────

type FaceName = 'down' | 'up' | 'north' | 'south' | 'west' | 'east'

export interface MCFace {
  uv?: [number, number, number, number]
  texture: string
  rotation?: number
  tintindex?: number
}

export interface MCElement {
  from: [number, number, number]
  to: [number, number, number]
  faces: Partial<Record<FaceName, MCFace>>
  rotation?: { origin: [number, number, number]; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean }
}

export interface ResolvedModel {
  textures: Record<string, string>
  elements: MCElement[]
  parentChain: string[]
  /** builtin/generated → flat item rendered from texture layers */
  isGenerated: boolean
  /** builtin/entity → geometry is hardcoded in the game (chests, banners…) */
  isEntityBuiltin: boolean
}

export async function resolveModel(read: AssetReader, modelRef: string): Promise<ResolvedModel> {
  const textures: Record<string, string> = {}
  let elements: MCElement[] | null = null
  const parentChain: string[] = []
  let isGenerated = false
  let isEntityBuiltin = false
  let current: string | null = modelRef

  for (let depth = 0; current && depth < 24; depth++) {
    if (current.includes('builtin/generated')) { isGenerated = true; break }
    if (current.includes('builtin/')) { isEntityBuiltin = true; break }
    const b64 = await read(modelRefToPath(current))
    if (b64 === null) {
      if (depth === 0) throw new Error(`Modelo no encontrado: ${current}`)
      break
    }
    const json = JSON.parse(b64ToText(b64)) as {
      parent?: string
      textures?: Record<string, string>
      elements?: MCElement[]
    }
    parentChain.push(current)
    // Child definitions win — only fill texture keys not yet set
    for (const [k, v] of Object.entries(json.textures ?? {})) {
      if (!(k in textures)) textures[k] = v
    }
    if (!elements && Array.isArray(json.elements)) elements = json.elements
    current = json.parent ?? null
  }

  return { textures, elements: elements ?? [], parentChain, isGenerated, isEntityBuiltin }
}

/** Follows #ref chains in the texture map ("#all" → "block/stone"). */
export function resolveTextureRef(textures: Record<string, string>, ref: string): string | null {
  let cur = ref
  for (let i = 0; i < 12; i++) {
    if (!cur.startsWith('#')) return cur
    const next = textures[cur.slice(1)]
    if (!next) return null
    cur = next
  }
  return null
}

// ── Texture loading ──────────────────────────────────────────────────────────

export async function loadImage(b64: string): Promise<HTMLImageElement> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('PNG inválido'))
    img.src = `data:image/png;base64,${b64}`
  })
  return img
}

// ── Texture animation (.mcmeta) ──────────────────────────────────────────────

export interface TextureAnim {
  /** frame indices in play order */
  order: number[]
  /** ticks per frame (1 tick = 50 ms) */
  frametime: number
  /** height of one frame normalized to the strip (imgW / imgH) */
  frameHNorm: number
  frameCount: number
}

/** Parses a .png.mcmeta animation for a vertical frame strip. Returns null if not animated. */
export function parseAnimMeta(mcmeta: unknown, imgW: number, imgH: number): TextureAnim | null {
  if (!mcmeta || typeof mcmeta !== 'object' || !('animation' in mcmeta)) return null
  if (imgH <= imgW || imgH % imgW !== 0) return null
  const frameCount = imgH / imgW
  const a = (mcmeta as { animation?: { frametime?: number; frames?: Array<number | { index?: number }> } }).animation ?? {}
  const frametime = Math.max(1, a.frametime ?? 1)
  const raw = Array.isArray(a.frames) && a.frames.length > 0
    ? a.frames.map(f => (typeof f === 'number' ? f : f?.index ?? 0))
    : [...Array(frameCount).keys()]
  const order = raw.filter(i => i >= 0 && i < frameCount)
  return { order: order.length > 0 ? order : [0], frametime, frameHNorm: imgW / imgH, frameCount }
}

/** Current frame index for an animation at a given time (ms). */
export function animFrameAt(anim: TextureAnim, nowMs: number): number {
  return anim.order[Math.floor(nowMs / (50 * anim.frametime)) % anim.order.length]
}

export function imageToTexture(img: HTMLImageElement, anim?: TextureAnim | null): THREE.Texture {
  const tex = new THREE.Texture(img)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  // Frame strips show a single frame; the viewer animates offset.y when anim is set
  if (img.height > img.width && img.height % img.width === 0) {
    tex.repeat.set(1, img.width / img.height)
    tex.offset.set(0, 1 - img.width / img.height)
    if (anim) tex.userData.anim = anim
  }
  tex.needsUpdate = true
  return tex
}

/** Creates a memoized texture loader for model texture refs (reads .mcmeta for animations). */
export function makeTextureLoader(read: AssetReader): (texRef: string) => Promise<THREE.Texture | null> {
  const cache = new Map<string, Promise<THREE.Texture | null>>()
  return (texRef: string) => {
    let p = cache.get(texRef)
    if (!p) {
      p = (async () => {
        const path = textureRefToPath(texRef)
        const b64 = await read(path)
        if (!b64) return null
        try {
          const img = await loadImage(b64)
          let anim: TextureAnim | null = null
          const metaB64 = await read(`${path}.mcmeta`).catch(() => null)
          if (metaB64) {
            try { anim = parseAnimMeta(JSON.parse(b64ToText(metaB64)), img.width, img.height) } catch { /* bad mcmeta */ }
          }
          return imageToTexture(img, anim)
        } catch { return null }
      })()
      cache.set(texRef, p)
    }
    return p
  }
}

// ── Quad geometry accumulator (shared with mob models) ──────────────────────

type Vec3 = [number, number, number]
type UV = [number, number] // normalized three.js coords (v up)

export class QuadAccumulator {
  positions: number[] = []
  normals: number[] = []
  uvs: number[] = []
  indices: number[] = []

  /** corners in TL, TR, BL, BR order; uv corners matching, already normalized. */
  addQuad(corners: [Vec3, Vec3, Vec3, Vec3], uvCorners: [UV, UV, UV, UV], normal: Vec3): void {
    const base = this.positions.length / 3
    for (let i = 0; i < 4; i++) {
      this.positions.push(...corners[i])
      this.normals.push(...normal)
      this.uvs.push(...uvCorners[i])
    }
    this.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
  }

  toGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    geo.setIndex(this.indices)
    return geo
  }
}

// ── Block model → THREE.Group ────────────────────────────────────────────────

const GRASS_TINT = 0x79c05a

// Corner layout per face (from/to in 16-space): TL, TR, BL, BR seen from outside
function faceCorners(f: FaceName, [x1, y1, z1]: Vec3, [x2, y2, z2]: Vec3): [Vec3, Vec3, Vec3, Vec3] {
  switch (f) {
    case 'north': return [[x2, y2, z1], [x1, y2, z1], [x2, y1, z1], [x1, y1, z1]]
    case 'south': return [[x1, y2, z2], [x2, y2, z2], [x1, y1, z2], [x2, y1, z2]]
    case 'east':  return [[x2, y2, z2], [x2, y2, z1], [x2, y1, z2], [x2, y1, z1]]
    case 'west':  return [[x1, y2, z1], [x1, y2, z2], [x1, y1, z1], [x1, y1, z2]]
    case 'up':    return [[x1, y2, z1], [x2, y2, z1], [x1, y2, z2], [x2, y2, z2]]
    case 'down':  return [[x1, y1, z2], [x2, y1, z2], [x1, y1, z1], [x2, y1, z1]]
  }
}

const FACE_NORMALS: Record<FaceName, Vec3> = {
  north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
}

// Vanilla default UVs when a face doesn't specify them
function defaultUV(f: FaceName, [x1, y1, z1]: Vec3, [x2, y2, z2]: Vec3): [number, number, number, number] {
  switch (f) {
    case 'down':  return [x1, 16 - z2, x2, 16 - z1]
    case 'up':    return [x1, z1, x2, z2]
    case 'north': return [16 - x2, 16 - y2, 16 - x1, 16 - y1]
    case 'south': return [x1, 16 - y2, x2, 16 - y1]
    case 'west':  return [z1, 16 - y2, z2, 16 - y1]
    case 'east':  return [16 - z2, 16 - y2, 16 - z1, 16 - y1]
  }
}

// MC uv [u1,v1,u2,v2] (v down, 0-16) → normalized three.js corners TL,TR,BL,BR + rotation
function uvCorners(uv: [number, number, number, number], rotation: number): [UV, UV, UV, UV] {
  const [u1, v1, u2, v2] = uv
  const n = (u: number, v: number): UV => [u / 16, 1 - v / 16]
  // ring in clockwise order starting at TL
  let ring: UV[] = [n(u1, v1), n(u2, v1), n(u2, v2), n(u1, v2)]
  const steps = ((rotation % 360) + 360) % 360 / 90
  for (let i = 0; i < steps; i++) ring = [ring[3], ring[0], ring[1], ring[2]]
  return [ring[0], ring[1], ring[3], ring[2]] // TL, TR, BL, BR
}

function rotateVec(p: Vec3, rot: NonNullable<MCElement['rotation']>): Vec3 {
  const angle = (rot.angle * Math.PI) / 180
  const [ox, oy, oz] = rot.origin
  let [x, y, z] = [p[0] - ox, p[1] - oy, p[2] - oz]
  if (rot.rescale && rot.angle !== 0) {
    const s = 1 / Math.cos(angle) // cos is even, so ±22.5/±45 both give s > 1
    if (rot.axis === 'x') { y *= s; z *= s }
    else if (rot.axis === 'y') { x *= s; z *= s }
    else { x *= s; y *= s }
  }
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  let r: Vec3
  if (rot.axis === 'x') r = [x, y * cos - z * sin, y * sin + z * cos]
  else if (rot.axis === 'y') r = [x * cos + z * sin, y, -x * sin + z * cos]
  else r = [x * cos - y * sin, x * sin + y * cos, z]
  return [r[0] + ox, r[1] + oy, r[2] + oz]
}

export interface BuildResult {
  group: THREE.Group
  missingTextures: string[]
}

export async function buildBlockModel(
  model: ResolvedModel,
  loadTexture: (texRef: string) => Promise<THREE.Texture | null>
): Promise<BuildResult> {
  interface Bucket { acc: QuadAccumulator; texRef: string | null; tinted: boolean }
  const buckets = new Map<string, Bucket>()
  const missing = new Set<string>()

  for (const el of model.elements) {
    const from = el.from
    const to = el.to
    for (const [faceName, face] of Object.entries(el.faces ?? {}) as [FaceName, MCFace][]) {
      if (!face) continue
      const texRef = resolveTextureRef(model.textures, face.texture)
      if (!texRef) missing.add(face.texture)
      const tinted = face.tintindex !== undefined
      const key = `${texRef ?? '∅'}|${tinted}`
      let bucket = buckets.get(key)
      if (!bucket) { bucket = { acc: new QuadAccumulator(), texRef, tinted }; buckets.set(key, bucket) }

      let corners = faceCorners(faceName, from, to)
      let normal = FACE_NORMALS[faceName]
      if (el.rotation) {
        corners = corners.map(c => rotateVec(c, el.rotation!)) as typeof corners
        const nEnd = rotateVec([normal[0] + el.rotation.origin[0], normal[1] + el.rotation.origin[1], normal[2] + el.rotation.origin[2]], el.rotation)
        normal = [nEnd[0] - el.rotation.origin[0], nEnd[1] - el.rotation.origin[1], nEnd[2] - el.rotation.origin[2]]
      }
      const uv = face.uv ?? defaultUV(faceName, from, to)
      bucket.acc.addQuad(corners, uvCorners(uv, face.rotation ?? 0), normal)
    }
  }

  const group = new THREE.Group()
  for (const bucket of buckets.values()) {
    const geo = bucket.acc.toGeometry()
    // 16-space → block units centered at origin
    geo.translate(-8, -8, -8)
    geo.scale(1 / 16, 1 / 16, 1 / 16)
    const tex = bucket.texRef ? await loadTexture(bucket.texRef) : null
    if (bucket.texRef && !tex) missing.add(bucket.texRef)
    const mat = new THREE.MeshLambertMaterial({
      map: tex ?? undefined,
      color: tex ? (bucket.tinted ? GRASS_TINT : 0xffffff) : 0xdd55dd,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
    })
    group.add(new THREE.Mesh(geo, mat))
  }

  return { group, missingTextures: [...missing] }
}

// ── Item "builtin/generated" → composited 2D layers ─────────────────────────

export interface ItemComposite {
  dataUrl: string
  width: number
  height: number
  layers: string[]
}

export async function buildItemComposite(read: AssetReader, model: ResolvedModel): Promise<ItemComposite | null> {
  const layerRefs: string[] = []
  for (let i = 0; i < 8; i++) {
    const ref = resolveTextureRef(model.textures, `#layer${i}`)
    if (!ref) break
    layerRefs.push(ref)
  }
  if (layerRefs.length === 0) return null

  const images: HTMLImageElement[] = []
  for (const ref of layerRefs) {
    const b64 = await read(textureRefToPath(ref))
    if (!b64) continue
    try { images.push(await loadImage(b64)) } catch { /* skip bad png */ }
  }
  if (images.length === 0) return null

  const size = Math.max(...images.map(i => i.width))
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  for (const img of images) {
    // Animated strips: draw only the first (square) frame
    const frameH = img.height > img.width && img.height % img.width === 0 ? img.width : img.height
    ctx.drawImage(img, 0, 0, img.width, frameH, 0, 0, size, size)
  }
  return { dataUrl: canvas.toDataURL(), width: size, height: size, layers: layerRefs }
}
