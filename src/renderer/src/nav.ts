const stack: Array<() => void> = []

type Direction = 'back' | 'forward'
type Interceptor = (direction: Direction) => boolean
let interceptor: Interceptor | null = null
// Ventanas abiertas encima (buscadores con historial propio): la última manda
const overlays: Interceptor[] = []

export const nav = {
  push(backFn: () => void): void {
    stack.push(backFn)
  },
  pop(): void {
    stack.pop()?.()
  },
  size(): number {
    return stack.length
  },
  clearFrom(index: number): void {
    stack.length = index
  },

  /**
   * Deja que una página se quede con los botones de atrás/adelante mientras
   * tenga algo propio que recorrer — por ejemplo, el historial de carpetas del
   * panel activo en Servidores. Devuelve la función para soltarlo.
   *
   * El interceptor devuelve true si ha gestionado el botón; si devuelve false,
   * se navega por las páginas de la app como siempre.
   */
  setInterceptor(fn: Interceptor): () => void {
    interceptor = fn
    return () => {
      if (interceptor === fn) interceptor = null
    }
  },
  intercept(direction: Direction): boolean {
    return interceptor?.(direction) ?? false
  },

  /**
   * Historial de una ventana abierta encima (p. ej. el buscador de mods de una
   * instancia): se consulta antes que todo lo demás mientras esté abierta.
   * Devuelve true si gestionó el botón. Devuelve la función para quitarlo.
   */
  pushOverlay(fn: Interceptor): () => void {
    overlays.push(fn)
    return () => {
      const i = overlays.lastIndexOf(fn)
      if (i >= 0) overlays.splice(i, 1)
    }
  },
  interceptOverlay(direction: Direction): boolean {
    const top = overlays[overlays.length - 1]
    return top ? top(direction) : false
  }
}
