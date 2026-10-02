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

// ── El modelo pensado para moverse: rig, expresiones y animaciones base ─────

interface RigBone { nombre: string; padre?: string; pivote?: number[]; cubos: number; rol?: string; lado?: 'izquierda' | 'derecha'; posicion?: 'delante' | 'detras' }

const ROLES: [string, RegExp][] = [
  // Ojo: «_» cuenta como letra para \b, por eso los separadores van explícitos ([_\s.-]) o se usa camelCase (leftEye)
  ['parpado', /eye_?lid|eyelid|(^|[_\s.-])lid|p[aá]rpado/i], ['ceja', /brow|ceja/i], ['ojo', /(^|[_\s.-]|[a-z])eye|^eye|ojo|pupil/i],
  ['mandibula', /jaw|mand[ií]bula|mouth|boca|(^|[_\s.-])lip|labio/i], ['oreja', /(^|[_\s.-])[eE][aA][rR]|[a-z]Ear|[oO]reja/], ['cuello', /neck|cuello/i],
  ['cabeza', /head|cabeza|skull/i], ['ala', /wing|(^|[_\s.-])ala([_\s.-]|$)/i], ['cola', /tail|cola/i],
  ['mano', /hand|mano|finger|dedo/i], ['brazo', /arm|brazo|shoulder|hombro/i], ['pie', /foot|feet|(^|[_\s.-])pie([_\s.-]|$)|paw|pezu/i],
  ['pierna', /leg|pierna|pata|thigh|muslo|knee|rodilla/i], ['cuerpo', /body|torso|chest|cuerpo|pecho|spine|hip|cadera|pelvis|root/i],
]
const side = (n: string): RigBone['lado'] => (/(^|[_\s.-])(l|left|izq|izquierd[ao])([_\s.-]|$)|left|izq/i.test(n) ? 'izquierda' : /(^|[_\s.-])(r|right|der|derech[ao])([_\s.-]|$)|right|derech/i.test(n) ? 'derecha' : undefined)
const front = (n: string): RigBone['posicion'] => (/front|delant|fore/i.test(n) ? 'delante' : /back|hind|rear|tras|detr/i.test(n) ? 'detras' : undefined)

/** Huesos con jerarquía, pivotes y papel (cabeza, pierna izquierda, párpado…). */
async function rigBones(modelFile: string): Promise<{ bones: RigBone[]; formato: string }> {
  const j = await fs.readJson(modelFile)
  const out: RigBone[] = []
  const geo = j['minecraft:geometry'] ?? (j.geometry ? [j.geometry] : null)
  let formato = ''
  if (Array.isArray(geo)) {
    formato = 'Bedrock / GeckoLib (.geo.json)'
    for (const b of geo.flatMap((g: any) => g.bones ?? [])) out.push({ nombre: String(b.name), padre: b.parent, pivote: b.pivot, cubos: (b.cubes ?? []).length })
  } else if (j.meta && Array.isArray(j.outliner)) {
    formato = `Blockbench (.bbmodel, ${j.meta.model_format})`
    const walk = (n: any, parent?: string): void => {
      if (!n || typeof n !== 'object') return
      out.push({ nombre: String(n.name), padre: parent, pivote: n.origin, cubos: (n.children ?? []).filter((c: unknown) => typeof c === 'string').length })
      for (const c of n.children ?? []) if (typeof c === 'object') walk(c, String(n.name))
    }
    j.outliner.forEach((n: any) => walk(n))
  } else if (Array.isArray(j.models)) {
    formato = 'OptiFine CEM / EMF (.jem)'
    for (const m of j.models) out.push({ nombre: String(m.part ?? m.id), pivote: m.translate, cubos: (m.boxes ?? []).length + (m.submodels ?? []).length })
  } else throw new Error('No parece un modelo .geo.json, .bbmodel ni .jem')
  for (const b of out) {
    b.rol = ROLES.find(([, re]) => re.test(b.nombre))?.[0]
    b.lado = side(b.nombre)
    b.posicion = front(b.nombre)
  }
  return { bones: out, formato }
}

const has = (bones: RigBone[], rol: string): RigBone[] => bones.filter((b) => b.rol === rol)

