import { useEffect, useMemo, useRef, useState } from 'react'
import type { RemoteEntry, ServerInfo, ServerJarMeta } from '../../../shared/types'
import ModrinthModal, { type ModrinthTarget } from './ModrinthModal'
import FileIcon from './FileIcon'

// Mods y plugins de un servidor, con el mismo aspecto que en las instancias y
// con el buscador de Modrinth filtrado a lo que ese servidor puede cargar.
// Aparece al abrir la carpeta mods/ o plugins/ en el cuadro del servidor.

export type Slot = 'mods' | 'plugins'

interface Props {
  info: ServerInfo
  slot: Slot
  host: string
  onLog: (kind: 'info' | 'ok' | 'error', text: string) => void
  /** Volver a mirar qué servidor es (tras corregirlo a mano, por ejemplo). */
  onRedetect: () => void
  /** Ver la carpeta como una lista de archivos normal. */
  onShowFiles: () => void
}

const MANUAL_OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: 'paper', label: 'Paper', hint: 'plugins' },
  { id: 'purpur', label: 'Purpur', hint: 'plugins' },
  { id: 'folia', label: 'Folia', hint: 'plugins' },
  { id: 'spigot', label: 'Spigot', hint: 'plugins' },
  { id: 'bukkit', label: 'Bukkit', hint: 'plugins' },
  { id: 'fabric', label: 'Fabric', hint: 'mods' },
  { id: 'quilt', label: 'Quilt', hint: 'mods' },
  { id: 'forge', label: 'Forge', hint: 'mods' },
  { id: 'neoforge', label: 'NeoForge', hint: 'mods' },
  { id: 'velocity', label: 'Velocity', hint: 'proxy' },
  { id: 'bungeecord', label: 'BungeeCord / Waterfall', hint: 'proxy' },
  { id: 'vanilla', label: 'Vanilla', hint: 'sin mods ni plugins' }
]

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '')
}

