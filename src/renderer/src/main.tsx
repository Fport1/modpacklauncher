import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PopoutApp from './PopoutApp'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Un cuadro de Servidores sacado a su ventana carga solo ese cuadro, sin el resto del launcher */}
    {window.location.hash.startsWith('#/ftp-pane') ? <PopoutApp /> : <App />}
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