/**
 * ¿Está el modelo preparado para moverse y para tener expresiones? Jerarquía,
 * pivotes, partes reconocidas, qué animaciones tiene (si se pasan) y qué falta.
 */
export async function analyzeRig(modelFile: string, animationsFile?: string): Promise<Record<string, unknown>> {
  const { bones, formato } = await rigBones(modelFile)
  const problems: string[] = []
  const tips: string[] = []
  const names = new Set(bones.map((b) => b.nombre))
  for (const b of bones) {
    if (b.padre && !names.has(b.padre)) problems.push(`«${b.nombre}» tiene como padre «${b.padre}», que no existe`)
    const atOrigin = Array.isArray(b.pivote) && b.pivote.every((v) => Number(v) === 0)
    if (atOrigin && b.rol && ['cabeza', 'brazo', 'pierna', 'cola', 'ala', 'mandibula', 'oreja', 'parpado'].includes(b.rol)) {
      problems.push(`El pivote de «${b.nombre}» (${b.rol}) está en 0,0,0: al rotarlo girará desde el suelo, no desde su articulación. Ponlo donde se une (hombro, cadera, cuello…)`)
    }
  }
  const legs = has(bones, 'pierna'), arms = has(bones, 'brazo'), head = has(bones, 'cabeza')
  const eyes = has(bones, 'ojo'), lids = has(bones, 'parpado'), jaw = has(bones, 'mandibula'), brows = has(bones, 'ceja')
  const kind = legs.length >= 4 ? 'cuadrúpedo' : legs.length === 2 ? (arms.length ? 'bípedo (humanoide)' : 'bípedo') : legs.length ? `${legs.length} patas` : has(bones, 'ala').length ? 'volador' : 'sin patas'
  if (!head.length) tips.push('Sin hueso de cabeza: no podrá mirar al jugador ni hacer gestos con la cabeza.')
  if (head.length && !has(bones, 'cuello').length && kind === 'cuadrúpedo') tips.push('Un hueso «neck» entre cuerpo y cabeza da movimientos de cabeza más naturales.')
  const expr = {
    parpadear: lids.length ? 'sí (párpados)' : eyes.length ? 'sí, escalando los ojos' : 'no: añade huesos de ojos o párpados',
    hablar_o_morder: jaw.length ? 'sí (mandíbula/boca)' : 'no: añade un hueso de mandíbula con el pivote en la bisagra',
    cejas: brows.length ? 'sí' : 'no',
    mirar: head.length ? 'sí (cabeza)' : 'no',
    por_textura: 'También se pueden hacer cambiando la textura de la cara (GeckoLib: textura según el estado en el código; ETF: variantes y ojos emisivos _e)',
  }
  if (!eyes.length && !lids.length) tips.push('Para expresiones, separa los ojos (y mejor párpados) en huesos propios, hijos de la cabeza.')
  if (!jaw.length && head.length) tips.push('Una mandíbula como hueso hijo de la cabeza permite hablar, rugir o morder.')
  let animations: string[] = []
  if (animationsFile && await fs.pathExists(animationsFile)) {
    const a = await fs.readJson(animationsFile).catch(() => ({}))
    animations = a.animations && !Array.isArray(a.animations) ? Object.keys(a.animations) : Array.isArray(a.animations) ? a.animations.map((x: any) => x.name) : []
  }
  const want = ['idle', 'walk', ...(legs.length ? ['run'] : []), ...(arms.length || jaw.length ? ['attack'] : []), 'hurt', 'death', ...(lids.length || eyes.length ? ['blink'] : []), ...(jaw.length ? ['talk'] : []), ...(has(bones, 'ala').length ? ['fly'] : [])]
  const missing = want.filter((w) => !animations.some((n) => n.toLowerCase().includes(w)))
  return {
    modelo: modelFile, formato, tipo: kind,
    huesos: bones.map((b) => ({ ...b, pivote: b.pivote ? b.pivote.map((v) => Number(v)) : undefined })),
    partes: Object.fromEntries(ROLES.map(([r]) => [r, has(bones, r).map((b) => b.nombre)]).filter(([, l]) => (l as string[]).length)),
    expresiones: expr, animaciones: animationsFile ? animations : undefined,
    animacionesQueFaltan: missing, problemas: problems, consejos: tips,
    siguiente: missing.length ? 'crear_animaciones_base hace una primera versión de las que faltan a partir de estos huesos, para retocarlas después.' : undefined,
  }
}

