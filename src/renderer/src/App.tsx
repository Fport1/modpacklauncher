import { useEffect, useRef, useState } from 'react'
import { nav } from './nav'
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import OperationsPanel from './components/OperationsPanel'
import UpdateModal from './components/UpdateModal'
import HomePage from './pages/HomePage'
import InstancesPage from './pages/InstancesPage'
import ModpacksPage from './pages/ModpacksPage'
import SettingsPage from './pages/SettingsPage'
import SkinsPage from './pages/SkinsPage'
import SkinEditorPage from './pages/SkinEditorPage'
import StatusPage from './pages/StatusPage'
import DiscoverPage from './pages/DiscoverPage'
import AdminPage from './pages/AdminPage'
import BlockPreviewPage from './pages/BlockPreviewPage'
import FriendsPage from './pages/FriendsPage'
import ConsolePage from './pages/ConsolePage'
import MacToolsPage from './pages/MacToolsPage'
import { useStore } from './store'

function FpackOpenHandler() {
  const navigate = useNavigate()
  const setPendingFpackFile = useStore(s => s.setPendingFpackFile)
  useEffect(() => {
    return window.api.fpack.onOpen(path => {
      setPendingFpackFile(path)
      navigate('/modpacks')
    })
  }, [])
  return null
}

const AFK_THRESHOLD = 3 * 60 * 1000
const HOURLY_CHECK = 60 * 60 * 1000

export default function App() {
  const {
    setAccounts,
    setActiveAccountId,
    setSettings,
    upsertOperation,
    setPendingUpdate,
    setUpdateModalOpen,
    appendGameLog,
    clearGameLog,
    setInstanceRunning,
    setFriends,
    addFriendLocal
  } = useStore()

  const [appReady, setAppReady] = useState(false)
  const [closeConfirm, setCloseConfirm] = useState(false)

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
      const [accountsData, settings, friendsList] = await Promise.all([
        window.api.auth.getAccounts(),
        window.api.settings.get(),
        window.api.friends.list().catch(() => [])
      ])
      setAccounts(accountsData.accounts)
      if (accountsData.activeId) setActiveAccountId(accountsData.activeId)
      setSettings(settings)
      settingsRef.current = settings
      setFriends(friendsList)

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

    const unsubOps = window.api.ops.onUpdate((update) => {
      upsertOperation(update as Parameters<typeof upsertOperation>[0])
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

    // Handle mouse back/forward navigation buttons
    let lastDomNavTime = 0
    const handleMouseNav = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault()
        if (e.button === 3) {
          lastDomNavTime = Date.now()
          nav.pop()
        }
      }
    }
    document.addEventListener('mousedown', handleMouseNav, { capture: true })

    // IPC fallback: Electron main process detected backwards in-page navigation
    const unsubNavBack = window.api.onNavBack(() => {
      if (Date.now() - lastDomNavTime > 200) nav.pop()
    })

    // Handle close request from main process
    const unsubClose = window.api.window.onRequestClose(() => {
      const { operations } = useStore.getState()
      const hasRunning = [...operations.values()].some(op => op.status === 'running')
      if (hasRunning) {
        setCloseConfirm(true)
      } else {
        window.api.window.confirmClose()
      }
    })

    // Handle deep links (modpacklauncher:// protocol)
    const unsubDeepLink = window.api.onDeepLink(async (action, params) => {
      if (action === 'friend-add' && params.username && params.uuid) {
        const existing = useStore.getState().friends.find(f => f.uuid === params.uuid)
        if (!existing) {
          const friend = {
            id: params.uuid,
            username: params.username,
            uuid: params.uuid,
            addedAt: Date.now()
          }
          await window.api.friends.add(friend)
          addFriendLocal(friend)
        }
      }
    })

    return () => {
      unsubOps()
      unsubStarted()
      unsubLog()
      unsubExit()
      window.removeEventListener('mousemove', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('mousedown', onActivity)
      clearInterval(afkTimer)
      clearInterval(hourlyTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      document.removeEventListener('mousedown', handleMouseNav, { capture: true })
      unsubNavBack()
      unsubClose()
      unsubDeepLink()
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
      <FpackOpenHandler />
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
              <Route path="/skins" element={<SkinsPage />} />
              <Route path="/skin-editor" element={<SkinEditorPage />} />
              <Route path="/status" element={<StatusPage />} />
              <Route path="/discover" element={<DiscoverPage />} />
              <Route path="/block-preview" element={<BlockPreviewPage />} />
              <Route path="/friends" element={<FriendsPage />} />
              <Route path="/console" element={<ConsolePage />} />
              <Route path="/mac-tools" element={<MacToolsPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Routes>
          </main>
        </div>
        <OperationsPanel />
        <UpdateModal />
      </div>
      {closeConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[500]">
          <div className="bg-bg-secondary border border-border rounded-2xl p-6 w-[400px] shadow-2xl">
            <h2 className="text-base font-bold text-text-primary mb-2">¿Cerrar el launcher?</h2>
            <p className="text-sm text-text-muted mb-5">
              Hay una operación en curso. Si cierras ahora, podría interrumpirse y dejar archivos incompletos.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setCloseConfirm(false)}
                className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">
                Cancelar
              </button>
              <button onClick={() => window.api.window.confirmClose()}
                className="flex-1 py-2 bg-red-500 hover:bg-red-400 text-white rounded-lg text-sm font-medium transition-colors">
                Cerrar de todas formas
              </button>
            </div>
          </div>
        </div>
      )}
    </HashRouter>
  )
}
