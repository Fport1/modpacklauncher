// Modo fácil de «Exportar modpack»: en vez de un árbol de carpetas, preguntas
// en lenguaje normal sobre qué recibirá quien lo instale.

export type ExportStart = 'fresh' | 'mine' | 'world'

export interface ExportPlanData {
  categories: { path: string; label: string; hint: string; size: number; files: number; group: 'content' | 'world' | 'personal' }[]
  worlds: { name: string; path: string; size: number }[]
  options: { exists: boolean; keybinds: number; activePacks: number }
  hasServerList: boolean
}

export interface StartOptions {
  controls: 'default' | 'mine'
  settings: 'default' | 'mine'
  activePacks: boolean
  serverList: boolean
}

export function fmtSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const STARTS: { key: ExportStart; title: string; hint: string; icon: string }[] = [
  { key: 'fresh', icon: '✨', title: 'Como nuevo', hint: 'Al abrir Minecraft será como la primera vez: sin mundos, sin servidores guardados ni tus ajustes. Recomendado para compartir.' },
  { key: 'mine', icon: '🎛️', title: 'Con mi configuración', hint: 'Empiezan con tus ajustes de vídeo, sonido y controles y tu lista de servidores. Luego cada uno puede cambiarlos.' },
  { key: 'world', icon: '🌍', title: 'Con mi configuración y un mundo', hint: 'Lo mismo, y además los mundos que elijas (por ejemplo, un mapa de aventura).' },
]

/** Opciones de inicio de cada forma de empezar. */
export function presetFor(start: ExportStart, plan: ExportPlanData | null): StartOptions {
  // Sin options.txt (el juego nunca se abrió) no hay ajustes propios que dar
  const mine = start !== 'fresh' && !!plan?.options.exists
  return { controls: mine ? 'mine' : 'default', settings: mine ? 'mine' : 'default', activePacks: !!plan?.options.activePacks, serverList: start !== 'fresh' && !!plan?.hasServerList }
}

export function ExportStartPicker({ value, onChange }: { value: ExportStart; onChange: (s: ExportStart) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {STARTS.map(s => (
        <button key={s.key} onClick={() => onChange(s.key)}
          className={`p-3 rounded-xl border text-left transition-colors ${value === s.key ? 'bg-accent/10 border-accent/60' : 'border-border hover:bg-bg-hover'}`}>
          <p className="text-lg leading-none">{s.icon}</p>
          <p className="text-sm font-semibold text-text-primary mt-1.5">{s.title}</p>
          <p className="text-[11px] text-text-muted mt-1 leading-snug">{s.hint}</p>
        </button>
      ))}
    </div>
  )
}

/** Qué contenido se incluye (mods, configs, packs…) y, si toca, qué mundos. */
export function ExportContentPicker({ plan, chosen, onChange, worlds, onWorlds, showWorlds }: {
  plan: ExportPlanData
  chosen: Set<string>
  onChange: (s: Set<string>) => void
  worlds: Set<string>
  onWorlds: (s: Set<string>) => void
  showWorlds: boolean
}) {
  const toggle = (set: Set<string>, p: string, cb: (s: Set<string>) => void): void => {
    const n = new Set(set)
    if (n.has(p)) n.delete(p); else n.add(p)
    cb(n)
  }
  const content = plan.categories.filter(c => c.group === 'content')
  const personal = plan.categories.filter(c => c.group === 'personal')
  const total = plan.categories.filter(c => chosen.has(c.path)).reduce((s, c) => s + c.size, 0) + plan.worlds.filter(w => worlds.has(w.path)).reduce((s, w) => s + w.size, 0)

  const row = (c: { path: string; label: string; hint: string; size: number }, on: boolean, onClick: () => void, warn?: boolean) => (
    <label key={c.path} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-bg-hover ${on ? 'bg-accent/5' : ''}`}>
      <input type="checkbox" checked={on} onChange={onClick} className="w-4 h-4 accent-accent flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${on ? 'text-text-primary' : 'text-text-secondary'}`}>{c.label}</p>
        <p className={`text-[11px] truncate ${warn ? 'text-amber-300/80' : 'text-text-muted'}`}>{c.hint}</p>
      </div>
      <span className="text-[11px] text-text-muted flex-shrink-0">{fmtSize(c.size)}</span>
    </label>
  )

  return (
    <div className="space-y-3">
      <div className="bg-bg-primary border border-border rounded-xl overflow-hidden divide-y divide-border/40">
        {content.length === 0 && <p className="p-4 text-xs text-text-muted">La instancia no tiene contenido todavía.</p>}
        {content.map(c => row(c, chosen.has(c.path), () => toggle(chosen, c.path, onChange)))}
      </div>

      {showWorlds && (
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1.5">Mundos</p>
          <div className="bg-bg-primary border border-border rounded-xl overflow-hidden divide-y divide-border/40">
            {plan.worlds.length === 0 && <p className="p-4 text-xs text-text-muted">Esta instancia no tiene mundos.</p>}
            {plan.worlds.map(w => row({ path: w.path, label: w.name, hint: 'Mundo guardado', size: w.size }, worlds.has(w.path), () => toggle(worlds, w.path, onWorlds)))}
          </div>
        </div>
      )}

      {personal.length > 0 && (
        <details className="group">
          <summary className="text-[11px] text-text-muted cursor-pointer hover:text-text-secondary select-none">Datos de tu partida que normalmente no se comparten ({personal.length})</summary>
          <div className="mt-1.5 bg-bg-primary border border-border rounded-xl overflow-hidden divide-y divide-border/40">
            {personal.map(c => row(c, chosen.has(c.path), () => toggle(chosen, c.path, onChange), true))}
          </div>
        </details>
      )}
      <p className="text-[11px] text-text-muted">Total aproximado: <span className="text-text-secondary">{fmtSize(total)}</span>. Nunca se incluyen registros, capturas, crash reports ni datos de tu cuenta.</p>
    </div>
  )
}

