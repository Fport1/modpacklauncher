import { useEffect, useState } from 'react'

interface ServiceStatus {
  id: string
  name: string
  url: string
  status: 'up' | 'down'
  latency: number
}

export default function StatusPage() {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

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

  useEffect(() => { check() }, [])

  const allUp = services.length > 0 && services.every(s => s.status === 'up')
  const downCount = services.filter(s => s.status === 'down').length

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-1">Estado</h1>
          <p className="text-sm text-text-muted">Servicios de Mojang y Minecraft</p>
        </div>
        <button onClick={check} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 border border-border hover:border-accent/40 rounded-lg text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50">
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

      <div className="flex flex-col gap-2">
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
    </div>
  )
}
