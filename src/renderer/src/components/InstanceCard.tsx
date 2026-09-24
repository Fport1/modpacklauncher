import { useEffect, useState } from 'react'
import type { Instance } from '../../../shared/types'
import ContextMenu, { type MenuEntry } from './ui/ContextMenu'
import {
  IconPlay, IconStop, IconInfo, IconEdit, IconImage, IconCopy, IconFolder, IconPackage, IconSave,
  IconHelp, IconWrench, IconTrash, IconMore, IconClock, IconRefresh
} from './ui/icons'

interface Props {
  instance: Instance
  onPlay: () => void
  onKill: () => void
  onLaunchExtra?: () => void
  onEdit: () => void
  onDelete: () => void
  onOpenFolder: () => void
  onDetails: () => void
  onExport: () => void
  onDuplicate: () => void
  onChangeIcon: () => void
  onSaveFpack?: () => void
  onRepair?: () => void
  /** Pedir ayuda remota a un amigo con esta instancia. */
  onAssist?: () => void
  isLaunching?: boolean
  isRunning?: boolean
  hasUpdate?: boolean
  onUpdate?: () => void
}

const MODLOADER_STYLE: Record<string, string> = {
  vanilla: 'text-green-400 bg-green-500/10 border-green-500/20',
  forge: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  fabric: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
  quilt: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  neoforge: 'text-amber-400 bg-amber-500/10 border-amber-500/20'
}

