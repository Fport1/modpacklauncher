import { useMemo, useState } from 'react'
import type { NbtTag } from '../../../../shared/types'
import { MC_COLORS, colorHex, parseCodes, plainText, type McSegment } from '../../lib/mcText'
import {
  type Compound, str, byte, int, compound, stringList, compoundList, listItems, getStr, getNum, getBool,
  readText, writeText, readRichText, writeRichText, textAsNbt
} from '../../lib/nbtBuild'
import McTextInput, { McTextPreview, RichTextInput } from './McTextInput'
import { headUrl } from './shared'

// Modo sencillo de scoreboard.dat: todo lo que se puede hacer con /team y
// /scoreboard, sin tocar el árbol NBT. Equipos con prefijos de colores y
// textos al pasar el ratón, objetivos de cualquier tipo, puntos de cada
// jugador y qué se ve en pantalla.

type Mutate = (fn: (root: NbtTag) => void, coalesce?: string) => boolean

interface Props {
  root: NbtTag & { name: string }
  mutate: Mutate
}

const VISIBILITY = [
  ['always', 'Siempre'], ['never', 'Nunca'],
  ['hideForOtherTeams', 'Ocultar a otros equipos'], ['hideForOwnTeam', 'Ocultar a su propio equipo']
] as const
const COLLISION = [
  ['always', 'Siempre'], ['never', 'Nunca'],
  ['pushOtherTeams', 'Solo con otros equipos'], ['pushOwnTeam', 'Solo con su propio equipo']
] as const

const VALID_NAME = /^[A-Za-z0-9_]{1,16}$/
const VALID_ID = /^[A-Za-z0-9_.+-]{1,64}$/

// ── Acceso a los datos ──────────────────────────────────────────────────────

function dataOf(root: NbtTag): Compound {
  const top = root.value as Compound
  if (!top.data || top.data.type !== 'compound') top.data = { type: 'compound', value: {} }
  return top.data.value as Compound
}

/** Lista de compounds de `data`, creándola si hace falta, lista para modificar. */
function listOf(root: NbtTag, key: string): Compound[] {
  const data = dataOf(root)
  if (!data[key] || data[key]!.type !== 'list') data[key] = compoundList([])
  const tag = data[key]!
  if (tag.value.type === 'end') tag.value.type = 'compound'
  return tag.value.value as Compound[]
}

function setList(root: NbtTag, key: string, items: Compound[]): void {
  dataOf(root)[key] = compoundList(items)
}

const playersOf = (team: Compound): string[] => listItems<string>(team.Players)
const nameOf = (c: Compound): string => getStr(c, 'Name')

function Head({ name, size = 20 }: { name: string; size?: number }) {
  if (!VALID_NAME.test(name)) {
    return <span className="rounded-sm bg-bg-hover shrink-0 flex items-center justify-center text-[9px] text-text-muted" style={{ width: size, height: size }}
      title={name.startsWith('#') ? 'Jugador falso (para textos o contadores)' : 'Entidad'}>{name.startsWith('#') ? '#' : '?'}</span>
  }
  return <img src={headUrl(name, size)} alt="" className="rounded-sm shrink-0" style={{ width: size, height: size }} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
}

// ── Componente ──────────────────────────────────────────────────────────────

type Tab = 'teams' | 'objectives' | 'players' | 'display'

export default function ScoreboardSimple({ root, mutate }: Props) {
  const [tab, setTab] = useState<Tab>('teams')
  const data = dataOf(root)
  const teams = listItems<Compound>(data.Teams)
  const objectives = listItems<Compound>(data.Objectives)
  const scores = listItems<Compound>(data.PlayerScores)
  const modern = textAsNbt(root)
  const holders = useMemo(() => {
    const s = new Set<string>()
    for (const sc of scores) s.add(nameOf(sc))
    for (const t of teams) for (const p of playersOf(t)) s.add(p)
    return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [scores, teams])

  const tabs: [Tab, string][] = [
    ['teams', `Equipos (${teams.length})`],
    ['objectives', `Objetivos (${objectives.length})`],
    ['players', `Jugadores (${holders.length})`],
    ['display', 'Pantalla']
  ]
  const shared = { root, mutate, teams, objectives, scores, modern, holders }

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
      {tab === 'teams' && <Teams {...shared} />}
      {tab === 'objectives' && <Objectives {...shared} />}
      {tab === 'players' && <Players {...shared} />}
      {tab === 'display' && <DisplaySlots {...shared} />}
    </div>
  )
}

interface Shared extends Props {
  teams: Compound[]
  objectives: Compound[]
  scores: Compound[]
  modern: boolean
  holders: string[]
}

// ── Lista lateral + detalle (responde al ancho del cuadro) ──────────────────

