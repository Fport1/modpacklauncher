import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PopoutApp from './PopoutApp'
import ErrorBoundary, { installGlobalErrorReporting } from './components/ErrorBoundary'
import './index.css'

installGlobalErrorReporting()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Un cuadro de Servidores sacado a su ventana carga solo ese cuadro, sin el resto del launcher */}
    <ErrorBoundary scope="app">
      {window.location.hash.startsWith('#/ftp-pane') ? <PopoutApp /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
)

// Remove splash screen after React's first paint
requestAnimationFrame(() => requestAnimationFrame(() => {
  const el = document.getElementById('loading-splash')
  if (el) {
    el.style.transition = 'opacity 0.25s'
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 260)
  }
}))
