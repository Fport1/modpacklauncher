import { useEffect, useState } from 'react'

interface ServiceStatus {
  id: string
  name: string
  url: string
  status: 'up' | 'down'
  latency: number
}

interface CustomServer {
  id: string
  label: string
  host: string
  port: number
}

interface CustomServerStatus {
  online: boolean
  latency: number
  players?: { online: number; max: number }
  version?: string
}

const SERVERS_KEY = 'ml-custom-servers'

function loadServers(): CustomServer[] {
  try { return JSON.parse(localStorage.getItem(SERVERS_KEY) ?? '[]') } catch { return [] }
}
function saveServers(servers: CustomServer[]): void {
  localStorage.setItem(SERVERS_KEY, JSON.stringify(servers))
}

function parseHostPort(input: string): { host: string; port: number } {
  const last = input.lastIndexOf(':')
  if (last > 0 && last < input.length - 1) {
    const p = parseInt(input.slice(last + 1))
    if (!isNaN(p) && p > 0 && p < 65536) {
      return { host: input.slice(0, last).replace(/^\[|\]$/g, ''), port: p }
    }
  }
  return { host: input, port: 25565 }
}

export default function StatusPage() {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  const [servers, setServers] = useState<CustomServer[]>(loadServers)
  const [serverStatuses, setServerStatuses] = useState<Record<string, CustomServerStatus>>({})
  const [checkingServers, setCheckingServers] = useState(false)

  const [addingServer, setAddingServer] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newAddr, setNewAddr] = useState('')

  async function check() {
    setLoading(true)
    try {
      const results = await window.api.status.check()
      setServices(results)
      setLastChecked(new Date())
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }

  async function checkServers(list = servers) {
    if (list.length === 0) return
    setCheckingServers(true)
    const results: Record<string, CustomServerStatus> = {}
    await Promise.all(list.map(async s => {
      try {
        results[s.id] = await window.api.status.checkServer(s.host, s.port)
      } catch {
        results[s.id] = { online: false, latency: 0 }
      }
    }))
    setServerStatuses(results)
    setCheckingServers(false)
  }

  useEffect(() => { check() }, [])
  useEffect(() => { checkServers() }, [])

  function addServer() {
    if (!newAddr.trim()) return
    const { host, port } = parseHostPort(newAddr.trim())
    const server: CustomServer = {
      id: Date.now().toString(),
      label: newLabel.trim() || host,
      host,
      port
    }
    const updated = [...servers, server]
    setServers(updated)
    saveServers(updated)
    setNewLabel('')
    setNewAddr('')
    setAddingServer(false)
    checkServers(updated)
  }

  function removeServer(id: string) {
    const updated = servers.filter(s => s.id !== id)
    setServers(updated)
    saveServers(updated)
    setServerStatuses(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  const allUp = services.length > 0 && services.every(s => s.status === 'up')
  const downCount = services.filter(s => s.status === 'down').length

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-1">Estado</h1>
          <p className="text-sm text-text-muted">Servicios de Mojang y Minecraft</p>
        </div>
        <button onClick={() => { check(); checkServers() }} disabled={loading || checkingServers}
          className="flex items-center gap-2 px-3 py-2 border border-border hover:border-accent/40 rounded-lg text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50">
          <svg className={`w-4 h-4 ${loading || checkingServers ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
          Actualizar
        </button>
      </div>

      {/* Summary banner */}
      {services.length > 0 && (
        <div className={`flex items-center gap-3 p-3 rounded-xl mb-5 border ${
          allUp
            ? 'bg-green-500/10 border-green-500/30'
            : 'bg-red-500/10 border-red-500/30'
        }`}>
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${allUp ? 'bg-green-400' : 'bg-red-400'}`} />
          <p className={`text-sm font-medium ${allUp ? 'text-green-400' : 'text-red-400'}`}>
            {allUp
              ? 'Todos los servicios operativos'
              : `${downCount} servicio${downCount !== 1 ? 's' : ''} con problemas`}
          </p>
          {lastChecked && (
            <span className="text-[10px] text-text-muted ml-auto">
              {lastChecked.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {loading && services.length === 0 && (
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 00-9-9"/>
          </svg>
          Comprobando servicios...
        </div>
      )}

      <div className="flex flex-col gap-2 mb-8">
        {services.map(service => (
          <div key={service.id} className="flex items-center gap-4 p-3 bg-bg-card border border-border rounded-xl">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${service.status === 'up' ? 'bg-green-400' : 'bg-red-400'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary">{service.name}</p>
              <p className="text-[11px] text-text-muted truncate">{service.url}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className={`text-xs font-semibold ${service.status === 'up' ? 'text-green-400' : 'text-red-400'}`}>
                {service.status === 'up' ? 'Operativo' : 'Sin servicio'}
              </p>
              {service.status === 'up' && (
                <p className="text-[10px] text-text-muted">{service.latency} ms</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Custom servers */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Servidores de Minecraft</h2>
            <p className="text-xs text-text-muted">Tus servidores personalizados</p>
          </div>
          <button
            onClick={() => setAddingServer(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Agregar servidor
          </button>
        </div>

        {addingServer && (
          <div className="bg-bg-card border border-border rounded-xl p-4 mb-3 flex flex-col gap-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Nombre (opcional)"
                className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
              />
              <input
                type="text"
                value={newAddr}
                onChange={e => setNewAddr(e.target.value)}
                placeholder="IP o IP:puerto"
                onKeyDown={e => e.key === 'Enter' && addServer()}
                className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent font-mono"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setAddingServer(false); setNewLabel(''); setNewAddr('') }}
                className="px-3 py-1.5 text-xs border border-border text-text-secondary hover:text-text-primary rounded-lg transition-colors">
                Cancelar
              </button>
              <button onClick={addServer} disabled={!newAddr.trim()}
                className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors disabled:opacity-40">
                Agregar
              </button>
            </div>
          </div>
        )}

        {servers.length === 0 && !addingServer && (
          <div className="text-center py-8 border border-dashed border-border rounded-xl text-text-muted text-sm">
            No hay servidores añadidos
          </div>
        )}

        <div className="flex flex-col gap-2">
          {servers.map(server => {
            const st = serverStatuses[server.id]
            const checking = checkingServers && !st
            return (
              <div key={server.id} className="flex items-center gap-4 p-3 bg-bg-card border border-border rounded-xl group">
                {checking ? (
                  <svg className="animate-spin w-2.5 h-2.5 text-text-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 00-9-9"/></svg>
                ) : (
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${!st ? 'bg-text-muted/30' : st.online ? 'bg-green-400' : 'bg-red-400'}`} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{server.label}</p>
                  <p className="text-[11px] text-text-muted font-mono">{server.host}:{server.port}</p>
                </div>
                <div className="text-right flex-shrink-0 mr-2">
                  {st && (
                    <>
                      <p className={`text-xs font-semibold ${st.online ? 'text-green-400' : 'text-red-400'}`}>
                        {st.online ? 'En línea' : 'Sin conexión'}
                      </p>
                      {st.online && st.players && (
                        <p className="text-[10px] text-text-muted">{st.players.online}/{st.players.max} jugadores · {st.latency} ms</p>
                      )}
                      {st.online && !st.players && (
                        <p className="text-[10px] text-text-muted">{st.latency} ms</p>
                      )}
                    </>
                  )}
                </div>
                <button
                  onClick={() => removeServer(server.id)}
                  className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
