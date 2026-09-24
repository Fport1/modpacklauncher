import { useEffect, useState } from 'react'

// Texturas de Minecraft en la interfaz. Se piden en lote al proceso principal
// (que las saca del .jar del juego) y se guardan para no pedirlas dos veces.

const cache = new Map<string, string | null>()
let queued = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null
const waiters = new Set<() => void>()

function flush(): void {
  const keys = [...queued]
  queued = new Set()
  timer = null
  window.api.mc.textures(keys).then((res) => {
    for (const k of keys) cache.set(k, res[k] ?? null)
    waiters.forEach((w) => w())
  }).catch(() => {
    for (const k of keys) cache.set(k, null)
    waiters.forEach((w) => w())
  })
}

function request(keys: string[]): void {
  let added = false
  for (const k of keys) if (!cache.has(k) && !queued.has(k)) { queued.add(k); added = true }
  // Todo lo que pida la pantalla en el mismo instante va en una sola llamada
  if (added && !timer) timer = setTimeout(flush, 0)
}

/** Textura de cada clave (null si no existe, undefined mientras llega). */
export function useTextures(keys: string[]): Record<string, string | null | undefined> {
  const [, force] = useState(0)
  const joined = keys.join('|')
  useEffect(() => {
    const w = (): void => force((n) => n + 1)
    waiters.add(w)
    request(keys)
    return () => { waiters.delete(w) }
  }, [joined])
  const out: Record<string, string | null | undefined> = {}
  for (const k of keys) out[k] = cache.has(k) ? cache.get(k) : undefined
  return out
}

/**
 * Un icono de Minecraft con los píxeles nítidos. Si la textura es una tira
 * animada (brújula, reloj…) se ve el primer fotograma. Sin textura, `fallback`.
 */
export function McIcon({ k, size = 32, fallback, title, className = '' }: {
  k: string; size?: number; fallback?: React.ReactNode; title?: string; className?: string
}) {
  const url = useTextures([k])[k]
  if (!url) return <>{fallback ?? null}</>
  return (
    <span title={title} className={`inline-block shrink-0 ${className}`}
      style={{
        width: size, height: size,
        backgroundImage: `url(${url})`,
        backgroundSize: '100% auto',
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated'
      }} />
  )
}

export const HUD = {
  heartFull: 'gui/sprites/hud/heart/full',
  heartHalf: 'gui/sprites/hud/heart/half',
  heartEmpty: 'gui/sprites/hud/heart/container',
  foodFull: 'gui/sprites/hud/food_full',
  foodHalf: 'gui/sprites/hud/food_half',
  foodEmpty: 'gui/sprites/hud/food_empty',
  xpBack: 'gui/sprites/hud/experience_bar_background',
  xpFill: 'gui/sprites/hud/experience_bar_progress'
}
