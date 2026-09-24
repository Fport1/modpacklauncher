import { APP_VERSION } from '../../../shared/types'

// Barra de título del launcher. Los botones de minimizar, maximizar y cerrar
// son los del sistema (ver main/titleBar.ts): aquí solo se deja su hueco.
// - Windows/Linux: a la derecha, con el ancho exacto que dice el sistema
//   (env(titlebar-area-*)); 140 px si por lo que sea no lo dice.
// - macOS: a la izquierda, para los tres círculos.

const isMac = navigator.userAgent.toLowerCase().includes('macintosh')

/** `title` sustituye al nombre del launcher, p. ej. en la ventana de Servidores. */
export default function TitleBar({ title }: { title?: string } = {}) {
  return (
    <div
      className="flex items-center h-9 bg-bg-secondary border-b border-border flex-shrink-0 relative z-[200]"
      style={{
        WebkitAppRegion: 'drag',
        paddingLeft: isMac ? 80 : 16,
        paddingRight: isMac ? 16 : 'calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100% - 140px)) + 12px)'
      } as React.CSSProperties}
    >
      <div className={`flex items-center gap-2 min-w-0 ${isMac ? 'mx-auto' : ''}`}>
        {title
          ? <span className="text-sm font-semibold text-text-primary select-none truncate">{title}</span>
          : <span className="text-sm font-semibold text-text-primary select-none truncate">Modpack Launcher by <span className="text-red-500">Fport1</span></span>}
        <span className="text-xs text-text-muted select-none">v{APP_VERSION}</span>
      </div>
    </div>
  )
}
