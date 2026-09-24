import * as THREE from 'three'
import { boxUVRects, FACES, type FaceName, type GeoCube, type GeoFaceUV, type Geometry, type BoneHandles } from './bedrockGeo'
import bundledDefaults from './modelOverrides.defaults.json'

// Ajustes sobre las geometrías de Mojang.
//
// Hay mobs cuya geometría no publica Mojang y se aproximan con otra, así que
// quedan descolocados o con la textura en la cara equivocada. En vez de tocar
// los datos originales, se guarda aparte lo que hay que cambiar y se aplica al
// construir el modelo. Así los originales quedan intactos y siempre se puede
// volver atrás.
//
// Hay dos capas:
// - los ajustes que se distribuyen con la app (modelOverrides.defaults.json)
// - los del usuario, que se guardan en su carpeta y pisan a los anteriores
//   para esa geometría. Cuando un ajuste está bien, se pasa de la segunda capa
//   a la primera y ya lo ve todo el mundo.

type Vec3 = [number, number, number]
type Vec2 = [number, number]

export interface FaceOverride {
  /** Esquina de la región de la textura, en píxeles. */
  uv?: Vec2
  /** Tamaño de la región. Negativo = imagen volteada en ese eje. */
  size?: Vec2
  rotation?: 0 | 90 | 180 | 270
  hidden?: boolean
}

export interface CubeOverride {
  /** Desplazamiento del cubo, en píxeles del modelo. */
  offset?: Vec3
  /** Giro añadido al del cubo, en grados. */
  rotation?: Vec3
  inflate?: number
  mirror?: boolean
  faces?: Partial<Record<FaceName, FaceOverride>>
}

export interface BoneOverride {
  /** Desplazamiento del hueso con todo lo que cuelga de él, en píxeles. */
  offset?: Vec3
  /** Giro añadido al del hueso, en grados. */
  rotation?: Vec3
}

export interface GeoOverride {
  bones?: Record<string, BoneOverride>
  /** Clave `hueso#indice` del cubo dentro del hueso. */
  cubes?: Record<string, CubeOverride>
}

export type OverrideFile = Record<string, GeoOverride>

export const cubeKey = (bone: string, index: number): string => `${bone}#${index}`

const DEFAULTS = bundledDefaults as OverrideFile

/**
 * Ajuste vigente para una geometría: el del usuario si lo tiene, y si no el
 * distribuido con la app.
 */
export function effectiveOverride(user: OverrideFile, geoName: string): GeoOverride {
  return user[geoName] ?? DEFAULTS[geoName] ?? {}
}

export function hasBundledOverride(geoName: string): boolean {
  return geoName in DEFAULTS
}

const add3 = (a: Vec3, b?: Vec3): Vec3 => (b ? [a[0] + b[0], a[1] + b[1], a[2] + b[2]] : a)

/**
 * UV actual de cada cara de un cubo, venga de caja o de caras sueltas.
 *
 * Es lo que se muestra en el editor, y el punto de partida al convertir un
 * cubo con UV de caja a caras sueltas para poder tocar solo una.
 */
export function currentFaces(
  cube: GeoCube,
  mirror: boolean
): Record<FaceName, GeoFaceUV> {
  const [sw, sh, sd] = cube.size ?? [0, 0, 0]
  const out = {} as Record<FaceName, GeoFaceUV>

  if (Array.isArray(cube.uv)) {
    const rects = boxUVRects(cube.uv[0], cube.uv[1], sw, sh, sd)
    for (const face of FACES) {
      // El constructor intercambia este y oeste en los cubos espejados con UV
      // de caja; al pasar a caras sueltas hay que hacerlo aquí para que se vea igual.
      const key = mirror ? (face === 'east' ? 'west' : face === 'west' ? 'east' : face) : face
      const [u1, v1, u2, v2] = rects[key]
      out[face] = { uv: [u1, v1], uv_size: [u2 - u1, v2 - v1] }
    }
  } else if (cube.uv && typeof cube.uv === 'object') {
    for (const face of FACES) {
      const f = (cube.uv as Record<string, GeoFaceUV>)[face]
      if (f) {
        const size: Vec2 = f.uv_size ?? (
          face === 'up' || face === 'down' ? [sw, sd]
            : face === 'east' || face === 'west' ? [sd, sh]
              : [sw, sh]
        )
        out[face] = { ...f, uv_size: size }
      } else {
        out[face] = { uv: [0, 0], uv_size: [0, 0], hidden: true }
      }
    }
  }
  return out
}

