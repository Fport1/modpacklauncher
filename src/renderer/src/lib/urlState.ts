import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Estado guardado en la URL (`#/models?tab=mobs`) en vez de en un useState.
 *
 * Así forma parte del historial: los botones laterales del ratón recorren las
 * pestañas igual que las páginas, y al volver hacia delante la página reaparece
 * como estaba en vez de con sus valores por defecto.
 *
 * - `push` crea una entrada nueva en el historial. Para pestañas: "atrás" debe
 *   devolverte a la anterior.
 * - `replace` actualiza la entrada actual sin crear otra. Para selecciones
 *   dentro de una pestaña (qué mob, qué carpeta): se recuerdan al volver, pero
 *   no llenan el historial de pasos que nadie quiere deshacer uno a uno.
 */
export function useUrlState<T extends string>(
  key: string,
  fallback: T,
  mode: 'push' | 'replace' = 'push'
): [T, (value: T) => void] {
  const [params, setParams] = useSearchParams()
  const value = (params.get(key) as T | null) ?? fallback

  const setValue = useCallback(
    (next: T) => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev)
          if (next === fallback) updated.delete(key)
          else updated.set(key, next)
          return updated
        },
        { replace: mode === 'replace' }
      )
    },
    [key, fallback, mode, setParams]
  )

  return [value, setValue]
}