function SplitView({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) {
  return (
    <div className="flex-1 flex min-h-0">
      <div className="w-48 max-w-[40%] shrink-0 border-r border-border flex flex-col min-h-0">{list}</div>
      <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-5">{detail}</div>
    </div>
  )
}

// ═══ Equipos ════════════════════════════════════════════════════════════════

function Teams({ mutate, teams, modern }: Shared) {
  const [selected, setSelected] = useState<string | null>(teams[0] ? nameOf(teams[0]) : null)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState<{ name: string; prefix: string; color: string; error?: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [memberDraft, setMemberDraft] = useState('')
  const [note, setNote] = useState('')

  const team = teams.find((t) => nameOf(t) === selected) ?? null
  const q = search.trim().toLowerCase()
  const visible = teams.filter((t) =>
    !q || nameOf(t).toLowerCase().includes(q) || plainText(readText(t.DisplayName)).toLowerCase().includes(q) ||
    playersOf(t).some((p) => p.toLowerCase().includes(q)))

  function editTeam(fn: (t: Compound, all: Compound[]) => void, coalesce?: string): void {
    if (!selected) return
    mutate((r) => {
      const all = listOf(r, 'Teams')
      const t = all.find((x) => nameOf(x) === selected)
      if (t) fn(t, all)
    }, coalesce)
  }

  function create(): void {
    if (!creating) return
    const name = creating.name.trim()
    if (!VALID_ID.test(name)) { setCreating({ ...creating, error: 'Solo letras, números y _ . + - (sin espacios)' }); return }
    if (teams.some((t) => nameOf(t) === name)) { setCreating({ ...creating, error: 'Ya hay un equipo con ese nombre' }); return }
    mutate((r) => {
      listOf(r, 'Teams').push({
        Name: str(name),
        DisplayName: writeText(name, modern),
        MemberNamePrefix: writeText(creating.prefix, modern),
        MemberNameSuffix: writeText('', modern),
        ...(creating.color !== 'reset' ? { TeamColor: str(creating.color) } : {}),
        AllowFriendlyFire: byte(1),
        SeeFriendlyInvisibles: byte(1),
        NameTagVisibility: str('always'),
        DeathMessageVisibility: str('always'),
        CollisionRule: str('always'),
        Players: stringList([])
      })
    })
    setSelected(name)
    setCreating(null)
  }

  function addMembers(): void {
    const names = memberDraft.split(/[\s,;]+/).map((n) => n.trim()).filter(Boolean)
    if (names.length === 0 || !team) return
    const moved: string[] = []
    editTeam((t, all) => {
      // Como en el juego: un jugador solo puede estar en un equipo
      for (const other of all) {
        if (other === t) continue
        const list = playersOf(other)
        const kept = list.filter((p) => !names.includes(p))
        if (kept.length !== list.length) {
          moved.push(...list.filter((p) => names.includes(p)).map((p) => `${p} (de ${nameOf(other)})`))
          other.Players = stringList(kept)
        }
      }
      const current = playersOf(t)
      t.Players = stringList([...current, ...names.filter((n) => !current.includes(n))])
    })
    setMemberDraft('')
    setNote(moved.length ? `Movidos a este equipo: ${moved.join(', ')}` : '')
  }

  const teamColor = team ? getStr(team, 'TeamColor', 'reset') : 'reset'
  const nameSeg = (n: string): McSegment[] => [{ text: n, color: teamColor !== 'reset' ? teamColor : undefined }]
  const sample = team ? (playersOf(team)[0] ?? 'Steve') : 'Steve'
  const prefix = team ? readRichText(team.MemberNamePrefix) : { codes: '' }
  const suffix = team ? readRichText(team.MemberNameSuffix) : { codes: '' }

  return (
    <>
      <SplitView
        list={<>
          <div className="p-2 space-y-2 border-b border-border">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar equipo o jugador…"
              className="w-full bg-bg-primary border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60" />
            <button type="button" onClick={() => setCreating({ name: '', prefix: '', color: 'white' })}
              className="w-full py-1.5 rounded-lg bg-accent/15 text-accent text-sm font-medium hover:bg-accent/25">＋ Nuevo equipo</button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {visible.map((t) => {
              const name = nameOf(t)
              return (
                <button key={name} type="button" onClick={() => { setSelected(name); setNote('') }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg border ${selected === name ? 'border-accent/60 bg-accent/10' : 'border-transparent hover:bg-bg-hover'}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/40" style={{ background: colorHex(getStr(t, 'TeamColor', 'reset')) ?? 'transparent' }} />
                    <McTextPreview segments={parseCodes(readText(t.DisplayName))} empty={name} className="text-sm truncate" />
                  </div>
                  <p className="text-[11px] text-text-muted pl-[18px] truncate">{name} · {playersOf(t).length} miembros</p>
                </button>
              )
            })}
            {visible.length === 0 && <p className="text-xs text-text-muted text-center py-6">{teams.length ? 'Nada coincide' : 'No hay equipos todavía'}</p>}
          </div>
        </>}
        detail={!team ? (
          <p className="text-sm text-text-muted text-center py-10">Elige un equipo o crea uno nuevo.</p>
        ) : (
          <>
            {/* Cómo se ve */}
            <div className="rounded-xl bg-[#1d1d24] border border-black/40 p-3 space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-white/40">Así se ve en el juego</p>
              <div className="flex items-center gap-2 flex-wrap">
                <Head name={sample} />
                <McTextPreview className="text-sm" segments={[...parseCodes(prefix.codes), ...nameSeg(sample), ...parseCodes(suffix.codes)]} />
              </div>
              <p className="text-sm">
                <McTextPreview segments={[{ text: '<' }, ...parseCodes(prefix.codes), ...nameSeg(sample), ...parseCodes(suffix.codes), { text: '> ¡Hola!' }]} />
              </p>
            </div>

            <Field label="Nombre interno" hint="El que se usa en los comandos (/team join …). No se ve en el juego.">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm text-text-primary break-all">{nameOf(team)}</span>
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => setRenaming(nameOf(team))}>renombrar</button>
              </div>
            </Field>

            <Field label="Nombre visible" hint="Cómo aparece el equipo en la lista y en /team list.">
              <RichTextInput value={readRichText(team.DisplayName)} placeholder="&6&lMi equipo"
                onChange={(v) => editTeam((t) => { t.DisplayName = writeRichText(v, modern) }, 'display')} />
            </Field>

            <Field label="Prefijo" hint="Va delante del nombre de cada miembro. Deja un espacio al final.">
              <RichTextInput value={prefix} placeholder="&5&l[VIP] " compact previewAfter={nameSeg(sample)}
                onChange={(v) => editTeam((t) => { t.MemberNamePrefix = writeRichText(v, modern) }, 'prefix')} />
            </Field>
            <Field label="Sufijo" hint="Va detrás del nombre. Empieza con un espacio.">
              <RichTextInput value={suffix} placeholder=" &7✦" compact previewBefore={nameSeg(sample)}
                onChange={(v) => editTeam((t) => { t.MemberNameSuffix = writeRichText(v, modern) }, 'suffix')} />
            </Field>

            <Field label="Color del equipo" hint="Color del nombre de los miembros y del brillo (glowing).">
              <ColorPicker value={teamColor} allowReset onChange={(c) => editTeam((t) => { if (c === 'reset') delete t.TeamColor; else t.TeamColor = str(c) })} />
            </Field>

            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              <Toggle label="Fuego amigo" hint="Los del mismo equipo se pueden hacer daño"
                value={getBool(team, 'AllowFriendlyFire', true)} onChange={(v) => editTeam((t) => { t.AllowFriendlyFire = byte(v) })} />
              <Toggle label="Ver a compañeros invisibles" hint="Se ven semitransparentes"
                value={getBool(team, 'SeeFriendlyInvisibles', true)} onChange={(v) => editTeam((t) => { t.SeeFriendlyInvisibles = byte(v) })} />
              <Select label="Nombres sobre la cabeza" value={getStr(team, 'NameTagVisibility', 'always')} options={VISIBILITY}
                onChange={(v) => editTeam((t) => { t.NameTagVisibility = str(v) })} />
              <Select label="Mensajes de muerte" value={getStr(team, 'DeathMessageVisibility', 'always')} options={VISIBILITY}
                onChange={(v) => editTeam((t) => { t.DeathMessageVisibility = str(v) })} />
              <Select label="Empujarse (colisiones)" value={getStr(team, 'CollisionRule', 'always')} options={COLLISION}
                onChange={(v) => editTeam((t) => { t.CollisionRule = str(v) })} />
            </div>

            <Field label={`Miembros (${playersOf(team).length})`} hint="Escribe uno o varios nombres separados por comas o espacios. Un jugador solo puede estar en un equipo.">
              <form onSubmit={(e) => { e.preventDefault(); addMembers() }} className="flex gap-2">
                <input value={memberDraft} onChange={(e) => setMemberDraft(e.target.value)} placeholder="Notch, jeb_"
                  className="flex-1 min-w-0 bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60" />
                <button type="submit" disabled={!memberDraft.trim()} className="px-3 rounded-lg bg-accent text-white text-sm disabled:opacity-40">Añadir</button>
              </form>
              {note && <p className="text-xs text-amber-400 mt-1.5">{note}</p>}
              <div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {playersOf(team).map((p) => (
                  <div key={p} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg bg-bg-card border border-border min-w-0">
                    <Head name={p} size={24} />
                    <span className="text-sm text-text-primary truncate flex-1" title={p}>{p}</span>
                    <button type="button" title="Quitar del equipo"
                      onClick={() => editTeam((t) => { t.Players = stringList(playersOf(t).filter((x) => x !== p)) })}
                      className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400">✕</button>
                  </div>
                ))}
              </div>
            </Field>

            <div className="flex gap-2 pt-2 border-t border-border flex-wrap">
              <button type="button"
                onClick={() => {
                  let n = 2
                  const base = nameOf(team)
                  while (teams.some((t) => nameOf(t) === `${base}${n}`)) n++
                  const copyName = `${base}${n}`
                  mutate((r) => {
                    const all = listOf(r, 'Teams')
                    const src = all.find((x) => nameOf(x) === base)
                    if (src) all.push({ ...structuredClone(src), Name: str(copyName), Players: stringList([]) })
                  })
                  setSelected(copyName)
                }}
                className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary">Duplicar (sin miembros)</button>
              <button type="button"
                onClick={() => {
                  const name = nameOf(team)
                  mutate((r) => setList(r, 'Teams', listOf(r, 'Teams').filter((x) => nameOf(x) !== name)))
                  setSelected(null)
                }}
                className="px-3 py-1.5 rounded-lg border border-red-500/40 text-sm text-red-400 hover:bg-red-500/10">Borrar equipo</button>
            </div>
          </>
        )} />

      {renaming !== null && (
        <NameDialog title="Renombrar equipo" current={renaming} taken={teams.map(nameOf)}
          note="Los comandos y plugins que usen el nombre anterior dejarán de encontrarlo."
          onCancel={() => setRenaming(null)}
          onOk={(to) => {
            const from = renaming
            mutate((r) => { const t = listOf(r, 'Teams').find((x) => nameOf(x) === from); if (t) t.Name = str(to) })
            setSelected(to)
            setRenaming(null)
          }} />
      )}

      {creating && (
        <Dialog onClose={() => setCreating(null)}>
          <form onSubmit={(e) => { e.preventDefault(); create() }} className="space-y-3">
            <h3 className="text-sm font-bold text-text-primary">Nuevo equipo</h3>
            <Field label="Nombre interno">
              <input autoFocus value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value, error: undefined })}
                placeholder="vip" className={inputCls} />
            </Field>
            <Field label="Prefijo" hint="Escríbelo con formato o usa los botones de colores.">
              <McTextInput value={creating.prefix} onChange={(v) => setCreating({ ...creating, prefix: v })} placeholder="&5&l[VIP] "
                previewAfter={[{ text: 'Steve', color: creating.color !== 'reset' ? creating.color : undefined }]} />
            </Field>
            <Field label="Color del nombre">
              <ColorPicker value={creating.color} onChange={(c) => setCreating({ ...creating, color: c })} />
            </Field>
            {creating.error && <p className="text-xs text-red-400">{creating.error}</p>}
            <DialogButtons onCancel={() => setCreating(null)} ok="Crear" />
          </form>
        </Dialog>
      )}
    </>
  )
}

