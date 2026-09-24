import * as THREE from 'three'
import type { BoneHandles } from './bedrockGeo'

// ─────────────────────────────────────────────────────────────────────────────
// Bedrock entity animation player (.animation.json from bedrock-samples).
// Supports numeric keyframes and a practical Molang subset (math.*, query
// time variables). Unknown queries evaluate to 0; some get synthetic values
// so walk cycles actually move.
// ─────────────────────────────────────────────────────────────────────────────

type V = number | string
type Chan = [V, V, V] | Record<string, [V, V, V] | { post?: [V, V, V]; pre?: [V, V, V] }>

export interface BedrockAnim {
  loop?: boolean | string
  animation_length?: number
  bones?: Record<string, { rotation?: Chan; position?: Chan }>
}

export type AnimSet = Record<string, Record<string, BedrockAnim>>

let animsPromise: Promise<AnimSet> | null = null
export function loadVanillaAnims(): Promise<AnimSet> {
  if (!animsPromise) {
    animsPromise = import('./bedrockAnims.json').then(m => (m.default ?? m) as unknown as AnimSet)
  }
  return animsPromise
}

/** Animations for a mob, trying name variants (cow_v2 → cow, cow_baby → cow). */
export function animsForMob(data: AnimSet, name: string): Record<string, BedrockAnim> {
  const base = name.replace(/_v\d+$/, '')
  for (const cand of [base, base.replace(/_baby$/, ''), base.split('_')[0]]) {
    if (data[cand]) return data[cand]
  }
  return {}
}

// ── Molang subset ────────────────────────────────────────────────────────────

const DEG = Math.PI / 180
const MM = {
  sin: (d: number) => Math.sin(d * DEG),
  cos: (d: number) => Math.cos(d * DEG),
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  sqrt: Math.sqrt,
  pow: Math.pow,
  exp: Math.exp,
  ln: Math.log,
  round: Math.round,
  trunc: Math.trunc,
  mod: (a: number, b: number) => a - b * Math.floor(a / b),
  min: Math.min,
  max: Math.max,
  clamp: (x: number, a: number, b: number) => Math.min(Math.max(x, a), b),
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  random: (a: number, b: number) => (a + b) / 2,
  pi: Math.PI,
}

/** Synthetic values so movement-driven animations do something sensible. */
function queryValue(name: string, t: number): number {
  switch (name) {
    case 'anim_time':
    case 'life_time':
      return t
    case 'modified_distance_moved':
    case 'distance_moved':
      return t * 4
    case 'ground_speed':
    case 'modified_speed':
      return 0.35
    case 'is_on_ground':
      return 1
    default:
      return 0
  }
}

type Evaluator = (t: number) => number
const exprCache = new Map<string, Evaluator>()

function compileExpr(src: string): Evaluator {
  let fn = exprCache.get(src)
  if (fn) return fn
  let s = src.toLowerCase().trim()
  if (!/^[\s0-9a-z_.+\-*/%(),<>=!?:&|]*$/.test(s)) {
    fn = () => 0
  } else {
    s = s.replace(/\bmath\.(\w+)/g, 'MM.$1')
    s = s.replace(/\b(?:query|q)\.(\w+)/g, 'Q("$1")')
    s = s.replace(/\b(?:variable|v|temp|t)\.(\w+)/g, '0')
    s = s.replace(/\bthis\b/g, '0')
    try {
      const raw = new Function('MM', 'Q', `return (${s});`) as (mm: typeof MM, q: (n: string) => number) => number
      fn = (t: number) => {
        try {
          const r = raw(MM, (n: string) => queryValue(n, t))
          return Number.isFinite(r) ? r : 0
        } catch { return 0 }
      }
    } catch {
      fn = () => 0
    }
  }
  exprCache.set(src, fn)
  return fn
}

function evalV(v: V, t: number): number {
  if (typeof v === 'number') return v
  return compileExpr(v)(t)
}

// ── Channel sampling ─────────────────────────────────────────────────────────

function sampleChan(chan: Chan, t: number, length: number): [number, number, number] {
  if (Array.isArray(chan)) {
    return [evalV(chan[0], t), evalV(chan[1], t), evalV(chan[2], t)]
  }
  // Keyframes: sorted numeric times, linear interpolation, looped by length.
  // Entries are kept as pairs — reconstructing keys from Number loses "1.30".
  const entries = Object.entries(chan)
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([k]) => Number.isFinite(k))
    .sort((a, b) => a[0] - b[0])
  if (entries.length === 0) return [0, 0, 0]
  const dur = length > 0 ? length : entries[entries.length - 1][0] || 1
  const tt = dur > 0 ? ((t % dur) + dur) % dur : 0
  const val = (raw: [V, V, V] | { post?: [V, V, V]; pre?: [V, V, V] }): [number, number, number] => {
    const arr = Array.isArray(raw) ? raw : raw?.post ?? raw?.pre ?? [0, 0, 0]
    return [evalV(arr[0], tt), evalV(arr[1], tt), evalV(arr[2], tt)]
  }
  let prev = entries[0]
  let next = entries[entries.length - 1]
  for (const e of entries) {
    if (e[0] <= tt) prev = e
    if (e[0] >= tt) { next = e; break }
  }
  const a = val(prev[1])
  if (next[0] === prev[0]) return a
  const b = val(next[1])
  const f = (tt - prev[0]) / (next[0] - prev[0])
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

// ── Ticker ───────────────────────────────────────────────────────────────────

/**
 * Creates a per-frame ticker applying the given animations to the model's bones.
 * `timeFn` maps wall-clock ms to animation seconds (frozen pose = () => 0).
 */
export function makeAnimTicker(
  bones: Map<string, BoneHandles>,
  anims: BedrockAnim[],
  timeFn: (nowMs: number) => number
): (nowMs: number) => void {
  return (nowMs: number) => {
    const t = timeFn(nowMs)
    // Reset to base pose, then add animation channels
    for (const h of bones.values()) {
      h.outer.rotation.set(h.baseRot[0], h.baseRot[1], h.baseRot[2])
      h.outer.position.set(h.basePos[0], h.basePos[1], h.basePos[2])
    }
    for (const anim of anims) {
      const len = anim.animation_length ?? 0
      for (const [boneName, ch] of Object.entries(anim.bones ?? {})) {
        const h = bones.get(boneName.toLowerCase())
        if (!h) continue
        if (ch.rotation) {
          const [rx, ry, rz] = sampleChan(ch.rotation, t, len)
          // bedrock degrees → render space (x/y negated, XYZ order)
          h.outer.rotation.x += -rx * DEG
          h.outer.rotation.y += -ry * DEG
          h.outer.rotation.z += rz * DEG
        }
        if (ch.position) {
          const [px, py, pz] = sampleChan(ch.position, t, len)
          h.outer.position.x += -px
          h.outer.position.y += py
          h.outer.position.z += pz
        }
      }
    }
  }
}

/** Pose-like animations (constant stances) applied automatically at t=0.
 *  Versioned variants (base_pose_v1.0, setup.v2) target other geometry revisions. */
export function isPoseAnim(name: string): boolean {
  return /default|_pose$|^pose|setup/.test(name) && !/v\d/.test(name)
}

export function tickerFor(
  group: THREE.Group,
  anims: BedrockAnim[],
  playing: boolean
): ((nowMs: number) => void) | null {
  const bones = group.userData.bones as Map<string, BoneHandles> | undefined
  if (!bones) return null
  // An empty list still returns a ticker so deselecting an animation resets the pose
  const start = performance.now()
  return makeAnimTicker(bones, anims, playing ? (now) => (now - start) / 1000 : () => 0)
}
