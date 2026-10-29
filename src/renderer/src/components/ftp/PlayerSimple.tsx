import { useState } from 'react'
import type { NbtTag } from '../../../../shared/types'
import {
  type Compound, str, byte, int, float, compound, compoundList, listItems, getStr, getNum, getBool
} from '../../lib/nbtBuild'
import { McIcon, HUD, useTextures } from '../../lib/mcTextures'
import {
  McItem, useLang, itemName, tooltipLines, containerItems, bundleItems, bundleWeight, isBundle, isShulker,
  itemCount, maxDamage, itemDamage
} from '../../lib/mcItems'
import { Field, Toggle, Select, NumberCell } from './ScoreboardSimple'
import { McTextPreview } from './McTextInput'
import AdvancementsView from './AdvancementsView'
import { headUrl } from './shared'

// Modo sencillo de un jugador: el <uuid>.dat del jugador (playerdata/ o, desde
// la 26.1, players/data/), o el tuyo dentro de level.dat en un mundo de un
// jugador. Vida, comida, experiencia, dónde está y qué lleva encima, con los
// iconos del juego. Los objetos se pueden arrastrar de una casilla a otra.

type Mutate = (fn: (root: NbtTag) => void, coalesce?: string) => boolean

interface Props {
  root: NbtTag & { name: string }
  mutate: Mutate
  playerName?: string
  /** Dónde está el jugador dentro del archivo (["Data", "Player"] en level.dat). */
  at?: string[]
  /** Mundo y UUID del jugador, para abrir sus logros (solo archivos de este equipo). */
  advancements?: { worldDir: string; uuid: string; remote?: boolean }
}

const GAMEMODES = [['0', 'Supervivencia'], ['1', 'Creativo'], ['2', 'Aventura'], ['3', 'Espectador']] as const
const DIMENSIONS = [['minecraft:overworld', 'Mundo normal'], ['minecraft:the_nether', 'Nether'], ['minecraft:the_end', 'End']] as const

/** 1.20.5 cambió el formato de los objetos (count en vez de Count, components en vez de tag). */
const NEW_ITEMS = 3837
/** 1.21.5 sacó la armadura y la mano izquierda del inventario a "equipment". */
const EQUIPMENT_COMPOUND = 4325

