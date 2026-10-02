import fs from 'fs-extra'
import path from 'path'

// Animaciones para la IA: entenderlas a fondo y escribirlas sin romper el
// formato. Formatos:
// - Bedrock / GeckoLib (.animation.json): animations → bones → rotation/position/scale
//   con keyframes por tiempo (número, [x,y,z], Molang en cadenas, o {pre, post, lerp_mode});
// - Blockbench (.bbmodel): animations[] con animators por hueso y keyframes;
// - OptiFine CEM / EMF (.jem): animations[] con expresiones por parte;
// - Emotecraft (.json con «emote»): moves por parte del cuerpo.
// Con el modelo (.geo.json o .bbmodel) se comprueba que los huesos existen.

type Vec = (number | string)[]
type KeyframeValue = number | string | Vec | { pre?: Vec; post?: Vec | { vector?: Vec }; lerp_mode?: string }
type Channel = Vec | number | string | Record<string, KeyframeValue>

interface ChannelInfo { canal: string; keyframes: number; tiempos?: number[]; molang: boolean; interpolaciones?: string[] }
interface AnimInfo {
  nombre: string
  duracion?: number
  bucle?: unknown
  huesos: { hueso: string; canales: ChannelInfo[] }[]
  eventos?: { sonidos?: number; particulas?: number; timeline?: number }
  problemas: string[]
}

const LERP = new Set(['linear', 'catmullrom', 'step', 'bezier'])
const isMolang = (v: unknown): boolean => typeof v === 'string' && /[a-z_]/i.test(v)

/** Huesos de un modelo .geo.json (Bedrock/GeckoLib) o .bbmodel. */
export async function modelBones(file: string): Promise<string[]> {
  const j = await fs.readJson(file)
  const geo = j['minecraft:geometry'] ?? (j.geometry ? [j.geometry] : null)
  if (Array.isArray(geo)) return [...new Set(geo.flatMap((g: any) => (g.bones ?? []).map((b: any) => String(b.name))))]
  if (j.meta && Array.isArray(j.outliner)) {
    const out: string[] = []
    const walk = (n: any): void => { if (n && typeof n === 'object') { if (n.name) out.push(String(n.name)); (n.children ?? []).forEach(walk) } }
    j.outliner.forEach(walk)
    return [...new Set(out)]
  }
  throw new Error('No parece un modelo .geo.json ni un .bbmodel')
}

function channelInfo(name: string, ch: Channel, length: number | undefined, problems: string[], bone: string): ChannelInfo {
  // Valor fijo (sin keyframes): número, vector o Molang
  if (typeof ch === 'number' || typeof ch === 'string' || Array.isArray(ch)) {
    return { canal: name, keyframes: 1, molang: Array.isArray(ch) ? ch.some(isMolang) : isMolang(ch) }
  }
  const times = Object.keys(ch).map(Number)
  const interps = new Set<string>()
  let molang = false
  for (const [t, v] of Object.entries(ch)) {
    if (!Number.isFinite(Number(t))) problems.push(`${bone}.${name}: el tiempo «${t}» no es un número`)
    if (length !== undefined && Number(t) > length + 1e-6) problems.push(`${bone}.${name}: keyframe en ${t}s, después del final (${length}s)`)
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const lm = (v as { lerp_mode?: string }).lerp_mode
      if (lm) { interps.add(lm); if (!LERP.has(lm)) problems.push(`${bone}.${name} @${t}: lerp_mode «${lm}» no existe (linear, catmullrom, step)`) }
      const post = (v as { post?: unknown }).post
      const vec = Array.isArray(post) ? post : (post as { vector?: unknown[] })?.vector
      if (Array.isArray(vec) && vec.length !== 3) problems.push(`${bone}.${name} @${t}: hacen falta 3 valores (x, y, z)`)
      molang ||= JSON.stringify(v).match(/"[^"]*[a-z_][^"]*"/i) !== null && JSON.stringify(v).includes('.')
    } else if (Array.isArray(v)) {
      if (v.length !== 3) problems.push(`${bone}.${name} @${t}: hacen falta 3 valores (x, y, z)`)
      molang ||= v.some(isMolang)
    } else molang ||= isMolang(v)
  }
  const sorted = [...times].sort((a, b) => a - b)
  if (sorted.join() !== times.join()) problems.push(`${bone}.${name}: los keyframes no están en orden de tiempo (funciona, pero cuesta leerlo)`)
  return { canal: name, keyframes: times.length, tiempos: sorted.slice(0, 40), molang, interpolaciones: interps.size ? [...interps] : undefined }
}

