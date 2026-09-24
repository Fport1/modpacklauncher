import { useState } from 'react'
import type { NbtTag } from '../../../../shared/types'
import { type Compound, str, byte, int, compound, getStr, getNum, getBool } from '../../lib/nbtBuild'
import { longToString, parseValue } from '../../lib/nbtModel'
import { McIcon } from '../../lib/mcTextures'
import { Field, Toggle, Select, NumberCell } from './ScoreboardSimple'
import PlayerSimple from './PlayerSimple'

// Modo sencillo de level.dat: los ajustes del mundo, las reglas del juego y,
// en un mundo de un jugador, tu propio jugador (que se guarda aquí dentro y no
// en playerdata).

type Mutate = (fn: (root: NbtTag) => void, coalesce?: string) => boolean

interface Props {
  root: NbtTag & { name: string }
  mutate: Mutate
  playerName?: string
}

const GAMEMODES = [['0', 'Supervivencia'], ['1', 'Creativo'], ['2', 'Aventura'], ['3', 'Espectador']] as const
const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard']
const DIFF_LABELS: [string, string][] = [['peaceful', 'Pacífico'], ['easy', 'Fácil'], ['normal', 'Normal'], ['hard', 'Difícil']]

/** Explicación de las reglas del juego más usadas (se buscan sin mayúsculas ni guiones). */
const RULES: Record<string, string> = {
  keepinventory: 'Conservar el inventario al morir',
  dodaylightcycle: 'Pasa el tiempo (día y noche)',
  advancetime: 'Pasa el tiempo (día y noche)',
  doweathercycle: 'Cambia el tiempo (lluvia, tormentas)',
  advanceweather: 'Cambia el tiempo (lluvia, tormentas)',
  domobspawning: 'Aparecen criaturas solas',
  spawnmobs: 'Aparecen criaturas solas',
  mobgriefing: 'Las criaturas rompen bloques (creepers, endermans…)',
  dofiretick: 'El fuego se extiende',
  naturalregeneration: 'Se recupera vida al estar lleno',
  doimmediaterespawn: 'Reaparecer sin pantalla de muerte',
  showdeathmessages: 'Mensajes de muerte en el chat',
  announceadvancements: 'Anunciar logros en el chat',
  doinsomnia: 'Aparecen phantoms si no duermes',
  randomtickspeed: 'Velocidad de crecimiento (cultivos, hojas…)',
  playerssleepingpercentage: 'Porcentaje de jugadores que tienen que dormir',
  spawnradius: 'Radio del punto de aparición',
  falldamage: 'Daño por caída',
  firedamage: 'Daño por fuego',
  drowningdamage: 'Daño por ahogarse',
  freezedamage: 'Daño por congelación',
  dotiledrops: 'Los bloques rotos sueltan objetos',
  domobloot: 'Las criaturas sueltan objetos',
  doentitydrops: 'Las entidades (barcas, cuadros…) sueltan objetos',
  commandblockoutput: 'Los bloques de comandos avisan en el chat',
  sendcommandfeedback: 'Respuesta de los comandos en el chat',
  logadmincommands: 'Avisar a los OP de los comandos de otros',
  disableraids: 'Desactivar las invasiones',
  dopatrolspawning: 'Aparecen patrullas de saqueadores',
  dotraderspawning: 'Aparece el comerciante errante',
  dowardenspawning: 'Aparece el Warden',
  forgivedeadplayers: 'Las criaturas neutrales perdonan al morir el jugador',
  universalanger: 'Las criaturas neutrales atacan a todos',
  maxentitycramming: 'Máximo de criaturas apiladas antes de hacerse daño',
  dolimitedcrafting: 'Solo se fabrica lo desbloqueado en el libro de recetas',
  reduceddebuginfo: 'Menos información en F3',
  spectatorsgeneratechunks: 'Los espectadores generan terreno',
  snowaccumulationheight: 'Capas de nieve que se acumulan',
  lavasourceconversion: 'La lava crea fuentes nuevas',
  watersourceconversion: 'El agua crea fuentes nuevas',
  projectilescanbreakblocks: 'Los proyectiles rompen bloques',
  enderpearlsvanishondeath: 'Las perlas de Ender desaparecen al morir',
  dovinesspread: 'Las enredaderas crecen',
  spawnchunkradius: 'Chunks del spawn siempre cargados',
  pvp: 'PvP entre jugadores',
  maxcommandchainlength: 'Longitud máxima de cadenas de comandos',
  disableelytramovementcheck: 'No comprobar el vuelo con élitros',
  globalsoundevents: 'Sonidos globales (jefes) para todos'
}
const ruleKey = (k: string): string => k.toLowerCase().replace(/[_\-.]/g, '').replace(/^minecraft:/, '')