// ═══ Objetivos ══════════════════════════════════════════════════════════════

const CRITERIA_PRESETS: [string, string][] = [
  ['dummy', 'Manual (dummy): solo cambia con comandos'],
  ['trigger', 'Trigger: lo cambian los jugadores con /trigger'],
  ['deathCount', 'Muertes'],
  ['playerKillCount', 'Jugadores matados'],
  ['totalKillCount', 'Criaturas matadas'],
  ['health', 'Vida (solo lectura)'],
  ['food', 'Comida (solo lectura)'],
  ['air', 'Aire (solo lectura)'],
  ['armor', 'Armadura (solo lectura)'],
  ['xp', 'Experiencia (solo lectura)'],
  ['level', 'Nivel (solo lectura)']
]
const STAT_TYPES: [string, string][] = [
  ['minecraft.custom', 'Estadística general'], ['minecraft.mined', 'Bloques picados'], ['minecraft.crafted', 'Objetos fabricados'],
  ['minecraft.used', 'Objetos usados'], ['minecraft.broken', 'Herramientas rotas'], ['minecraft.picked_up', 'Objetos recogidos'],
  ['minecraft.dropped', 'Objetos tirados'], ['minecraft.killed', 'Criaturas matadas (de un tipo)'], ['minecraft.killed_by', 'Muertes por (un tipo)']
]
const CUSTOM_STATS = [
  'play_time', 'deaths', 'mob_kills', 'player_kills', 'jump', 'walk_one_cm', 'sprint_one_cm', 'fly_one_cm', 'swim_one_cm',
  'time_since_death', 'time_since_rest', 'damage_dealt', 'damage_taken', 'fish_caught', 'animals_bred', 'leave_game',
  'sneak_time', 'open_chest', 'traded_with_villager', 'enchant_item', 'sleep_in_bed', 'talked_to_villager'
]

