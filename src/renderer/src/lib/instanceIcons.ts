import type { Instance } from '../../../shared/types'
import { dominantColor, cachedDominantColor } from './dominantColor'

// Iconos de instancia en memoria. La tarjeta los pide al listar y el detalle
// los encuentra ya cargados (con su color calculado), así al abrirlo no hay
// un instante sin icono ni degradado.

const icons = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

const keyOf = (inst: Pick<Instance, 'id' | 'icon'>): string => `${inst.id}|${inst.icon ?? ''}`

export function cachedInstanceIcon(inst: Pick<Instance, 'id' | 'icon'>): string | null | undefined {
  return icons.get(keyOf(inst))
}

export function cachedInstanceColor(inst: Pick<Instance, 'id' | 'icon'>): string | null {
  const src = icons.get(keyOf(inst))
  return src ? cachedDominantColor(src) ?? null : null
}

export function loadInstanceIcon(inst: Pick<Instance, 'id' | 'icon'>): Promise<string | null> {
  const key = keyOf(inst)
  if (icons.has(key)) return Promise.resolve(icons.get(key)!)
  const running = pending.get(key)
  if (running) return running
  const p = window.api.instances.getIcon(inst.id)
    .then((src) => {
      icons.set(key, src)
      // El color se calcula ya, en segundo plano, para cuando se abra el detalle
      if (src) dominantColor(src).catch(() => {})
      return src
    })
    .catch(() => { icons.set(key, null); return null })
    .finally(() => pending.delete(key))
  pending.set(key, p)
  return p
}
