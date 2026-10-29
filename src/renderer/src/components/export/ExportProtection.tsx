import type { ModpackProtection } from '../../../../shared/types'

// Sección «Protección» de Exportar modpack: caducidad, cuenta obligatoria y qué puede
// cambiar quien lo instale. Si se activa algo, la instancia de quien lo instala queda
// protegida (no se duplica, ni se exporta, ni se saca su contenido).

export interface ProtectionDraft {
  expiry: boolean
  /** «AAAA-MM-DDTHH:mm» en la hora local de quien exporta */
  expiryAt: string
  account: boolean
  accountUntil: boolean
  accountUntilAt: string
  allow: ModpackProtection['allow']
}

export const EMPTY_PROTECTION: ProtectionDraft = {
  expiry: false,
  expiryAt: '',
  account: false,
  accountUntil: false,
  accountUntilAt: '',
  allow: { options: true, packs: true, mods: false, files: false },
}

const localInputValue = (ms: number): string => {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

/** Lo que se manda al exportar, o undefined si no se activó nada (o si falta una fecha). */
export function toProtection(d: ProtectionDraft): ModpackProtection | undefined {
  if (!d.expiry && !d.account) return undefined
  const expiresAt = d.expiry && d.expiryAt ? new Date(d.expiryAt).getTime() : undefined
  const until = d.account && d.accountUntil && d.accountUntilAt ? new Date(d.accountUntilAt).getTime() : undefined
  return {
    ...(expiresAt ? { expiresAt, expiresTz: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}),
    ...(d.account ? { account: until ? { until } : {} } : {}),
    allow: d.allow,
  }
}

/** Motivo por el que no se puede exportar todavía, o null. */
export function protectionProblem(d: ProtectionDraft): string | null {
  if (d.expiry) {
    if (!d.expiryAt) return 'Elige la fecha y hora de caducidad'
    if (new Date(d.expiryAt).getTime() <= Date.now() + 60_000) return 'La caducidad tiene que ser en el futuro'
  }
  if (d.account && d.accountUntil) {
    if (!d.accountUntilAt) return 'Elige hasta cuándo se exige la cuenta'
    if (new Date(d.accountUntilAt).getTime() <= Date.now()) return 'La fecha de la cuenta obligatoria tiene que ser en el futuro'
  }
  return null
}

const ALLOW: [keyof ModpackProtection['allow'], string, string][] = [
  ['options', 'Cambiar los ajustes del juego', 'Controles, vídeo, sonido…'],
  ['packs', 'Poner o quitar resource packs y shaders', 'Los suyos, además de los del modpack'],
  ['mods', 'Añadir mods propios', 'Los mods del modpack nunca se pueden quitar'],
  ['files', 'Ver las carpetas y la configuración de los mods', 'Si no, la config solo existe mientras se juega'],
]

export default function ExportProtection({ value, onChange }: { value: ProtectionDraft; onChange: (v: ProtectionDraft) => void }) {
  const set = (patch: Partial<ProtectionDraft>): void => onChange({ ...value, ...patch })
  const on = value.expiry || value.account
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const minNow = localInputValue(Date.now() + 5 * 60_000)
  const problem = protectionProblem(value)

  const toggle = (checked: boolean, label: string, hint: string, onToggle: (v: boolean) => void) => (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} className="w-4 h-4 mt-0.5 accent-accent shrink-0" />
      <span>
        <span className="block text-sm text-text-primary">{label}</span>
        <span className="block text-[11px] text-text-muted">{hint}</span>
      </span>
    </label>
  )

  return (
    <div className="space-y-3">
      <div className="bg-bg-primary border border-border rounded-xl p-3 space-y-3">
        {toggle(value.expiry, 'Caducidad', 'Al llegar la fecha, el modpack se borra solo de quien lo tenga instalado', (v) => set({ expiry: v }))}
        {value.expiry && (
          <div className="pl-7 space-y-1">
            <input type="datetime-local" value={value.expiryAt} min={minNow} onChange={(e) => set({ expiryAt: e.target.value })}
              className="bg-bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent [color-scheme:dark]" />
            <p className="text-[11px] text-text-muted">En tu hora local ({tz}). Quien lo instale lo verá en la suya, con un aviso 10 minutos antes.</p>
          </div>
        )}

        {toggle(value.account, 'Cuenta obligatoria', 'Quien lo instale elige una cuenta (premium o no) y solo podrá jugarlo con esa', (v) => set({ account: v }))}
        {value.account && (
          <div className="pl-7 flex flex-wrap items-center gap-2">
            <select value={value.accountUntil ? 'until' : 'forever'} onChange={(e) => set({ accountUntil: e.target.value === 'until' })}
              className="bg-bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent">
              <option value="forever">Siempre</option>
              <option value="until">Hasta una fecha</option>
            </select>
            {value.accountUntil && (
              <input type="datetime-local" value={value.accountUntilAt} min={minNow} onChange={(e) => set({ accountUntilAt: e.target.value })}
                className="bg-bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent [color-scheme:dark]" />
            )}
          </div>
        )}
      </div>

      {on && (
        <div className="bg-bg-primary border border-border rounded-xl p-3 space-y-2.5">
          <p className="text-xs font-medium text-text-secondary">Qué puede hacer quien lo instale</p>
          <p className="text-[11px] text-text-muted -mt-1.5">Nunca podrá duplicarlo, exportarlo, guardarlo como .fpack ni pasar su contenido a otra instancia.</p>
          {ALLOW.map(([k, label, hint]) => (
            <label key={k} className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={value.allow[k]} onChange={(e) => set({ allow: { ...value.allow, [k]: e.target.checked } })} className="w-4 h-4 mt-0.5 accent-accent shrink-0" />
              <span>
                <span className="block text-xs text-text-primary">{label}</span>
                <span className="block text-[10px] text-text-muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {on && (
        <p className="text-[11px] text-text-muted bg-bg-card rounded-lg p-2.5">
          Los mods y la configuración se guardan <b className="text-text-secondary">cifrados</b> en el equipo de cada jugador y solo se abren mientras juega, así que copiar la carpeta no sirve. Pon también una <b className="text-text-secondary">clave de acceso</b>: sin ella, alguien con conocimientos podría descifrar el archivo del modpack. Ninguna protección es imposible de saltar al 100%, pero esta lo pone muy difícil.
        </p>
      )}
      {problem && <p className="text-[11px] text-amber-300">{problem}</p>}
    </div>
  )
}
