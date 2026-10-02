import { Component, type ErrorInfo, type ReactNode } from 'react'

// Si algo falla al pintar una pantalla, React desmonta todo y la ventana se queda
// en negro. Esto lo atrapa, lo guarda en el registro del launcher (también en
// disco) y enseña qué ha pasado con una forma de seguir.

// Una lista que falla falla en cada elemento: el mismo error seguido se apunta una vez
let last = { message: '', at: 0 }

function report(error: unknown, info?: ErrorInfo): void {
  const e = error instanceof Error ? error : new Error(String(error))
  const now = Date.now()
  if (e.message === last.message && now - last.at < 3000) return
  last = { message: e.message, at: now }
  const text = `${e.stack ?? e.message}${info?.componentStack ? `\nComponentes:${info.componentStack.split('\n').slice(0, 12).join('\n')}` : ''}`
  try { window.api.console.reportError(text) } catch { /* sin puente no hay registro */ }
}

/** Errores fuera de React (promesas sin catch, scripts): solo se apuntan. */
export function installGlobalErrorReporting(): void {
  window.addEventListener('error', (ev) => report(ev.error ?? ev.message))
  window.addEventListener('unhandledrejection', (ev) => report(ev.reason))
}

interface Props {
  children: ReactNode
  /** 'app': ocupa la ventana entera; 'page': solo el hueco de la página (la barra lateral sigue) */
  scope: 'app' | 'page'
  onHome?: () => void
}

export default class ErrorBoundary extends Component<Props, { error: Error | null; copied: boolean }> {
  state = { error: null as Error | null, copied: false }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    report(error, info)
  }

  private copy = (): void => {
    const e = this.state.error
    if (!e) return
    navigator.clipboard.writeText(e.stack ?? e.message).catch(() => {})
    this.setState({ copied: true })
    setTimeout(() => this.setState({ copied: false }), 2000)
  }

  render(): ReactNode {
    const { error, copied } = this.state
    if (!error) return this.props.children
    const app = this.props.scope === 'app'
    const btn = 'px-4 py-2 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-hover'
    return (
      <div className={`${app ? 'fixed inset-0 bg-bg-primary' : 'h-full'} flex items-center justify-center p-6`}>
        {/* En la ventana sin bordes, la franja de arriba sigue sirviendo para moverla */}
        {app && <div className="fixed top-0 left-0 right-0 h-9" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />}
        <div className="w-full max-w-[560px] bg-bg-secondary border border-border rounded-3xl shadow-2xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 shrink-0 rounded-2xl bg-red-500/15 text-red-300 flex items-center justify-center text-xl font-bold">!</div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-text-primary">Algo ha fallado en esta pantalla</p>
              <p className="text-sm text-text-muted mt-0.5">
                {app ? 'El launcher sigue abierto y tus partidas no se han tocado. Recárgalo para seguir.' : 'El resto del launcher sigue funcionando. Puedes reintentarlo o ir a otra página.'}
                {' '}Se ha guardado en el registro de errores para poder arreglarlo.
              </p>
            </div>
          </div>
          <pre className="max-h-40 overflow-auto rounded-xl bg-bg-primary border border-border px-3 py-2 text-xs text-red-200 whitespace-pre-wrap break-words">{error.message || String(error)}</pre>
          <div className="flex flex-wrap gap-2">
            {app
              ? <button onClick={() => location.reload()} className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-bold">Recargar el launcher</button>
              : <>
                  <button onClick={() => this.setState({ error: null })} className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-bold">Reintentar</button>
                  {this.props.onHome && <button onClick={() => { this.setState({ error: null }); this.props.onHome?.() }} className={btn}>Ir a Inicio</button>}
                </>}
            <button onClick={this.copy} className={btn}>{copied ? 'Copiado ✓' : 'Copiar el error'}</button>
            <button onClick={() => window.api.console.showErrorsLog().catch(() => {})} className={btn}>Ver el registro</button>
          </div>
        </div>
      </div>
    )
  }
}
