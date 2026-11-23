import { DIRS, DIR_NAMES, resolveTex, type SModel } from './model'

// Avisos amables de lo que no va a funcionar en Minecraft, con su arreglo cuando se puede.
// Cada arreglo cambia el modelo que recibe (el editor lo apunta para poder deshacerlo).

export interface Issue {
  id: string
  level: 'error' | 'aviso'
  text: string
  /** Cubo al que se refiere (para seleccionarlo) */
  cube?: string
  fixLabel?: string
  fix?: (m: SModel) => void
}

/** Ángulos que admiten los modelos de bloque e ítem */
export const ANGLES = [-45, -22.5, 0, 22.5, 45]
const nearestAngle = (a: number): number => ANGLES.reduce((b, x) => (Math.abs(x - a) < Math.abs(b - a) ? x : b), 0)
const LIMIT_MIN = -16, LIMIT_MAX = 32
const clamp = (n: number): number => Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, n))

export function validate(m: SModel, textureSizes: Map<string, { w: number; h: number }>): Issue[] {
  const out: Issue[] = []
  const els = m.elements ?? []
  /** Variables de textura que se usan sin definir (en una plantilla las pone el modelo hijo) */
  const unset = new Map<string, string[]>()
  els.forEach((e, i) => {
    const label = e.name ? `«${e.name}»` : `El cubo ${i + 1}`
    const of = e.name ? `de «${e.name}»` : `del cubo ${i + 1}`
    if (e.rotation && !ANGLES.includes(e.rotation.angle)) {
      const to = nearestAngle(e.rotation.angle)
      out.push({
        id: `ang-${e.uid}`, level: 'error', cube: e.uid,
        text: `${label} está girado ${e.rotation.angle}°. Minecraft solo deja girar los cubos de bloques e ítems de 22,5 en 22,5 grados, hasta 45 (−45, −22,5, 0, 22,5, 45).`,
        fixLabel: `Girarlo ${to}°`,
        fix: (mm) => { const x = mm.elements?.find((c) => c.uid === e.uid); if (x?.rotation) x.rotation.angle = to },
      })
    }
    const out_ = [...e.from, ...e.to].some((v) => v < LIMIT_MIN || v > LIMIT_MAX)
    if (out_) {
      out.push({
        id: `lim-${e.uid}`, level: 'error', cube: e.uid,
        text: `${label} se sale del espacio permitido (de −16 a 32 píxeles en cada dirección, es decir, como mucho un bloque alrededor). El juego no cargaría el modelo.`,
        fixLabel: 'Meterlo dentro',
        fix: (mm) => { const x = mm.elements?.find((c) => c.uid === e.uid); if (x) { x.from = x.from.map(clamp) as typeof x.from; x.to = x.to.map(clamp) as typeof x.to } },
      })
    }
    if (e.from.some((v, k) => v > e.to[k])) {
      out.push({
        id: `inv-${e.uid}`, level: 'aviso', cube: e.uid,
        text: `${label} está «del revés» (el principio está después del final en algún eje): algunas caras pueden no verse.`,
        fixLabel: 'Darle la vuelta',
        fix: (mm) => { const x = mm.elements?.find((c) => c.uid === e.uid); if (x) for (let k = 0; k < 3; k++) if (x.from[k] > x.to[k]) [x.from[k], x.to[k]] = [x.to[k], x.from[k]] },
      })
    }
    for (const d of DIRS) {
      const f = e.faces[d]
      if (!f) continue
      if (!resolveTex(m, f.texture)) unset.set(f.texture, [...(unset.get(f.texture) ?? []), e.uid])
      if (f.uv && f.uv.some((v) => v < 0 || v > 16)) {
        out.push({
          id: `uv-${e.uid}-${d}`, level: 'aviso', cube: e.uid,
          text: `La cara ${DIR_NAMES[d].toLowerCase()} ${of} pinta un trozo que se sale de la textura.`,
          fixLabel: 'Ajustar a la textura',
          fix: (mm) => { const x = mm.elements?.find((c) => c.uid === e.uid)?.faces[d]; if (x?.uv) x.uv = x.uv.map((v) => Math.min(16, Math.max(0, v))) as typeof x.uv },
        })
      }
      if (f.rotation !== undefined && ![0, 90, 180, 270].includes(f.rotation)) {
        out.push({
          id: `frot-${e.uid}-${d}`, level: 'error', cube: e.uid,
          text: `La textura de la cara ${DIR_NAMES[d].toLowerCase()} está girada ${f.rotation}°: solo vale 0, 90, 180 o 270.`,
          fixLabel: 'Redondear',
          fix: (mm) => { const x = mm.elements?.find((c) => c.uid === e.uid)?.faces[d]; if (x) x.rotation = (Math.round((f.rotation ?? 0) / 90) * 90) % 360 },
        })
      }
    }
  })
  // Texturas sin definir: un solo aviso. Si el modelo es una plantilla (otros lo usan de «parent» y
  // ponen esas texturas), está bien; si no, en el juego se verían moradas y negras.
  if (unset.size) {
    const first = Object.keys(m.textures).find((k) => k !== 'particle') ?? Object.keys(m.textures)[0]
    const names = [...unset.keys()]
    out.push({
      id: 'unset', level: 'aviso', cube: [...unset.values()][0][0],
      text: `Usa ${names.join(', ')} sin decir qué textura es. Si es una plantilla que otros modelos rellenan, está bien; si no, en el juego se verá morada y negra.`,
      ...(first ? { fixLabel: `Usar «${first}» en esas caras`, fix: (mm: SModel) => { for (const x of mm.elements ?? []) for (const f of Object.values(x.faces)) if (f && names.includes(f.texture)) f.texture = `#${first}` } } : {}),
    })
  }
  // Texturas con un tamaño que el juego no va a pintar bien
  for (const [ref, s] of textureSizes) {
    const strip = s.h > s.w && s.h % s.w === 0
    if (s.w % 16 !== 0 || (s.w !== s.h && !strip)) {
      out.push({
        id: `size-${ref}`, level: 'aviso',
        text: `La textura ${ref} mide ${s.w}×${s.h}. Para bloques e ítems lo normal es un cuadrado de 16×16 (o 32, 64…); otros tamaños se ven estirados o borrosos.`,
      })
    }
  }
  if (m.elements && m.elements.length > 0 && !m.textures.particle && !unset.size && !m.parent) {
    const first = Object.values(m.textures)[0]
    out.push({
      id: 'particle', level: 'aviso',
      text: 'Al modelo le falta la textura «particle» (la de las partículas al romperlo). Se verán moradas y negras.',
      ...(first ? { fixLabel: 'Usar la primera textura', fix: (mm: SModel) => { mm.textures.particle = first } } : {}),
    })
  }
  return out
}