function relativeTime(ms?: number): string {
  if (!ms) return 'Nunca'
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (diff < 60_000) return 'Hace unos instantes'
  if (mins === 1) return 'Hace 1 minuto'
  if (mins < 60) return `Hace ${mins} minutos`
  if (hours === 1) return 'Hace 1 hora'
  if (hours < 24) return `Hace ${hours} horas`
  if (days === 1) return 'Hace 1 día'
  return new Date(ms).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatPlaytime(ms?: number): string {
  if (!ms || ms < 60_000) return ''
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function InstanceCard({
  instance, onPlay, onKill, onLaunchExtra, onEdit, onDelete, onOpenFolder, onDetails, onExport,
  onDuplicate, onChangeIcon, onSaveFpack, onRepair, onAssist, isLaunching, isRunning, hasUpdate, onUpdate
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [showExtraConfirm, setShowExtraConfirm] = useState(false)
  const [iconSrc, setIconSrc] = useState<string | null>(null)

  useEffect(() => {
    window.api.instances.getIcon(instance.id).then(setIconSrc).catch(() => setIconSrc(null))
  }, [instance.id, instance.icon])

  const loaderStyle = MODLOADER_STYLE[instance.modloader] ?? 'text-text-secondary bg-bg-hover border-border'
  const playtime = formatPlaytime(instance.playtime)
  const lastText = relativeTime(instance.lastPlayed)
  const isVanilla = instance.modloader === 'vanilla'

  const items: MenuEntry[] = [
    isRunning
      ? { label: 'Cerrar el juego', icon: <IconStop size={15} />, onClick: onKill, tone: 'text-red-400' }
      : { label: 'Jugar', icon: <IconPlay size={15} />, onClick: onPlay, tone: 'text-accent', disabled: isLaunching },
    'separator',
    { label: 'Detalles', icon: <IconInfo />, onClick: onDetails, hint: 'mods, mundos…' },
    { label: 'Editar', icon: <IconEdit />, onClick: onEdit },
    { label: 'Cambiar icono', icon: <IconImage />, onClick: onChangeIcon },
    { label: 'Duplicar', icon: <IconCopy />, onClick: onDuplicate },
    { label: 'Abrir carpeta', icon: <IconFolder />, onClick: onOpenFolder },
    { header: 'Compartir' },
    ...(onAssist ? [{ label: 'Pedir ayuda a un amigo', icon: <IconHelp />, onClick: onAssist, tone: 'text-purple-400' } as MenuEntry] : []),
    ...(!isVanilla ? [{ label: 'Exportar modpack', icon: <IconPackage />, onClick: onExport } as MenuEntry] : []),
    ...(onSaveFpack ? [{ label: 'Guardar como .fpack', icon: <IconSave />, onClick: onSaveFpack } as MenuEntry] : []),
    'separator',
    ...(onRepair ? [{ label: 'Reparar instancia', icon: <IconWrench />, onClick: onRepair } as MenuEntry] : []),
    { label: 'Eliminar', icon: <IconTrash />, onClick: onDelete, danger: true }
  ]

  return (
    <div
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
      className={`relative group h-full flex flex-col bg-bg-card border rounded-2xl p-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-xl ${
        isRunning
          ? 'border-green-500/60 shadow-green-500/10 shadow-md'
          : menu ? 'border-accent/60 shadow-lg shadow-accent/10' : 'border-border hover:border-accent/40 hover:shadow-accent/5'
      }`}
    >
      {/* Icono, nombre y etiquetas: siempre una sola fila de etiquetas */}
      <div className="flex items-start gap-3">
        <div className="w-14 h-14 rounded-xl bg-bg-hover flex items-center justify-center overflow-hidden shrink-0 ring-1 ring-white/5">
          {iconSrc
            ? <img src={iconSrc} alt="" className="w-full h-full object-cover" draggable={false} />
            : <div className="w-full h-full animate-pulse bg-bg-card" />}
        </div>
        <div className="min-w-0 flex-1 pr-7">
          <h3 className="font-semibold text-[15px] text-text-primary truncate" title={instance.name}>{instance.name}</h3>
          <div className="flex items-center gap-1.5 mt-1 overflow-hidden whitespace-nowrap">
            <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded-md bg-bg-hover text-text-secondary border border-border">MC {instance.minecraft}</span>
            <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded-md border capitalize ${loaderStyle}`}>{instance.modloader}</span>
            {instance.modpackUrl && (
              <span className="min-w-0 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-accent/10 text-accent border border-accent/20" title={`Modpack v${instance.modpackVersion ?? '?'}`}>
                <IconPackage size={11} />
                <span className="truncate">v{instance.modpackVersion ?? '?'}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Estado: la misma línea sirve para "jugado hace…", "en juego" y el aviso de actualización */}
      <div className="mt-3 h-6 flex items-center gap-2 text-xs">
        {isRunning ? (
          <span className="inline-flex items-center gap-1.5 bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            En juego
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-text-muted min-w-0 truncate">
            <IconClock size={12} />
            {lastText}
            {playtime && <><span className="text-border">·</span>{playtime} jugado</>}
          </span>
        )}
        {hasUpdate && (
          <button onClick={onUpdate} title="Hay una versión nueva del modpack"
            className="ml-auto shrink-0 inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 px-2 py-0.5 rounded-full hover:bg-amber-500/20 transition-colors">
            <IconRefresh size={11} />
            Actualizar
          </button>
        )}
      </div>

      {/* Botones: misma altura jugando o no, siempre abajo */}
      <div className="mt-auto pt-3">
        {isRunning ? (
          <div className="flex gap-2">
            <button onClick={onKill}
              className="flex-1 h-11 flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-semibold rounded-xl transition-colors">
              <IconStop size={13} />
              Cerrar
            </button>
            <button onClick={() => setShowExtraConfirm((v) => !v)} title="Abrir segunda instancia"
              className={`h-11 w-11 flex items-center justify-center rounded-xl border transition-colors ${
                showExtraConfirm ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-bg-card border-border text-text-secondary hover:border-accent/40 hover:text-accent'
              }`}>
              <IconRefresh size={15} />
            </button>
          </div>
        ) : (
          <button onClick={onPlay} disabled={isLaunching}
            className="w-full h-11 flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm shadow-accent/20">
            {isLaunching ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.3" />
                  <path d="M21 12a9 9 0 00-9-9" />
                </svg>
                Lanzando...
              </>
            ) : (
              <><IconPlay size={14} />Jugar</>
            )}
          </button>
        )}
      </div>

      {/* Segunda copia: flota encima en vez de estirar la tarjeta */}
      {isRunning && showExtraConfirm && (
        <div className="absolute left-3 right-3 bottom-[4.25rem] z-10 p-3 rounded-xl bg-bg-secondary border border-amber-500/40 shadow-2xl">
          <p className="text-xs text-amber-300 font-medium mb-0.5">¿Abrir una segunda copia?</p>
          <p className="text-[11px] text-amber-300/70 mb-2.5">
            Tendrás dos Minecrafts corriendo a la vez. Puede causar lag, alta RAM y CPU.
          </p>
          <div className="flex gap-2">
            <button onClick={() => { onLaunchExtra?.(); setShowExtraConfirm(false) }}
              className="flex-1 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold hover:bg-amber-500/30 transition-colors">
              Abrir igual
            </button>
            <button onClick={() => setShowExtraConfirm(false)}
              className="flex-1 py-1.5 rounded-lg border border-border text-text-secondary text-xs hover:text-text-primary transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Botón de opciones (lo mismo que el clic derecho) */}
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu(menu ? null : { x: r.right - 230, y: r.bottom + 4 })
        }}
        onMouseDown={(e) => e.stopPropagation()}
        title="Opciones (también con clic derecho)"
        className={`absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-all ${menu ? 'opacity-100 bg-bg-hover text-text-primary' : 'opacity-0 group-hover:opacity-100'}`}>
        <IconMore size={16} />
      </button>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)}
          title={
            <div className="flex items-center gap-2.5">
              {iconSrc ? <img src={iconSrc} alt="" className="w-8 h-8 rounded-lg object-cover" /> : <div className="w-8 h-8 rounded-lg bg-bg-hover" />}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{instance.name}</p>
                <p className="text-[11px] text-text-muted capitalize">MC {instance.minecraft} · {instance.modloader}</p>
              </div>
            </div>
          } />
      )}
    </div>
  )
}
