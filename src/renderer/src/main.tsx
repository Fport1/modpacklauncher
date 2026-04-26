import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
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
