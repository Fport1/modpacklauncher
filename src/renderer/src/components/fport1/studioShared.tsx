import { useState } from 'react'
import type { Channel, Fport1License, Fport1Type } from '../../lib/fport1Content'

// Piezas comunes del panel «Mis creaciones».

export const TYPES: { key: Fport1Type; label: string; accept: string; hint: string }[] = [
  { key: 'modpack', label: 'Modpack', accept: '.fpack,.mrpack', hint: '.fpack (del launcher) o .mrpack' },
  { key: 'mod', label: 'Mod', accept: '.jar', hint: '.jar' },
  { key: 'resourcepack', label: 'Resource Pack', accept: '.zip', hint: '.zip' },
  { key: 'datapack', label: 'Data Pack', accept: '.zip', hint: '.zip' },
  { key: 'shader', label: 'Shader', accept: '.zip', hint: '.zip' },
  { key: 'plugin', label: 'Plugin', accept: '.jar', hint: '.jar (servidores Paper, Spigot, Velocity…)' },
]

export const LOADERS: Record<Fport1Type, string[]> = {
  modpack: ['fabric', 'forge', 'neoforge', 'quilt', 'vanilla'],
  mod: ['fabric', 'forge', 'neoforge', 'quilt'],
  resourcepack: [],
  datapack: [],
  shader: ['iris', 'optifine', 'canvas', 'vanilla'],
  plugin: ['paper', 'spigot', 'bukkit', 'purpur', 'folia', 'velocity', 'bungeecord'],
}

export const LOADER_NAMES: Record<string, string> = {
  fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', vanilla: 'Vanilla',
  iris: 'Iris', optifine: 'OptiFine', canvas: 'Canvas',
  paper: 'Paper', spigot: 'Spigot', bukkit: 'Bukkit', purpur: 'Purpur', folia: 'Folia', velocity: 'Velocity', bungeecord: 'BungeeCord',
}

export const CHANNELS: { key: Channel; label: string; cls: string }[] = [
  { key: 'release', label: 'Release', cls: 'bg-green-500/15 text-green-300 border-green-500/40' },
  { key: 'beta', label: 'Beta', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  { key: 'alpha', label: 'Alpha', cls: 'bg-red-500/15 text-red-300 border-red-500/40' },
]

export const SIDES = [
  { key: 'required', label: 'Necesario' },
  { key: 'optional', label: 'Opcional' },
  { key: 'unsupported', label: 'No hace falta' },
] as const

/** Licencias de código abierto (las primeras las sabe poner GitHub al crear el repo). */
export const OPEN_LICENSES: Fport1License[] = [
  { id: 'MIT', name: 'MIT' },
  { id: 'Apache-2.0', name: 'Apache 2.0' },
  { id: 'GPL-3.0', name: 'GNU GPL v3' },
  { id: 'LGPL-3.0', name: 'GNU LGPL v3' },
  { id: 'MPL-2.0', name: 'Mozilla Public License 2.0' },
  { id: 'AGPL-3.0', name: 'GNU AGPL v3' },
  { id: 'BSD-3-Clause', name: 'BSD 3-Clause' },
  { id: 'Unlicense', name: 'Unlicense (dominio público)' },
  { id: 'CC0-1.0', name: 'CC0 (dominio público)' },
  { id: 'CC-BY-4.0', name: 'Creative Commons BY 4.0' },
  { id: 'CC-BY-SA-4.0', name: 'Creative Commons BY-SA 4.0' },
]

/** Licencias para código cerrado. */
export const CLOSED_LICENSES: Fport1License[] = [
  { id: 'ARR', name: 'Todos los derechos reservados' },
  { id: 'CC-BY-NC-4.0', name: 'Creative Commons BY-NC 4.0 (sin uso comercial)' },
  { id: 'CC-BY-NC-ND-4.0', name: 'Creative Commons BY-NC-ND 4.0 (sin uso comercial ni cambios)' },
]


export const inputCls = 'w-full bg-bg-primary border border-border focus:border-[#a855f7] rounded-xl px-3 py-2 text-sm text-text-primary outline-none transition-colors'
export const labelCls = 'block text-xs font-semibold text-text-secondary mb-1.5'

export function fmtSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const cleanErr = (e: unknown): string => e instanceof Error ? e.message.replace(/^Error invoking remote method [^:]+: (Error: )?/, '') : 'Algo ha fallado'

export function Chips({ options, value, onChange, names }: { options: string[]; value: string[]; onChange: (v: string[]) => void; names?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = value.includes(o)
        return (
          <button key={o} type="button" onClick={() => onChange(on ? value.filter(x => x !== o) : [...value, o])}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${on ? 'bg-[#a855f7]/25 border-[#a855f7]/60 text-[#e9d5ff]' : 'border-border text-text-secondary hover:bg-bg-hover'}`}>
            {on && '✓ '}{names?.[o] ?? o}
          </button>
        )
      })}
    </div>
  )
}

/** Etiquetas libres: se escriben y se añaden con Enter o coma. */
export function TagInput({ value, onChange, placeholder, max = 20 }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number }) {
  const [text, setText] = useState('')
  function add(raw: string): void {
    const t = raw.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40)
    if (t && !value.includes(t) && value.length < max) onChange([...value, t])
    setText('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 bg-bg-primary border border-border focus-within:border-[#a855f7] rounded-xl px-2 py-1.5">
      {value.map(t => (
        <span key={t} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-[#a855f7]/20 text-[#e9d5ff] text-xs">
          #{t}
          <button type="button" onClick={() => onChange(value.filter(x => x !== t))} className="w-4 h-4 rounded hover:bg-white/10 text-[10px]">✕</button>
        </span>
      ))}
      <input value={text} onChange={e => { const v = e.target.value; if (v.endsWith(',')) add(v.slice(0, -1)); else setText(v) }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(text) } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)) }}
        onBlur={() => text && add(text)}
        placeholder={value.length >= max ? `Máximo ${max}` : placeholder} disabled={value.length >= max}
        className="flex-1 min-w-[120px] bg-transparent text-sm text-text-primary outline-none py-0.5" />
    </div>
  )
}