type CriteriaKind = 'preset' | 'team' | 'stat' | 'other'
function criteriaKind(c: string): CriteriaKind {
  if (CRITERIA_PRESETS.some(([v]) => v === c)) return 'preset'
  if (/^(teamkill|killedByTeam)\./.test(c)) return 'team'
  if (/^minecraft\.[a-z_]+:/.test(c)) return 'stat'
  return 'other'
}

function CriteriaPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const kind = criteriaKind(value)
  const [statType, statId] = kind === 'stat' ? value.split(':') : ['minecraft.custom', 'minecraft.play_time']
  const [teamKind, teamColor] = kind === 'team' ? value.split('.') : ['teamkill', 'red']
  return (
    <div className="space-y-2">
      <div className="flex rounded-lg border border-border overflow-hidden w-fit flex-wrap">
        {([['preset', 'Básico'], ['stat', 'Estadística'], ['team', 'De equipo'], ['other', 'Escribir']] as [CriteriaKind, string][]).map(([k, l]) => (
          <button key={k} type="button"
            onClick={() => onChange(k === 'preset' ? 'dummy' : k === 'stat' ? 'minecraft.custom:minecraft.play_time' : k === 'team' ? 'teamkill.red' : value)}
            className={`px-2.5 py-1 text-xs ${kind === k ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}>{l}</button>
        ))}
      </div>
      {kind === 'preset' && <Select label="" value={value} options={CRITERIA_PRESETS} onChange={onChange} />}
      {kind === 'stat' && (
        <div className="flex gap-2 flex-wrap">
          <select value={statType} onChange={(e) => onChange(`${e.target.value}:${statId}`)} className={`${selectCls} flex-1 min-w-[160px]`}>
            {STAT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input list="mc-custom-stats" value={statId.replace(/^minecraft\./, '')}
            onChange={(e) => onChange(`${statType}:minecraft.${e.target.value.replace(/^minecraft[.:]/, '').trim()}`)}
            placeholder={statType === 'minecraft.custom' ? 'play_time' : statType === 'minecraft.killed' || statType === 'minecraft.killed_by' ? 'zombie' : 'diamond_ore'}
            className={`${inputCls} flex-1 min-w-[140px] font-mono`} />
          <datalist id="mc-custom-stats">{statType === 'minecraft.custom' && CUSTOM_STATS.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
      )}
      {kind === 'team' && (
        <div className="flex gap-2 flex-wrap items-center">
          <select value={teamKind} onChange={(e) => onChange(`${e.target.value}.${teamColor}`)} className={selectCls}>
            <option value="teamkill">Mató a alguien del equipo…</option>
            <option value="killedByTeam">Le mató alguien del equipo…</option>
          </select>
          <ColorPicker value={teamColor} onChange={(c) => onChange(`${teamKind}.${c}`)} small />
        </div>
      )}
      {kind === 'other' && <input value={value} onChange={(e) => onChange(e.target.value.trim())} className={`${inputCls} font-mono`} />}
      <p className="text-[11px] text-text-muted font-mono">{value}</p>
    </div>
  )
}

/** Cómo se muestran los números: normal, ocultos, un texto fijo o con otro color. */
function NumberFormatEditor({ tag, onChange }: { tag: NbtTag | undefined; onChange: (t: NbtTag | undefined) => void }) {
  const f = tag?.type === 'compound' ? (tag.value as Compound) : null
  const type = f ? getStr(f, 'type') : 'default'
  const style = f?.style?.type === 'compound' ? (f.style.value as Compound) : {}
  return (
    <div className="space-y-2">
      <select value={type} className={selectCls}
        onChange={(e) => {
          const t = e.target.value
          if (t === 'default') onChange(undefined)
          else if (t === 'blank') onChange(compound({ type: str('blank') }))
          else if (t === 'fixed') onChange(compound({ type: str('fixed'), value: writeText('&e★', true) }))
          else onChange(compound({ type: str('styled'), style: compound({ color: str('yellow') }) }))
        }}>
        <option value="default">Número normal (rojo)</option>
        <option value="styled">Número de otro color</option>
        <option value="fixed">Un texto fijo en vez del número</option>
        <option value="blank">Ocultar el número</option>
      </select>
      {type === 'fixed' && f && (
        <McTextInput compact value={readText(f.value)} onChange={(codes) => onChange(compound({ ...f, value: writeText(codes, true) }))} placeholder="&e★" />
      )}
      {type === 'styled' && f && (
        <div className="flex gap-2 items-center flex-wrap">
          <ColorPicker small value={getStr(style, 'color', 'red')} onChange={(c) => onChange(compound({ ...f, style: compound({ ...style, color: str(c) }) }))} />
          <label className="flex items-center gap-1 text-xs text-text-secondary">
            <input type="checkbox" checked={getBool(style, 'bold')} onChange={(e) => onChange(compound({ ...f, style: compound({ ...style, bold: byte(e.target.checked) }) }))} />
            Negrita
          </label>
        </div>
      )}
    </div>
  )
}

function Objectives({ mutate, objectives, scores, modern }: Shared) {
  const [selected, setSelected] = useState<string | null>(objectives[0] ? nameOf(objectives[0]) : null)
  const [creating, setCreating] = useState<{ name: string; criteria: string; display: string; error?: string } | null>(null)
  const [scoreSearch, setScoreSearch] = useState('')
  const [newScore, setNewScore] = useState({ name: '', score: '0' })
  const [expanded, setExpanded] = useState<string | null>(null)
  const obj = objectives.find((o) => nameOf(o) === selected) ?? null

  const objScores = useMemo(() => {
    const q = scoreSearch.trim().toLowerCase()
    return scores
      .filter((s) => getStr(s, 'Objective') === selected && (!q || nameOf(s).toLowerCase().includes(q)))
      .sort((a, b) => getNum(b, 'Score') - getNum(a, 'Score'))
  }, [scores, selected, scoreSearch])

  function editObj(fn: (o: Compound) => void, coalesce?: string): void {
    mutate((r) => { const o = listOf(r, 'Objectives').find((x) => nameOf(x) === selected); if (o) fn(o) }, coalesce)
  }
  function editScore(player: string, fn: (s: Compound) => void, coalesce?: string): void {
    mutate((r) => {
      const all = listOf(r, 'PlayerScores')
      let s = all.find((x) => nameOf(x) === player && getStr(x, 'Objective') === selected)
      if (!s) { s = { Name: str(player), Objective: str(selected!), Score: int(0), Locked: byte(1) }; all.push(s) }
      fn(s)
    }, coalesce)
  }

  function create(): void {
    if (!creating) return
    const name = creating.name.trim()
    if (!VALID_ID.test(name)) { setCreating({ ...creating, error: 'Solo letras, números y _ . + - (sin espacios)' }); return }
    if (objectives.some((o) => nameOf(o) === name)) { setCreating({ ...creating, error: 'Ya existe' }); return }
    mutate((r) => {
      listOf(r, 'Objectives').push({
        Name: str(name),
        CriteriaName: str(creating.criteria),
        DisplayName: writeText(creating.display || name, modern),
        RenderType: str('integer'),
        display_auto_update: byte(0)
      })
    })
    setSelected(name)
    setCreating(null)
  }

  const isTrigger = obj && getStr(obj, 'CriteriaName') === 'trigger'

  return (
    <>
      <SplitView
        list={<>
          <div className="p-2 border-b border-border">
            <button type="button" onClick={() => setCreating({ name: '', criteria: 'dummy', display: '' })}
              className="w-full py-1.5 rounded-lg bg-accent/15 text-accent text-sm font-medium hover:bg-accent/25">＋ Nuevo objetivo</button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {objectives.map((o) => {
              const name = nameOf(o)
              return (
                <button key={name} type="button" onClick={() => setSelected(name)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg border ${selected === name ? 'border-accent/60 bg-accent/10' : 'border-transparent hover:bg-bg-hover'}`}>
                  <McTextPreview segments={parseCodes(readText(o.DisplayName))} empty={name} className="text-sm truncate block" />
                  <p className="text-[11px] text-text-muted truncate">{name} · {getStr(o, 'CriteriaName')}</p>
                </button>
              )
            })}
            {objectives.length === 0 && <p className="text-xs text-text-muted text-center py-6">No hay objetivos</p>}
          </div>
        </>}
        detail={!obj ? (
          <p className="text-sm text-text-muted text-center py-10">Elige un objetivo o crea uno nuevo.</p>
        ) : (
          <>
            <Field label="Nombre interno"><span className="font-mono text-sm text-text-primary break-all">{nameOf(obj)}</span></Field>
            <Field label="Nombre visible" hint="El título que sale en la barra lateral o en la lista.">
              <McTextInput value={readText(obj.DisplayName)} placeholder="&e&lPuntos"
                onChange={(codes) => editObj((o) => { o.DisplayName = writeText(codes, modern) }, 'objdisplay')} />
            </Field>
            <Field label="Qué cuenta" hint="Con «Manual» los puntos solo cambian con comandos; el resto se cuentan solos.">
              <CriteriaPicker value={getStr(obj, 'CriteriaName', 'dummy')} onChange={(v) => editObj((o) => { o.CriteriaName = str(v) }, 'criteria')} />
            </Field>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              <Select label="Cómo se muestra en la lista (Tab)" value={getStr(obj, 'RenderType', 'integer')}
                options={[['integer', 'Números'], ['hearts', 'Corazones']]}
                onChange={(v) => editObj((o) => { o.RenderType = str(v) })} />
              <Toggle label="Actualizar nombres solos" hint="Si un jugador cambia de nombre visible, se actualiza aquí"
                value={getBool(obj, 'display_auto_update')} onChange={(v) => editObj((o) => { o.display_auto_update = byte(v) })} />
            </div>
            <Field label="Cómo se ven los números" hint="En la barra lateral y bajo el nombre (1.20.3 o más nueva).">
              <NumberFormatEditor tag={obj.format} onChange={(t) => editObj((o) => { if (t) o.format = t; else delete o.format })} />
            </Field>

            <Field label={`Puntuaciones (${objScores.length})`}
              hint={isTrigger ? 'Con el candado abierto, ese jugador puede usar /trigger una vez (el juego lo vuelve a cerrar al usarlo).' : undefined}>
              <div className="flex gap-2 flex-wrap mb-2">
                <input value={scoreSearch} onChange={(e) => setScoreSearch(e.target.value)} placeholder="Buscar jugador…"
                  className={`${inputCls} w-40 flex-none`} />
                <form className="flex gap-1.5 flex-wrap" onSubmit={(e) => {
                  e.preventDefault()
                  const n = newScore.name.trim()
                  if (!n || !/^-?\d+$/.test(newScore.score.trim())) return
                  editScore(n, (s) => { s.Score = int(Number(newScore.score)) })
                  setNewScore({ name: '', score: '0' })
                }}>
                  <input value={newScore.name} onChange={(e) => setNewScore({ ...newScore, name: e.target.value })} placeholder="Jugador o #falso"
                    className={`${inputCls} w-36 flex-none`} />
                  <input value={newScore.score} onChange={(e) => setNewScore({ ...newScore, score: e.target.value })}
                    className={`${inputCls} w-20 flex-none`} />
                  <button type="submit" className="px-3 rounded-lg bg-accent text-white text-sm">Añadir</button>
                </form>
              </div>
              <div className="space-y-1">
                {objScores.slice(0, 500).map((s) => {
                  const player = nameOf(s)
                  const open = expanded === player
                  const locked = getBool(s, 'Locked', true)
                  return (
                    <div key={player} className="rounded-lg bg-bg-card border border-border">
                      <div className="group flex items-center gap-2 px-2 py-1 flex-wrap">
                        <Head name={player} />
                        <span className="flex-1 min-w-[80px] text-sm text-text-primary truncate" title={player}>{player}</span>
                        {s.display && <McTextPreview segments={parseCodes(readText(s.display))} className="text-xs truncate max-w-[120px]" />}
                        <NumberCell value={getNum(s, 'Score')} onCommit={(v) => editScore(player, (x) => { x.Score = int(v) }, `score:${player}`)} />
                        {isTrigger && (
                          <button type="button" title={locked ? 'No puede usar /trigger (clic para permitir)' : 'Puede usar /trigger'}
                            onClick={() => editScore(player, (x) => { x.Locked = byte(!locked) })} className="w-6 text-center">{locked ? '🔒' : '🔓'}</button>
                        )}
                        <button type="button" title="Más opciones" onClick={() => setExpanded(open ? null : player)} className="w-6 text-text-muted hover:text-text-primary">{open ? '▴' : '▾'}</button>
                        <button type="button" title="Quitar"
                          onClick={() => mutate((r) => setList(r, 'PlayerScores', listOf(r, 'PlayerScores').filter((x) => !(nameOf(x) === player && getStr(x, 'Objective') === selected))))}
                          className="w-6 text-text-muted hover:text-red-400">✕</button>
                      </div>
                      {open && (
                        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border">
                          <Field label="Nombre que se muestra en vez del suyo" hint="Solo en este objetivo (1.20.3 o más nueva). Útil para jugadores falsos (#líneas de texto).">
                            <McTextInput compact value={readText(s.display)} placeholder="&aTexto de la barra lateral"
                              onChange={(codes) => editScore(player, (x) => { if (codes) x.display = writeText(codes, true); else delete x.display }, `sdisplay:${player}`)} />
                          </Field>
                          <Field label="Cómo se ve su número">
                            <NumberFormatEditor tag={s.format} onChange={(t) => editScore(player, (x) => { if (t) x.format = t; else delete x.format })} />
                          </Field>
                        </div>
                      )}
                    </div>
                  )
                })}
                {objScores.length > 500 && <p className="text-xs text-text-muted">Se muestran 500; usa la búsqueda.</p>}
              </div>
            </Field>

            <button type="button"
              onClick={() => {
                const name = selected!
                mutate((r) => {
                  setList(r, 'Objectives', listOf(r, 'Objectives').filter((x) => nameOf(x) !== name))
                  setList(r, 'PlayerScores', listOf(r, 'PlayerScores').filter((x) => getStr(x, 'Objective') !== name))
                  const d = dataOf(r)
                  if (d.DisplaySlots?.type === 'compound') {
                    const slots = d.DisplaySlots.value as Compound
                    for (const k of Object.keys(slots)) if (slots[k]?.value === name) delete slots[k]
                  }
                })
                setSelected(null)
              }}
              className="px-3 py-1.5 rounded-lg border border-red-500/40 text-sm text-red-400 hover:bg-red-500/10">Borrar objetivo y sus puntos</button>
          </>
        )} />

      {creating && (
        <Dialog onClose={() => setCreating(null)}>
          <form onSubmit={(e) => { e.preventDefault(); create() }} className="space-y-3">
            <h3 className="text-sm font-bold text-text-primary">Nuevo objetivo</h3>
            <Field label="Nombre interno">
              <input autoFocus value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value, error: undefined })}
                placeholder="muertes" className={inputCls} />
            </Field>
            <Field label="Qué cuenta"><CriteriaPicker value={creating.criteria} onChange={(v) => setCreating({ ...creating, criteria: v })} /></Field>
            <Field label="Nombre visible">
              <McTextInput value={creating.display} onChange={(v) => setCreating({ ...creating, display: v })} placeholder="&c&lMuertes" />
            </Field>
            {creating.error && <p className="text-xs text-red-400">{creating.error}</p>}
            <DialogButtons onCancel={() => setCreating(null)} ok="Crear" />
          </form>
        </Dialog>
      )}
    </>
  )
}

