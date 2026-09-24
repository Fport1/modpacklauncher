import { useEffect, useRef, useState } from 'react'
import type { FtpConnectionState, FtpProtocol, FtpSiteInput, FtpSiteSummary } from '../../../shared/types'
import { useStore } from '../store'
import { nav } from '../nav'
import { parseHostInput } from '../../../shared/ftpHost'
import FilePane, { Btn, type PaneApi } from '../components/ftp/FilePane'
import AssistConnectDialog from '../components/assist/AssistConnectDialog'
import { errText, type LogKind, type Side } from '../components/ftp/shared'

// Cliente de archivos para servidores (FTP, FTPS y SFTP), con lo básico de
// FileZilla: sitios guardados, dos cuadros, subir, bajar, editar, renombrar,
// borrar y crear carpetas. Pensado para subir mods y mundos a un servidor de
// Minecraft y tocar su configuración sin salir del launcher.
//
// Cada cuadro se puede sacar a su propia ventana (⧉): aquí solo se muestran
// los que siguen en la principal.

interface LogLine { t: number; kind: LogKind; text: string }

const PROTOCOLS: { id: FtpProtocol; label: string; port: number }[] = [
  { id: 'sftp', label: 'SFTP', port: 22 },
  { id: 'ftp', label: 'FTP', port: 21 },
  { id: 'ftps', label: 'FTPS (FTP con TLS)', port: 21 }
]

const EMPTY_FORM: FtpSiteInput = { name: '', protocol: 'sftp', host: '', port: 22, user: '', password: '', remoteDir: '' }

export const EMPTY_CONN: FtpConnectionState = {
  connected: false, siteId: null, label: '', kind: 'site', root: '/', cwd: '/', lost: false, reconnecting: false
}

/** Estado de la conexión, igual en todas las ventanas. */
export function useFtpConnection(): FtpConnectionState {
  const [conn, setConn] = useState<FtpConnectionState>(EMPTY_CONN)
  useEffect(() => {
    window.api.ftp.status().then(setConn).catch(() => {})
    return window.api.ftp.onConnection(setConn)
  }, [])
  return conn
}

/** Registro compartido: lo que pasa en cualquier cuadro, esté en la ventana que esté. */
export function useFtpLog(): LogLine[] {
  const [lines, setLines] = useState<LogLine[]>([])
  useEffect(() => window.api.ftp.onLog((l) => setLines((prev) => [...prev.slice(-199), l])), [])
  return lines
}

/** Los botones laterales del ratón recorren las carpetas del cuadro activo. */
export function usePaneNav(focusedRef: React.MutableRefObject<Side | null>, apis: Record<Side, React.MutableRefObject<PaneApi | null>>): void {
  useEffect(() => nav.setInterceptor((direction) => {
    const side = focusedRef.current
    if (!side) return false
    return apis[side].current?.nav(direction) ?? false
  }), [])
}

export function LogBox({ lines, className = '' }: { lines: LogLine[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }) }, [lines])
  return (
    <div ref={ref} className={`shrink-0 bg-bg-secondary border border-border rounded-xl overflow-y-auto px-3 py-2 font-mono text-xs ${className}`}>
      {lines.length === 0 && <p className="text-text-muted">Aquí aparece lo que va pasando con la conexión y las transferencias.</p>}
      {lines.map((l, i) => (
        <p key={i} className={l.kind === 'error' ? 'text-red-400' : l.kind === 'ok' ? 'text-green-400' : 'text-text-muted'}>
          <span className="text-text-muted/60">{new Date(l.t).toLocaleTimeString()}</span> {l.text}
        </p>
      ))}
    </div>
  )
}

