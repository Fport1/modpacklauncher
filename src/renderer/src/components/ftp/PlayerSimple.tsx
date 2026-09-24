import { useState } from 'react'
import type { NbtTag } from '../../../../shared/types'
import {
  type Compound, str, byte, int, float, compound, compoundList, listItems, getStr, getNum, getBool
} from '../../lib/nbtBuild'
import { McIcon, HUD, useTextures } from '../../lib/mcTextures'
import { Field, Toggle, Select, NumberCell } from './ScoreboardSimple'
import { headUrl } from './shared'

// Modo sencillo de un jugador: playerdata/<uuid>.dat, o el tuyo dentro de
// level.dat en un mundo de un jugador. Vida, comida, experiencia, dónde está y
// qué lleva encima, con los iconos del juego.

type Mutate = (fn: (root: NbtTag) => void, coalesce?: string) => boolean

interface Props {
  root: NbtTag & { name: string }
  mutate: Mutate
  playerName?: string
  /** Dónde está el jugador dentro del archivo (["Data", "Player"] en level.dat). */
  at?: string[]
}

const GAMEMODES = [['0', 'Supervivencia'], ['1', 'Creativo'], ['2', 'Aventura'], ['3', 'Espectador']] as const
const DIMENSIONS = [['minecraft:overworld', 'Mundo normal'], ['minecraft:the_nether', 'Nether'], ['minecraft:the_end', 'End']] as const

/** 1.20.5 cambió el formato de los objetos (count en vez de Count, components en vez de tag). */
const NEW_ITEMS = 3837
/** 1.21.5 sacó la armadura y la mano izquierda del inventario a "equipment". */
const EQUIPMENT_COMPOUND = 4325