const prettyId = (id: string): string =>
  id.replace(/^minecraft:/, '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

/** Lo que se pasa al arrastrar una casilla. */
const DRAG_TYPE = 'application/x-fport1-slot'

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

export default function PlayerSimple({ root, mutate, playerName, at, advancements }: Props) {
  const [sel, setSel] = useState<SlotRef | null>(null)
  const [draft, setDraft] = useState({ id: '', count: '1' })
  const [hover, setHover] = useState<{ item: Compound; x: number; y: number } | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [showAdv, setShowAdv] = useState(false)
  const lang = useLang()
  const p = readPlayer(root, at)
  // Sin usercache: Paper/Spigot guardan el último nombre con el que entró
  const bukkit = p.bukkit?.type === 'compound' ? (p.bukkit.value as Compound) : {}
  const name = playerName ?? (getStr(bukkit, 'lastKnownName') || undefined)
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

  /** El objeto (entero, sin «Slot») de una casilla del jugador ya clonado. */
  function takeAt(pl: Compound, ref: SlotRef): Compound | null {
    const fromList = (key: 'Inventory' | 'EnderItems', slot: number): Compound | null => {
      const arr = listItems<Compound>(pl[key])
      const i = arr.findIndex((x) => getNum(x, 'Slot') === slot)
      if (i < 0) return null
      const [it] = arr.splice(i, 1)
      const out = { ...it }
      delete out.Slot
      return out
    }
    if (ref.where === 'inv') return fromList('Inventory', ref.slot)
    if (ref.where === 'ender') return fromList('EnderItems', ref.slot)
    if (equipCompound) {
      const eq = pl.equipment?.type === 'compound' ? (pl.equipment.value as Compound) : {}
      const it = eq[ref.key]?.type === 'compound' ? (eq[ref.key]!.value as Compound) : null
      delete eq[ref.key]
      return it
    }
    return fromList('Inventory', ARMOR.find((a) => a.key === ref.key)!.legacy)
  }

  /** Deja un objeto entero (o nada) en una casilla. */
  function putAt(pl: Compound, ref: SlotRef, item: Compound | null): void {
    const inList = (key: 'Inventory' | 'EnderItems', slot: number): void => {
      if (!pl[key] || pl[key]!.type !== 'list') pl[key] = compoundList([])
      const tag = pl[key]!
      if (tag.value.type === 'end') tag.value.type = 'compound'
      const arr = tag.value.value as Compound[]
      const i = arr.findIndex((x) => getNum(x, 'Slot') === slot)
      if (!item) { if (i >= 0) arr.splice(i, 1); return }
      const next = { ...item, Slot: byte(slot) }
      if (i >= 0) arr[i] = next
      else arr.push(next)
    }
    if (ref.where === 'inv') inList('Inventory', ref.slot)
    else if (ref.where === 'ender') inList('EnderItems', ref.slot)
    else if (equipCompound) {
      if (!pl.equipment || pl.equipment.type !== 'compound') pl.equipment = compound({})
      const eq = pl.equipment.value as Compound
      if (!item) delete eq[ref.key]
      else { const it = { ...item }; delete it.Slot; eq[ref.key] = compound(it) }
    } else {
      inList('Inventory', ARMOR.find((a) => a.key === ref.key)!.legacy)
    }
  }

  /** Poner (o quitar, con null) el objeto de una casilla. */
  function writeSlot(ref: SlotRef, item: { id: string; count: number } | null, keepExtra = true): void {
    set((pl) => {
      const prev = itemAt(ref)
      if (!item) { putAt(pl, ref, null); return }
      const base: Compound = keepExtra && prev ? { ...prev } : {}
      base.id = str(item.id)
      if (newItems) { base.count = int(item.count); delete base.Count }
      else { base.Count = byte(item.count); delete base.count }
      putAt(pl, ref, base)
    })
  }

  /** Arrastrar de una casilla a otra: se mueve, y si había algo se intercambian. */
  function moveItem(from: SlotRef, to: SlotRef): void {
    if (JSON.stringify(from) === JSON.stringify(to)) return
    set((pl) => {
      const a = takeAt(pl, from)
      const b = takeAt(pl, to)
      putAt(pl, to, a)
      putAt(pl, from, b)
    })
    if (sel && JSON.stringify(sel) === JSON.stringify(from)) setSel(to)
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
    const key = JSON.stringify(ref)
    return (
      <McSlot key={key} selected={sameRef(sel, ref)} over={dragOver === key} onClick={() => select(ref)}
        title={item ? undefined : label ?? 'Vacía'}
        draggable={!!item}
        onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, key); e.dataTransfer.effectAllowed = 'move'; setHover(null) }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDragOver(key) } }}
        onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(null)
          const raw = e.dataTransfer.getData(DRAG_TYPE)
          if (raw) moveItem(JSON.parse(raw) as SlotRef, ref)
        }}
        onHover={(x, y) => setHover(item && x >= 0 ? { item, x, y } : null)}>
        {item ? <ItemInSlot item={item} /> : emptyIcon ? <McIcon k={emptyIcon} size={32} /> : null}
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
        {name
          ? <img src={headUrl(name, 64)} alt="" className="w-14 h-14 rounded-lg" style={{ imageRendering: 'pixelated' }} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
          : <div className="w-14 h-14 rounded-lg bg-bg-hover" />}
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-text-primary truncate">{name ?? 'Jugador sin nombre conocido'}</p>
          <p className="text-xs text-text-muted">
            {DIMENSIONS.find(([d]) => d === getStr(p, 'Dimension'))?.[1] ?? getStr(p, 'Dimension')}
            {pos.length === 3 && ` · ${pos.map((n) => Math.round(n)).join(', ')}`}
          </p>
        </div>
        {advancements && (
          <button type="button" onClick={() => setShowAdv(true)}
            className="flex items-center gap-2 px-3 h-9 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary hover:border-accent/50">
            <McItem id="minecraft:wheat" size={18} /> Logros
          </button>
        )}
        <div className="w-44">
          <Select label="Modo de juego" value={String(getNum(p, 'playerGameType'))} options={GAMEMODES}
            onChange={(v) => set((pl) => { pl.playerGameType = int(Number(v)) })} />
        </div>
      </div>

      {/* Como en la pantalla del juego: corazones a la izquierda, comida a la derecha y la experiencia debajo */}
      <div className="rounded-xl bg-[#1d1d24] border border-black/40 px-4 pt-3 pb-4 w-fit max-w-full overflow-x-auto">
        <Hud health={health} food={food} level={getNum(p, 'XpLevel')} progress={getNum(p, 'XpP')} />
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
      <Field label="Inventario" hint="Clic en una casilla para cambiar o quitar lo que hay; arrastra para moverlo (también al cofre de Ender). Pasa el ratón para ver la información.">
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
            {selItem && <McItem id={getStr(selItem, 'id')} size={24} />}
            <p className="text-sm font-semibold text-text-primary">
              {selItem ? itemName(lang, getStr(selItem, 'id')) : 'Casilla vacía'}
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
                {draft.id && <McItem id={draft.id.includes(':') ? draft.id : `minecraft:${draft.id}`} size={24} />}
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
          {selItem && <ItemContents item={selItem} onHover={setHover} />}
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
                  <span className="text-text-primary">{lang[`effect.${id.replace(':', '.')}`] ?? prettyId(id)}</span>
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

      {hover && <ItemTooltip item={hover.item} x={hover.x} y={hover.y} lang={lang} />}
      {showAdv && advancements && (
        <AdvancementsView worldDir={advancements.worldDir} uuid={advancements.uuid} remote={advancements.remote} playerName={name} onClose={() => setShowAdv(false)} />
      )}
    </div>
  )
}

