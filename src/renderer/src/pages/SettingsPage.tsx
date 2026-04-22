import { useState, useEffect } from 'react'
import { useStore } from '../store'
import RamSlider from '../components/RamSlider'
import type { MinecraftAccount } from '../../../shared/types'
import { OFFLINE_USERNAME_REGEX, APP_VERSION } from '../../../shared/types'
import UpdateCheckBtn from '../components/UpdateCheckBtn'



function SkinAvatar({ uuid, username }: { uuid: string; username: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    window.api.skin.getHead(uuid).then(setSrc).catch(() => setSrc(null))
  }, [uuid])

  if (!src) {
    return <span className="text-accent text-sm font-bold">{username[0].toUpperCase()}</span>
  }
  return <img src={src} alt={username} className="w-full h-full object-cover" draggable={false} />
}

export { SkinAvatar }

export default function SettingsPage() {
  const { accounts, activeAccountId, settings, addAccount, removeAccount, setActiveAccountId, setSettings } = useStore()

  const [loginMode, setLoginMode] = useState<'microsoft' | 'offline'>('microsoft')
  const [offlineName, setOfflineName] = useState('')
  const [offlineError, setOfflineError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [saved, setSaved] = useState(false)
  const [systemRam, setSystemRam] = useState(8192)
  const [showToken, setShowToken] = useState(false)

  const [localSettings, setLocalSettings] = useState(settings)

  useEffect(() => {
    window.api.system.getRam().then(setSystemRam)
  }, [])

  // Keep local settings in sync when store settings change
  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])

  function validateOfflineName(name: string): string {
    if (!name.trim()) return 'El nombre de usuario es requerido'
    if (!OFFLINE_USERNAME_REGEX.test(name)) {
      return 'Solo se permiten letras, números y los caracteres: - _ ! .'
    }
    return ''
  }

  function handleOfflineNameChange(value: string) {
    // Block spaces immediately
    if (value.includes(' ')) return
    setOfflineName(value)
    setOfflineError('')
  }

  async function loginMicrosoft() {
    setAuthLoading(true)
    setAuthError('')
    try {
      const account = await window.api.auth.loginMicrosoft()
      addAccount(account)
      await window.api.auth.setActive(account.id)
    } catch (e: unknown) {
      setAuthError(e instanceof Error ? e.message : 'Error al iniciar sesión')
    } finally {
      setAuthLoading(false)
    }
  }

  async function loginOffline() {
    const err = validateOfflineName(offlineName)
    if (err) { setOfflineError(err); return }
    const account = await window.api.auth.loginOffline(offlineName.trim())
    addAccount(account)
    await window.api.auth.setActive(account.id)
    setOfflineName('')
    setOfflineError('')
  }

  async function logout(account: MinecraftAccount) {
    await window.api.auth.logout(account.id)
    removeAccount(account.id)
  }

  async function setActive(accountId: string) {
    setActiveAccountId(accountId)
    await window.api.auth.setActive(accountId)
  }

  async function saveSettings() {
    await window.api.settings.set(localSettings)
    setSettings(localSettings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <h1 className="text-xl font-bold text-text-primary">Ajustes</h1>

      {/* Accounts */}
      <section>
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-4">
          Cuentas
        </h2>

        {accounts.length > 0 && (
          <div className="space-y-2 mb-4">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  acc.id === activeAccountId
                    ? 'border-accent/50 bg-accent/5'
                    : 'border-border bg-bg-card hover:border-border/60'
                }`}
                onClick={() => setActive(acc.id)}
              >
                <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {acc.type === 'microsoft' ? (
                    <SkinAvatar uuid={acc.uuid} username={acc.username} size={40} />
                  ) : (
                    <span className="text-accent text-sm font-bold">
                      {acc.username[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="font-medium text-text-primary text-sm truncate">{acc.username}</p>
                  <p className="text-xs text-text-muted">
                    {acc.type === 'microsoft' ? 'Microsoft (Premium)' : 'Offline (No premium)'}
                  </p>
                </div>
                {acc.id === activeAccountId && (
                  <span className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                    Activo
                  </span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); logout(acc) }}
                  className="text-text-muted hover:text-red-400 transition-colors ml-1"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="bg-bg-card border border-border rounded-xl p-4">
          <div className="flex gap-2 mb-4">
            {(['microsoft', 'offline'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setLoginMode(mode)}
                className={`flex-1 py-1.5 text-sm rounded-lg transition-colors ${
                  loginMode === mode
                    ? 'bg-accent text-white font-medium'
                    : 'text-text-secondary hover:text-text-primary border border-border'
                }`}
              >
                {mode === 'microsoft' ? 'Microsoft' : 'Offline'}
              </button>
            ))}
          </div>

          {loginMode === 'microsoft' ? (
            <button
              onClick={loginMicrosoft}
              disabled={authLoading}
              className="w-full py-2 bg-bg-hover hover:bg-bg-primary border border-border text-text-primary text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {authLoading ? 'Abriendo ventana...' : 'Iniciar sesión con Microsoft'}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <input
                    type="text"
                    value={offlineName}
                    onChange={(e) => handleOfflineNameChange(e.target.value)}
                    placeholder="NombreDeUsuario"
                    className={`w-full bg-bg-primary border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none transition-colors ${
                      offlineError ? 'border-red-500' : 'border-border focus:border-accent'
                    }`}
                    onKeyDown={(e) => e.key === 'Enter' && loginOffline()}
                  />
                </div>
                <button
                  onClick={loginOffline}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors"
                >
                  Añadir
                </button>
              </div>
              {offlineError ? (
                <p className="text-xs text-red-400">{offlineError}</p>
              ) : (
                <p className="text-xs text-text-muted">
                  Solo letras, números y: <code className="bg-bg-primary px-1 rounded">- _ ! .</code>
                  {' '}Sin espacios.
                </p>
              )}
            </div>
          )}

          {authError && <p className="mt-2 text-xs text-red-400">{authError}</p>}
        </div>
      </section>

      {/* Java & Memory */}
      <section>
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-4">
          Java y Memoria
        </h2>
        <div className="bg-bg-card border border-border rounded-xl p-4 space-y-5">
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">
              Ruta de Java{' '}
              <span className="text-text-muted text-xs">(dejar vacío para detectar automáticamente)</span>
            </label>
            <input
              type="text"
              value={localSettings.javaPath}
              onChange={(e) => setLocalSettings({ ...localSettings, javaPath: e.target.value })}
              placeholder="/usr/bin/java  ·  C:\Program Files\Java\...\bin\java.exe"
              className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
            <p className="text-xs text-text-muted mt-1">
              Si se deja vacío, el launcher detecta Java automáticamente. Si no está instalado, lo descarga solo.
            </p>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-3">
              RAM máxima asignada
            </label>
            <RamSlider
              value={localSettings.maxMemory}
              onChange={(v) => setLocalSettings({ ...localSettings, maxMemory: v })}
              max={systemRam}
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-3">
              RAM mínima
            </label>
            <RamSlider
              value={localSettings.minMemory}
              onChange={(v) => setLocalSettings({ ...localSettings, minMemory: v })}
              max={Math.min(systemRam, localSettings.maxMemory)}
            />
          </div>
        </div>
      </section>

      {/* Launcher options */}
      <section>
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-4">
          Launcher
        </h2>
        <div className="bg-bg-card border border-border rounded-xl p-4 space-y-4">
          {[
            {
              key: 'closeOnLaunch' as const,
              label: 'Minimizar launcher al lanzar el juego'
            },
            {
              key: 'checkUpdatesOnStart' as const,
              label: 'Comprobar actualizaciones de modpack al iniciar'
            }
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-text-secondary">{label}</span>
              <button
                onClick={() => setLocalSettings({ ...localSettings, [key]: !localSettings[key] })}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  localSettings[key] ? 'bg-accent' : 'bg-border'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    localSettings[key] ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </label>
          ))}
        </div>
      </section>

      {/* GitHub para modpacks */}
      <section>
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-4">
          Creación de Modpacks
        </h2>
        <div className="bg-bg-card border border-border rounded-xl p-4 space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">
              Token de GitHub
              <span className="text-text-muted text-xs ml-1">(solo si vas a crear modpacks)</span>
            </label>
            <div className="flex gap-2">
              <input
                type={showToken ? 'text' : 'password'}
                value={localSettings.githubToken ?? ''}
                onChange={(e) => setLocalSettings({ ...localSettings, githubToken: e.target.value })}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent font-mono"
              />
              <button
                onClick={() => setShowToken((v) => !v)}
                title={showToken ? 'Ocultar token' : 'Ver token'}
                className="px-3 py-2 border border-border rounded-lg text-text-muted hover:text-text-primary transition-colors"
              >
                {showToken ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="bg-bg-primary rounded-xl p-4 space-y-2 select-text cursor-text">
            <p className="text-xs font-semibold text-text-secondary">¿Cómo conseguir un token?</p>
            <ol className="text-xs text-text-muted space-y-1.5 list-decimal list-inside">
              <li>Ve a <span className="text-accent font-mono select-text">github.com/settings/tokens</span> (necesitas cuenta de GitHub, es gratis)</li>
              <li>Click en <span className="font-semibold">"Generate new token (classic)"</span> — elige <em>classic</em>, no fine-grained</li>
              <li>Dale un nombre como <span className="font-mono bg-bg-card px-1 rounded select-text">ModpackLauncher</span></li>
              <li>En <span className="font-semibold">Expiration</span> elige <span className="font-semibold">No expiration</span> (o la duración que prefieras — si caduca, deberás generar uno nuevo)</li>
              <li>En permisos marca solo <span className="font-mono bg-bg-card px-1 rounded select-text">repo</span> (acceso completo a repositorios)</li>
              <li>Click <span className="font-semibold">"Generate token"</span>, copia el token que empieza por <span className="font-mono bg-bg-card px-1 rounded">ghp_</span> y pégalo arriba</li>
            </ol>
            <div className="pt-2 border-t border-border space-y-1">
              <p className="text-xs text-amber-400/80">⚠ El token solo se muestra una vez en GitHub — guárdalo bien.</p>
              <p className="text-xs text-text-muted">
                Una vez configurado, ve a una instancia → menú ··· → <span className="font-semibold">Exportar Modpack</span> para publicarlo.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Save */}
      <button
        onClick={saveSettings}
        className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-colors"
      >
        {saved ? '¡Guardado!' : 'Guardar ajustes'}
      </button>

      {/* Version */}
      <div className="flex items-center justify-center gap-2 pb-2">
        <p className="text-xs text-text-muted">ModpackLauncher v{APP_VERSION}</p>
        <UpdateCheckBtn />
      </div>
    </div>
  )
}
