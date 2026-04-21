import { useEffect, useRef, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ProgressModal from './components/ProgressModal'
import UpdateModal from './components/UpdateModal'
import HomePage from './pages/HomePage'
import InstancesPage from './pages/InstancesPage'
import ModpacksPage from './pages/ModpacksPage'
import SettingsPage from './pages/SettingsPage'
import { useStore } from './store'

const AFK_THRESHOLD = 3 * 60 * 1000
const HOURLY_CHECK = 60 * 60 * 1000

export default function App() {
  const {
    setAccounts,
    setActiveAccountId,
    setSettings,
    addProgress,
    clearProgress,
    setPendingUpdate,
    setUpdateModalOpen,
    appendGameLog,
    clearGameLog,
    setInstanceRunning
  } = useStore()

  const [appReady, setAppReady] = useState(false)

  const lastActivityRef = useRef(Date.now())
  const afkRef = useRef(false)
  const settingsRef = useRef(useStore.getState().settings)

  // Keep settingsRef in sync
  useEffect(() => {
    return useStore.subscribe((state) => {
      settingsRef.current = state.settings
    })
  }, [])

  async function silentCheckUpdate() {
    const s = settingsRef.current
    if (!s.updateManifestUrl) return
    try {
      const result = await window.api.updater.check()
      if (result.hasUpdate && result.manifest) {
        setPendingUpdate(result.manifest)
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    async function init() {
      const [accountsData, settings] = await Promise.all([
        window.api.auth.getAccounts(),
        window.api.settings.get()
      ])
      setAccounts(accountsData.accounts)
      if (accountsData.activeId) setActiveAccountId(accountsData.activeId)
      setSettings(settings)
      settingsRef.current = settings

      if (settings.checkUpdatesOnStart && settings.updateManifestUrl) {
        try {
          const result = await window.api.updater.check()
          if (result.hasUpdate && result.manifest) {
            setPendingUpdate(result.manifest)
            setUpdateModalOpen(true)
          }
        } catch {
          // ignore
        }
      }

      setAppReady(true)
    }
    init()

    const unsubProgress = window.api.onProgress((progress) => {
      if (progress.done || progress.error) {
        clearProgress()
      } else {
        addProgress(progress)
      }
    })

    const unsubStarted = window.api.onGameStarted((id) => {
      clearGameLog(id)
      setInstanceRunning(id, true)
    })
    const unsubLog = window.api.onGameLog((id, line) => appendGameLog(id, line))
    const unsubExit = window.api.onGameExit((id) => setInstanceRunning(id, false))

    // AFK + activity tracking
    function onActivity() {
      const wasAfk = afkRef.current
      lastActivityRef.current = Date.now()
      afkRef.current = false
      if (wasAfk) {
        silentCheckUpdate()
      }
    }

    window.addEventListener('mousemove', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity, { passive: true })
    window.addEventListener('mousedown', onActivity, { passive: true })

    // AFK poll: mark afk after threshold
    const afkTimer = setInterval(() => {
      if (!afkRef.current && Date.now() - lastActivityRef.current > AFK_THRESHOLD) {
        afkRef.current = true
      }
    }, 30_000)

    // Hourly silent check (only when not afk and visible)
    const hourlyTimer = setInterval(() => {
      if (!afkRef.current && !document.hidden) {
        silentCheckUpdate()
      }
    }, HOURLY_CHECK)

    // Check on return from background
    function onVisibilityChange() {
      if (!document.hidden && !afkRef.current) {
        silentCheckUpdate()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      unsubProgress()
      unsubStarted()
      unsubLog()
      unsubExit()
      window.removeEventListener('mousemove', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('mousedown', onActivity)
      clearInterval(afkTimer)
      clearInterval(hourlyTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  if (!appReady) {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-bg-primary">
        <TitleBar />
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <svg className="animate-spin w-8 h-8 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.2" />
            <path d="M21 12a9 9 0 00-9-9" />
          </svg>
          <p className="text-sm text-text-secondary">Comprobando actualizaciones...</p>
        </div>
      </div>
    )
  }

  return (
    <HashRouter>
      <div className="flex flex-col h-screen overflow-hidden">
        <TitleBar />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-bg-primary">
            <Routes>
              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/instances" element={<InstancesPage />} />
              <Route path="/modpacks" element={<ModpacksPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
        <ProgressModal />
        <UpdateModal />
      </div>
    </HashRouter>
  )
}
