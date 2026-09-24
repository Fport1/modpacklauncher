import { useEffect, useRef, useState } from 'react'
import { nav } from '../nav'
import type { DiskInfo, StorageChild } from '../../../shared/types'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

/** Nombres técnicos de carpeta traducidos a algo legible. */
const FRIENDLY: Record<string, string> = {
  shared: 'Compartido entre instancias',
  assets: 'Assets de Minecraft',
  libraries: 'Librerías',
  versions: 'Versiones',
  instances: 'Instancias',
  jre: 'Runtime de Java',
  minecraft: 'Datos del juego',
  saves: 'Mundos',
  mods: 'Mods',
  screenshots: 'Capturas',
  shaderpacks: 'Shaders',
  resourcepacks: 'Paquetes de recursos',
  config: 'Configuración',
  logs: 'Registros',
  'crash-reports': 'Informes de fallo',
  Cache: 'Caché de la app',
  'Code Cache': 'Caché de código',
  GPUCache: 'Caché de GPU'
}

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#f97316', '#14b8a6']

/** Cuenta hacia el valor nuevo en vez de saltar, para que el total se sienta vivo. */
function useCountUp(target: number, durationMs = 400): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const startRef = useRef(0)

  useEffect(() => {
    fromRef.current = value
    startRef.current = performance.now()
    let raf = 0
    const step = (now: number): void => {
      const t = Math.min(1, (now - startRef.current) / durationMs)
      // easing suave al final
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(fromRef.current + (target - fromRef.current) * eased)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])

  return value
}

