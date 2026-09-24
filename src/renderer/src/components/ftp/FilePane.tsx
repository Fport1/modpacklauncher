import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { FtpConnectionState, LocalEntry, RemoteEntry, ServerInfo } from '../../../../shared/types'
import { isTextFile } from '../../lib/monacoLanguage'
import FileIcon from '../FileIcon'
import ServerContentPanel, { type Slot } from '../ServerContentPanel'
import TextEditor from './TextEditor'
import ImageViewer from './ImageViewer'
import NbtFileView, { type NbtKind } from './NbtFileView'
import PropertiesFileView from './PropertiesFileView'
import type { CloseRequest } from './EditorShell'
import {
  type Side, type Entry, type SortKey, type DragPayload, type FileKind, type LogKind,
  MAX_EDIT_BYTES, PLAYER_FILE, formatBytes, formatDate, remoteJoin, remoteParent, localJoin, joinFor,
  errText, typingIn, fileKindOf, baseNameOf
} from './shared'

// Un cuadro del gestor de servidores: "Este equipo" o el servidor.
//
// Es autónomo (su carpeta, historial, selección, deshacer y el archivo que
// tenga abierto) para poder vivir en la ventana principal o en una ventana
// propia. Lo que necesita del otro cuadro (a qué carpeta subir o descargar,
// qué se está arrastrando) lo pregunta al proceso principal, que lo comparte
// entre ventanas.

/** Lo que el que contiene el cuadro puede pedirle (los botones laterales del ratón). */
export interface PaneApi {
  nav: (direction: 'back' | 'forward') => boolean
}

interface Props {
  side: Side
  conn: FtpConnectionState
  focused: boolean
  onFocus: () => void
  apiRef: MutableRefObject<PaneApi | null>
  /** true si el cuadro está en su propia ventana. */
  detached: boolean
  downloadsDir: string
}

type UndoOp =
  | { kind: 'rename'; dir: string; from: string; to: string }
  | { kind: 'mkdir'; dir: string; name: string }

interface OpenFile {
  kind: FileKind
  name: string
  path: string
  dir: string
  playerName?: string
}

const log = (kind: LogKind, text: string): void => { window.api.ftp.log(kind, text) }