// ═══ Jugadores: todo lo de cada uno junto ═══════════════════════════════════

function Players({ mutate, teams, objectives, scores, holders }: Shared) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState('')
  const q = search.trim().toLowerCase()
  const list = holders.filter((h) => !q || h.toLowerCase().includes(q))

  const teamOf = (p: string): Compound | undefined => teams.find((t) => playersOf(t).includes(p))
  const scoreOf = (p: string, obj: string): Compound | undefined => scores.find((s) => nameOf(s) === p && getStr(s, 'Objective') === obj)

  function setTeam(player: string, teamName: string): void {
    mutate((r) => {
      for (const t of listOf(r, 'Teams')) {
        const members = playersOf(t)
        const isTarget = nameOf(t) === teamName
        if (isTarget && !members.includes(player)) t.Players = stringList([...members, player])
        else if (!isTarget && members.includes(player)) t.Players = stringList(members.filter((m) => m !== player))
      }
    })
  }

  function setScore(player: string, obj: string, value: number | null): void {
    mutate((r) => {
      const all = listOf(r, 'PlayerScores')
      const i = all.findIndex((x) => nameOf(x) === player && getStr(x, 'Objective') === obj)
      if (value === null) { if (i >= 0) all.splice(i, 1); return }
      if (i >= 0) all[i].Score = int(value)
      else all.push({ Name: str(player), Objective: str(obj), Score: int(value), Locked: byte(1) })
    }, `pscore:${player}:${obj}`)
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <div className="flex gap-2 flex-wrap">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar jugador…" className={`${inputCls} w-48 flex-none`} />
        <form className="flex gap-1.5" onSubmit={(e) => {
          e.preventDefault()
          const n = adding.trim()
          if (!n || !objectives[0]) return
          setScore(n, nameOf(objectives[0]), 0)
          setAdding('')
          setOpen(n)
        }}>
          <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Añadir jugador" className={`${inputCls} w-40 flex-none`} />
          <button type="submit" disabled={!objectives.length} title={objectives.length ? '' : 'Crea antes un objetivo'}
            className="px-3 rounded-lg bg-accent text-white text-sm disabled:opacity-40">Añadir</button>
        </form>
      </div>
      <p className="text-[11px] text-text-muted">Todos los que tienen puntos o están en un equipo. Los que empiezan por # son jugadores falsos (se usan para textos y contadores).</p>
      {list.map((p) => {
        const t = teamOf(p)
        const isOpen = open === p
        return (
          <div key={p} className="rounded-lg bg-bg-card border border-border">
            <button type="button" onClick={() => setOpen(isOpen ? null : p)} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left">
              <Head name={p} size={24} />
              <span className="text-sm text-text-primary truncate flex-1 min-w-0">{p}</span>
              {t && <span className="text-xs px-2 py-0.5 rounded-full border border-border truncate max-w-[40%]" title="Equipo">
                <McTextPreview segments={parseCodes(readText(t.DisplayName))} empty={nameOf(t)} />
              </span>}
              <span className="text-text-muted">{isOpen ? '▴' : '▾'}</span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border">
                <Select label="Equipo" value={t ? nameOf(t) : ''} options={[['', '(sin equipo)'], ...teams.map((x) => [nameOf(x), nameOf(x)] as [string, string])]}
                  onChange={(v) => setTeam(p, v)} />
                <div className="space-y-1">
                  <p className="text-xs text-text-muted">Puntos</p>
                  {objectives.map((o) => {
                    const sc = scoreOf(p, nameOf(o))
                    return (
                      <div key={nameOf(o)} className="flex items-center gap-2 flex-wrap">
                        <McTextPreview segments={parseCodes(readText(o.DisplayName))} empty={nameOf(o)} className="text-sm flex-1 min-w-[100px] truncate" />
                        {sc ? (
                          <>
                            <NumberCell value={getNum(sc, 'Score')} onCommit={(v) => setScore(p, nameOf(o), v)} />
                            <button type="button" title="Quitar este punto" onClick={() => setScore(p, nameOf(o), null)} className="text-text-muted hover:text-red-400 w-5">✕</button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setScore(p, nameOf(o), 0)} className="text-xs text-accent hover:underline">＋ añadir</button>
                        )}
                      </div>
                    )
                  })}
                  {objectives.length === 0 && <p className="text-xs text-text-muted">No hay objetivos.</p>}
                </div>
                <button type="button"
                  onClick={() => mutate((r) => {
                    setList(r, 'PlayerScores', listOf(r, 'PlayerScores').filter((x) => nameOf(x) !== p))
                    for (const tm of listOf(r, 'Teams')) tm.Players = stringList(playersOf(tm).filter((m) => m !== p))
                  })}
                  className="px-3 py-1 rounded-lg border border-red-500/40 text-xs text-red-400 hover:bg-red-500/10">Quitar del scoreboard (puntos y equipo)</button>
              </div>
            )}
          </div>
        )
      })}
      {list.length === 0 && <p className="text-sm text-text-muted text-center py-8">No hay jugadores</p>}
    </div>
  )
}