const prettyId = (id: string): string =>
  id.replace(/^minecraft:/, '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

type SlotRef =
  | { where: 'inv'; slot: number }
  | { where: 'ender'; slot: number }
  | { where: 'equip'; key: 'head' | 'chest' | 'legs' | 'feet' | 'offhand' }

const ARMOR: { key: 'head' | 'chest' | 'legs' | 'feet' | 'offhand'; legacy: number; label: string; empty: string }[] = [
  { key: 'head', legacy: 103, label: 'Cabeza', empty: 'gui/sprites/container/slot/helmet' },
  { key: 'chest', legacy: 102, label: 'Pecho', empty: 'gui/sprites/container/slot/chestplate' },
  { key: 'legs', legacy: 101, label: 'Piernas', empty: 'gui/sprites/container/slot/leggings' },
  { key: 'feet', legacy: 100, label: 'Pies', empty: 'gui/sprites/container/slot/boots' },
  { key: 'offhand', legacy: -106, label: 'Mano izquierda', empty: 'gui/sprites/container/slot/shield' }
]

/** Baja por los compounds de `at`, creándolos si hace falta. */
function playerCompound(root: NbtTag, at: string[] | undefined): Compound {
  let c = root.value as Compound
  for (const key of at ?? []) {
    if (!c[key] || c[key]!.type !== 'compound') c[key] = compound({})
    c = c[key]!.value as Compound
  }
  return c
}

/** Lo mismo pero sin crear nada: para leer mientras se pinta. */
function readPlayer(root: NbtTag, at: string[] | undefined): Compound {
  let c = root.value as Compound
  for (const key of at ?? []) {
    if (c[key]?.type !== 'compound') return {}
    c = c[key]!.value as Compound
  }
  return c
}

export default function PlayerSimple({ root, mutate, playerName, at }: Props) {
  const [sel, setSel] = useState<SlotRef | null>(null)
  const [draft, setDraft] = useState({ id: '', count: '1' })
  const p = readPlayer(root, at)
  const version = getNum(root.value as Compound, 'DataVersion') || getNum(p, 'DataVersion')
  const newItems = version >= NEW_ITEMS || listItems<Compound>(p.Inventory).some((i) => 'count' in i)
  const equipCompound = version >= EQUIPMENT_COMPOUND || p.equipment?.type === 'compound'

  const set = (fn: (p: Compound) => void, coalesce?: string): void => { mutate((r) => fn(playerCompound(r, at)), coalesce) }

  // ── Objetos ──
  const inv = listItems<Compound>(p.Inventory)
  const ender = listItems<Compound>(p.EnderItems)
  const equipment = p.equipment?.type === 'compound' ? (p.equipment.value as Compound) : {}

  function itemAt(ref: SlotRef): Compound | null {
    if (ref.where === 'inv') return inv.find((i) => getNum(i, 'Slot') === ref.slot) ?? null
    if (ref.where === 'ender') return ender.find((i) => getNum(i, 'Slot') === ref.slot) ?? null
    if (equipCompound) return equipment[ref.key]?.type === 'compound' ? (equipment[ref.key]!.value as Compound) : null
    const legacy = ARMOR.find((a) => a.key === ref.key)!.legacy
    return inv.find((i) => getNum(i, 'Slot') === legacy) ?? null
  }

  const countOf = (item: Compound): number => getNum(item, newItems ? 'count' : 'Count', 1)

  /** Poner (o quitar, con null) el objeto de una casilla. */
  function writeSlot(ref: SlotRef, item: { id: string; count: number } | null, keepExtra = true): void {
    set((pl) => {
      const makeItem = (slot: number | null, prev: Compound | null): Compound => {
        const base: Compound = keepExtra && prev ? { ...prev } : {}
        base.id = str(item!.id)
        if (newItems) { base.count = int(item!.count); delete base.Count }
        else { base.Count = byte(item!.count); delete base.count }
        if (slot !== null) base.Slot = byte(slot)
        else delete base.Slot
        return base
      }
      const inList = (key: 'Inventory' | 'EnderItems', slot: number): void => {
        if (!pl[key] || pl[key]!.type !== 'list') pl[key] = compoundList([])
        const tag = pl[key]!
        if (tag.value.type === 'end') tag.value.type = 'compound'
        const arr = tag.value.value as Compound[]
        const i = arr.findIndex((x) => getNum(x, 'Slot') === slot)
        const prev = i >= 0 ? arr[i] : null
        if (!item) { if (i >= 0) arr.splice(i, 1); return }
        const next = makeItem(slot, prev)
        if (i >= 0) arr[i] = next
        else arr.push(next)
      }
      if (ref.where === 'inv') inList('Inventory', ref.slot)
      else if (ref.where === 'ender') inList('EnderItems', ref.slot)
      else if (equipCompound) {
        if (!pl.equipment || pl.equipment.type !== 'compound') pl.equipment = compound({})
        const eq = pl.equipment.value as Compound
        const prev = eq[ref.key]?.type === 'compound' ? (eq[ref.key]!.value as Compound) : null
        if (!item) delete eq[ref.key]
        else eq[ref.key] = compound(makeItem(null, prev))
      } else {
        inList('Inventory', ARMOR.find((a) => a.key === ref.key)!.legacy)
      }
    })
  }

  function select(ref: SlotRef): void {
    setSel(ref)
    const item = itemAt(ref)
    setDraft({ id: item ? getStr(item, 'id') : '', count: String(item ? countOf(item) : 1) })
  }

  const selItem = sel ? itemAt(sel) : null
  const hasExtra = !!selItem && Object.keys(selItem).some((k) => !['id', 'count', 'Count', 'Slot'].includes(k))
  const sameRef = (a: SlotRef | null, b: SlotRef): boolean => !!a && JSON.stringify(a) === JSON.stringify(b)

  const slot = (ref: SlotRef, emptyIcon?: string, label?: string): JSX.Element => {
    const item = itemAt(ref)
    const id = item ? getStr(item, 'id') : ''
    const extra = !!item && Object.keys(item).some((k) => k === 'components' || k === 'tag')
    return (
      <McSlot key={JSON.stringify(ref)} selected={sameRef(sel, ref)} glint={extra} onClick={() => select(ref)}
        title={item ? `${prettyId(id)} ×${countOf(item)}${extra ? ' (con datos extra: encantamientos, nombre…)' : ''}` : label ?? 'Vacío'}>
        {item ? (
          <>
            <McIcon k={`item:${id}`} size={32} fallback={<span className="text-[8px] leading-tight text-center text-white/90 px-0.5 break-all">{prettyId(id)}</span>} />
            {countOf(item) > 1 && <span className="absolute bottom-0 right-0.5 text-[13px] font-bold text-white leading-none" style={{ textShadow: '2px 2px 0 #3f3f3f' }}>{countOf(item)}</span>}
          </>
        ) : emptyIcon ? <McIcon k={emptyIcon} size={32} /> : null}
      </McSlot>
    )
  }

  const pos = listItems<number>(p.Pos)
  const abilities = p.abilities?.type === 'compound' ? (p.abilities.value as Compound) : {}
  const effectsKey = p.active_effects ? 'active_effects' : 'ActiveEffects'
  const effects = listItems<Compound>(p[effectsKey])
  const health = getNum(p, 'Health')
  const food = getNum(p, 'foodLevel', 20)

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* Cabecera */}
      <div className="flex items-center gap-4 flex-wrap">
        {playerName
          ? <img src={headUrl(playerName, 64)} alt="" className="w-14 h-14 rounded-lg" style={{ imageRendering: 'pixelated' }} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
          : <div className="w-14 h-14 rounded-lg bg-bg-hover" />}
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-text-primary truncate">{playerName ?? 'Jugador'}</p>
          <p className="text-xs text-text-muted">
            {DIMENSIONS.find(([d]) => d === getStr(p, 'Dimension'))?.[1] ?? getStr(p, 'Dimension')}
            {pos.length === 3 && ` · ${pos.map((n) => Math.round(n)).join(', ')}`}
          </p>
        </div>
        <div className="w-44">
          <Select label="Modo de juego" value={String(getNum(p, 'playerGameType'))} options={GAMEMODES}
            onChange={(v) => set((pl) => { pl.playerGameType = int(Number(v)) })} />
        </div>
      </div>

      {/* Como en la pantalla del juego */}
      <div className="rounded-xl bg-[#1d1d24] border border-black/40 p-3 space-y-2 w-fit max-w-full">
        <div className="flex gap-6 flex-wrap">
          <IconRow value={health} max={20} full={HUD.heartFull} half={HUD.heartHalf} empty={HUD.heartEmpty} title={`Vida: ${health}`} />
          <IconRow value={food} max={20} full={HUD.foodFull} half={HUD.foodHalf} empty={HUD.foodEmpty} title={`Comida: ${food}`} reverse />
        </div>
        <XpBar level={getNum(p, 'XpLevel')} progress={getNum(p, 'XpP')} />
      </div>

      {/* Estado */}
      <Field label="Estado">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
          <Stat label="Vida" hint={`${(health / 2).toFixed(1)} corazones`}>
            <NumberCell width="w-full" value={Number(health.toFixed(2))} onCommit={(v) => set((pl) => { pl.Health = float(Math.max(0, v)) })} />
          </Stat>
          <Stat label="Comida" hint="0 a 20">
            <NumberCell width="w-full" value={food} onCommit={(v) => set((pl) => { pl.foodLevel = int(Math.min(20, Math.max(0, v))) })} />
          </Stat>
          <Stat label="Saturación" hint="Cuánto aguanta sin bajar la comida">
            <NumberCell width="w-full" value={Number(getNum(p, 'foodSaturationLevel').toFixed(2))} onCommit={(v) => set((pl) => { pl.foodSaturationLevel = float(Math.max(0, v)) })} />
          </Stat>
          <Stat label="Nivel de experiencia">
            <NumberCell width="w-full" value={getNum(p, 'XpLevel')} onCommit={(v) => set((pl) => { pl.XpLevel = int(Math.max(0, v)) })} />
          </Stat>
          <Stat label="Barra de experiencia" hint="0 a 100 %">
            <NumberCell width="w-full" value={Math.round(getNum(p, 'XpP') * 100)} onCommit={(v) => set((pl) => { pl.XpP = float(Math.min(100, Math.max(0, v)) / 100) })} />
          </Stat>
        </div>
      </Field>

      {/* Posición */}
      <Field label="Dónde está" hint="Cambiarlo es como teletransportarlo: aparecerá ahí la próxima vez que entre.">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
          {['X', 'Y', 'Z'].map((axis, i) => (
            <label key={axis} className="block min-w-0">
              <span className="text-xs text-text-muted">{axis}</span>
              <div className="mt-1"><NumberCell width="w-full" value={Number((pos[i] ?? 0).toFixed(2))}
                onCommit={(v) => set((pl) => {
                  const cur = listItems<number>(pl.Pos)
                  pl.Pos = { type: 'list', value: { type: 'double', value: [0, 1, 2].map((j) => (j === i ? v : cur[j] ?? 0)) } }
                })} /></div>
            </label>
          ))}
          <div className="min-w-0" style={{ gridColumn: 'span 2' }}>
            <Select label="Dimensión" value={getStr(p, 'Dimension', 'minecraft:overworld')} options={DIMENSIONS}
              onChange={(v) => set((pl) => { pl.Dimension = str(v) })} />
          </div>
        </div>
      </Field>

      {/* Habilidades */}
      <Field label="Habilidades">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          <Toggle label="Puede volar" value={getBool(abilities, 'mayfly')} onChange={(v) => set((pl) => ability(pl, 'mayfly', v))} />
          <Toggle label="Volando ahora" value={getBool(abilities, 'flying')} onChange={(v) => set((pl) => ability(pl, 'flying', v))} />
          <Toggle label="Invulnerable" hint="No recibe daño" value={getBool(abilities, 'invulnerable')} onChange={(v) => set((pl) => ability(pl, 'invulnerable', v))} />
          <Toggle label="Rompe al instante" hint="Como en creativo" value={getBool(abilities, 'instabuild')} onChange={(v) => set((pl) => ability(pl, 'instabuild', v))} />
        </div>
      </Field>

      {/* Inventario, como la pantalla del juego */}
      <Field label="Inventario" hint="Haz clic en una casilla para cambiar o quitar lo que hay.">
        <div className="overflow-x-auto">
          <div className="inline-flex gap-3 p-2 rounded-md" style={{ background: '#c6c6c6', border: '2px solid', borderColor: '#fff #555 #555 #fff' }}>
            <div className="flex flex-col gap-0.5">
              {ARMOR.slice(0, 4).map((a) => slot({ where: 'equip', key: a.key }, a.empty, a.label))}
              <div className="h-2" />
              {slot({ where: 'equip', key: 'offhand' }, ARMOR[4].empty, ARMOR[4].label)}
            </div>
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-9 gap-0.5">
                {Array.from({ length: 27 }, (_, i) => slot({ where: 'inv', slot: 9 + i }))}
              </div>
              <div className="grid grid-cols-9 gap-0.5">
                {Array.from({ length: 9 }, (_, i) => slot({ where: 'inv', slot: i }))}
              </div>
            </div>
          </div>
        </div>
      </Field>

      {sel && (
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            {selItem && <McIcon k={`item:${getStr(selItem, 'id')}`} size={24} />}
            <p className="text-sm font-semibold text-text-primary">
              {selItem ? prettyId(getStr(selItem, 'id')) : 'Casilla vacía'}
              <span className="font-normal text-text-muted"> · {sel.where === 'ender' ? `cofre de Ender, casilla ${sel.slot + 1}` : sel.where === 'equip' ? ARMOR.find((a) => a.key === sel.key)!.label.toLowerCase() : sel.slot < 9 ? `barra rápida ${sel.slot + 1}` : `inventario, casilla ${sel.slot - 8}`}</span>
            </p>
          </div>
          <form className="flex items-end gap-2 flex-wrap" onSubmit={(e) => {
            e.preventDefault()
            const raw = draft.id.trim().toLowerCase()
            const id = raw.includes(':') ? raw : `minecraft:${raw}`
            const count = Number(draft.count)
            if (!raw || !Number.isInteger(count) || count < 1 || count > 99) return
            writeSlot(sel, { id, count }, getStr(selItem ?? undefined, 'id') === id)
          }}>
            <label className="block flex-1 min-w-[160px]">
              <span className="text-xs text-text-muted">Objeto</span>
              <div className="mt-1 flex items-center gap-2">
                {draft.id && <McIcon k={`item:${draft.id.includes(':') ? draft.id : `minecraft:${draft.id}`}`} size={24} />}
                <input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="minecraft:diamond"
                  className="flex-1 min-w-0 bg-bg-primary border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary font-mono outline-none focus:border-accent/60" />
              </div>
            </label>
            <label className="block">
              <span className="text-xs text-text-muted">Cantidad</span>
              <input value={draft.count} onChange={(e) => setDraft({ ...draft, count: e.target.value })}
                className="mt-1 block w-20 bg-bg-primary border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60" />
            </label>
            <button type="submit" className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm">{selItem ? 'Cambiar' : 'Poner'}</button>
            {selItem && (
              <button type="button" onClick={() => { writeSlot(sel, null); setDraft({ id: '', count: '1' }) }}
                className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 text-sm hover:bg-red-500/10">Quitar objeto</button>
            )}
          </form>
          {hasExtra && (
            <p className="text-[11px] text-purple-300">
              Este objeto tiene datos extra (encantamientos, nombre, durabilidad…). Se conservan si solo cambias la cantidad;
              para editarlos usa el modo avanzado.
            </p>
          )}
        </div>
      )}

      <Field label="Cofre de Ender">
        <div className="overflow-x-auto">
          <div className="inline-grid grid-cols-9 gap-0.5 p-2 rounded-md" style={{ background: '#c6c6c6', border: '2px solid', borderColor: '#fff #555 #555 #fff' }}>
            {Array.from({ length: 27 }, (_, i) => slot({ where: 'ender', slot: i }))}
          </div>
        </div>
      </Field>

      {effects.length > 0 && (
        <Field label="Efectos activos">
          <div className="space-y-1">
            {effects.map((e, i) => {
              const id = getStr(e, 'id') || `efecto ${getNum(e, 'Id')}`
              const secs = Math.round(getNum(e, 'duration', getNum(e, 'Duration')) / 20)
              return (
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-card border border-border text-sm flex-wrap">
                  <McIcon k={`mob_effect/${id.replace(/^minecraft:/, '')}`} size={18} />
                  <span className="text-text-primary">{prettyId(id)}</span>
                  <span className="text-text-muted">nivel {getNum(e, 'amplifier', getNum(e, 'Amplifier')) + 1}</span>
                  <span className="text-text-muted">{secs < 0 ? '∞' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</span>
                  <button type="button" className="ml-auto text-text-muted hover:text-red-400"
                    onClick={() => set((pl) => { pl[effectsKey] = compoundList(listItems<Compound>(pl[effectsKey]).filter((_, j) => j !== i)) })}>Quitar</button>
                </div>
              )
            })}
          </div>
        </Field>
      )}
    </div>
  )
}