export default function FilePane({ side, conn, focused, onFocus, apiRef, detached, downloadsDir }: Props) {
  const remote = side === 'remote'
  const disabled = remote && !conn.connected

  // ── Estado de la carpeta ──
  const [dir, setDir] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<string[]>([])
  const [index, setIndex] = useState(-1)
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true })
  const [filter, setFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  // ── Varios ──
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; names: string[] } | null>(null)
  const [confirm, setConfirm] = useState<{ text: string; action: () => void; danger?: boolean } | null>(null)
  const [prompt, setPrompt] = useState<{ title: string; value: string; onOk: (v: string) => void } | null>(null)
  const [arrived, setArrived] = useState<Set<string>>(new Set())
  const [undoStack, setUndoStack] = useState<UndoOp[]>([])
  const [redoStack, setRedoStack] = useState<UndoOp[]>([])
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  const [incoming, setIncoming] = useState<DragPayload | null>(null)
  const [draggingOwn, setDraggingOwn] = useState<Set<string> | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [otherDirs, setOtherDirs] = useState<{ local: string; remote: string }>({ local: '', remote: '' })
  const [downloadTarget, setDownloadTarget] = useState<'downloads' | 'local'>('downloads')
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const [asFiles, setAsFiles] = useState(false)
  const [searchFocus, setSearchFocus] = useState(0)

  const closeRef = useRef<CloseRequest | null>(null)
  const state = useRef({ dir, entries, selected, index, history, openFile })
  state.current = { dir, entries, selected, index, history, openFile }

  const join = (d: string, n: string): string => joinFor(side, d, n)

  // ── Abrir carpetas, con historial propio ──
  /**
   * `record` = navegación nueva (entrar, subir un nivel, escribir la ruta):
   * se apunta en el historial del cuadro y se descarta lo que hubiera por
   * delante, como en un navegador. Atrás, adelante y recargar no apuntan.
   */
  async function openDir(target: string, record = true): Promise<boolean> {
    setLoading(true)
    try {
      const list = remote ? await window.api.ftp.list(target) : await window.api.ftp.localList(target)
      setEntries(list)
      setDir(target)
      setSelected(new Set())
      setAsFiles(false)
      if (record) {
        const { history: h, index: i } = state.current
        if (h[i] !== target) {
          const next = [...h.slice(0, i + 1), target]
          setHistory(next)
          setIndex(next.length - 1)
        }
      }
      window.api.ftp.paneDirSet(side, target)
      return true
    } catch (e) {
      log('error', `No se pudo abrir ${target}: ${errText(e)}`)
      return false
    } finally {
      setLoading(false)
    }
  }

  const reload = (): void => { if (state.current.dir) openDir(state.current.dir, false) }

  function historyStep(delta: -1 | 1): void {
    const { history: h, index: i } = state.current
    const next = i + delta
    if (next < 0 || next >= h.length) return
    setIndex(next)
    openDir(h[next], false)
  }

  async function goUp(): Promise<void> {
    const parent = remote ? remoteParent(dir) : await window.api.ftp.localParent(dir)
    if (parent !== dir) openDir(parent)
  }

  function flash(names: string[]): void {
    setArrived(new Set(names))
    setTimeout(() => setArrived(new Set()), 2500)
  }

  // Carpeta inicial y cambios de conexión
  useEffect(() => {
    if (remote) return
    ;(async () => {
      const dirs = await window.api.ftp.paneDirs()
      openDir(dirs.local || await window.api.ftp.localStart())
    })()
  }, [])

  useEffect(() => {
    if (!remote) return
    if (!conn.connected) {
      if (!conn.reconnecting) { setEntries([]); setSelected(new Set()); setServerInfo(null) }
      return
    }
    ;(async () => {
      // Donde se estaba (si se viene de otra ventana o se ha reconectado), si no, la raíz
      if (!(await openDir(conn.cwd || conn.root))) await openDir(conn.root)
    })()
    window.api.ftp.serverDetect(conn.root).then(setServerInfo).catch(() => setServerInfo(null))
  }, [remote, conn.connected, conn.siteId, conn.label, conn.root])

  // Lo que pasa en las otras ventanas
  useEffect(() => {
    window.api.ftp.paneDirs().then(setOtherDirs)
    const offDirs = window.api.ftp.onPaneDirs(setOtherDirs)
    const offChanged = window.api.ftp.onChanged((c) => {
      if (c.side === side && c.dir === state.current.dir) {
        openDir(c.dir, false).then(() => { if (c.names?.length) flash(c.names) })
      }
    })
    const offDrag = window.api.ftp.onDrag((p) => {
      const payload = p as DragPayload | null
      setIncoming(payload && payload.side !== side ? payload : null)
    })
    return () => { offDirs(); offChanged(); offDrag() }
  }, [side])

  // Atrás/adelante del ratón: primero cierra el archivo abierto, luego recorre carpetas
  apiRef.current = {
    nav: (direction) => {
      if (state.current.openFile) {
        closeRef.current?.(() => setOpenFile(null))
        return true
      }
      historyStep(direction === 'back' ? -1 : 1)
      return true
    }
  }

  // ── Operaciones con deshacer ──
  async function doRename(d: string, from: string, to: string): Promise<void> {
    if (remote) await window.api.ftp.rename(remoteJoin(d, from), remoteJoin(d, to))
    else await window.api.ftp.localRename(localJoin(d, from), localJoin(d, to))
  }
  async function doMkdir(d: string, name: string): Promise<void> {
    if (remote) await window.api.ftp.mkdir(remoteJoin(d, name))
    else await window.api.ftp.localMkdir(localJoin(d, name))
  }
  async function doRemoveDir(d: string, name: string): Promise<void> {
    if (remote) await window.api.ftp.remove(remoteJoin(d, name), true)
    else await window.api.ftp.localTrash(localJoin(d, name))
  }
  function record(op: UndoOp): void {
    setUndoStack((s) => [...s.slice(-49), op])
    setRedoStack([])
  }

  async function commitRename(): Promise<void> {
    const from = renaming
    const to = renameValue.trim()
    setRenaming(null)
    if (!from || !to || to === from) return
    try {
      await doRename(dir, from, to)
      record({ kind: 'rename', dir, from, to })
      log('ok', `Renombrado ${from} → ${to}`)
      await openDir(dir, false)
      flash([to])
    } catch (e) {
      log('error', `Error al renombrar: ${errText(e)}`)
    }
  }

  function startRename(name: string): void {
    setRenaming(name)
    setRenameValue(name)
  }

  function newFolder(): void {
    if (disabled) return
    const d = dir
    setPrompt({
      title: 'Nombre de la carpeta nueva',
      value: '',
      onOk: async (name) => {
        const clean = name.trim()
        if (!clean) return
        try {
          await doMkdir(d, clean)
          record({ kind: 'mkdir', dir: d, name: clean })
          log('ok', `Carpeta creada: ${clean}`)
          await openDir(d, false)
          flash([clean])
        } catch (e) {
          log('error', `Error al crear la carpeta: ${errText(e)}`)
        }
      }
    })
  }

  function removeSelection(names: string[]): void {
    if (names.length === 0 || disabled) return
    const d = dir
    const list = entries
    const what = names.length === 1 ? `"${names[0]}"` : `${names.length} elementos`
    setConfirm({
      danger: true,
      text: remote
        ? `¿Borrar ${what} del servidor? No se puede deshacer.`
        : `¿Enviar ${what} a la papelera? Se puede recuperar desde la papelera del sistema.`,
      action: async () => {
        setBusy(true)
        for (const name of names) {
          const entry = list.find((x) => x.name === name)
          try {
            if (remote) await window.api.ftp.remove(remoteJoin(d, name), entry?.isDir ?? false)
            else await window.api.ftp.localTrash(localJoin(d, name))
            log('ok', remote ? `Borrado ${name}` : `${name} enviado a la papelera`)
          } catch (e) {
            log('error', `Error al borrar ${name}: ${errText(e)}`)
          }
        }
        setBusy(false)
        await openDir(d, false)
      }
    })
  }

  async function undo(): Promise<void> {
    const op = undoStack[undoStack.length - 1]
    if (!op) { log('info', 'No hay nada que deshacer'); return }
    try {
      if (op.kind === 'rename') await doRename(op.dir, op.to, op.from)
      else await doRemoveDir(op.dir, op.name)
      setUndoStack((s) => s.slice(0, -1))
      setRedoStack((s) => [...s, op])
      log('info', op.kind === 'rename' ? `Deshecho: ${op.to} vuelve a llamarse ${op.from}` : `Deshecho: carpeta ${op.name} eliminada`)
      if (state.current.dir === op.dir) await openDir(op.dir, false)
    } catch (e) {
      log('error', `No se pudo deshacer: ${errText(e)}`)
    }
  }

  async function redo(): Promise<void> {
    const op = redoStack[redoStack.length - 1]
    if (!op) { log('info', 'No hay nada que rehacer'); return }
    try {
      if (op.kind === 'rename') await doRename(op.dir, op.from, op.to)
      else await doMkdir(op.dir, op.name)
      setRedoStack((s) => s.slice(0, -1))
      setUndoStack((s) => [...s, op])
      log('info', op.kind === 'rename' ? `Rehecho: ${op.from} → ${op.to}` : `Rehecho: carpeta ${op.name} creada`)
      if (state.current.dir === op.dir) await openDir(op.dir, false)
    } catch (e) {
      log('error', `No se pudo rehacer: ${errText(e)}`)
    }
  }

  // ── Transferencias (hacia el otro cuadro, esté en la ventana que esté) ──

  /** Sube rutas locales a una carpeta del servidor. */
  async function uploadPaths(paths: string[], toDir: string): Promise<void> {
    if (!conn.connected || paths.length === 0 || !toDir) return
    const names = paths.map(baseNameOf)
    const existing = await window.api.ftp.list(toDir).catch(() => [] as RemoteEntry[])
    const clash = names.filter((n) => existing.some((r) => r.name === n))
    const run = async (): Promise<void> => {
      setBusy(true)
      for (const p of paths) {
        try {
          await window.api.ftp.upload(p, toDir)
          log('ok', `Subido ${baseNameOf(p)} → ${toDir}`)
        } catch (e) {
          log('error', `Error al subir ${baseNameOf(p)}: ${errText(e)}`)
        }
      }
      setBusy(false)
      window.api.ftp.notifyChanged({ side: 'remote', dir: toDir, names })
    }
    if (clash.length > 0) setConfirm({ text: `Ya existe en el servidor: ${clash.join(', ')}. ¿Sobrescribir?`, action: run })
    else await run()
  }

  /** Descarga elementos del servidor a una carpeta de este equipo. */
  async function downloadEntries(fromDir: string, items: Entry[], toDir: string): Promise<void> {
    if (!conn.connected || items.length === 0 || !toDir) return
    const existing = await window.api.ftp.localList(toDir).catch(() => [] as LocalEntry[])
    const clash = items.filter((i) => existing.some((l) => l.name === i.name)).map((i) => i.name)
    const run = async (): Promise<void> => {
      setBusy(true)
      for (const item of items) {
        try {
          const saved = await window.api.ftp.download(remoteJoin(fromDir, item.name), toDir, item as RemoteEntry)
          log('ok', `Descargado ${item.name} en ${toDir}`)
          void saved
        } catch (e) {
          log('error', `Error al descargar ${item.name}: ${errText(e)}`)
        }
      }
      setBusy(false)
      window.api.ftp.notifyChanged({ side: 'local', dir: toDir, names: items.map((i) => i.name) })
    }
    if (clash.length > 0) setConfirm({ text: `Ya existe en ${toDir}: ${clash.join(', ')}. ¿Sobrescribir?`, action: run })
    else await run()
  }

  const downloadDest = downloadTarget === 'downloads' ? downloadsDir : otherDirs.local
  const sendSelection = (names: string[]): void => {
    const items = entries.filter((e) => names.includes(e.name))
    if (remote) downloadEntries(dir, items, downloadDest)
    else uploadPaths(items.map((i) => localJoin(dir, i.name)), otherDirs.remote)
  }

  // ── Arrastrar y soltar (también entre ventanas y desde el explorador) ──
  function onDragStart(name: string, e: React.DragEvent): void {
    const names = selected.has(name) ? [...selected] : [name]
    const payload: DragPayload = { side, dir, names, entries: entries.filter((x) => names.includes(x.name)) }
    e.dataTransfer.setData('application/x-ftp', '1')
    e.dataTransfer.effectAllowed = 'copy'
    setDraggingOwn(new Set(names))
    window.api.ftp.dragSet(payload)
  }
  function onDragEnd(): void {
    setDraggingOwn(null)
    window.api.ftp.dragSet(null)
  }
  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    // Archivos soltados desde el explorador del sistema
    const osFiles = [...e.dataTransfer.files].map((f) => (f as File & { path?: string }).path).filter((p): p is string => !!p)
    if (osFiles.length > 0 && !e.dataTransfer.types.includes('application/x-ftp')) {
      if (remote) uploadPaths(osFiles, dir)
      return
    }
    const payload = (await window.api.ftp.dragGet()) as DragPayload | null
    window.api.ftp.dragSet(null)
    if (!payload || payload.side === side) return
    if (remote) uploadPaths(payload.names.map((n) => localJoin(payload.dir, n)), dir)
    else downloadEntries(payload.dir, payload.entries, dir)
  }

  // ── Abrir un elemento ──
  async function openEntry(entry: Entry): Promise<void> {
    if (entry.isDir) { openDir(join(dir, entry.name)); return }
    const kind = fileKindOf(entry.name, isTextFile)
    if (!kind) {
      log('info', `${entry.name} no se puede abrir aquí; usa el clic derecho para ${remote ? 'descargarlo' : 'subirlo o mostrarlo'}.`)
      return
    }
    if ((kind === 'text' || kind === 'properties') && entry.size > MAX_EDIT_BYTES) {
      log('error', `${entry.name} es demasiado grande para editarlo aquí (más de 5 MB).`)
      return
    }
    const file: OpenFile = { kind, name: entry.name, path: join(dir, entry.name), dir }
    setOpenFile(file)
    if (kind === 'playerdata') {
      const name = await playerNameFor(entry.name)
      if (name) setOpenFile((f) => (f && f.path === file.path ? { ...f, playerName: name } : f))
    }
  }

  /** El nombre del jugador de un <uuid>.dat, sacado de usercache.json del servidor. */
  async function playerNameFor(fileName: string): Promise<string | null> {
    const uuid = PLAYER_FILE.exec(fileName)?.[1]?.toLowerCase()
    if (!uuid) return null
    const candidates: string[] = []
    if (remote) {
      candidates.push(remoteJoin(conn.root, 'usercache.json'))
      // <mundo>/playerdata → la carpeta del servidor está dos niveles arriba
      candidates.push(remoteJoin(remoteParent(remoteParent(dir)), 'usercache.json'))
    } else {
      const world = await window.api.ftp.localParent(dir)
      const up1 = await window.api.ftp.localParent(world)
      candidates.push(localJoin(up1, 'usercache.json'), localJoin(await window.api.ftp.localParent(up1), 'usercache.json'))
    }
    for (const c of [...new Set(candidates)]) {
      const text = await window.api.ftp.readOptional(side, c, 'text')
      if (!text) continue
      try {
        const hit = (JSON.parse(text) as { name: string; uuid: string }[]).find((u) => u.uuid.toLowerCase() === uuid)
        if (hit) return hit.name
      } catch { /* usercache.json roto: sin nombre */ }
    }
    return null
  }

  function closeFile(): void {
    setOpenFile(null)
    reload()
  }

  // ── Selección ──
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : [...entries]
    const d = sort.asc ? 1 : -1
    return list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      if (sort.key === 'size') return (a.size - b.size) * d || a.name.localeCompare(b.name)
      if (sort.key === 'modified') return ((a.modified ?? 0) - (b.modified ?? 0)) * d || a.name.localeCompare(b.name)
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) * d
    })
  }, [entries, filter, sort])

  function clickEntry(name: string, e: React.MouseEvent): void {
    const names = visible.map((x) => x.name)
    let next: Set<string>
    if (e.shiftKey && selected.size > 0) {
      // Rango desde el último seleccionado, como en cualquier explorador
      const last = [...selected].pop()!
      const [a, b] = [names.indexOf(last), names.indexOf(name)].sort((x, y) => x - y)
      next = new Set(names.slice(a, b + 1))
    } else if (e.ctrlKey || e.metaKey) {
      next = new Set(selected)
      if (next.has(name)) next.delete(name)
      else next.add(name)
    } else {
      next = new Set([name])
    }
    setSelected(next)
  }

  // ── Teclado (solo con el cuadro activo y ningún archivo abierto) ──
  useEffect(() => {
    if (!focused || openFile) return
    const onKey = (e: KeyboardEvent): void => {
      if (confirm || prompt) return
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (ctrl && key === 'f') { e.preventDefault(); setSearchOpen(true); setSearchFocus((n) => n + 1); return }
      if (typingIn(e.target)) return
      if (e.key === 'F5') { e.preventDefault(); reload(); return }
      if (ctrl && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
      if (disabled) return
      if (ctrl && key === 'a') { e.preventDefault(); setSelected(new Set(entries.map((x) => x.name))) }
      else if (e.key === 'Delete') { e.preventDefault(); removeSelection([...selected]) }
      else if (e.key === 'F2' && selected.size === 1) { e.preventDefault(); startRename([...selected][0]) }
      else if (e.key === 'Enter' && selected.size === 1) {
        e.preventDefault()
        const entry = entries.find((x) => selected.has(x.name))
        if (entry) openEntry(entry)
      } else if (e.key === 'Backspace') { e.preventDefault(); goUp() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Clic fuera: cerrar el menú
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent): void => { if (!(e.target as HTMLElement).closest('[data-context-menu]')) setMenu(null) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  // ── Menú contextual ──
  function openMenu(e: React.MouseEvent, name?: string): void {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    onFocus()
    let names: string[] = []
    if (name) {
      // Clic derecho sobre algo no seleccionado: pasa a ser la selección
      names = selected.has(name) ? [...selected] : [name]
      if (!selected.has(name)) setSelected(new Set([name]))
    }
    setMenu({ x: e.clientX, y: e.clientY, names })
  }

  type MenuItem = { label: string; icon: string; run: () => void; danger?: boolean; disabled?: boolean } | 'sep'
  const menuItems = ((): MenuItem[] => {
    if (!menu) return []
    const { names } = menu
    const single = names.length === 1 ? entries.find((x) => x.name === names[0]) : undefined
    const items: MenuItem[] = []
    const count = names.length > 1 ? ` (${names.length})` : ''
    if (single) {
      const kind = single.isDir ? null : fileKindOf(single.name, isTextFile)
      if (single.isDir) items.push({ label: 'Abrir', icon: '📂', run: () => openEntry(single) })
      else if (kind === 'image') items.push({ label: 'Ver imagen', icon: '🖼', run: () => openEntry(single) })
      else if (kind === 'scoreboard') items.push({ label: 'Editar equipos y puntos', icon: '⚑', run: () => openEntry(single) })
      else if (kind === 'playerdata') items.push({ label: 'Editar jugador', icon: '☺', run: () => openEntry(single) })
      else if (kind === 'level') items.push({ label: 'Editar mundo (hora, reglas…)', icon: '🌍', run: () => openEntry(single) })
      else if (kind === 'properties') items.push({ label: 'Editar opciones del servidor', icon: '⚙', run: () => openEntry(single) })
      else if (kind === 'nbt') items.push({ label: 'Editar NBT', icon: '⌬', run: () => openEntry(single) })
      else if (kind === 'text') items.push({ label: 'Editar', icon: '✎', run: () => openEntry(single) })
    }
    if (names.length > 0) {
      if (remote) items.push({ label: `Descargar${count}`, icon: '⬇', run: () => sendSelection(names), disabled: !downloadDest })
      else {
        items.push({ label: `Subir al servidor${count}`, icon: '⬆', run: () => sendSelection(names), disabled: !conn.connected || !otherDirs.remote })
        if (single) items.push({ label: 'Mostrar en el explorador', icon: '🗂', run: () => window.api.ftp.localReveal(localJoin(dir, single.name)) })
      }
      if (single) {
        items.push({ label: 'Renombrar', icon: '✏', run: () => startRename(single.name) })
        items.push({ label: 'Copiar ruta', icon: '⧉', run: () => navigator.clipboard.writeText(join(dir, single.name)) })
      }
      items.push({ label: remote ? `Borrar${count}` : `Enviar a la papelera${count}`, icon: '🗑', danger: true, run: () => removeSelection(names) })
      items.push('sep')
    }
    items.push({ label: 'Carpeta nueva', icon: '＋', run: newFolder })
    items.push({ label: 'Recargar', icon: '⟳', run: reload })
    if (!remote && names.length === 0) items.push({ label: 'Abrir esta carpeta en el explorador', icon: '🗂', run: () => window.api.ftp.localReveal(dir) })
    return items
  })()

  // ── Vista de mods/plugins al abrir su carpeta ──
  const contentSlot: Slot | null = remote && serverInfo && !openFile
    ? serverInfo.mods?.folder === dir ? 'mods' : serverInfo.plugins?.folder === dir ? 'plugins' : null
    : null
  // Carpeta llamada mods/plugins en un servidor que no se ha reconocido: se ofrece igual
  const guessedSlot: Slot | null = remote && !contentSlot && !openFile && /(^|\/)(mods|plugins)$/.test(dir)
    && serverInfo && !serverInfo.mods && !serverInfo.plugins ? (dir.endsWith('mods') ? 'mods' : 'plugins') : null
  const [forceGuess, setForceGuess] = useState(false)
  useEffect(() => { setForceGuess(false) }, [dir])
  const showContent = (contentSlot || (guessedSlot && forceGuess)) && !asFiles

  const title = remote ? (conn.connected ? conn.label : 'Servidor') : 'Este equipo'
  const canBack = index > 0
  const canForward = index < history.length - 1
  const dropLabel = incoming && !disabled
    ? remote ? `Suelta para subir ${incoming.names.length === 1 ? incoming.names[0] : `${incoming.names.length} elementos`} al servidor`
      : `Suelta para descargar ${incoming.names.length === 1 ? incoming.names[0] : `${incoming.names.length} elementos`} aquí`
    : null

  return (
    <div
      data-pane={side}
      onMouseDown={onFocus}
      className={`relative flex-1 min-w-0 min-h-0 flex flex-col bg-bg-secondary rounded-2xl overflow-hidden transition-all duration-150 border-2 ${
        focused ? 'border-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.25)]' : dragOver ? 'border-accent' : 'border-border'
      }`}
      onDragOver={(e) => { if (!disabled && !openFile) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
      onDrop={(e) => { if (!openFile) onDrop(e) }}
    >
      {/* Cabecera */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-1.5">
        <span className={`text-sm font-semibold truncate min-w-0 ${focused ? 'text-green-400' : 'text-text-primary'}`}>{title}</span>
        {remote && conn.kind === 'assist' && conn.connected && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 shrink-0">asistencia</span>}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <NavBtn title="Atrás" onClick={() => historyStep(-1)} disabled={disabled || !canBack || !!openFile}>←</NavBtn>
          <NavBtn title="Adelante" onClick={() => historyStep(1)} disabled={disabled || !canForward || !!openFile}>→</NavBtn>
          <NavBtn title="Subir un nivel (Retroceso)" onClick={goUp} disabled={disabled || !!openFile}>↑</NavBtn>
          <NavBtn title="Buscar (Ctrl+F)" onClick={() => { setSearchOpen(!searchOpen); setFilter('') }} disabled={disabled || !!openFile} active={searchOpen}>⌕</NavBtn>
          <NavBtn title="Recargar (F5)" onClick={reload} disabled={disabled}>⟳</NavBtn>
          <span className="w-px h-5 bg-border mx-0.5" />
          {detached ? (
            <NavBtn title="Devolver este cuadro a la ventana del launcher" onClick={() => window.api.ftp.paneClose(side)}>↙</NavBtn>
          ) : (
            <NavBtn title="Sacar este cuadro a otra ventana" onClick={() => window.api.ftp.paneOpen(side)}>⧉</NavBtn>
          )}
        </div>
      </div>

      {/* Aviso de conexión perdida */}
      {remote && (conn.lost || conn.reconnecting) && (
        <div className={`px-3 py-2 text-xs flex items-center gap-2 border-b ${conn.reconnecting ? 'bg-amber-500/10 text-amber-300 border-amber-500/20' : 'bg-red-500/10 text-red-300 border-red-500/30'}`}>
          {conn.reconnecting ? '⟳ Se cortó la conexión. Reconectando…' : `⚠ Se perdió la conexión${conn.reason ? ` (${conn.reason})` : ''}.`}
          {!conn.reconnecting && conn.kind === 'site' && (
            <button type="button" onClick={() => window.api.ftp.reconnect()} className="ml-auto px-2.5 py-1 rounded-md bg-red-500/80 text-white font-medium">Reconectar</button>
          )}
        </div>
      )}

      {openFile ? (
        <FileView file={openFile} remote={remote} conn={conn} closeRef={closeRef} onClose={closeFile} />
      ) : (
        <>
          {/* Ruta, atajos y búsqueda */}
          <div className="px-3 py-2 border-b border-border space-y-2">
            <PathBar dir={dir} disabled={disabled} onGo={(d) => openDir(d)}
              extra={!remote && (
                <button type="button" title="Elegir carpeta con el explorador"
                  onClick={async () => { const d = await window.api.ftp.pickLocalDir(dir); if (d) openDir(d) }}
                  className="px-3 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-accent/60 font-bold tracking-widest">…</button>
              )} />
            <div className="flex items-center gap-1.5 flex-wrap">
              {remote ? (
                <>
                  <QuickBtn onClick={() => openDir(conn.root)} disabled={disabled}>⌂ Inicio del servidor</QuickBtn>
                  {serverInfo?.mods && <QuickBtn onClick={() => openDir(serverInfo.mods!.folder)} disabled={disabled}>Mods</QuickBtn>}
                  {serverInfo?.plugins && <QuickBtn onClick={() => openDir(serverInfo.plugins!.folder)} disabled={disabled}>Plugins</QuickBtn>}
                  <QuickBtn onClick={newFolder} disabled={disabled}>＋ Carpeta nueva</QuickBtn>
                </>
              ) : (
                <>
                  <QuickBtn onClick={async () => openDir(await window.api.ftp.localStart())}>Instancias</QuickBtn>
                  <QuickBtn onClick={() => { if (downloadsDir) openDir(downloadsDir) }}>Descargas</QuickBtn>
                  <QuickBtn onClick={async () => openDir(await window.api.ftp.localHome())}>Personal</QuickBtn>
                  <QuickBtn onClick={newFolder}>＋ Carpeta nueva</QuickBtn>
                </>
              )}
            </div>
            {searchOpen && (
              <SearchBox value={filter} focusKey={searchFocus} onChange={setFilter} onClose={() => { setSearchOpen(false); setFilter('') }} />
            )}
          </div>

          {showContent && serverInfo ? (
            <ServerContentPanel
              info={contentSlot ? serverInfo : {
                ...serverInfo, label: 'Servidor no reconocido',
                mods: guessedSlot === 'mods' ? { loaders: '', folder: dir } : null,
                plugins: guessedSlot === 'plugins' ? { loaders: '', folder: dir } : null
              }}
              slot={(contentSlot ?? guessedSlot)!}
              host={conn.label}
              onLog={log}
              onRedetect={() => window.api.ftp.serverDetect(conn.root, true).then(setServerInfo).catch(() => {})}
              onShowFiles={() => setAsFiles(true)}
            />
          ) : (
            <>
              {(contentSlot || guessedSlot) && (
                <div className="px-3 py-1.5 text-xs flex items-center gap-2 bg-accent/10 border-b border-accent/20">
                  <span className="text-text-secondary">{(contentSlot ?? guessedSlot) === 'mods' ? 'Carpeta de mods del servidor.' : 'Carpeta de plugins del servidor.'}</span>
                  <button type="button" onClick={() => { setAsFiles(false); setForceGuess(true) }} className="text-accent font-medium hover:underline">
                    Ver como {(contentSlot ?? guessedSlot) === 'mods' ? 'mods' : 'plugins'} e instalar desde Modrinth
                  </button>
                </div>
              )}

              {/* Columnas ordenables */}
              <div className="grid grid-cols-[1fr_76px_118px] gap-2 px-3 py-1.5 text-xs text-text-muted border-b border-border select-none">
                {(['name', 'size', 'modified'] as SortKey[]).map((key) => (
                  <button key={key} type="button"
                    onClick={() => setSort({ key, asc: sort.key === key ? !sort.asc : key === 'name' })}
                    className={`${key === 'name' ? 'text-left' : 'text-right'} hover:text-text-primary`}>
                    {key === 'name' ? 'Nombre' : key === 'size' ? 'Tamaño' : 'Modificado'}
                    {sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : ''}
                  </button>
                ))}
              </div>

              {/* Lista */}
              <div className="flex-1 overflow-y-auto" onContextMenu={(e) => openMenu(e)}>
                {visible.length === 0 && (
                  <p className="text-sm text-text-muted text-center py-10 px-4">
                    {disabled ? 'Conéctate a un servidor para ver sus archivos' : loading ? 'Cargando…' : filter ? `Nada coincide con "${filter}"` : 'Carpeta vacía'}
                  </p>
                )}
                {visible.map((e) => {
                  const sel = selected.has(e.name)
                  const isRenaming = renaming === e.name
                  return (
                    <div key={e.name}
                      draggable={!isRenaming}
                      onDragStart={(ev) => onDragStart(e.name, ev)}
                      onDragEnd={onDragEnd}
                      onClick={(ev) => clickEntry(e.name, ev)}
                      onDoubleClick={() => openEntry(e)}
                      onContextMenu={(ev) => openMenu(ev, e.name)}
                      className={`grid grid-cols-[1fr_76px_118px] gap-2 px-3 py-1.5 text-[13px] cursor-default select-none transition-colors duration-700 ${
                        arrived.has(e.name) ? 'bg-green-500/25 text-green-200'
                          : sel ? (focused ? 'bg-green-500/20 text-text-primary' : 'bg-accent/15 text-text-primary')
                            : 'text-text-secondary hover:bg-bg-primary'
                      } ${draggingOwn?.has(e.name) ? 'opacity-40' : ''}`}>
                      <span className="flex items-center gap-2 min-w-0">
                        <FileIcon name={e.name} isDir={e.isDir} size={18} />
                        {isRenaming ? (
                          <input autoFocus value={renameValue} onChange={(ev) => setRenameValue(ev.target.value)}
                            onClick={(ev) => ev.stopPropagation()}
                            onKeyDown={(ev) => {
                              ev.stopPropagation()
                              if (ev.key === 'Enter') commitRename()
                              if (ev.key === 'Escape') setRenaming(null)
                            }}
                            onBlur={commitRename}
                            className="flex-1 bg-bg-primary border border-accent/60 rounded px-1.5 text-[13px] text-text-primary outline-none" />
                        ) : <span className="truncate">{e.name}</span>}
                      </span>
                      <span className="text-right tabular-nums text-text-muted">{e.isDir ? '' : formatBytes(e.size)}</span>
                      <span className="text-right text-text-muted text-xs self-center">{formatDate(e.modified)}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Pie */}
          <div className="px-3 py-2 border-t border-border flex items-center gap-2 flex-wrap">
            {remote ? (
              <>
                <label className="flex items-center gap-1.5 text-xs text-text-muted min-w-0" title={downloadDest}>
                  Descargar en
                  <select value={downloadTarget} onChange={(e) => setDownloadTarget(e.target.value as 'downloads' | 'local')}
                    className="bg-bg-primary border border-border rounded-md px-2 py-1 text-xs text-text-primary">
                    <option value="downloads">Descargas del launcher</option>
                    <option value="local">La carpeta abierta en «Este equipo»</option>
                  </select>
                  <button type="button" onClick={() => { if (downloadDest) window.api.ftp.localReveal(downloadDest) }}
                    className="text-accent hover:underline shrink-0">abrir</button>
                </label>
                <div className="ml-auto flex items-center gap-2">
                  <Btn primary onClick={() => sendSelection([...selected])} disabled={disabled || selected.size === 0 || busy || !downloadDest}>
                    ⬇ Descargar {selected.size > 0 ? `(${selected.size})` : ''}
                  </Btn>
                  <Btn danger onClick={() => removeSelection([...selected])} disabled={disabled || selected.size === 0 || busy}>🗑 Borrar</Btn>
                </div>
              </>
            ) : (
              <div className="ml-auto">
                <Btn primary onClick={() => sendSelection([...selected])} disabled={!conn.connected || selected.size === 0 || busy || !otherDirs.remote}>
                  ⬆ Subir al servidor {selected.size > 0 ? `(${selected.size})` : ''}
                </Btn>
              </div>
            )}
          </div>
        </>
      )}

      {/* Aviso grande al arrastrar desde el otro cuadro (aunque esté en otra ventana) */}
      {dropLabel && !openFile && (
        <div className={`absolute inset-0 z-10 flex items-center justify-center p-6 pointer-events-none transition-colors ${dragOver ? 'bg-accent/25' : 'bg-accent/10'}`}>
          <div className={`border-2 border-dashed rounded-2xl px-6 py-5 text-center transition-all ${dragOver ? 'border-accent scale-105 bg-bg-secondary/90' : 'border-accent/50 bg-bg-secondary/70'}`}>
            <p className="text-3xl mb-1">{dragOver ? '⬇' : '⇣'}</p>
            <p className="text-sm font-semibold text-text-primary">{dropLabel}</p>
          </div>
        </div>
      )}

      {/* Menú contextual */}
      {menu && (
        <div data-context-menu
          className="fixed z-50 min-w-[230px] bg-bg-secondary border border-border rounded-xl shadow-2xl py-1.5"
          style={{ left: Math.min(menu.x, window.innerWidth - 250), top: Math.max(8, Math.min(menu.y, window.innerHeight - 38 * menuItems.length - 16)) }}>
          {menuItems.map((item, i) => item === 'sep' ? (
            <div key={i} className="my-1 border-t border-border" />
          ) : (
            <button key={i} type="button" disabled={item.disabled}
              onClick={() => { setMenu(null); item.run() }}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left disabled:opacity-40 ${item.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-text-primary hover:bg-bg-hover'}`}>
              <span className="w-5 text-center">{item.icon}</span>{item.label}
            </button>
          ))}
        </div>
      )}

      {/* Nombre para carpeta nueva (Electron no implementa window.prompt) */}
      {prompt && (
        <Overlay onClose={() => setPrompt(null)} title={prompt.title}>
          <form onSubmit={(e) => { e.preventDefault(); const p = prompt; setPrompt(null); p.onOk(p.value) }} className="space-y-3">
            <input autoFocus value={prompt.value} onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
              className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/60" />
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setPrompt(null)}>Cancelar</Btn>
              <Btn primary type="submit" disabled={!prompt.value.trim()}>Crear</Btn>
            </div>
          </form>
        </Overlay>
      )}

      {confirm && (
        <Overlay onClose={() => setConfirm(null)} title="Confirmar">
          <p className="text-sm text-text-secondary">{confirm.text}</p>
          <div className="flex justify-end gap-2 mt-4">
            <Btn onClick={() => setConfirm(null)}>Cancelar</Btn>
            <Btn danger={confirm.danger} primary={!confirm.danger} onClick={() => { const a = confirm.action; setConfirm(null); a() }}>Sí, continuar</Btn>
          </div>
        </Overlay>
      )}
    </div>
  )
}

// ── El archivo abierto dentro del cuadro ─────────────────────────────────────

function FileView({ file, remote, conn, closeRef, onClose }: {
  file: OpenFile; remote: boolean; conn: FtpConnectionState
  closeRef: MutableRefObject<CloseRequest | null>; onClose: () => void
}) {
  const location = remote ? `${conn.label}:${file.path}` : file.path
  const readText = (): Promise<string> => (remote ? window.api.ftp.readText(file.path) : window.api.ftp.localReadText(file.path))
  const writeText = async (content: string): Promise<void> => {
    if (remote) await window.api.ftp.writeText(file.path, content)
    else await window.api.ftp.localWriteText(file.path, content)
    log('ok', `Guardado ${file.name}`)
  }

  if (file.kind === 'image') {
    return <ImageViewer name={file.name} location={location} closeRef={closeRef} onClose={onClose}
      load={() => (remote ? window.api.ftp.readImage(file.path) : window.api.ftp.localReadImage(file.path))} />
  }
  if (file.kind === 'text') {
    return <TextEditor name={file.name} location={location} closeRef={closeRef} onClose={onClose} load={readText} save={writeText} />
  }
  if (file.kind === 'properties') {
    const icon = joinFor(remote ? 'remote' : 'local', file.dir, 'server-icon.png')
    return <PropertiesFileView name={file.name} location={location} closeRef={closeRef} onClose={onClose} load={readText} save={writeText}
      loadIcon={() => window.api.ftp.readOptional(remote ? 'remote' : 'local', icon, 'image')}
      saveIcon={async (png) => {
        const side = remote ? 'remote' : 'local'
        if (png) await window.api.ftp.writeBytes(side, icon, png)
        else if (remote) await window.api.ftp.remove(icon, false)
        else await window.api.ftp.localTrash(icon)
        log('ok', png ? 'Icono del servidor actualizado' : 'Icono del servidor quitado')
        window.api.ftp.notifyChanged({ side, dir: file.dir, names: ['server-icon.png'] })
      }} />
  }
  const kind: NbtKind = file.kind === 'scoreboard' || file.kind === 'playerdata' || file.kind === 'level' ? file.kind : 'nbt'
  return (
    <NbtFileView name={file.name} location={location} kind={kind} remote={remote} playerName={file.playerName}
      closeRef={closeRef} onClose={onClose}
      load={() => (remote ? window.api.nbt.readRemote(file.path) : window.api.nbt.readLocal(file.path))}
      save={async (doc) => {
        if (remote) await window.api.nbt.writeRemote(file.path, doc)
        else await window.api.nbt.writeLocal(file.path, doc)
        log('ok', `Guardado ${file.name} (copia del anterior en ${file.name}.bak)`)
      }} />
  )
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function PathBar({ dir, disabled, onGo, extra }: { dir: string; disabled: boolean; onGo: (d: string) => void; extra?: React.ReactNode }) {
  const [draft, setDraft] = useState(dir)
  useEffect(() => { setDraft(dir) }, [dir])
  return (
    <form onSubmit={(e) => { e.preventDefault(); onGo(draft) }} className="flex gap-1.5">
      <input value={draft} onChange={(e) => setDraft(e.target.value)} disabled={disabled}
        className="flex-1 min-w-0 bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-text-secondary outline-none focus:border-accent/60 disabled:opacity-50" />
      {extra}
    </form>
  )
}

function SearchBox({ value, focusKey, onChange, onClose }: { value: string; focusKey: number; onChange: (v: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [focusKey])
  return (
    <input ref={ref} value={value} placeholder="Buscar en esta carpeta…"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      className="w-full bg-bg-primary border border-accent/50 rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none" />
  )
}

export function Btn({ children, onClick, disabled, primary, danger, type = 'button' }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; danger?: boolean; type?: 'button' | 'submit'
}) {
  const style = primary
    ? 'bg-accent text-white border-accent hover:bg-accent/85 shadow-sm'
    : danger ? 'border-red-500/50 text-red-400 hover:bg-red-500/15'
      : 'border-border text-text-secondary hover:text-text-primary hover:border-accent/60 hover:bg-bg-hover'
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`px-3.5 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${style}`}>
      {children}
    </button>
  )
}

function QuickBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="px-2.5 py-1 text-xs rounded-md border border-border text-text-secondary hover:text-text-primary hover:border-accent/60 disabled:opacity-40">
      {children}
    </button>
  )
}

function NavBtn({ children, onClick, title, disabled, active }: {
  children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean; active?: boolean
}) {
  return (
    <button type="button" onClick={onClick} title={title} disabled={disabled}
      className={`w-8 h-8 flex items-center justify-center rounded-lg text-base border transition-colors disabled:opacity-30 ${
        active ? 'border-accent/60 text-accent bg-accent/10' : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-primary hover:border-border'
      }`}>
      {children}
    </button>
  )
}

export function Overlay({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { e.stopPropagation(); onClose() }}>
      <div className="w-full max-w-md bg-bg-secondary border border-border rounded-2xl shadow-2xl p-5" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-text-primary mb-4">{title}</h2>
        {children}
      </div>
    </div>
  )
}