/** Presets de hora: el día en que se está se conserva. */
const TIMES: [number, string, string][] = [
  [0, 'Amanecer', 'item:clock'], [6000, 'Mediodía', 'item:sunflower'], [12000, 'Atardecer', 'item:clock'], [18000, 'Medianoche', 'item:clock']
]

function dataOf(root: NbtTag): Compound {
  const top = root.value as Compound
  if (top.Data?.type === 'compound') return top.Data.value as Compound
  return top
}

export default function LevelSimple({ root, mutate, playerName }: Props) {
  const d = dataOf(root)
  const hasPlayer = d.Player?.type === 'compound'
  const [tab, setTab] = useState<'world' | 'rules' | 'player'>('world')
  const set = (fn: (d: Compound) => void, coalesce?: string): void => { mutate((r) => fn(dataOf(r)), coalesce) }

  const tabs: ['world' | 'rules' | 'player', string][] = [['world', 'Mundo'], ['rules', 'Reglas del juego']]
  if (hasPlayer) tabs.push(['player', playerName ? `Tu jugador (${playerName})` : 'Tu jugador'])

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-3 pt-2 border-b border-border overflow-x-auto">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === id ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'world' && <World d={d} set={set} />}
      {tab === 'rules' && <Rules d={d} set={set} />}
      {tab === 'player' && hasPlayer && (
        <PlayerSimple root={root} mutate={mutate} playerName={playerName} at={(root.value as Compound).Data ? ['Data', 'Player'] : ['Player']} />
      )}
    </div>
  )
}

// ── Mundo ───────────────────────────────────────────────────────────────────