/** Icono, cantidad y barra de durabilidad, como en el juego. */
function ItemInSlot({ item }: { item: Compound }) {
  const id = getStr(item, 'id')
  const count = itemCount(item)
  const max = maxDamage(item)
  const dmg = itemDamage(item)
  const enchanted = Object.keys(item).some((k) => k === 'components' || k === 'tag') && /enchant/.test(JSON.stringify(item.components ?? item.tag ?? ''))
  return (
    <>
      <span className="relative">
        <McItem id={id} size={32} fallback={<span className="text-[8px] leading-tight text-center text-white/90 px-0.5 break-all">{prettyId(id)}</span>} />
        {enchanted && <span className="absolute inset-0 pointer-events-none mix-blend-screen" style={{ background: 'linear-gradient(115deg, transparent 20%, rgba(190,120,255,0.45) 45%, transparent 70%)' }} />}
      </span>
      {max > 0 && dmg > 0 && (
        <span className="absolute left-[4px] right-[4px] bottom-[3px] h-[3px] bg-black">
          <span className="block h-[2px]" style={{ width: `${((max - dmg) / max) * 100}%`, background: `hsl(${((max - dmg) / max) * 120}, 100%, 50%)` }} />
        </span>
      )}
      {count > 1 && <span className="absolute bottom-0 right-0.5 text-[13px] font-bold text-white leading-none" style={{ textShadow: '2px 2px 0 #3f3f3f' }}>{count}</span>}
    </>
  )
}