/**
 * Copia de la geometría con los ajustes de cubo aplicados.
 *
 * Los de hueso no van aquí: mover el pivote de un hueso no mueve sus cubos
 * (el constructor los recoloca respecto a él), así que se aplican después,
 * directamente sobre el grupo ya construido. Ver `applyBoneOverrides`.
 */
export function applyGeoOverride(geo: Geometry, ov: GeoOverride): Geometry {
  if (!ov.cubes || Object.keys(ov.cubes).length === 0) return geo

  return {
    ...geo,
    bones: geo.bones.map((bone) => {
      const cubes = bone.cubes?.map((cube, index) => {
        const c = ov.cubes![cubeKey(bone.name, index)]
        if (!c) return cube

        const mirror = c.mirror ?? cube.mirror ?? bone.mirror ?? false
        const next = { ...cube }

        if (c.offset) {
          // La X del formato de Bedrock va al revés que la de la vista, así
          // que se invierte para que "+X" en el editor sea "a la derecha".
          const o: Vec3 = [-c.offset[0], c.offset[1], c.offset[2]]
          next.origin = add3(cube.origin ?? [0, 0, 0], o)
          if (cube.pivot) next.pivot = add3(cube.pivot, o)
        }
        if (c.rotation) next.rotation = add3(cube.rotation ?? [0, 0, 0], c.rotation)
        if (c.inflate !== undefined) next.inflate = c.inflate
        if (c.mirror !== undefined) next.mirror = c.mirror

        if (c.faces && Object.keys(c.faces).length > 0) {
          // Tocar una cara obliga a pasar de UV de caja a caras sueltas
          const faces = currentFaces(cube, mirror)
          for (const face of FACES) {
            const f = c.faces[face]
            if (!f) continue
            faces[face] = {
              uv: f.uv ?? faces[face].uv,
              uv_size: f.size ?? faces[face].uv_size,
              uv_rotation: f.rotation ?? faces[face].uv_rotation ?? 0,
              hidden: f.hidden ?? faces[face].hidden ?? false
            }
          }
          next.uv = faces
        }
        return next
      })
      return { ...bone, cubes }
    })
  }
}

/**
 * Aplica los ajustes de hueso sobre el modelo ya construido.
 *
 * Se tocan también `basePos` y `baseRot` porque son la pose de reposo a la que
 * vuelven las animaciones en cada fotograma; si no, la primera animación
 * desharía el ajuste.
 */
export function applyBoneOverrides(group: THREE.Group, ov: GeoOverride): void {
  if (!ov.bones) return
  const bones = group.userData.bones as Map<string, BoneHandles> | undefined
  if (!bones) return

  const DEG = Math.PI / 180
  for (const [name, b] of Object.entries(ov.bones)) {
    const h = bones.get(name.toLowerCase())
    if (!h) continue
    if (b.offset) {
      h.basePos = add3(h.basePos, b.offset)
      h.outer.position.set(...h.basePos)
    }
    if (b.rotation) {
      h.baseRot = add3(h.baseRot, [b.rotation[0] * DEG, b.rotation[1] * DEG, b.rotation[2] * DEG])
      h.outer.rotation.set(...h.baseRot)
    }
  }
}

/** Quita claves vacías para que el JSON guardado solo tenga lo que cambia. */
export function pruneOverride(ov: GeoOverride): GeoOverride | null {
  const isZero = (v?: Vec3): boolean => !v || (v[0] === 0 && v[1] === 0 && v[2] === 0)
  const out: GeoOverride = {}

  if (ov.bones) {
    const bones: Record<string, BoneOverride> = {}
    for (const [k, b] of Object.entries(ov.bones)) {
      const clean: BoneOverride = {}
      if (!isZero(b.offset)) clean.offset = b.offset
      if (!isZero(b.rotation)) clean.rotation = b.rotation
      if (Object.keys(clean).length) bones[k] = clean
    }
    if (Object.keys(bones).length) out.bones = bones
  }

  if (ov.cubes) {
    const cubes: Record<string, CubeOverride> = {}
    for (const [k, c] of Object.entries(ov.cubes)) {
      const clean: CubeOverride = {}
      if (!isZero(c.offset)) clean.offset = c.offset
      if (!isZero(c.rotation)) clean.rotation = c.rotation
      if (c.inflate !== undefined) clean.inflate = c.inflate
      if (c.mirror !== undefined) clean.mirror = c.mirror
      if (c.faces && Object.keys(c.faces).length) clean.faces = c.faces
      if (Object.keys(clean).length) cubes[k] = clean
    }
    if (Object.keys(cubes).length) out.cubes = cubes
  }

  return Object.keys(out).length ? out : null
}
