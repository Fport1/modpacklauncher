import { parseModel, resolveTex, type SModel } from './model'
import { loadStudioTexture, type StudioTex } from './textures'

// Abre un modelo para verlo: sigue la cadena de «parent» si no tiene cubos propios y carga sus
// texturas. Lo usan el editor y las miniaturas de la lista.

export interface Loaded {
  model: SModel
  /** Cubos heredados del padre (solo para ver), o null si tiene los suyos */
  shape: SModel | null
  /** Objeto plano (item/generated): la forma sale de los píxeles de la textura */
  flat: boolean
  textures: Map<string, StudioTex>
  refs: string[]
}

export async function resolveShape(m: SModel): Promise<{ shape: SModel | null; flat: boolean }> {
  if (m.elements) return { shape: null, flat: false }
  let parentRef = m.parent
  const merged: Record<string, string> = {}
  for (let i = 0; i < 8 && parentRef; i++) {
    if (/builtin\/generated|item\/generated|item\/handheld/.test(parentRef)) return { shape: null, flat: !!m.textures.layer0 }
    const pt = await window.api.studio.readVanillaModel(parentRef.includes(':') ? parentRef : `minecraft:${parentRef}`)
    if (!pt) break
    const pm = parseModel(pt)
    for (const [k, v] of Object.entries(pm.textures)) if (!(k in merged)) merged[k] = v
    if (pm.elements) return { shape: { ...m, textures: { ...merged, ...m.textures }, elements: pm.elements, groups: null }, flat: false }
    parentRef = pm.parent
  }
  return { shape: null, flat: false }
}

/** texCache: para las miniaturas, que no pintan y pueden compartir las texturas. */
export async function loadView(id: string, texCache?: Map<string, Promise<StudioTex | null>>): Promise<Loaded> {
  const m = parseModel(await window.api.studio.readModel(id))
  const { shape, flat } = await resolveShape(m)
  const shown = shape ?? m
  const refs = [...new Set(Object.keys(shown.textures).map((k) => resolveTex(shown, `#${k}`)).filter((r): r is string => !!r))]
  const textures = new Map<string, StudioTex>()
  await Promise.all(refs.map(async (r) => {
    let p = texCache?.get(r)
    if (!p) { p = loadStudioTexture(r).catch(() => null); texCache?.set(r, p) }
    const t = await p
    if (t) textures.set(r, t)
  }))
  return { model: m, shape, flat, textures, refs }
}
