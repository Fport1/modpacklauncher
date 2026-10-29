import { useEffect, useMemo, useState } from 'react'
import type { TransferArea, WorldPlayer } from '../../../shared/types'
import { useStore } from '../store'
import { headUrl, errText } from './ftp/shared'
import AdvancementsView from './ftp/AdvancementsView'

// Los jugadores de un mundo: quién es quién (nombre, premium o no) y pasar sus
// cosas de una cuenta a otra. Pensado para un mundo de un servidor no premium
// que ahora se juega en uno premium: ahí cada uno tiene dos jugadores (la UUID
// no premium sale del nombre y la premium es la de la cuenta), y al entrar al
// servidor premium aparecen sin nada.

const AREAS: { id: TransferArea; label: string; hint: string }[] = [
  { id: 'inventory', label: 'Inventario', hint: 'Lo que lleva encima, armadura y mano izquierda' },
  { id: 'enderchest', label: 'Cofre de Ender', hint: '' },
  { id: 'advancements', label: 'Logros', hint: 'Se suman a los que ya tenga' },
  { id: 'recipes', label: 'Recetas', hint: 'Las del libro de recetas; se suman' },
  { id: 'xp', label: 'Experiencia', hint: 'Nivel y barra' },
  { id: 'stats', label: 'Estadísticas', hint: 'Se suman (tiempo jugado, bloques…)' },
  { id: 'position', label: 'Posición', hint: 'Dónde está y su cama' },
]

interface Props {
  worldDir: string
  worldName: string
  /** Mundo de un servidor conectado: worldDir es su ruta allí */
  remote?: boolean
  /** Abrir el editor de un jugador */
  onOpenPlayer: (p: WorldPlayer) => void
  onClose: () => void
}