function ability(pl: Compound, key: string, value: boolean): void {
  if (!pl.abilities || pl.abilities.type !== 'compound') pl.abilities = compound({})
  ;(pl.abilities.value as Compound)[key] = byte(value)
}

/** Casilla de inventario con el relieve del juego. */
export function McSlot({ children, selected, glint, onClick, title }: {
  children?: React.ReactNode; selected?: boolean; glint?: boolean; onClick?: () => void; title?: string
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`relative w-10 h-10 flex items-center justify-center overflow-hidden ${selected ? 'outline outline-2 outline-accent z-[1]' : ''}`}
      style={{
        background: selected ? '#a8c4ff' : '#8b8b8b',
        border: '2px solid',
        borderColor: '#373737 #fff #fff #373737',
        boxShadow: glint ? 'inset 0 0 8px rgba(170,90,255,0.8)' : undefined
      }}>
      {children}
    </button>
  )
}

/** Una fila de 10 iconos (corazones o comida) como en la pantalla del juego. */
function IconRow({ value, max, full, half, empty, title, reverse }: {
  value: number; max: number; full: string; half: string; empty: string; title: string; reverse?: boolean
}) {
  const tex = useTextures([full, half, empty])
  const n = max / 2
  const icons = Array.from({ length: n }, (_, i) => {
    const v = value - i * 2
    return v >= 2 ? full : v >= 1 ? half : empty
  })
  if (!tex[empty]) return <span className="text-sm text-white" title={title}>{title}</span>
  return (
    <div className={`flex ${reverse ? 'flex-row-reverse' : ''}`} title={title}>
      {icons.map((k, i) => (
        <span key={i} className="relative w-[18px] h-[18px]" style={{ imageRendering: 'pixelated' }}>
          <img src={tex[empty] ?? ''} alt="" className="absolute inset-0 w-full h-full" style={{ imageRendering: 'pixelated' }} />
          {k !== empty && tex[k] && <img src={tex[k]!} alt="" className="absolute inset-0 w-full h-full" style={{ imageRendering: 'pixelated' }} />}
        </span>
      ))}
    </div>
  )
}

