import { useEffect, useRef, useState } from 'react'
import { HashRouter } from 'react-router-dom'
import TitleBar from './components/TitleBar'
import FilePane, { type PaneApi } from './components/ftp/FilePane'
import type { Side } from './components/ftp/shared'
import { LogBox, TransfersBar, useFtpConnection, useFtpLog, usePaneNav } from './pages/FtpPage'
import { MouseNavHandler } from './App'
import { useStore } from './store'

// Raíz de una ventana con un solo cuadro de Servidores ("Este equipo" o el
// servidor), sacado aparte para tenerlo en otra pantalla.

export default function PopoutApp() {
  const side: Side = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('side') === 'local' ? 'local' : 'remote'
  const upsertOperation = useStore((s) => s.upsertOperation)
  const conn = useFtpConnection()
  const log = useFtpLog()
  const [downloadsDir, setDownloadsDir] = useState('')
  const apiRef = useRef<PaneApi | null>(null)
  // En su propia ventana el cuadro siempre está activo: el ratón recorre sus carpetas
  const focusedRef = useRef<Side | null>(side)
  usePaneNav(focusedRef, side === 'local' ? { local: apiRef, remote: { current: null } } : { local: { current: null }, remote: apiRef })

  useEffect(() => {
    document.title = side === 'local' ? 'Este equipo — Modpack Launcher' : 'Servidor — Modpack Launcher'
    window.api.ftp.downloadsDir().then(setDownloadsDir)
    return window.api.ops.onUpdate((update) => upsertOperation(update as Parameters<typeof upsertOperation>[0]))
  }, [])

  const title = side === 'local' ? 'Este equipo' : conn.connected ? `Servidor · ${conn.label}` : 'Servidor'

  return (
    <HashRouter>
      <MouseNavHandler />
      <div className="flex flex-col h-screen overflow-hidden bg-bg-primary">
        <TitleBar title={title} />
        <div className="flex-1 flex flex-col gap-2 p-3 min-h-0">
          <TransfersBar />
          <FilePane side={side} conn={conn} focused onFocus={() => {}} apiRef={apiRef} detached downloadsDir={downloadsDir} />
          <LogBox lines={log} className="h-16" />
        </div>
      </div>
    </HashRouter>
  )
}
