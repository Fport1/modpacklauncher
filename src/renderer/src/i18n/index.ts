import { useStore } from '../store'
import { es } from './es'
import { en } from './en'
import type { TranslationKey } from './es'

export type { TranslationKey }

export function useT() {
  const language = useStore(s => s.settings?.language ?? 'es')
  const dict = language === 'en' ? en : es

  return function t(key: TranslationKey, vars?: Record<string, string | number>): string {
    let str: string = dict[key] ?? key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{${k}}`, String(v))
      }
    }
    return str
  }
}