/** Análisis completo de un archivo de animaciones (y, con el modelo, qué huesos no existen). */
export async function analyzeAnimation(file: string, modelFile?: string): Promise<Record<string, unknown>> {
  const j = await fs.readJson(file).catch(() => { throw new Error(`No se puede leer ${file} como JSON`) })
  const bones = modelFile ? await modelBones(modelFile) : null
  const anims: AnimInfo[] = []
  let format = ''

  if (j.animations && !Array.isArray(j.animations) && typeof j.animations === 'object') {
    format = `Bedrock / GeckoLib (.animation.json) ${j.format_version ?? ''}`.trim()
    for (const [name, a] of Object.entries<any>(j.animations)) {
      const problems: string[] = []
      const length = typeof a.animation_length === 'number' ? a.animation_length : undefined
      const huesos = Object.entries<any>(a.bones ?? {}).map(([bone, chans]) => ({
        hueso: bone,
        canales: Object.entries<any>(chans).filter(([c]) => ['rotation', 'position', 'scale'].includes(c)).map(([c, v]) => channelInfo(c, v, length, problems, bone)),
      }))
      for (const [bone, chans] of Object.entries<any>(a.bones ?? {})) {
        for (const c of Object.keys(chans)) if (!['rotation', 'position', 'scale', 'relative_to'].includes(c)) problems.push(`${bone}: canal «${c}» desconocido (rotation, position o scale)`)
      }
      if (!name.startsWith('animation.')) problems.push(`El nombre suele empezar por «animation.» (p. ej. animation.${name})`)
      if (a.loop !== undefined && ![true, false, 'hold_on_last_frame'].includes(a.loop)) problems.push(`loop «${a.loop}» no vale (true, false o "hold_on_last_frame")`)
      if (length === undefined) problems.push('Sin animation_length: dura hasta el último keyframe')
      anims.push({
        nombre: name, duracion: length, bucle: a.loop, huesos,
        eventos: a.sound_effects || a.particle_effects || a.timeline
          ? { sonidos: a.sound_effects ? Object.keys(a.sound_effects).length : undefined, particulas: a.particle_effects ? Object.keys(a.particle_effects).length : undefined, timeline: a.timeline ? Object.keys(a.timeline).length : undefined }
          : undefined,
        problemas: problems,
      })
    }
  } else if (j.meta && Array.isArray(j.animations)) {
    format = `Blockbench (.bbmodel, ${j.meta.model_format})`
    const byUuid = new Map<string, string>()
    const walk = (n: any): void => { if (n && typeof n === 'object') { if (n.uuid && n.name) byUuid.set(n.uuid, n.name); (n.children ?? []).forEach(walk) } }
    ;(j.outliner ?? []).forEach(walk)
    for (const a of j.animations) {
      const problems: string[] = []
      const huesos = Object.entries<any>(a.animators ?? {}).map(([uuid, an]) => {
        const kf = (an.keyframes ?? []) as any[]
        const byCh = new Map<string, any[]>()
        for (const k of kf) byCh.set(k.channel, [...(byCh.get(k.channel) ?? []), k])
        return {
          hueso: an.name ?? byUuid.get(uuid) ?? uuid,
          canales: [...byCh].map(([c, list]) => ({
            canal: c, keyframes: list.length, tiempos: list.map((k) => Number(k.time)).sort((x, y) => x - y).slice(0, 40),
            molang: list.some((k) => (k.data_points ?? []).some((p: any) => Object.values(p).some(isMolang))),
            interpolaciones: [...new Set(list.map((k) => String(k.interpolation ?? 'linear')))],
          })),
        }
      })
      anims.push({ nombre: a.name, duracion: a.length, bucle: a.loop, huesos, problemas: problems })
    }
  } else if (Array.isArray(j.models) && (j.textureSize || j.texture)) {
    format = 'OptiFine CEM / EMF (.jem)'
    const exprs = (j.models as any[]).flatMap((m) => (m.animations ?? []).flatMap((a: any) => Object.entries(a))) as [string, string][]
    anims.push({
      nombre: 'expresiones de animación', huesos: [...new Set(exprs.map(([k]) => k.split('.')[0]))].map((b) => ({ hueso: b, canales: exprs.filter(([k]) => k.startsWith(b + '.')).map(([k, v]) => ({ canal: k.split('.').slice(1).join('.'), keyframes: 1, molang: true, tiempos: undefined, interpolaciones: [String(v).slice(0, 80)] })) })),
      problemas: exprs.length ? [] : ['El .jem no tiene animaciones (solo el modelo)'],
    })
  } else if (j.emote) {
    format = 'Emotecraft (.json)'
    const moves = (j.emote.moves ?? []) as any[]
    const parts = new Map<string, number>()
    for (const m of moves) for (const k of Object.keys(m)) if (!['tick', 'easing', 'turn'].includes(k)) parts.set(k, (parts.get(k) ?? 0) + 1)
    anims.push({
      nombre: j.name ?? 'emote', duracion: j.emote.endTick ? j.emote.endTick / 20 : undefined, bucle: j.emote.isLoop,
      huesos: [...parts].map(([p, n]) => ({ hueso: p, canales: [{ canal: 'moves', keyframes: n, molang: false }] })), problemas: [],
    })
  } else throw new Error('No se reconoce el formato de animación (Bedrock/GeckoLib, Blockbench, CEM/EMF o Emotecraft)')

  let modelo: Record<string, unknown> | undefined
  if (bones) {
    const animated = new Set(anims.flatMap((a) => a.huesos.map((h) => h.hueso)))
    const missing = [...animated].filter((b) => !bones.includes(b))
    for (const a of anims) for (const h of a.huesos) if (!bones.includes(h.hueso)) a.problemas.push(`El hueso «${h.hueso}» no existe en el modelo: esa parte no se moverá (¿mayúsculas o nombre distinto?)`)
    modelo = { huesos: bones, sinAnimar: bones.filter((b) => !animated.has(b)), noExistenEnElModelo: missing }
  }
  return { archivo: file, formato: format, animaciones: anims, modelo, total: anims.length, conProblemas: anims.filter((a) => a.problemas.length).length }
}