// ═══ Pantalla: dónde se ve cada objetivo ════════════════════════════════════

/** Nombres de los huecos: modernos desde la 1.20.2, numéricos (slot_N) antes. */
const MAIN_SLOTS = [
  { modern: 'sidebar', legacy: 'slot_1', label: 'Barra lateral (para todos)' },
  { modern: 'list', legacy: 'slot_0', label: 'Lista de jugadores (Tab)' },
  { modern: 'below_name', legacy: 'slot_2', label: 'Bajo el nombre' }
]

function DisplaySlots({ root, mutate, objectives, scores }: Shared) {
  const data = dataOf(root)
  const slots = data.DisplaySlots?.type === 'compound' ? (data.DisplaySlots.value as Compound) : {}
  const legacy = Object.keys(slots).some((k) => k.startsWith('slot_'))
  const [preview, setPreview] = useState<string>(legacy ? 'slot_1' : 'sidebar')

  const keyFor = (modern: string, legacyKey: string): string => (legacy ? legacyKey : modern)
  // Barras laterales solo para un equipo: slot_3…slot_18 en el formato antiguo, en el orden de los colores
  const teamSlots = MC_COLORS.map((c, i) => ({ key: legacy ? `slot_${3 + i}` : `sidebar.team.${c.name}`, color: c }))

  const current = (key: string): string => (slots[key]?.type === 'string' ? (slots[key]!.value as string) : '')
  const setSlot = (key: string, obj: string): void => { mutate((r) => {
    const d = dataOf(r)
    if (!d.DisplaySlots || d.DisplaySlots.type !== 'compound') d.DisplaySlots = compound({})
    const s = d.DisplaySlots.value as Compound
    if (obj) s[key] = str(obj)
    else delete s[key]
  }) }
  const options: [string, string][] = [['', '(nada)'], ...objectives.map((o) => [nameOf(o), plainText(readText(o.DisplayName)) || nameOf(o)] as [string, string])]

  // Vista previa de la barra lateral como en el juego
  const previewObj = objectives.find((o) => nameOf(o) === current(preview))
  const lines = previewObj
    ? scores.filter((s) => getStr(s, 'Objective') === nameOf(previewObj)).sort((a, b) => getNum(b, 'Score') - getNum(a, 'Score')).slice(0, 15)
    : []
  const fmt = previewObj?.format?.type === 'compound' ? (previewObj.format.value as Compound) : null

  return (
    <div className="flex-1 overflow-y-auto p-4 flex gap-6 flex-wrap items-start">
      <div className="flex-1 min-w-[260px] space-y-4">
        <div className="space-y-2">
          {MAIN_SLOTS.map((s) => {
            const key = keyFor(s.modern, s.legacy)
            return (
              <div key={key} className="flex items-end gap-2">
                <div className="flex-1"><Select label={s.label} value={current(key)} options={options} onChange={(v) => setSlot(key, v)} /></div>
                {key.includes('sidebar') || key === 'slot_1'
                  ? <button type="button" onClick={() => setPreview(key)} className={`h-9 px-2 rounded-lg border text-xs ${preview === key ? 'border-accent text-accent' : 'border-border text-text-muted'}`}>ver</button>
                  : <span className="w-[42px]" />}
              </div>
            )
          })}
        </div>
        <Field label="Barra lateral solo para un equipo" hint="Lo que ven en la barra lateral los miembros de los equipos de ese color, en vez de la general.">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {teamSlots.map(({ key, color }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-4 h-4 rounded border border-black/40 shrink-0" style={{ background: color.hex }} title={color.label} />
                <select value={current(key)} onChange={(e) => setSlot(key, e.target.value)} className={`${selectCls} flex-1 min-w-0`}>
                  {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button type="button" onClick={() => setPreview(key)} className={`text-xs ${preview === key ? 'text-accent' : 'text-text-muted'}`}>ver</button>
              </div>
            ))}
          </div>
        </Field>
      </div>

      {/* Vista previa */}
      <div className="w-56 shrink-0">
        <p className="text-xs text-text-muted mb-1.5">Así se ve la barra lateral</p>
        <div className="bg-[#3a4a3a] rounded-lg p-4 flex justify-end" style={{ backgroundImage: 'linear-gradient(135deg,#4a6a4a,#2a3a4a)' }}>
          {previewObj ? (
            <div className="min-w-[120px] text-[13px] font-mono">
              <div className="px-2 py-0.5 text-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
                <McTextPreview segments={parseCodes(readText(previewObj.DisplayName))} empty={nameOf(previewObj)} />
              </div>
              <div className="px-2 py-0.5" style={{ background: 'rgba(0,0,0,0.3)' }}>
                {lines.length === 0 && <p className="text-white/50 text-xs">(sin puntos)</p>}
                {lines.map((s) => {
                  const own = s.format?.type === 'compound' ? (s.format.value as Compound) : fmt
                  const t = own ? getStr(own, 'type') : 'default'
                  const numSegs: McSegment[] = t === 'blank' ? [] : t === 'fixed' ? parseCodes(readText(own!.value))
                    : [{ text: String(getNum(s, 'Score')), color: t === 'styled' && own?.style?.type === 'compound' ? getStr(own.style.value as Compound, 'color', 'red') : 'red' }]
                  return (
                    <div key={nameOf(s)} className="flex justify-between gap-4 whitespace-nowrap">
                      <McTextPreview segments={s.display ? parseCodes(readText(s.display)) : [{ text: nameOf(s) }]} />
                      <McTextPreview segments={numSegs} />
                    </div>
                  )
                })}
              </div>
            </div>
          ) : <p className="text-xs text-white/60">No hay nada en este hueco</p>}
        </div>
      </div>
    </div>
  )
}

// ── Piezas ──────────────────────────────────────────────────────────────────

const inputCls = 'w-full bg-bg-primary border border-border rounded-lg px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60'
const selectCls = 'bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary'

function ColorPicker({ value, onChange, allowReset, small }: { value: string; onChange: (c: string) => void; allowReset?: boolean; small?: boolean }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {allowReset && (
        <button type="button" onClick={() => onChange('reset')}
          className={`h-7 px-2 rounded-md border text-xs ${value === 'reset' ? 'border-accent text-text-primary' : 'border-border text-text-muted'}`}>Sin color</button>
      )}
      {MC_COLORS.map((c) => (
        <button key={c.name} type="button" title={c.label} onClick={() => onChange(c.name)}
          className={`${small ? 'w-5 h-5' : 'w-7 h-7'} rounded-md border-2 ${value === c.name ? 'border-white' : 'border-black/40'}`} style={{ background: c.hex }} />
      ))}
    </div>
  )
}

function Dialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-10 bg-black/50 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md max-h-full overflow-y-auto bg-bg-secondary border border-border rounded-2xl p-5 shadow-2xl">{children}</div>
    </div>
  )
}

function DialogButtons({ onCancel, ok }: { onCancel: () => void; ok: string }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-border text-sm text-text-secondary">Cancelar</button>
      <button type="submit" className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium">{ok}</button>
    </div>
  )
}

function NameDialog({ title, current, taken, note, onOk, onCancel }: {
  title: string; current: string; taken: string[]; note?: string; onOk: (v: string) => void; onCancel: () => void
}) {
  const [value, setValue] = useState(current)
  const [error, setError] = useState('')
  return (
    <Dialog onClose={onCancel}>
      <form onSubmit={(e) => {
        e.preventDefault()
        const v = value.trim()
        if (v === current) { onCancel(); return }
        if (!VALID_ID.test(v)) { setError('Solo letras, números y _ . + - (sin espacios)'); return }
        if (taken.includes(v)) { setError('Ese nombre ya está en uso'); return }
        onOk(v)
      }} className="space-y-3">
        <h3 className="text-sm font-bold text-text-primary">{title}</h3>
        <input autoFocus value={value} onChange={(e) => { setValue(e.target.value); setError('') }} className={inputCls} />
        {note && <p className="text-[11px] text-text-muted">{note}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <DialogButtons onCancel={onCancel} ok="Renombrar" />
      </form>
    </Dialog>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold text-text-secondary">{label}</p>
      {hint && <p className="text-[11px] text-text-muted mb-1.5">{hint}</p>}
      <div className={hint ? '' : 'mt-1.5'}>{children}</div>
    </div>
  )
}

export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-bg-card border border-border text-left min-w-0">
      <span className="min-w-0">
        <span className="block text-sm text-text-primary">{label}</span>
        {hint && <span className="block text-[11px] text-text-muted">{hint}</span>}
      </span>
      <span className={`relative w-10 h-5 rounded-full shrink-0 transition-colors ${value ? 'bg-accent' : 'bg-border'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${value ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

export function Select({ label, value, options, onChange }: {
  label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (v: string) => void
}) {
  return (
    <label className="block min-w-0">
      {label && <span className="text-xs text-text-muted">{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className={`${label ? 'mt-1' : ''} w-full bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary`}>
        {!options.some(([v]) => v === value) && <option value={value}>{value}</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

/** Número que se confirma al salir del campo o con Enter (no a cada tecla). */
export function NumberCell({ value, onCommit, width = 'w-24' }: { value: number; onCommit: (v: number) => void; width?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft === null) return
    const n = Number(draft.replace(',', '.'))
    if (draft.trim() !== '' && Number.isFinite(n) && n !== value) onCommit(n)
    setDraft(null)
  }
  return (
    <input value={draft ?? String(value)} inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') setDraft(null) }}
      className={`${width} min-w-0 bg-bg-primary border border-border rounded-md px-2 py-1 text-sm text-text-primary text-right tabular-nums outline-none focus:border-accent/60`} />
  )
}
