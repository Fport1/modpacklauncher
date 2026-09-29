import { useState } from 'react'
import { useStore } from '../store'

// Qué comparte el launcher y cómo desactivarlo. Se usa en Ajustes › Privacidad
// y en el aviso que sale la primera vez.

export const PRIVACY_ITEMS = {
  telemetry: {
    title: 'Estadísticas de uso anónimas',
    desc: 'Cuántas personas usan el launcher y cómo: versión, sistema, idioma, veces que se abre, minutos de juego, crashes, loaders usados y si hay sesión de fport1social o cuenta premium (solo sí/no).',
    sample: '{ "v": "1.10.1", "os": "win32", "lang": "es", "launches": 12, "playMinutes": 340, "loaders": { "fabric": 2 }, "social": true }',
  },
  aiLearning: {
    title: 'Ayudar a que la IA aprenda',
    desc: 'Cuando el juego crashea se guarda la huella del error (tipo de fallo y mods implicados) y, cuando una IA lo arregla, la lección. Así, a quien le pase lo mismo, la IA se lo arregla a la primera.',
    sample: '{ "sig": "Mixin apply failed | NoSuchMethodError…", "mods": ["sodium", "iris"], "mc": "1.21.1", "fix": "Actualizar iris a 1.8" }',
  },
} as const

export const PRIVACY_NEVER = 'Nunca se envían nombres, correos, contraseñas, rutas de tu equipo, IPs, mundos, capturas ni mensajes del chat: antes de salir, el texto se limpia de todo eso.'

export default function PrivacySettings({ compact = false }: { compact?: boolean }) {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const [open, setOpen] = useState<string | null>(null)
  if (!settings) return null

  async function toggle(key: 'telemetry' | 'aiLearning'): Promise<void> {
    const value = !settings![key]
    await window.api.settings.set({ [key]: value })
    setSettings({ ...settings!, [key]: value })
  }

  return (
    <div className={compact ? 'space-y-3' : 'bg-bg-card border border-border rounded-xl p-4 space-y-4'}>
      {(['telemetry', 'aiLearning'] as const).map((key) => {
        const it = PRIVACY_ITEMS[key]
        const on = settings[key] !== false
        return (
          <div key={key}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-sm text-text-secondary">{it.title}</span>
                <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{it.desc}</p>
                <button onClick={() => setOpen(open === key ? null : key)} className="text-[11px] text-accent hover:underline mt-1">
                  {open === key ? 'Ocultar ejemplo' : 'Ver un ejemplo de lo que se envía'}
                </button>
                {open === key && <pre data-no-translate className="mt-1.5 px-2.5 py-2 rounded-lg bg-bg-primary border border-border text-[10.5px] text-text-muted whitespace-pre-wrap break-all">{it.sample}</pre>}
              </div>
              <button onClick={() => toggle(key)} role="switch" aria-checked={on} aria-label={it.title}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 mt-0.5 ${on ? 'bg-accent' : 'bg-border'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        )
      })}
      <p className="text-[11px] text-text-muted leading-relaxed">🔒 {PRIVACY_NEVER}</p>
    </div>
  )
}

/** Aviso de la primera vez: informa y deja elegir, sin bloquear el launcher. */
export function PrivacyNotice() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  if (!settings || settings.privacyNoticeSeen !== false) return null

  async function done(): Promise<void> {
    await window.api.settings.set({ privacyNoticeSeen: true })
    setSettings({ ...settings!, privacyNoticeSeen: true })
  }

  return (
    <div className="fixed bottom-4 left-4 z-[380] w-[420px] max-w-[calc(100vw-2rem)] bg-bg-secondary border border-border rounded-2xl shadow-2xl p-5">
      <p className="font-bold text-text-primary">Tu privacidad en el launcher</p>
      <p className="text-xs text-text-muted mt-1 mb-4">Para mejorar el launcher y la IA se comparte información anónima. Puedes cambiarlo cuando quieras en Ajustes › Privacidad.</p>
      <PrivacySettings compact />
      <div className="flex justify-end mt-4">
        <button onClick={done} className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold">Entendido</button>
      </div>
    </div>
  )
}