/** La tarjetita del juego al pasar el ratón por un objeto. */
export function ItemTooltip({ item, x, y, lang }: { item: Compound; x: number; y: number; lang: Record<string, string> }) {
  const lines = tooltipLines(item, lang)
  // Que no se salga de la ventana
  const left = Math.min(x + 14, window.innerWidth - 320)
  const top = Math.min(y + 14, window.innerHeight - 24 - lines.length * 20)
  return (
    <div className="fixed z-[200] pointer-events-none px-2 py-1.5 max-w-[300px]" style={{
      left, top, background: 'rgba(16,0,16,0.94)', border: '2px solid #100010',
      boxShadow: 'inset 0 0 0 1px #2d0a63, inset 0 1px 0 1px #5000ff55', borderRadius: 3,
    }}>
      {lines.map((segs, i) => (
        <div key={i} className={`text-[13px] leading-[18px] ${i === 0 && lines.length > 1 ? 'mb-1' : ''}`}>
          <McTextPreview segments={segs} className="!whitespace-normal" />
        </div>
      ))}
    </div>
  )
}

/** Lo que hay dentro de un shulker o de un saco. */
function ItemContents({ item, onHover }: { item: Compound; onHover: (h: { item: Compound; x: number; y: number } | null) => void }) {
  const id = getStr(item, 'id')
  if (isShulker(id)) {
    const inside = containerItems(item)
    return (
      <div className="space-y-1">
        <p className="text-xs text-text-muted">Dentro ({inside.length} de 27 casillas ocupadas)</p>
        <div className="inline-grid grid-cols-9 gap-0.5 p-1.5 rounded-md" style={{ background: '#c6c6c6', border: '2px solid', borderColor: '#fff #555 #555 #fff' }}>
          {Array.from({ length: 27 }, (_, i) => {
            const it = inside.find((e) => e.slot === i)?.item ?? null
            return (
              <McSlot key={i} onHover={(x, y) => onHover(it && x >= 0 ? { item: it, x, y } : null)}>
                {it && <ItemInSlot item={it} />}
              </McSlot>
            )
          })}
        </div>
      </div>
    )
  }
  if (isBundle(id)) {
    const inside = bundleItems(item)
    const used = Math.min(64, bundleWeight(item))
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-text-muted">
          Dentro: {inside.length} {inside.length === 1 ? 'montón' : 'montones'} · ocupa {Math.round(used)}/64 · {used >= 64 ? 'lleno' : `le queda sitio para ${Math.floor(64 - used)} objetos normales`}
        </p>
        <div className="h-2 w-64 rounded bg-black/40 overflow-hidden">
          <div className="h-full" style={{ width: `${(used / 64) * 100}%`, background: used >= 64 ? '#ef4444' : '#7c6cf0' }} />
        </div>
        {inside.length > 0 && (
          <div className="flex flex-wrap gap-0.5 p-1.5 rounded-md w-fit" style={{ background: '#c6c6c6', border: '2px solid', borderColor: '#fff #555 #555 #fff' }}>
            {inside.map((it, i) => (
              <McSlot key={i} onHover={(x, y) => onHover(x >= 0 ? { item: it, x, y } : null)}><ItemInSlot item={it} /></McSlot>
            ))}
          </div>
        )}
      </div>
    )
  }
  return null
}

function ability(pl: Compound, key: string, value: boolean): void {
  if (!pl.abilities || pl.abilities.type !== 'compound') pl.abilities = compound({})
  ;(pl.abilities.value as Compound)[key] = byte(value)
}