export default function StorageModal({ onClose }: { onClose: () => void }) {
  const [scanning, setScanning] = useState(true)
  const [scanned, setScanned] = useState(0)
  const [files, setFiles] = useState(0)
  const [current, setCurrent] = useState('')
  const [disk, setDisk] = useState<DiskInfo | null>(null)
  const [trail, setTrail] = useState<{ rel: string; label: string }[]>([{ rel: '', label: 'Todo' }])
  const [children, setChildren] = useState<StorageChild[]>([])
  const [confirmRel, setConfirmRel] = useState<string | null>(null)
  const [busyRel, setBusyRel] = useState<string | null>(null)

  const here = trail[trail.length - 1]
  const shownTotal = useCountUp(scanned)

  useEffect(() => {
    // Mismo patron que el resto de modales: al desmontarse se retira de la
    // pila, o el siguiente "atras" se gastaria cerrando un modal ya cerrado.
    const baseSize = nav.size()
    nav.push(() => onClose())

    const unsub = window.api.storage.onScanProgress((p) => {
      setScanned(p.bytes)
      setFiles(p.files)
      setCurrent(p.current)
    })

    ;(async () => {
      const result = await window.api.storage.scan()
      setScanned(result.bytes)
      setFiles(result.files)
      setScanning(false)
      setDisk(await window.api.storage.disk())
      setChildren(await window.api.storage.children(''))
    })()

    return () => {
      unsub()
      nav.clearFrom(baseSize)
    }
  }, [])

  async function refresh(rel: string): Promise<void> {
    setChildren(await window.api.storage.children(rel))
    setDisk(await window.api.storage.disk())
  }

  async function enter(child: StorageChild): Promise<void> {
    if (!child.isDir || child.childCount === 0) return
    setTrail([...trail, { rel: child.rel, label: FRIENDLY[child.name] ?? child.name }])
    setChildren(await window.api.storage.children(child.rel))
  }

  async function goTo(index: number): Promise<void> {
    const next = trail.slice(0, index + 1)
    setTrail(next)
    setChildren(await window.api.storage.children(next[next.length - 1].rel))
  }

  async function remove(rel: string): Promise<void> {
    setBusyRel(rel)
    setConfirmRel(null)
    try {
      await window.api.storage.delete(rel)
      setScanned((b) => b - (children.find((c) => c.rel === rel)?.bytes ?? 0))
      await refresh(here.rel)
    } finally {
      setBusyRel(null)
    }
  }

  const levelTotal = children.reduce((sum, c) => sum + c.bytes, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6" onClick={onClose}>
      <div
        className="w-full max-w-3xl h-[80vh] flex flex-col bg-bg-secondary border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera con el total y el disco */}
        <header className="px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Almacenamiento</h2>
              <p className="text-3xl font-semibold text-text-primary mt-1 tabular-nums tracking-tight">
                {formatBytes(shownTotal)}
              </p>
              <p className="text-xs text-text-muted mt-1 h-4 truncate max-w-md">
                {scanning
                  ? `Analizando... ${files.toLocaleString()} archivos · ${current.split('/').pop() ?? ''}`
                  : `${files.toLocaleString()} archivos del launcher`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {disk && disk.total > 0 && (
            <div className="mt-4">
              <div className="flex h-2.5 rounded-full overflow-hidden bg-bg-hover">
                <div
                  className="transition-all duration-700 ease-out"
                  style={{ width: `${(disk.launcher / disk.total) * 100}%`, backgroundColor: '#6366f1' }}
                  title={`ModpackLauncher — ${formatBytes(disk.launcher)}`}
                />
                <div
                  className="transition-all duration-700 ease-out"
                  style={{ width: `${(disk.others / disk.total) * 100}%`, backgroundColor: '#475569' }}
                  title={`Otras apps y sistema — ${formatBytes(disk.others)}`}
                />
              </div>
              <div className="flex items-center gap-4 mt-2 text-[11px] text-text-muted">
                <Legend color="#6366f1" label="ModpackLauncher" value={formatBytes(disk.launcher)} />
                <Legend color="#475569" label="Otras apps y sistema" value={formatBytes(disk.others)} />
                <Legend color="#1e293b" label="Libre" value={formatBytes(disk.free)} />
                <span className="ml-auto">{formatBytes(disk.total)} en total</span>
              </div>
            </div>
          )}
        </header>

        {/* Migas de pan */}
        <div className="flex items-center gap-1 px-6 py-2.5 border-b border-border text-xs overflow-x-auto">
          {trail.map((crumb, i) => (
            <span key={crumb.rel} className="flex items-center gap-1 flex-shrink-0">
              {i > 0 && <span className="text-text-muted">›</span>}
              <button
                onClick={() => goTo(i)}
                disabled={i === trail.length - 1}
                className={i === trail.length - 1
                  ? 'text-text-primary font-medium'
                  : 'text-text-muted hover:text-text-primary transition-colors'}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>

        {/* Listado */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {scanning && children.length === 0 && (
            <div className="py-16 text-center">
              <div className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-text-muted mt-3">Midiendo carpetas...</p>
            </div>
          )}

          {!scanning && children.length === 0 && (
            <p className="text-xs text-text-muted py-16 text-center">Esta carpeta está vacía.</p>
          )}

          {children.map((child, i) => {
            const pct = levelTotal > 0 ? (child.bytes / levelTotal) * 100 : 0
            const color = PALETTE[i % PALETTE.length]
            const navigable = child.isDir && child.childCount > 0

            return (
              <div
                key={child.rel}
                onClick={() => enter(child)}
                className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  navigable ? 'cursor-pointer hover:bg-bg-hover' : ''
                }`}
              >
                {/* Barra de fondo proporcional */}
                <span
                  className="absolute inset-y-1 left-0 rounded-lg opacity-10 transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />

                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 relative" style={{ backgroundColor: color }} />

                <span className="flex-1 min-w-0 relative">
                  <span className="text-sm text-text-secondary truncate block">
                    {FRIENDLY[child.name] ?? child.name}
                  </span>
                  {child.isDir && (
                    <span className="text-[10px] text-text-muted">
                      {child.childCount} {child.childCount === 1 ? 'elemento' : 'elementos'}
                    </span>
                  )}
                </span>

                <span className="text-xs text-text-muted font-mono flex-shrink-0 relative tabular-nums">
                  {formatBytes(child.bytes)}
                </span>
                <span className="text-[10px] text-text-muted w-9 text-right flex-shrink-0 relative tabular-nums">
                  {pct >= 1 ? `${Math.round(pct)}%` : ''}
                </span>

                <span className="flex items-center gap-1 flex-shrink-0 relative" onClick={(e) => e.stopPropagation()}>
                  {confirmRel === child.rel ? (
                    <>
                      <button
                        onClick={() => remove(child.rel)}
                        className="text-[11px] px-2 py-1 rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
                      >
                        Borrar
                      </button>
                      <button
                        onClick={() => setConfirmRel(null)}
                        className="text-[11px] px-2 py-1 rounded-md text-text-muted hover:text-text-primary transition-colors"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmRel(child.rel)}
                      disabled={busyRel === child.rel}
                      className="text-[11px] px-2 py-1 rounded-md text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 disabled:opacity-50 transition-all"
                    >
                      {busyRel === child.rel ? '...' : 'Borrar'}
                    </button>
                  )}
                  {navigable && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.5" className="text-text-muted">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        <footer className="flex items-center justify-between px-6 py-3 border-t border-border">
          <button
            onClick={() => window.api.storage.open(here.rel)}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Abrir esta carpeta
          </button>
          <span className="text-[11px] text-text-muted">
            Los datos compartidos se vuelven a descargar solos; los mundos no.
          </span>
        </footer>
      </div>
    </div>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
      {label} <span className="text-text-secondary">{value}</span>
    </span>
  )
}
