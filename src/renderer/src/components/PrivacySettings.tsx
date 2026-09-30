import { useState } from 'react'
import { useStore } from '../store'

// Qué comparte el launcher y cómo desactivarlo (Ajustes › Privacidad).
// Viene activado; no se enseña ningún aviso al abrir el launcher.

export const PRIVACY_ITEMS = {
  telemetry: {
    title: 'Estadísticas de uso anónimas',
    desc: 'Cuántas personas usan el launcher y cómo: versión, sistema, idioma, veces que se abre, minutos de juego, crashes, loaders usados y si hay sesión de fport1social o cuenta premium (solo sí/no).',
    sample: '{ "v": "1.10.1", "os": "win32", "lang": "es", "launches": 12, "playMinutes": 340, "loaders": { "fabric": 2 }, "social": true }',
  },
  aiLearning: {
    title: 'Ayudar a que la IA aprenda',
    desc: 'Al cerrar el juego se guarda un resumen de la partida: mods activos, cómo es el mundo (dimensiones, cómo se genera, modo, dificultad, reglas), qué pasó (mobs matados, causas de muerte, minutos) y cómo fue (carga, lag, errores, crashes). También lo que aprende la IA al arreglar o construir algo. Así la IA sabe cómo se comporta el juego con cada combinación de mods y a quien le pase lo mismo se lo resuelve a la primera.',
    sample: '{ "mods": ["sodium", "iris", "terralith"], "mc": "1.21.1", "world": { "dims": ["minecraft:overworld", "minecraft:the_nether"], "difficulty": "difícil", "killed": { "zombie": 14 }, "deaths": 2 }, "loadSeconds": 41, "lagWarnings": 3, "crashed": false }',
  },
} as const

export const PRIVACY_NEVER = 'Nunca se envían nombres (el tuyo, el de tus mundos o el de otros jugadores), correos, contraseñas, rutas de tu equipo, IPs, semillas, coordenadas, capturas, carteles, libros ni mensajes del chat: antes de salir, el texto se limpia de todo eso.'

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