/** Casilla de inventario con el relieve del juego. */
export function McSlot({ children, selected, over, glint, onClick, title, draggable, onDragStart, onDragOver, onDragLeave, onDrop, onHover }: {
  children?: React.ReactNode; selected?: boolean; over?: boolean; glint?: boolean; onClick?: () => void; title?: string
  draggable?: boolean
  onDragStart?: React.DragEventHandler; onDragOver?: React.DragEventHandler; onDragLeave?: React.DragEventHandler; onDrop?: React.DragEventHandler
  /** Posición del ratón mientras está encima (null al salir), para la tarjetita */
  onHover?: (x: number, y: number) => void
}) {
  return (
    <button type="button" onClick={onClick} title={title} draggable={draggable}
      onDragStart={onDragStart} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      onMouseMove={onHover ? (e) => onHover(e.clientX, e.clientY) : undefined}
      onMouseLeave={onHover ? () => onHover(-1, -1) : undefined}
      className={`relative w-10 h-10 flex items-center justify-center overflow-hidden ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${selected ? 'outline outline-2 outline-accent z-[1]' : ''}`}
      style={{
        background: over ? '#c5d6ff' : selected ? '#a8c4ff' : '#8b8b8b',
        border: '2px solid',
        borderColor: '#373737 #fff #fff #373737',
        boxShadow: glint ? 'inset 0 0 8px rgba(170,90,255,0.8)' : undefined
      }}>
      {children}
    </button>
  )
}

/**
 * La parte de abajo de la pantalla del juego, a escala 2: 364 de ancho como la
 * barra de experiencia; 10 corazones a la izquierda y 10 muslos a la derecha
 * (cada icono de 18 cada 16, solapados un píxel como en el juego); el nivel,
 * centrado sobre la barra.
 */
function Hud({ health, food, level, progress }: { health: number; food: number; level: number; progress: number }) {
  const tex = useTextures([HUD.heartFull, HUD.heartHalf, HUD.heartEmpty, HUD.foodFull, HUD.foodHalf, HUD.foodEmpty, HUD.xpBack, HUD.xpFill])
  const row = (value: number, full: string, half: string, empty: string, fromRight: boolean): JSX.Element[] =>
    Array.from({ length: 10 }, (_, i) => {
      const v = value - i * 2
      const k = v >= 2 ? full : v >= 1 ? half : empty
      return (
        <span key={i} className="absolute top-0 w-[18px] h-[18px]" style={fromRight ? { right: i * 16 } : { left: i * 16 }}>
          {tex[empty] && <img src={tex[empty]!} alt="" className="absolute inset-0 w-full h-full" style={{ imageRendering: 'pixelated' }} />}
          {k !== empty && tex[k] && <img src={tex[k]!} alt="" className="absolute inset-0 w-full h-full" style={{ imageRendering: 'pixelated' }} />}
        </span>
      )
    })
  if (!tex[HUD.heartEmpty]) {
    return <p className="text-sm text-white">Vida {health} · Comida {food} · Nivel {level}</p>
  }
  return (
    <div className="relative w-[364px] h-[34px]">
      <div className="absolute inset-x-0 top-0 h-[18px]" title={`Vida: ${health} (${(health / 2).toFixed(1)} corazones)`}>
        {row(health, HUD.heartFull, HUD.heartHalf, HUD.heartEmpty, false)}
      </div>
      <div className="absolute inset-x-0 top-0 h-[18px]" title={`Comida: ${food}`}>
        {row(food, HUD.foodFull, HUD.foodHalf, HUD.foodEmpty, true)}
      </div>
      <div className="absolute left-0 right-0 bottom-0 h-[10px]" title={`Nivel ${level} · ${Math.round(progress * 100)} %`}>
        {tex[HUD.xpBack] && <img src={tex[HUD.xpBack]!} alt="" className="absolute inset-0 w-full h-full" style={{ imageRendering: 'pixelated' }} />}
        <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}>
          {tex[HUD.xpFill] && <img src={tex[HUD.xpFill]!} alt="" className="h-full max-w-none" style={{ width: 364, imageRendering: 'pixelated' }} />}
        </div>
      </div>
      {level > 0 && (
        <span className="absolute left-1/2 -translate-x-1/2 bottom-[6px] text-[15px] font-bold leading-none" style={{ color: '#80ff20', textShadow: '2px 0 0 #000, -2px 0 0 #000, 0 2px 0 #000, 0 -2px 0 #000' }}>
          {level}
        </span>
      )}
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