export function TransfersBar() {
  const operations = useStore((st) => st.operations)
  const transfers = [...operations.values()].filter((o) => (o.type === 'ftp-upload' || o.type === 'ftp-download') && o.status === 'running')
  if (transfers.length === 0) return null
  return (
    <div className="bg-bg-secondary border border-accent/40 rounded-xl px-3 py-2 space-y-1.5">
      {transfers.map((t) => {
        const pct = t.total ? Math.min(100, Math.round(((t.current ?? 0) / t.total) * 100)) : 0
        const up = t.type === 'ftp-upload'
        return (
          <div key={t.id} className="flex items-center gap-3 text-sm">
            <span className={`font-semibold ${up ? 'text-accent' : 'text-sky-400'}`}>{up ? '↑ Subiendo' : '↓ Descargando'}</span>
            <span className="text-text-secondary truncate w-56">{t.message ?? t.name}</span>
            <div className="flex-1 h-2 bg-bg-hover rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-200 ${up ? 'bg-accent' : 'bg-sky-400'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-text-muted tabular-nums w-10 text-right">{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

export default function FtpPage() {
  const [sites, setSites] = useState<FtpSiteSummary[]>([])
  const [siteId, setSiteId] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [form, setForm] = useState<FtpSiteInput | null>(null)
  const [askPassword, setAskPassword] = useState(false)
  const [typedPassword, setTypedPassword] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [downloadsDir, setDownloadsDir] = useState('')
  const [popped, setPopped] = useState({ local: false, remote: false })
  const [focused, setFocused] = useState<Side | null>(null)
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  const localApi = useRef<PaneApi | null>(null)
  const remoteApi = useRef<PaneApi | null>(null)

  const conn = useFtpConnection()
  const log = useFtpLog()
  usePaneNav(focusedRef, { local: localApi, remote: remoteApi })

  const site = sites.find((s) => s.id === siteId)

  async function loadSites(): Promise<FtpSiteSummary[]> {
    const list = await window.api.ftp.sites()
    setSites(list)
    return list
  }

  useEffect(() => {
    ;(async () => {
      const list = await loadSites()
      const status = await window.api.ftp.status()
      setSiteId(status.siteId ?? list[0]?.id ?? '')
      setDownloadsDir(await window.api.ftp.downloadsDir())
      setPopped(await window.api.ftp.paneState())
    })()
    return window.api.ftp.onPaneState((s) => {
      setPopped(s)
      if (focusedRef.current && s[focusedRef.current]) setFocused(null)
    })
  }, [])

  // Clic fuera de los cuadros = ninguno activo, y el ratón vuelve a navegar la app
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (e.button !== 0 && e.button !== 2) return
      const target = e.target as HTMLElement
      if (!target.closest('[data-pane]') && !target.closest('[data-context-menu]')) setFocused(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // ── Conexión ──
  async function connect(password?: string): Promise<void> {
    if (!site) return
    if (!site.hasPassword && password === undefined) {
      setTypedPassword('')
      setAskPassword(true)
      return
    }
    setAskPassword(false)
    setConnecting(true)
    window.api.ftp.log('info', `Conectando a ${site.host}:${site.port} (${site.protocol.toUpperCase()})...`)
    try {
      const { cwd } = await window.api.ftp.connect(site.id, password)
      window.api.ftp.log('ok', `Conectado. Carpeta: ${cwd}`)
    } catch (e) {
      window.api.ftp.log('error', `No se pudo conectar: ${errText(e)}`)
    } finally {
      setConnecting(false)
    }
  }

  async function disconnect(): Promise<void> {
    await window.api.ftp.disconnect()
    if (focusedRef.current === 'remote') setFocused(null)
    window.api.ftp.log('info', 'Desconectado')
  }

  async function saveForm(): Promise<void> {
    if (!form || !form.host.trim()) return
    try {
      const id = await window.api.ftp.saveSite(form)
      setForm(null)
      await loadSites()
      setSiteId(id)
      window.api.ftp.log('ok', `Sitio guardado: ${form.name || form.host}`)
    } catch (e) {
      window.api.ftp.log('error', `No se pudo guardar el sitio: ${errText(e)}`)
    }
  }

  const busyConn = conn.connected || conn.reconnecting || conn.lost
  const statusText = conn.reconnecting ? 'Reconectando…' : conn.connected ? `Conectado a ${conn.label}` : conn.lost ? 'Conexión perdida' : connecting ? 'Conectando…' : 'Desconectado'

  return (
    <div className="h-full flex flex-col gap-3 p-6 min-h-0">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-text-primary">Servidores</h1>
        <span className="text-xs text-text-muted">FTP · FTPS · SFTP</span>
        <span className="ml-auto text-[11px] text-text-muted hidden xl:block">
          Ctrl+F buscar · F5 recargar · F2 renombrar · Supr borrar · Ctrl+Z / Ctrl+Y deshacer · ⧉ sacar un cuadro a otra ventana
        </span>
      </div>

      {/* Barra de conexión */}
      <div className="flex items-center gap-2 bg-bg-secondary border border-border rounded-xl px-3 py-2.5 flex-wrap">
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={busyConn}
          className="bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary min-w-[240px] disabled:opacity-60">
          {sites.length === 0 && <option value="">Sin sitios guardados</option>}
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.protocol.toUpperCase()} {s.host}:{s.port}</option>)}
        </select>
        <Btn onClick={() => setForm({ ...EMPTY_FORM })} disabled={busyConn}>＋ Nuevo sitio</Btn>
        <Btn onClick={() => site && setForm({
          id: site.id, name: site.name, protocol: site.protocol, host: site.host,
          port: site.port, user: site.user, password: '', remoteDir: site.remoteDir ?? ''
        })} disabled={!site || busyConn}>✎ Editar</Btn>
        <Btn onClick={() => setConfirmDelete(true)} disabled={!site || busyConn} danger>🗑</Btn>
        <Btn onClick={() => setAssistOpen(true)} disabled={busyConn}>🤝 Ayudar a un amigo</Btn>

        <div className="ml-auto flex items-center gap-3">
          <span className={`flex items-center gap-2 text-sm ${conn.connected ? 'text-green-400' : conn.lost ? 'text-red-400' : conn.reconnecting ? 'text-amber-400' : 'text-text-muted'}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${conn.connected ? 'bg-green-400 shadow-[0_0_8px_#4ade80]' : conn.lost ? 'bg-red-400' : conn.reconnecting ? 'bg-amber-400 animate-pulse' : 'bg-border'}`} />
            {statusText}
          </span>
          {conn.lost && conn.kind === 'site' && <Btn primary onClick={() => window.api.ftp.reconnect()}>Reconectar</Btn>}
          {busyConn
            ? <Btn onClick={disconnect}>Desconectar</Btn>
            : <Btn primary onClick={() => connect()} disabled={!site || connecting}>Conectar</Btn>}
        </div>
      </div>

      <TransfersBar />

      {/* Cuadros */}
      <div className="flex-1 flex gap-3 min-h-0">
        {(['local', 'remote'] as Side[]).map((side) => popped[side] ? (
          <div key={side} className="w-52 shrink-0 flex flex-col items-center justify-center gap-3 text-center bg-bg-secondary border-2 border-dashed border-border rounded-2xl p-4">
            <span className="text-3xl text-accent">⧉</span>
            <p className="text-sm text-text-secondary">{side === 'local' ? '«Este equipo»' : 'El servidor'} está en otra ventana</p>
            <div className="flex flex-col gap-2 w-full">
              <Btn primary onClick={() => window.api.ftp.paneOpen(side)}>Ir a esa ventana</Btn>
              <Btn onClick={() => window.api.ftp.paneClose(side)}>Traerlo aquí</Btn>
            </div>
          </div>
        ) : (
          <FilePane key={side} side={side} conn={conn} focused={focused === side}
            onFocus={() => { if (side === 'local' || conn.connected) setFocused(side) }}
            apiRef={side === 'local' ? localApi : remoteApi} detached={false} downloadsDir={downloadsDir} />
        ))}
      </div>

      <LogBox lines={log} className="h-24" />

      {/* Formulario de sitio */}
      {form && (
        <Modal onClose={() => setForm(null)} title={form.id ? 'Editar sitio' : 'Nuevo sitio'}>
          <div className="space-y-3">
            <Field label="Nombre">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mi servidor" className={inputCls} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Protocolo">
                <select value={form.protocol} onChange={(e) => {
                  const p = PROTOCOLS.find((x) => x.id === e.target.value)!
                  const wasDefault = PROTOCOLS.some((x) => x.port === form.port)
                  setForm({ ...form, protocol: p.id, port: wasDefault ? p.port : form.port })
                }} className={inputCls}>
                  {PROTOCOLS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </Field>
              <Field label="Servidor" className="col-span-2">
                <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })}
                  onBlur={() => {
                    // Si se pegó la dirección entera del hosting, se reparte en los campos
                    const p = parseHostInput(form.host)
                    if (p.host === form.host.trim()) return
                    setForm({
                      ...form,
                      host: p.host,
                      protocol: p.protocol ?? form.protocol,
                      port: p.port ?? (p.protocol ? (p.protocol === 'sftp' ? 22 : 21) : form.port),
                      user: form.user || p.user || '',
                      remoteDir: form.remoteDir || p.path || ''
                    })
                  }}
                  placeholder="sftp://servidor.com:2022" className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Puerto">
                <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Usuario" className="col-span-2">
                <input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <Field label={form.id ? 'Contraseña (vacío = mantener la guardada)' : 'Contraseña'}>
              <input type="password" value={form.password ?? ''} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Carpeta inicial (opcional)">
              <input value={form.remoteDir ?? ''} onChange={(e) => setForm({ ...form, remoteDir: e.target.value })} placeholder="/" className={inputCls} />
            </Field>
            <p className="text-xs text-text-muted leading-snug">
              Puedes pegar la dirección tal cual te la da tu hosting (<span className="font-mono">sftp://servidor:2022</span>):
              se reparte sola en protocolo, servidor y puerto. La contraseña se guarda cifrada con el llavero de tu sistema.
              En paneles Pterodactyl el usuario suele ser <span className="font-mono">nombre.idservidor</span> y el puerto 2022.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Btn onClick={() => setForm(null)}>Cancelar</Btn>
              <Btn primary onClick={saveForm} disabled={!form.host.trim()}>Guardar</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Contraseña al conectar */}
      {askPassword && site && (
        <Modal onClose={() => setAskPassword(false)} title={`Contraseña para ${site.user}@${site.host}`}>
          <form onSubmit={(e) => { e.preventDefault(); connect(typedPassword) }} className="space-y-3">
            <input type="password" autoFocus value={typedPassword} onChange={(e) => setTypedPassword(e.target.value)} className={inputCls} />
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setAskPassword(false)}>Cancelar</Btn>
              <Btn primary type="submit">Conectar</Btn>
            </div>
          </form>
        </Modal>
      )}

      {confirmDelete && site && (
        <Modal onClose={() => setConfirmDelete(false)} title="Borrar sitio">
          <p className="text-sm text-text-secondary">¿Borrar el sitio "{site.name}"? Solo se quita de la lista, no toca el servidor.</p>
          <div className="flex justify-end gap-2 mt-4">
            <Btn onClick={() => setConfirmDelete(false)}>Cancelar</Btn>
            <Btn danger onClick={async () => {
              setConfirmDelete(false)
              await window.api.ftp.deleteSite(site.id)
              const list = await loadSites()
              setSiteId(list[0]?.id ?? '')
            }}>Borrar</Btn>
          </div>
        </Modal>
      )}

      {assistOpen && <AssistConnectDialog onClose={() => setAssistOpen(false)} />}
    </div>
  )
}

// ── Piezas ──────────────────────────────────────────────────────────────────

const inputCls = 'w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/60'

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs text-text-muted mb-1">{label}</span>
      {children}
    </label>
  )
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div className="w-full max-w-md bg-bg-secondary border border-border rounded-2xl shadow-2xl p-5" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-text-primary mb-4">{title}</h2>
        {children}
      </div>
    </div>
  )
}