function XpBar({ level, progress }: { level: number; progress: number }) {
  const tex = useTextures([HUD.xpBack, HUD.xpFill])
  return (
    <div className="relative w-[364px] max-w-full h-[10px] mt-3" title={`Nivel ${level} · ${Math.round(progress * 100)} %`}>
      {tex[HUD.xpBack] ? (
        <>
          <img src={tex[HUD.xpBack]!} alt="" className="absolute inset-0 w-full h-full" style={{ imageRendering: 'pixelated' }} />
          <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}>
            <img src={tex[HUD.xpFill] ?? ''} alt="" className="h-full max-w-none" style={{ width: 364, imageRendering: 'pixelated' }} />
          </div>
        </>
      ) : <div className="absolute inset-0 bg-black/50 rounded"><div className="h-full bg-lime-400" style={{ width: `${progress * 100}%` }} /></div>}
      <span className="absolute left-1/2 -translate-x-1/2 -top-4 text-sm font-bold" style={{ color: '#80ff20', textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>
        {level}
      </span>
    </div>
  )
}

function Stat({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-bg-card border border-border min-w-0 space-y-1">
      <p className="text-sm text-text-primary leading-tight">{label}</p>
      {hint && <p className="text-[10px] text-text-muted leading-tight">{hint}</p>}
      {children}
    </div>
  )
}