function World({ d, set }: { d: Compound; set: (fn: (d: Compound) => void, coalesce?: string) => void }) {
  // Desde la 1.21.x la dificultad va en difficulty_settings; antes, sueltos
  const ds = d.difficulty_settings?.type === 'compound' ? (d.difficulty_settings.value as Compound) : null
  const difficulty = ds ? getStr(ds, 'difficulty', 'normal') : DIFFICULTIES[getNum(d, 'Difficulty', 2)] ?? 'normal'
  const hardcore = ds ? getBool(ds, 'hardcore') : getBool(d, 'hardcore')
  const locked = ds ? getBool(ds, 'locked') : getBool(d, 'DifficultyLocked')

  const seedTag = (d.WorldGenSettings?.type === 'compound' ? (d.WorldGenSettings.value as Compound).seed : undefined) ?? d.RandomSeed
  const seed = seedTag?.type === 'long' ? longToString(seedTag.value) : ''

  const dayTimeTag = d.DayTime
  const dayTime = dayTimeTag?.type === 'long' ? Number(longToString(dayTimeTag.value)) : getNum(d, 'DayTime')
  const day = Math.floor(dayTime / 24000)
  const timeOfDay = ((dayTime % 24000) + 24000) % 24000

  // Punto de aparición: SpawnX/Y/Z, o "spawn" con pos en las versiones nuevas
  const spawnC = d.spawn?.type === 'compound' ? (d.spawn.value as Compound) : null
  const spawnPos: number[] = spawnC?.pos?.type === 'intArray' ? spawnC.pos.value : [getNum(d, 'SpawnX'), getNum(d, 'SpawnY'), getNum(d, 'SpawnZ')]

  const setDayTime = (t: number): void => set((x) => {
    const parsed = parseValue('long', String(Math.max(0, Math.round(t))))
    if (parsed.ok) x.DayTime = { type: 'long', value: parsed.value }
  })

  const weather = getBool(d, 'thundering') ? 'thunder' : getBool(d, 'raining') ? 'rain' : 'clear'

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        <label className="block min-w-0">
          <span className="text-xs text-text-muted">Nombre del mundo</span>
          <input value={getStr(d, 'LevelName')} onChange={(e) => set((x) => { x.LevelName = str(e.target.value) }, 'levelname')}
            className="mt-1 w-full bg-bg-primary border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60" />
        </label>
        {seed && (
          <label className="block min-w-0">
            <span className="text-xs text-text-muted">Semilla (solo lectura)</span>
            <div className="mt-1 flex gap-1.5">
              <input readOnly value={seed} className="flex-1 min-w-0 bg-bg-primary border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-secondary font-mono" />
              <button type="button" onClick={() => navigator.clipboard.writeText(seed)} className="px-2 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary">Copiar</button>
            </div>
          </label>
        )}
        <Select label="Modo de juego de los que entran por primera vez" value={String(getNum(d, 'GameType'))} options={GAMEMODES}
          onChange={(v) => set((x) => { x.GameType = int(Number(v)) })} />
        <Select label="Dificultad" value={difficulty} options={DIFF_LABELS}
          onChange={(v) => set((x) => {
            if (x.difficulty_settings?.type === 'compound') (x.difficulty_settings.value as Compound).difficulty = str(v)
            else x.Difficulty = byte(DIFFICULTIES.indexOf(v))
          })} />
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        <Toggle label="Trucos (comandos)" hint="Como «Permitir trucos» al crear el mundo" value={getBool(d, 'allowCommands')} onChange={(v) => set((x) => { x.allowCommands = byte(v) })} />
        <Toggle label="Extremo (hardcore)" hint="Una sola vida" value={hardcore}
          onChange={(v) => set((x) => { if (x.difficulty_settings?.type === 'compound') (x.difficulty_settings.value as Compound).hardcore = byte(v); else x.hardcore = byte(v) })} />
        <Toggle label="Dificultad bloqueada" value={locked}
          onChange={(v) => set((x) => { if (x.difficulty_settings?.type === 'compound') (x.difficulty_settings.value as Compound).locked = byte(v); else x.DifficultyLocked = byte(v) })} />
      </div>

      <Field label="Hora" hint={`Día ${day + 1}. Cada día son 24000 ticks (20 minutos reales).`}>
        <div className="flex items-center gap-2 flex-wrap">
          {TIMES.map(([t, label, icon]) => (
            <button key={t} type="button" onClick={() => setDayTime(day * 24000 + t)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm ${Math.abs(timeOfDay - t) < 1000 ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:border-accent/40'}`}>
              <McIcon k={icon} size={16} />{label}
            </button>
          ))}
          <span className="text-xs text-text-muted ml-1">o exacta:</span>
          <NumberCell value={timeOfDay} onCommit={(v) => setDayTime(day * 24000 + (((v % 24000) + 24000) % 24000))} />
        </div>
      </Field>

      <Field label="Tiempo">
        <div className="flex gap-2 flex-wrap">
          {([['clear', 'Despejado', 'item:sunflower'], ['rain', 'Lluvia', 'item:water_bucket'], ['thunder', 'Tormenta', 'item:trident']] as const).map(([w, label, icon]) => (
            <button key={w} type="button"
              onClick={() => set((x) => {
                x.raining = byte(w !== 'clear')
                x.thundering = byte(w === 'thunder')
                // Que dure: 10 minutos del tiempo elegido antes de que cambie solo
                x.clearWeatherTime = int(w === 'clear' ? 12000 : 0)
                x.rainTime = int(w === 'clear' ? 0 : 12000)
                x.thunderTime = int(w === 'thunder' ? 12000 : 0)
              })}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm ${weather === w ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:border-accent/40'}`}>
              <McIcon k={icon} size={16} />{label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Punto de aparición" hint="Donde aparecen los jugadores nuevos y los que mueren sin cama.">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
          {['X', 'Y', 'Z'].map((axis, i) => (
            <label key={axis} className="block min-w-0">
              <span className="text-xs text-text-muted">{axis}</span>
              <div className="mt-1"><NumberCell width="w-full" value={spawnPos[i] ?? 0}
                onCommit={(v) => set((x) => {
                  const n = Math.round(v)
                  if (x.spawn?.type === 'compound') {
                    const sc = x.spawn.value as Compound
                    const cur: number[] = sc.pos?.type === 'intArray' ? [...sc.pos.value] : [0, 0, 0]
                    cur[i] = n
                    sc.pos = { type: 'intArray', value: cur }
                  } else {
                    x[`Spawn${axis}`] = int(n)
                  }
                })} /></div>
            </label>
          ))}
        </div>
      </Field>
    </div>
  )
}

// ── Reglas del juego ────────────────────────────────────────────────────────

function Rules({ d, set }: { d: Compound; set: (fn: (d: Compound) => void, coalesce?: string) => void }) {
  const [search, setSearch] = useState('')
  const key = d.GameRules ? 'GameRules' : d.game_rules ? 'game_rules' : 'GameRules'
  const rules = d[key]?.type === 'compound' ? (d[key]!.value as Compound) : {}
  const q = search.trim().toLowerCase()
  const entries = Object.entries(rules)
    .filter((e): e is [string, NbtTag] => !!e[1])
    .filter(([k]) => !q || k.toLowerCase().includes(q) || (RULES[ruleKey(k)] ?? '').toLowerCase().includes(q))
    .sort(([a], [b]) => (RULES[ruleKey(a)] ?? a).localeCompare(RULES[ruleKey(b)] ?? b))

  /** Guardar con el mismo tipo que tenía (texto "true" en las versiones de siempre, byte/int en las nuevas). */
  function setRule(name: string, value: string | number | boolean): void {
    set((x) => {
      if (!x[key] || x[key]!.type !== 'compound') x[key] = compound({})
      const rs = x[key]!.value as Compound
      const prev = rs[name]
      if (!prev || prev.type === 'string') rs[name] = str(String(value))
      else if (prev.type === 'byte') rs[name] = byte(value === true || value === 'true' || value === 1)
      else rs[name] = int(Number(value))
    }, `rule:${name}`)
  }

  if (Object.keys(rules).length === 0) {
    return <p className="p-6 text-sm text-text-muted">Este mundo no tiene reglas guardadas todavía (se crean al abrirlo en el juego).</p>
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar regla…"
        className="w-full max-w-xs bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60" />
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {entries.map(([name, tag]) => {
          const label = RULES[ruleKey(name)]
          const raw = tag.type === 'string' ? tag.value : tag.value
          const isBool = raw === 'true' || raw === 'false' || tag.type === 'byte'
          if (isBool) {
            const v = raw === 'true' || raw === 1
            return <Toggle key={name} label={label ?? name} hint={label ? name : undefined} value={v} onChange={(nv) => setRule(name, nv)} />
          }
          return (
            <div key={name} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-bg-card border border-border min-w-0">
              <span className="min-w-0">
                <span className="block text-sm text-text-primary">{label ?? name}</span>
                {label && <span className="block text-[11px] text-text-muted font-mono truncate">{name}</span>}
              </span>
              <NumberCell value={Number(raw) || 0} onCommit={(v) => setRule(name, Math.round(v))} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