export default function WorldPlayers({ worldDir, worldName, remote, onOpenPlayer, onClose }: Props) {
  const io = remote ? window.api.world.remote : window.api.world
  const accounts = useStore((s) => s.accounts)
  const [players, setPlayers] = useState<WorldPlayer[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [transfer, setTransfer] = useState<{ from: WorldPlayer } | null>(null)
  const [adv, setAdv] = useState<WorldPlayer | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    setPlayers(null)
    io.players(worldDir).then(setPlayers).catch((e) => setError(errText(e)))
  }, [worldDir, remote, reload])

  const shown = useMemo(() => (players ?? []).filter((p) => !filter || (p.name ?? '').toLowerCase().includes(filter.toLowerCase()) || p.uuid.includes(filter.toLowerCase())), [players, filter])
  // Parejas típicas: el mismo nombre como no premium y como premium
  const pairs = useMemo(() => {
    const list = players ?? []
    return list.filter((p) => !p.premium && p.name).map((off) => ({ off, on: list.find((q) => q.premium && q.name?.toLowerCase() === off.name!.toLowerCase()) })).filter((x) => x.on)
  }, [players])

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-[min(760px,100%)] max-h-[min(720px,100%)] bg-bg-secondary border border-border rounded-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-text-primary truncate">Jugadores de «{worldName}»</p>
            <p className="text-xs text-text-muted">{players ? `${players.length} jugadores · ${players.filter((p) => p.premium).length} premium${remote ? ' · en el servidor' : ''}` : remote ? 'Bajando los datos de jugadores del servidor…' : 'Buscando…'}</p>
          </div>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar nombre o UUID"
            className="w-48 bg-bg-primary border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60" />
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover">✕</button>
        </div>

        {pairs.length > 0 && (
          <div className="mx-5 mt-3 p-3 rounded-xl bg-accent/5 border border-accent/30 space-y-1.5">
            <p className="text-xs text-text-secondary">
              Estos jugadores tienen datos como <b>no premium</b> y como <b>premium</b> (lo normal si el mundo era de un servidor no premium). Pásalos a su cuenta premium:
            </p>
            {pairs.map(({ off, on }) => (
              <div key={off.uuid} className="flex items-center gap-2 text-sm">
                <img src={headUrl(off.name!, 20)} alt="" className="w-5 h-5 rounded" />
                <span className="text-text-primary">{off.name}</span>
                <span className="text-text-muted text-xs">no premium → premium</span>
                <button type="button" onClick={() => setTransfer({ from: off })} className="ml-auto px-2.5 py-1 rounded-lg bg-accent text-white text-xs">Transferir…</button>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {error && <p className="p-3 text-sm text-red-400">{error}</p>}
          {!players && !error && <p className="p-3 text-sm text-text-muted">Leyendo jugadores y buscando sus nombres…</p>}
          {players?.length === 0 && <p className="p-3 text-sm text-text-muted">Nadie ha entrado todavía a este mundo.</p>}
          {shown.map((p) => (
            <div key={p.uuid} className="group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-bg-hover">
              {p.name
                ? <img src={headUrl(p.name, 32)} alt="" className="w-8 h-8 rounded" style={{ imageRendering: 'pixelated' }} />
                : <div className="w-8 h-8 rounded bg-bg-card flex items-center justify-center text-text-muted">?</div>}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary truncate flex items-center gap-2">
                  {p.name ?? <span className="text-text-muted italic">Nombre desconocido</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.premium ? 'bg-green-500/15 text-green-300' : 'bg-amber-500/15 text-amber-300'}`}>
                    {p.premium ? 'Premium' : 'No premium'}
                  </span>
                  {accounts.some((a) => a.uuid.replace(/-/g, '') === p.uuid.replace(/-/g, '')) && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent">Tu cuenta</span>}
                </p>
                <p className="text-[11px] text-text-muted font-mono truncate" title="UUID">{p.uuid} · {new Date(p.modified).toLocaleDateString('es')}</p>
              </div>
              <button type="button" onClick={() => onOpenPlayer(p)} className="px-2.5 py-1 rounded-lg border border-border text-xs text-text-secondary hover:text-text-primary">Editar</button>
              <button type="button" onClick={() => setAdv(p)} className="px-2.5 py-1 rounded-lg border border-border text-xs text-text-secondary hover:text-text-primary">Logros</button>
              <button type="button" onClick={() => setTransfer({ from: p })} className="px-2.5 py-1 rounded-lg border border-accent/40 text-xs text-accent hover:bg-accent/10">Transferir…</button>
            </div>
          ))}
        </div>
      </div>

      {transfer && players && (
        <TransferDialog worldDir={worldDir} remote={remote} from={transfer.from} players={players}
          onClose={() => setTransfer(null)} onDone={() => { setTransfer(null); setReload((n) => n + 1) }} />
      )}
      {adv && <AdvancementsView worldDir={worldDir} uuid={adv.uuid} remote={remote} playerName={adv.name} onClose={() => setAdv(null)} />}
    </div>
  )
}

function TransferDialog({ worldDir, remote, from, players, onClose, onDone }: {
  worldDir: string; remote?: boolean; from: WorldPlayer; players: WorldPlayer[]; onClose: () => void; onDone: () => void
}) {
  const accounts = useStore((s) => s.accounts)
  // Destinos: los demás jugadores del mundo y las cuentas premium del launcher que aún no han entrado
  const options = useMemo(() => {
    const out: { uuid: string; name?: string; premium: boolean; inWorld: boolean }[] = players.filter((p) => p.uuid !== from.uuid).map((p) => ({ uuid: p.uuid, name: p.name, premium: p.premium, inWorld: true }))
    for (const a of accounts) {
      if (a.type !== 'microsoft') continue
      const u = a.uuid.replace(/-/g, '').toLowerCase()
      const d = `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`
      if (!out.some((o) => o.uuid === d) && d !== from.uuid) out.push({ uuid: d, name: a.username, premium: true, inWorld: false })
    }
    // Primero la cuenta premium con el mismo nombre
    return out.sort((a, b) => Number(b.premium && b.name?.toLowerCase() === from.name?.toLowerCase()) - Number(a.premium && a.name?.toLowerCase() === from.name?.toLowerCase()))
  }, [players, accounts, from])
  const [to, setTo] = useState<string>(options[0]?.uuid ?? '')
  const [otherName, setOtherName] = useState('')
  const [looking, setLooking] = useState(false)
  const [extra, setExtra] = useState<{ uuid: string; name: string } | null>(null)
  const [areas, setAreas] = useState<Set<TransferArea>>(new Set(['inventory', 'enderchest', 'advancements', 'recipes', 'xp', 'stats']))
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const target = to === 'other' ? (extra ? { uuid: extra.uuid, name: extra.name, premium: true, inWorld: players.some((p) => p.uuid === extra.uuid) } : null) : options.find((o) => o.uuid === to) ?? null

  async function lookup(): Promise<void> {
    if (!otherName.trim()) return
    setLooking(true); setMsg(null)
    try {
      const r = await window.api.world.premiumUuid(otherName.trim())
      if (r) setExtra(r)
      else setMsg({ kind: 'error', text: `No existe ninguna cuenta premium llamada «${otherName.trim()}».` })
    } finally { setLooking(false) }
  }

  async function run(): Promise<void> {
    if (!target) return
    const what = all ? 'TODO (el jugador entero)' : AREAS.filter((a) => areas.has(a.id)).map((a) => a.label.toLowerCase()).join(', ')
    if (!window.confirm(`Pasar ${what} de «${from.name ?? from.uuid}» a «${target.name ?? target.uuid}»?\n\nLo que tenga ahora el destino se guarda antes en una copia dentro del mundo (fport1-backups${remote ? ', en el propio servidor' : ''}). El jugador de origen no se toca.\n\n${remote ? 'APAGA EL SERVIDOR antes: si está encendido, sobrescribe los cambios al guardar.' : 'Hazlo con el juego y el servidor cerrados.'}`)) return
    setBusy(true); setMsg(null)
    try {
      const r = await (remote ? window.api.world.remote : window.api.world).transfer(worldDir, from.uuid, target.uuid, all ? [] : [...areas], target.name)
      setMsg({ kind: 'ok', text: `✓ Hecho${r.created ? ' (el destino no existía: se ha copiado el jugador entero)' : ''}. Copia de lo anterior en ${r.backup}` })
      setTimeout(onDone, 1800)
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) })
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="w-[min(520px,100%)] bg-bg-secondary border border-border rounded-2xl p-5 space-y-4">
        <p className="text-[15px] font-semibold text-text-primary">Transferir datos de jugador</p>

        <div className="flex items-center gap-3">
          <Who name={from.name} uuid={from.uuid} premium={from.premium} />
          <span className="text-text-muted">→</span>
          {target ? <Who name={target.name} uuid={target.uuid} premium={target.premium} /> : <span className="text-sm text-text-muted">Elige destino</span>}
        </div>

        <label className="block">
          <span className="text-xs text-text-muted">Destino</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}
            className="mt-1 w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent">
            {options.map((o) => (
              <option key={o.uuid} value={o.uuid}>
                {o.name ?? o.uuid.slice(0, 8)} · {o.premium ? 'premium' : 'no premium'}{o.inWorld ? '' : ' · cuenta del launcher, aún no ha entrado'}
              </option>
            ))}
            <option value="other">Otra cuenta premium (por nombre)…</option>
          </select>
        </label>
        {to === 'other' && (
          <div className="flex gap-2">
            <input value={otherName} onChange={(e) => { setOtherName(e.target.value); setExtra(null) }} placeholder="Nombre de la cuenta premium"
              onKeyDown={(e) => { if (e.key === 'Enter') void lookup() }}
              className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent" />
            <button type="button" onClick={lookup} disabled={looking} className="px-3 rounded-lg border border-border text-sm text-text-secondary">{looking ? 'Buscando…' : 'Buscar'}</button>
          </div>
        )}

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Todo: copiar el jugador entero (vida, posición, efectos…)
          </label>
          {!all && (
            <div className="grid grid-cols-2 gap-1.5">
              {AREAS.map((a) => (
                <label key={a.id} className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg bg-bg-card border border-border cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={areas.has(a.id)} onChange={(e) => {
                    const n = new Set(areas); if (e.target.checked) n.add(a.id); else n.delete(a.id); setAreas(n)
                  }} />
                  <span className="min-w-0">
                    <span className="block text-sm text-text-primary">{a.label}</span>
                    {a.hint && <span className="block text-[10px] text-text-muted leading-tight">{a.hint}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
          {target && !target.inWorld && <p className="text-[11px] text-amber-300">Esa cuenta aún no ha entrado a este mundo: se le crea el jugador copiando al de origen entero.</p>}
          {!all && (areas.has('inventory') || areas.has('enderchest')) && target?.inWorld && (
            <p className="text-[11px] text-text-muted">El inventario y el cofre de Ender del destino se sustituyen por los del origen (lo de ahora queda en la copia).</p>
          )}
        </div>

        {msg && <p className={`text-xs break-all ${msg.kind === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-secondary">Cancelar</button>
          <button type="button" onClick={run} disabled={busy || !target || (!all && areas.size === 0)} className="px-4 py-1.5 rounded-lg bg-accent text-white text-sm disabled:opacity-40">
            {busy ? 'Transfiriendo…' : 'Transferir'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Who({ name, uuid, premium }: { name?: string; uuid: string; premium: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1 px-2.5 py-1.5 rounded-lg bg-bg-card border border-border">
      {name ? <img src={headUrl(name, 24)} alt="" className="w-6 h-6 rounded" /> : <div className="w-6 h-6 rounded bg-bg-hover" />}
      <div className="min-w-0">
        <p className="text-sm text-text-primary truncate">{name ?? 'Desconocido'}</p>
        <p className={`text-[10px] ${premium ? 'text-green-300' : 'text-amber-300'}`}>{premium ? 'Premium' : 'No premium'} · {uuid.slice(0, 8)}…</p>
      </div>
    </div>
  )
}