/** Controles y ajustes iniciales: se aplican solo si el jugador aún no tiene los suyos. */
export function ExportStartOptions({ plan, value, onChange }: { plan: ExportPlanData | null; value: StartOptions; onChange: (v: StartOptions) => void }) {
  const set = (patch: Partial<StartOptions>): void => onChange({ ...value, ...patch })
  const noOptions = plan && !plan.options.exists
  const choice = (label: string, current: string, opts: [string, string, string][], onPick: (k: string) => void) => (
    <div>
      <p className="text-xs font-medium text-text-secondary mb-1.5">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {opts.map(([k, title, hint]) => (
          <button key={k} onClick={() => onPick(k)} disabled={!!noOptions && k === 'mine'}
            className={`p-2.5 rounded-lg border text-left disabled:opacity-40 ${current === k ? 'bg-accent/10 border-accent/60' : 'border-border hover:bg-bg-hover'}`}>
            <p className="text-xs font-semibold text-text-primary">{title}</p>
            <p className="text-[10px] text-text-muted mt-0.5">{hint}</p>
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <div className="space-y-3">
      {choice('Controles', value.controls, [
        ['default', 'Los de Minecraft', 'Teclas por defecto (WASD, E para el inventario…)'],
        ['mine', 'Los míos', plan?.options.keybinds ? `Tus ${plan.options.keybinds} teclas, también las de los mods` : 'Tus teclas, también las de los mods'],
      ], k => set({ controls: k as StartOptions['controls'] }))}
      {choice('Vídeo, sonido, idioma y accesibilidad', value.settings, [
        ['default', 'Por defecto', 'Cada uno empieza con los ajustes normales'],
        ['mine', 'Los míos', 'Tu distancia de renderizado, brillo, volumen…'],
      ], k => set({ settings: k as StartOptions['settings'] }))}
      <label className="flex items-center gap-2.5 text-xs text-text-secondary cursor-pointer">
        <input type="checkbox" checked={value.activePacks || value.settings === 'mine'} disabled={value.settings === 'mine' || !plan?.options.activePacks}
          onChange={e => set({ activePacks: e.target.checked })} className="w-4 h-4 accent-accent" />
        Que empiecen con mis resource packs activados{plan?.options.activePacks ? ` (${plan.options.activePacks})` : ' (no tienes ninguno activo)'}
      </label>
      <label className="flex items-center gap-2.5 text-xs text-text-secondary cursor-pointer">
        <input type="checkbox" checked={value.serverList} disabled={!plan?.hasServerList} onChange={e => set({ serverList: e.target.checked })} className="w-4 h-4 accent-accent" />
        Incluir mi lista de servidores{plan?.hasServerList ? '' : ' (no tienes ninguno guardado)'}
      </label>
      <p className="text-[11px] text-text-muted bg-bg-card rounded-lg p-2.5">
        Son valores <b className="text-text-secondary">iniciales</b>: se ponen al instalar solo si el jugador no tiene los suyos, y nunca se pisan sus cambios al actualizar el modpack.
        {noOptions && ' Abre el juego una vez desde el launcher para poder exportar tus ajustes.'}
      </p>
    </div>
  )
}
