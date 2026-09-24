const stack: Array<() => void> = []

type Direction = 'back' | 'forward'
type Interceptor = (direction: Direction) => boolean
let interceptor: Interceptor | null = null

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
  }
}
