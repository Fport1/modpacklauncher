import { Component, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import type { NbtDocument, NbtTag } from '../../../../shared/types'
import EditorShell, { useSaver, type CloseRequest } from './EditorShell'
import NbtTree from './NbtTree'
import ScoreboardSimple from './ScoreboardSimple'
import PlayerSimple from './PlayerSimple'
import LevelSimple from './LevelSimple'
import { errText, typingIn } from './shared'

// Un archivo NBT abierto dentro del cuadro. scoreboard.dat y los playerdata
// tienen además un modo sencillo; los dos modos trabajan sobre el mismo
// documento, así que se puede pasar de uno a otro sin guardar y sin perder
// nada, y Ctrl+Z deshace igual en los dos.

export type NbtKind = 'nbt' | 'scoreboard' | 'playerdata' | 'level'

interface Props {
  name: string
  location: string
  kind: NbtKind
  /** En archivos del servidor se avisa de que debe estar apagado. */
  remote?: boolean
  playerName?: string
  /** Aviso propio en vez del de servidor (p. ej. «cierra el juego antes de guardar»). */
  warning?: string
  load: () => Promise<NbtDocument>
  save: (doc: NbtDocument) => Promise<void>
  onClose: () => void
  closeRef?: MutableRefObject<CloseRequest | null>
}

export default function NbtFileView({ name, location, kind, remote, playerName, warning, load, save, onClose, closeRef }: Props) {
  const [doc, setDoc] = useState<NbtDocument | null>(null)
  const [savedRoot, setSavedRoot] = useState<NbtTag | null>(null)
  const [loadError, setLoadError] = useState('')
  const [past, setPast] = useState<NbtTag[]>([])
  const [future, setFuture] = useState<NbtTag[]>([])
  const [mode, setMode] = useState<'simple' | 'advanced'>(kind === 'nbt' ? 'advanced' : 'simple')
  const lastEdit = useRef<{ key: string; t: number } | null>(null)
  const docRef = useRef(doc)
  docRef.current = doc

  useEffect(() => {
    load().then((d) => { setDoc(d); setSavedRoot(d.root) }).catch((e) => setLoadError(errText(e)))
  }, [])

  const dirty = !!doc && doc.root !== savedRoot

  /**
   * Aplica un cambio sobre una copia. Los cambios seguidos del mismo campo
   * (escribir letra a letra un prefijo) cuentan como un solo paso de deshacer.
   */
  function mutate(fn: (root: NbtTag) => void, coalesce?: string): boolean {
    const current = docRef.current
    if (!current) return false
    const next = structuredClone(current.root) as NbtDocument['root']
    try {
      fn(next)
    } catch (e) {
      saver.setStatus({ kind: 'error', text: errText(e) })
      return false
    }
    const now = Date.now()
    const merge = !!coalesce && lastEdit.current?.key === coalesce && now - lastEdit.current.t < 1500
    lastEdit.current = coalesce ? { key: coalesce, t: now } : null
    if (!merge) setPast((p) => [...p.slice(-199), current.root])
    setFuture([])
    const updated = { ...current, root: next }
    docRef.current = updated
    setDoc(updated)
    return true
  }

  function undo(): void {
    if (!doc || past.length === 0) return
    lastEdit.current = null
    setFuture((f) => [...f, doc.root])
    setDoc({ ...doc, root: past[past.length - 1] as NbtDocument['root'] })
    setPast((p) => p.slice(0, -1))
  }
  function redo(): void {
    if (!doc || future.length === 0) return
    lastEdit.current = null
    setPast((p) => [...p, doc.root])
    setDoc({ ...doc, root: future[future.length - 1] as NbtDocument['root'] })
    setFuture((f) => f.slice(0, -1))
  }

  const saver = useSaver(async () => {
    const d = docRef.current!
    await save(d)
    setSavedRoot(d.root)
  }, `✓ Guardado. El archivo anterior queda como ${name}.bak`)

  const format = doc ? ` · NBT ${doc.compression === 'none' ? 'sin comprimir' : doc.compression}${doc.format === 'big' ? '' : ' · Bedrock'}` : ''

  return (
    <EditorShell title={name} subtitle={location + format} dirty={dirty} onSave={saver.run} saving={saver.saving}
      status={saver.status} onClose={onClose} closeRef={closeRef}
      hint={playerName && <span className="shrink-0 text-xs font-normal text-accent bg-accent/10 px-2 py-0.5 rounded-full">{playerName}</span>}
      onKeyDown={(e) => {
        if (typingIn(e.target) || !(e.ctrlKey || e.metaKey)) return
        const key = e.key.toLowerCase()
        if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
        else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
      }}
      headerExtra={
        <div className="flex items-center gap-1.5 shrink-0">
          <HeadBtn onClick={undo} disabled={past.length === 0} title="Deshacer (Ctrl+Z)">↶</HeadBtn>
          <HeadBtn onClick={redo} disabled={future.length === 0} title="Rehacer (Ctrl+Y)">↷</HeadBtn>
          {kind !== 'nbt' && (
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(['simple', 'advanced'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`px-2.5 h-8 text-xs ${mode === m ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}>
                  {m === 'simple' ? 'Sencillo' : 'Avanzado'}
                </button>
              ))}
            </div>
          )}
        </div>
      }
      banner={warning ? (
        <p className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-500/10 border-b border-amber-500/20">⚠ {warning}</p>
      ) : remote && (
        <p className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-500/10 border-b border-amber-500/20">
          ⚠ Guarda con el servidor apagado{kind === 'playerdata' ? ' o con el jugador desconectado' : ''}: si está encendido, sobrescribe estos cambios al guardar el mundo.
        </p>
      )}>
      {loadError ? (
        <p className="p-6 text-sm text-red-400">{loadError}</p>
      ) : !doc ? (
        <div className="flex-1 flex items-center justify-center"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
      ) : mode === 'advanced' || kind === 'nbt' ? (
        <NbtTree root={doc.root} mutate={mutate} />
      ) : (
        <SimpleBoundary onFail={() => setMode('advanced')}>
          {kind === 'scoreboard' ? <ScoreboardSimple root={doc.root} mutate={mutate} />
            : kind === 'level' ? <LevelSimple root={doc.root} mutate={mutate} playerName={playerName} />
              : <PlayerSimple root={doc.root} mutate={mutate} playerName={playerName} />}
        </SimpleBoundary>
      )}
    </EditorShell>
  )
}

/**
 * Si el archivo tiene una forma que el modo sencillo no espera (otra versión,
 * un mod que añade cosas…), no se rompe la ventana: se ofrece el avanzado.
 */
class SimpleBoundary extends Component<{ onFail: () => void; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown): { error: string } { return { error: e instanceof Error ? e.message : String(e) } }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-sm text-text-secondary">El modo sencillo no entiende este archivo ({this.state.error}).</p>
        <button type="button" onClick={this.props.onFail} className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm">Abrir en modo avanzado</button>
      </div>
    )
  }
}

function HeadBtn({ children, onClick, disabled, title }: { children: ReactNode; onClick: () => void; disabled?: boolean; title: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className="min-w-[30px] h-8 px-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary hover:border-accent/40 disabled:opacity-30">
      {children}
    </button>
  )
}