/**
 * Primera versión de las animaciones típicas a partir de los huesos del modelo
 * (por nombre: piernas, brazos, cabeza, cola, alas, mandíbula, ojos…). Son una
 * base razonable para retocar, no la animación final.
 */
export async function baseAnimations(modelFile: string, which?: string[]): Promise<AnimationSpec[]> {
  const { bones } = await rigBones(modelFile)
  const legs = has(bones, 'pierna'), arms = has(bones, 'brazo'), head = has(bones, 'cabeza')[0], body = has(bones, 'cuerpo')[0]
  const tails = has(bones, 'cola'), wings = has(bones, 'ala'), jaw = has(bones, 'mandibula')[0]
  const blinkers = has(bones, 'parpado').length ? has(bones, 'parpado') : has(bones, 'ojo')
  const quad = legs.length >= 4
  // Fase de cada pierna: en cuadrúpedos se mueven en diagonal (delantera izquierda con trasera derecha)
  const phase = (b: RigBone): number => {
    const left = b.lado === 'izquierda'
    if (!quad) return left ? 0 : 1
    const fr = b.posicion !== 'detras'
    return left === fr ? 0 : 1
  }
  const swing = (amp: number, len: number, p: number): Record<string, Vec> => {
    const a = p ? -amp : amp
    return { 0: [a, 0, 0], [len / 2]: [-a, 0, 0], [len]: [a, 0, 0] }
  }
  const specs: AnimationSpec[] = []
  const want = (n: string): boolean => !which?.length || which.includes(n)
  if (want('idle')) {
    const h: AnimationSpec['huesos'] = {}
    if (body) h[body.nombre] = { scale: { 0: [1, 1, 1], 1.5: [1, 1.02, 1], 3: [1, 1, 1] } }
    if (head) h[head.nombre] = { rotation: { 0: [0, 0, 0], 1.5: [-3, 0, 0], 3: [0, 0, 0] } }
    for (const t of tails) h[t.nombre] = { rotation: [0, 'math.sin(query.anim_time * 120) * 8', 0] }
    for (const w of wings) h[w.nombre] = { rotation: [0, 0, `math.sin(query.anim_time * 90) * ${w.lado === 'derecha' ? -4 : 4}`] }
    if (Object.keys(h).length) specs.push({ nombre: 'idle', bucle: true, duracion: 3, huesos: h })
  }
  if (want('walk') && (legs.length || arms.length)) {
    const h: AnimationSpec['huesos'] = {}
    for (const l of legs) h[l.nombre] = { rotation: swing(25, 1, phase(l)) }
    // Los brazos van al revés que la pierna de su lado
    for (const a of arms) h[a.nombre] = { rotation: swing(15, 1, a.lado === 'izquierda' ? 1 : 0) }
    if (body) h[body.nombre] = { position: { 0: [0, 0, 0], 0.25: [0, 0.5, 0], 0.5: [0, 0, 0], 0.75: [0, 0.5, 0], 1: [0, 0, 0] } }
    for (const t of tails) h[t.nombre] = { rotation: { 0: [0, 10, 0], 0.5: [0, -10, 0], 1: [0, 10, 0] } }
    specs.push({ nombre: 'walk', bucle: true, duracion: 1, huesos: h })
  }
  if (want('run') && legs.length) {
    const h: AnimationSpec['huesos'] = {}
    for (const l of legs) h[l.nombre] = { rotation: swing(45, 0.5, phase(l)) }
    for (const a of arms) h[a.nombre] = { rotation: swing(35, 0.5, a.lado === 'izquierda' ? 1 : 0) }
    if (body) h[body.nombre] = { rotation: [8, 0, 0], position: { 0: [0, 0, 0], 0.125: [0, 1, 0], 0.25: [0, 0, 0], 0.375: [0, 1, 0], 0.5: [0, 0, 0] } }
    specs.push({ nombre: 'run', bucle: true, duracion: 0.5, huesos: h })
  }
  if (want('attack') && (arms.length || jaw || head)) {
    const h: AnimationSpec['huesos'] = {}
    const arm = arms.find((a) => a.lado === 'derecha') ?? arms[0]
    if (arm) h[arm.nombre] = { rotation: { 0: [0, 0, 0], 0.2: [-110, 0, 0], 0.35: [20, 0, 0], 0.6: [0, 0, 0] } }
    else if (head) h[head.nombre] = { rotation: { 0: [0, 0, 0], 0.15: [-20, 0, 0], 0.3: [15, 0, 0], 0.6: [0, 0, 0] } }
    if (jaw) h[jaw.nombre] = { rotation: { 0: [0, 0, 0], 0.15: [25, 0, 0], 0.3: [0, 0, 0] } }
    specs.push({ nombre: 'attack', bucle: false, duracion: 0.6, huesos: h })
  }
  if (want('hurt') && (body || head)) {
    const b = body ?? head!
    specs.push({ nombre: 'hurt', bucle: false, duracion: 0.3, huesos: { [b.nombre]: { rotation: { 0: [0, 0, 0], 0.1: [-10, 0, 5], 0.3: [0, 0, 0] } } } })
  }
  if (want('death') && (body || head)) {
    const b = body ?? head!
    specs.push({ nombre: 'death', bucle: 'hold_on_last_frame', duracion: 1, huesos: { [b.nombre]: { rotation: { 0: [0, 0, 0], 1: { post: [0, 0, 90], lerp_mode: 'catmullrom' } } } } })
  }
  if (want('blink') && blinkers.length) {
    const h: AnimationSpec['huesos'] = {}
    for (const e of blinkers) h[e.nombre] = { scale: { 0: [1, 1, 1], 3.8: [1, 1, 1], 3.9: [1, 0.1, 1], 4: [1, 1, 1] } }
    specs.push({ nombre: 'blink', bucle: true, duracion: 4, huesos: h })
  }
  if (want('talk') && jaw) {
    specs.push({ nombre: 'talk', bucle: true, duracion: 0.6, huesos: { [jaw.nombre]: { rotation: { 0: [0, 0, 0], 0.15: [18, 0, 0], 0.3: [4, 0, 0], 0.45: [14, 0, 0], 0.6: [0, 0, 0] } } } })
  }
  if (want('fly') && wings.length) {
    const h: AnimationSpec['huesos'] = {}
    for (const w of wings) h[w.nombre] = { rotation: { 0: [0, 0, w.lado === 'derecha' ? 35 : -35], 0.25: [0, 0, w.lado === 'derecha' ? -25 : 25], 0.5: [0, 0, w.lado === 'derecha' ? 35 : -35] } }
    specs.push({ nombre: 'fly', bucle: true, duracion: 0.5, huesos: h })
  }
  return specs
}

/** Escribe las animaciones base que falten (o las pedidas) en el .animation.json. */
export async function writeBaseAnimations(base: string, modelFile: string, animFile: string, which?: string[], replace = false): Promise<Record<string, unknown>> {
  const model = path.resolve(base, modelFile)
  const target = path.resolve(base, animFile)
  const existing = (await fs.pathExists(target)) ? Object.keys((await fs.readJson(target)).animations ?? {}) : []
  const specs = await baseAnimations(model, which)
  const written: string[] = [], skipped: string[] = []
  for (const s of specs) {
    if (!replace && existing.some((n) => n.toLowerCase().endsWith('.' + s.nombre) || n.toLowerCase() === s.nombre)) { skipped.push(s.nombre); continue }
    const r = await writeAnimation(base, animFile, s, { model: modelFile })
    written.push(String(r.animacion))
  }
  return { archivo: target, creadas: written, yaExistian: skipped, nota: written.length ? 'Son una primera versión hecha a partir de los nombres de los huesos: revísalas (amplitudes, tiempos, ejes) con analizar_animacion y retócalas con escribir_animacion.' : 'No había ninguna que crear.' }
}