const join = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`)
const baseName = (f: string): string => f.replace(/\.disabled$/, '')
const isEnabled = (f: string): boolean => !f.endsWith('.disabled')

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / Math.pow(1024, i)
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export default function ServerContentPanel({ info, slot, host, onLog, onRedetect, onShowFiles }: Props) {
  const [jars, setJars] = useState<RemoteEntry[]>([])
  const [loadingJars, setLoadingJars] = useState(false)
  const [meta, setMeta] = useState<Record<string, ServerJarMeta>>({})
  const [identify, setIdentify] = useState<{ done: number; total: number } | null>(null)
  const [search, setSearch] = useState('')
  const [modrinth, setModrinth] = useState<{ projectId?: string } | null>(null)
  const [override, setOverride] = useState<{ loader: string; minecraft: string } | null>(null)
  const [warn, setWarn] = useState<{ title: string; resolve: (ok: boolean) => void } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const loadSeq = useRef(0)

  const current = slot === 'mods' ? info?.mods : info?.plugins
  const folder = current?.folder ?? ''

  // ── Contenido de la carpeta ──
  async function loadJars(): Promise<void> {
    if (!current || !info) { setJars([]); return }
    const seq = ++loadSeq.current
    setLoadingJars(true)
    setSelected(new Set())
    try {
      const list = await window.api.ftp.serverListJars(current.folder)
      if (seq !== loadSeq.current) return
      setJars(list)
      setLoadingJars(false)
      // Identificar con Modrinth en segundo plano: la primera vez hay que bajar
      // cada .jar para calcular su huella, luego va de memoria
      const found = await window.api.ftp.serverIdentify(current.folder, info.minecraft, current.loaders)
      if (seq !== loadSeq.current) return
      setMeta(found)
    } catch (e) {
      if (seq === loadSeq.current) onLog('error', `No se pudo leer ${current.folder}: ${errText(e)}`)
    } finally {
      if (seq === loadSeq.current) { setLoadingJars(false); setIdentify(null) }
    }
  }
  useEffect(() => { setMeta({}); loadJars() }, [info, slot])

  useEffect(() => window.api.ftp.onIdentifyProgress((p) => {
    if (p.folder !== folder) return
    setIdentify(p.total > 0 && p.done < p.total ? { done: p.done, total: p.total } : null)
  }), [folder])

  // ── Acciones ──
  async function toggle(name: string): Promise<void> {
    const to = isEnabled(name) ? `${name}.disabled` : baseName(name)
    try {
      await window.api.ftp.rename(join(folder, name), join(folder, to))
      setJars((list) => list.map((j) => (j.name === name ? { ...j, name: to } : j)))
      setMeta((m) => {
        if (!m[name]) return m
        const { [name]: moved, ...rest } = m
        return { ...rest, [to]: moved }
      })
      onLog('ok', `${isEnabled(name) ? 'Desactivado' : 'Activado'} ${baseName(name)}`)
    } catch (e) {
      onLog('error', `No se pudo cambiar ${name}: ${errText(e)}`)
    }
  }

  async function remove(names: string[]): Promise<void> {
    for (const name of names) {
      try {
        await window.api.ftp.remove(join(folder, name), false)
        onLog('ok', `Borrado ${name}`)
      } catch (e) {
        onLog('error', `No se pudo borrar ${name}: ${errText(e)}`)
      }
    }
    await loadJars()
  }

  // ── Destino para el buscador de Modrinth ──
  const target = useMemo((): ModrinthTarget | null => {
    if (!info || !current) return null
    return {
      label: `${info.label} · ${slot === 'mods' ? 'mods' : 'plugins'}`,
      minecraft: info.minecraft,
      loader: current.loaders,
      // En un servidor interesa lo que funciona en el servidor
      environment: slot === 'mods' ? 'server' : 'any',
      installedIds: async () => Object.values(meta).map((m) => m.projectId),
      confirm: async (projectId) => {
        if (slot !== 'mods') return true
        const project = await window.api.modrinth.getProject(projectId).catch(() => null)
        if (!project || project.server_side !== 'unsupported') return true
        return new Promise<boolean>((resolve) => setWarn({ title: project.title ?? 'Este mod', resolve }))
      },
      install: async (file) => {
        await window.api.ftp.serverInstall(file.url, file.filename, current.folder, file.hashes?.sha1)
        onLog('ok', `Instalado ${file.filename} en ${current.folder}`)
      },
      remove: async (filename) => {
        await window.api.ftp.remove(join(current.folder, filename), false)
      }
    }
  }, [info, current, slot, meta])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return jars
      .map((j) => ({ entry: j, meta: meta[j.name] }))
      .filter(({ entry, meta: m }) => !q || entry.name.toLowerCase().includes(q) || (m?.title ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.meta?.title || baseName(a.entry.name)).localeCompare(b.meta?.title || baseName(b.entry.name)))
  }, [jars, meta, search])

  const updates = rows.filter((r) => r.meta?.hasUpdate).length
  const clientOnly = rows.filter((r) => r.meta?.serverSide === 'unsupported' && isEnabled(r.entry.name))

  // ── Vista ──
  return (
    <div className="relative flex-1 flex flex-col gap-2 min-h-0 p-3">
      {/* Tipo de servidor */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="px-2 py-1 rounded-full bg-accent/15 text-accent font-medium" title={info.evidence.join('\n')}>
          {info.label}{info.manual ? ' (elegido a mano)' : ''}
        </span>
        <button type="button" onClick={() => setOverride({ loader: info.loader || 'paper', minecraft: info.minecraft })}
          className="text-text-muted hover:text-text-primary hover:underline">¿No es correcto?</button>
        <button type="button" onClick={onShowFiles}
          className="ml-auto px-2.5 py-1 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-accent/50">
          Ver como archivos
        </button>
      </div>

      {!info.minecraft && (
        <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          No se ha podido saber la versión de Minecraft del servidor (se lee de logs/latest.log, que aparece tras arrancarlo una vez).
          Sin ella el buscador no puede filtrar por versión: indícala en «¿No es correcto?».
        </p>
      )}

      {(
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          {/* Barra */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Buscar ${slot === 'mods' ? 'mods' : 'plugins'}…`}
                className="w-64 bg-bg-primary border border-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60" />
              <svg className="absolute left-2.5 top-2 text-text-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </div>
            <button type="button" onClick={loadJars} title="Recargar"
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-muted hover:text-text-primary bg-bg-primary">⟳</button>
            <span className="text-xs text-text-muted font-mono truncate" title={folder}>{host}:{folder}</span>
            <button type="button" onClick={() => setModrinth({})}
              className="ml-auto flex items-center gap-2 px-4 py-2 bg-green-500/15 hover:bg-green-500/25 text-green-400 rounded-lg text-sm font-semibold">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              Añadir {slot === 'mods' ? 'mods' : 'plugins'} desde Modrinth
            </button>
          </div>

          {identify && (
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <Spinner small />
              Identificando con Modrinth {identify.done}/{identify.total} (solo la primera vez: hay que leer cada archivo del servidor)
              <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden max-w-xs">
                <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${(identify.done / identify.total) * 100}%` }} />
              </div>
            </div>
          )}

          {clientOnly.length > 0 && (
            <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              ⚠ {clientOnly.length === 1 ? 'Hay 1 mod' : `Hay ${clientOnly.length} mods`} que Modrinth marca como solo de cliente:{' '}
              {clientOnly.map((r) => r.meta!.title).join(', ')}. Si el servidor no arranca, prueba a desactivarlos.
            </p>
          )}

          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span>{rows.length} {slot === 'mods' ? (rows.length === 1 ? 'mod' : 'mods') : (rows.length === 1 ? 'plugin' : 'plugins')}</span>
            {updates > 0 && <span className="text-accent">{updates} con actualización</span>}
            {selected.size > 0 && (
              <>
                <span className="text-text-secondary">{selected.size} seleccionados</span>
                <button type="button" onClick={() => setConfirmDelete([...selected])} className="text-red-400 hover:underline">Borrar</button>
                <button type="button" onClick={() => setSelected(new Set())} className="hover:underline">Quitar selección</button>
              </>
            )}
            <span className="ml-auto">Los cambios se aplican al reiniciar el servidor</span>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 min-h-0 pr-1">
            {loadingJars ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted"><Spinner /> Cargando…</div>
            ) : rows.length === 0 ? (
              <p className="text-center py-10 text-sm text-text-muted">
                {search ? 'Nada coincide con la búsqueda' : `No hay ${slot === 'mods' ? 'mods' : 'plugins'} en ${folder}`}
              </p>
            ) : rows.map(({ entry, meta: m }) => {
              const enabled = isEnabled(entry.name)
              const isSel = selected.has(entry.name)
              return (
                <div key={entry.name}
                  onClick={(e) => {
                    const next = new Set(e.ctrlKey || e.metaKey ? selected : [])
                    if (isSel && (e.ctrlKey || e.metaKey)) next.delete(entry.name)
                    else next.add(entry.name)
                    setSelected(next)
                  }}
                  className={`group flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors cursor-default ${
                    isSel ? 'border-accent/60 bg-accent/10' : 'border-border bg-bg-card hover:border-border/80'
                  } ${enabled ? '' : 'opacity-50'}`}>
                  <div className="w-9 h-9 rounded-lg bg-bg-hover flex items-center justify-center overflow-hidden shrink-0">
                    {m?.iconUrl ? <img src={m.iconUrl} alt="" className="w-full h-full object-cover" /> : <FileIcon name={entry.name} isDir={false} size={20} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">{m?.title || baseName(entry.name).replace(/\.jar$/i, '')}</span>
                      {m?.versionNumber && <span className="text-[11px] text-text-muted truncate">{m.versionNumber}</span>}
                      {m && <SideBadges client={m.clientSide} server={m.serverSide} />}
                      {m?.hasUpdate && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setModrinth({ projectId: m.projectId }) }}
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/20 text-accent hover:bg-accent/30 font-medium">
                          Actualización
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-text-muted truncate">{entry.name} · {formatBytes(entry.size)}{!m && !identify ? ' · no está en Modrinth' : ''}</p>
                  </div>
                  {m && (
                    <button type="button" title="Ver en Modrinth / cambiar versión"
                      onClick={(e) => { e.stopPropagation(); setModrinth({ projectId: m.projectId }) }}
                      className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs rounded border border-border text-text-muted hover:text-text-primary">
                      Versiones
                    </button>
                  )}
                  <button type="button" onClick={(e) => { e.stopPropagation(); toggle(entry.name) }}
                    title={enabled ? 'Desactivar (se renombra a .disabled)' : 'Activar'}
                    className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${enabled ? 'bg-accent' : 'bg-border'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete([entry.name]) }} title="Borrar"
                    className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-red-400 hover:bg-red-500/10 shrink-0">🗑</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Buscador de Modrinth apuntando al servidor */}
      {modrinth && target && (
        <ModrinthModal
          target={target}
          projectType={slot === 'mods' ? 'mod' : 'plugin'}
          initialProjectId={modrinth.projectId}
          onClose={() => setModrinth(null)}
          onInstalled={loadJars}
          projectVersionMap={Object.fromEntries(Object.values(meta).map((m) => [m.projectId, m.versionId]))}
          projectFilenameMap={Object.fromEntries(Object.entries(meta).map(([file, m]) => [m.projectId, file]))}
        />
      )}

      {/* Aviso de mod solo de cliente */}
      {warn && (
        <div className="fixed inset-0 z-[400] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-[520px] bg-bg-secondary border border-amber-500/40 rounded-2xl p-6 shadow-2xl">
            <h2 className="text-base font-bold text-amber-400 mb-3">⚠ «{warn.title}» es un mod solo de cliente</h2>
            <div className="text-sm text-text-secondary space-y-2 leading-relaxed">
              <p>Modrinth indica que este mod es para el juego de cada jugador, no para el servidor. Si lo instalas aquí:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>En el mejor caso el servidor lo ignora y no hace nada.</li>
                <li>
                  A menudo el servidor <b className="text-text-primary">no arranca</b>: el mod intenta cargar cosas que solo existen en el
                  juego (gráficos, sonido, menús) y el servidor se cierra con un error que no siempre dice qué mod ha sido.
                </li>
                <li>Para que los jugadores lo tengan, cada uno debe instalarlo en su propio launcher; en el servidor no les llega.</li>
              </ul>
              <p className="text-text-muted">
                Algunos mods marcados así funcionan igualmente en un servidor. Instálalo solo si sabes que este es uno de ellos.
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" autoFocus onClick={() => { warn.resolve(false); setWarn(null) }}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover">No instalar</button>
              <button type="button" onClick={() => { warn.resolve(true); setWarn(null) }}
                className="px-4 py-2 rounded-lg border border-amber-500/50 text-amber-400 text-sm hover:bg-amber-500/10">Instalar de todas formas</button>
            </div>
          </div>
        </div>
      )}

      {/* Corrección manual del tipo */}
      {override && (
        <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) setOverride(null) }}>
          <div className="w-[460px] bg-bg-secondary border border-border rounded-2xl p-6 shadow-2xl space-y-4">
            <h2 className="text-base font-bold text-text-primary">¿Qué servidor es?</h2>
            <div className="grid grid-cols-3 gap-2">
              {MANUAL_OPTIONS.map((o) => (
                <button key={o.id} type="button" onClick={() => setOverride({ ...override, loader: o.id })}
                  className={`px-2 py-2 rounded-lg border text-left ${override.loader === o.id ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/40'}`}>
                  <p className="text-sm text-text-primary">{o.label}</p>
                  <p className="text-[10px] text-text-muted">{o.hint}</p>
                </button>
              ))}
            </div>
            <label className="block">
              <span className="text-xs text-text-muted">Versión de Minecraft</span>
              <input value={override.minecraft} onChange={(e) => setOverride({ ...override, minecraft: e.target.value.trim() })}
                placeholder="1.21.1"
                className="mt-1 w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/60" />
            </label>
            <div className="flex items-center gap-2">
              {info?.manual && (
                <button type="button" onClick={async () => { await window.api.ftp.serverSetOverride(null); setOverride(null); onRedetect() }}
                  className="text-xs text-text-muted hover:text-text-primary hover:underline">Volver a la detección automática</button>
              )}
              <div className="ml-auto flex gap-2">
                <button type="button" onClick={() => setOverride(null)}
                  className="px-4 py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
                <button type="button"
                  onClick={async () => { await window.api.ftp.serverSetOverride(override); setOverride(null); onRedetect() }}
                  className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover">Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmar borrado */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-[420px] bg-bg-secondary border border-border rounded-2xl p-6 shadow-2xl">
            <h2 className="text-base font-bold text-text-primary mb-2">¿Borrar del servidor?</h2>
            <p className="text-sm text-text-secondary break-words">
              {confirmDelete.length === 1 ? confirmDelete[0] : `${confirmDelete.length} archivos`}. En el servidor no hay papelera: no se puede deshacer.
              Si solo quieres probar sin él, desactívalo con el interruptor.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
              <button type="button" onClick={() => { const n = confirmDelete; setConfirmDelete(null); remove(n) }}
                className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-400 text-white text-sm font-medium">Borrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SideBadges({ client, server }: { client: string; server: string }) {
  const clientOnly = server === 'unsupported'
  const serverOnly = client === 'unsupported'
  if (clientOnly) return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400" title="Solo de cliente según Modrinth">Solo cliente</span>
  if (serverOnly) return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-400" title="Solo de servidor: los jugadores no lo necesitan">Solo servidor</span>
  if (client === 'required' && server === 'required') {
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300" title="Hace falta en el servidor y en cada jugador">Cliente + servidor</span>
  }
  return null
}

function Spinner({ small }: { small?: boolean }) {
  return (
    <svg className={`animate-spin text-accent ${small ? 'w-3.5 h-3.5' : 'w-5 h-5'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.2" /><path d="M21 12a9 9 0 00-9-9" />
    </svg>
  )
}