export interface AnimationSpec {
  /** Nombre completo (animation.<modelo>.<accion>) o solo la acción */
  nombre: string
  duracion?: number
  bucle?: boolean | 'hold_on_last_frame'
  /** hueso → canal → valor fijo o keyframes { "0.0": [x,y,z] | {post, lerp_mode} | "molang" } */
  huesos: Record<string, Partial<Record<'rotation' | 'position' | 'scale', Channel>>>
  sonidos?: Record<string, { effect: string }>
  timeline?: Record<string, string | string[]>
}

const inside = (base: string, p: string): string => {
  const abs = path.resolve(base, p)
  const rel = path.relative(base, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`El archivo tiene que estar dentro de ${base}`)
  return abs
}

/**
 * Añade o reemplaza una animación en un .animation.json (lo crea si no existe),
 * con el formato que esperan Bedrock y GeckoLib. Si se pasa el modelo, se
 * niega a usar huesos que no existen. Guarda copia del archivo anterior.
 */
export async function writeAnimation(base: string, file: string, spec: AnimationSpec, opts: { model?: string; prefix?: string } = {}): Promise<Record<string, unknown>> {
  const target = inside(base, file)
  if (!/\.json$/i.test(target)) throw new Error('El archivo de animaciones tiene que ser .json (normalmente <modelo>.animation.json)')
  const bones = opts.model ? await modelBones(path.resolve(base, opts.model)) : null
  if (!spec?.huesos || !Object.keys(spec.huesos).length) throw new Error('Faltan los huesos y sus keyframes')
  if (bones) {
    const bad = Object.keys(spec.huesos).filter((b) => !bones.includes(b))
    if (bad.length) throw new Error(`Estos huesos no existen en el modelo: ${bad.join(', ')}. Huesos del modelo: ${bones.join(', ')}`)
  }
  const prefix = opts.prefix || path.basename(target).replace(/\.animation\.json$|\.json$/i, '')
  const name = spec.nombre.startsWith('animation.') ? spec.nombre : `animation.${prefix}.${spec.nombre}`
  const anim: Record<string, unknown> = {}
  if (spec.bucle !== undefined) anim.loop = spec.bucle
  // Duración: la indicada o el último keyframe
  const lastKey = Math.max(0, ...Object.values(spec.huesos).flatMap((ch) => Object.values(ch ?? {}).flatMap((v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).map(Number) : [0]))))
  anim.animation_length = spec.duracion ?? lastKey
  const outBones: Record<string, Record<string, unknown>> = {}
  for (const [bone, chans] of Object.entries(spec.huesos)) {
    outBones[bone] = {}
    for (const [c, v] of Object.entries(chans ?? {})) {
      if (!['rotation', 'position', 'scale'].includes(c)) throw new Error(`Canal «${c}» desconocido en ${bone} (rotation, position o scale)`)
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // Keyframes ordenados y con el tiempo como texto («0.0», «0.5»…), como los escribe Blockbench
        const entries = Object.entries(v).map(([t, val]) => [Number(t), val] as const)
        if (entries.some(([t]) => !Number.isFinite(t))) throw new Error(`${bone}.${c}: los tiempos tienen que ser números (segundos)`)
        outBones[bone][c] = Object.fromEntries(entries.sort((a, b) => a[0] - b[0]).map(([t, val]) => [String(Number.isInteger(t) ? t.toFixed(1) : t), val]))
      } else outBones[bone][c] = v
    }
  }
  anim.bones = outBones
  if (spec.sonidos) anim.sound_effects = spec.sonidos
  if (spec.timeline) anim.timeline = spec.timeline

  const existed = await fs.pathExists(target)
  const json = existed ? await fs.readJson(target) : { format_version: '1.8.0', animations: {} }
  if (!json.animations || typeof json.animations !== 'object') json.animations = {}
  const replaced = name in json.animations
  if (existed) {
    const backup = path.join(base, '.ai', 'copias', `${path.basename(target)}.${Date.now()}.bak`)
    await fs.ensureDir(path.dirname(backup))
    await fs.copy(target, backup)
  }
  json.animations[name] = anim
  await fs.outputJson(target, json, { spaces: 2 })
  const check = await analyzeAnimation(target, opts.model ? path.resolve(base, opts.model) : undefined)
  const mine = (check.animaciones as AnimInfo[]).find((a) => a.nombre === name)
  return { archivo: target, animacion: name, accion: replaced ? 'reemplazada' : 'añadida', duracion: anim.animation_length, problemas: mine?.problemas ?? [] }
}
