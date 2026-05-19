import { useState, useEffect } from 'react'
import { useStore } from '../store'
import RamSlider from '../components/RamSlider'
import type { MinecraftAccount, AIConfig } from '../../../shared/types'
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
  const { accounts, activeAccountId, settings, addAccount, removeAccount, setActiveAccountId, setSettings, sidebarCompact, setSidebarCompact } = useStore()

  const [loginMode, setLoginMode] = useState<'microsoft' | 'offline'>('microsoft')
  const [offlineName, setOfflineName] = useState('')
  const [offlineError, setOfflineError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [saved, setSaved] = useState(false)
  const [systemRam, setSystemRam] = useState(8192)
  const [showToken, setShowToken] = useState(false)

  const [localSettings, setLocalSettings] = useState(settings)

  // AI config form state — null = list view, object = add/edit view
  type AIForm = { id?: string; label: string; provider: AIConfig['provider']; model: string; apiKey: string; ollamaUrl: string }
  const [aiForm, setAiForm] = useState<AIForm | null>(null)
  const [showAiKey, setShowAiKey] = useState(false)

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

  // AI config helpers — auto-save immediately (don't wait for Guardar)
  const aiConfigs = settings.aiConfigs ?? []

  function openAddAiForm() {
    setAiForm({ label: '', provider: 'claude', model: 'claude-haiku-4-5-20251001', apiKey: '', ollamaUrl: 'http://localhost:11434' })
    setShowAiKey(false)
  }

  function openEditAiForm(c: AIConfig) {
    setAiForm({ id: c.id, label: c.label, provider: c.provider, model: c.model, apiKey: c.apiKey ?? '', ollamaUrl: c.ollamaUrl ?? 'http://localhost:11434' })
    setShowAiKey(false)
  }

  async function saveAiConfig() {
    if (!aiForm || !aiForm.label.trim() || !aiForm.model.trim()) return
    const cfg: AIConfig = {
      id: aiForm.id ?? crypto.randomUUID(),
      label: aiForm.label.trim(),
      provider: aiForm.provider,
      model: aiForm.model.trim(),
      ...(aiForm.provider !== 'ollama' ? { apiKey: aiForm.apiKey } : {}),
      ...(aiForm.provider === 'ollama' ? { ollamaUrl: aiForm.ollamaUrl || 'http://localhost:11434' } : {}),
    }
    const newList = aiForm.id ? aiConfigs.map(c => c.id === aiForm.id ? cfg : c) : [...aiConfigs, cfg]
    await window.api.settings.set({ aiConfigs: newList })
    setSettings({ ...settings, aiConfigs: newList })
    setAiForm(null)
  }

  async function deleteAiConfig(id: string) {
    const newList = aiConfigs.filter(c => c.id !== id)
    const newDefault = settings.aiDefaultId === id ? undefined : settings.aiDefaultId
    await window.api.settings.set({ aiConfigs: newList, aiDefaultId: newDefault })
    setSettings({ ...settings, aiConfigs: newList, aiDefaultId: newDefault })
  }

  async function toggleAiDefault(id: string) {
    const newDefault = settings.aiDefaultId === id ? undefined : id
    await window.api.settings.set({ aiDefaultId: newDefault })
    setSettings({ ...settings, aiDefaultId: newDefault })
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
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-text-secondary">Sidebar compacto (solo iconos)</span>
            <button
              onClick={() => setSidebarCompact(!sidebarCompact)}
              className={`relative w-11 h-6 rounded-full transition-colors ${sidebarCompact ? 'bg-accent' : 'bg-border'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${sidebarCompact ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </label>
        </div>
      </section>

      {/* Modrinth */}
      <section>
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-4">
          Modrinth
        </h2>
        <div className="bg-bg-card border border-border rounded-xl p-4 space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">Canal de versiones al instalar mods</label>
            <select
              value={localSettings.modInstallChannel ?? 'all'}
              onChange={e => setLocalSettings({ ...localSettings, modInstallChannel: e.target.value as 'all' | 'stable' })}
              className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="all">Todo (release, beta, alpha)</option>
              <option value="stable">Solo estable (release)</option>
            </select>
            <p className="text-xs text-text-muted mt-1">Controla qué tipos de versiones se consideran al instalar con un clic o auto-seleccionar.</p>
          </div>
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

      {/* Sistema */}
      <section>
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-4">
          Sistema
        </h2>
        <div className="bg-bg-card border border-border rounded-xl p-4 space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-sm text-text-secondary">Minimizar a bandeja al cerrar</span>
              <p className="text-xs text-text-muted mt-0.5">Al pulsar X el launcher se oculta en la barra del sistema en vez de cerrarse.</p>
            </div>
            <button
              onClick={() => setLocalSettings({ ...localSettings, closeToTray: !localSettings.closeToTray })}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 ${localSettings.closeToTray ? 'bg-accent' : 'bg-border'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${localSettings.closeToTray ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-sm text-text-secondary">Iniciar con Windows</span>
              <p className="text-xs text-text-muted mt-0.5">Abre el launcher automáticamente al encender el equipo.</p>
            </div>
            <button
              onClick={() => setLocalSettings({ ...localSettings, launchAtStartup: !localSettings.launchAtStartup })}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 ${localSettings.launchAtStartup ? 'bg-accent' : 'bg-border'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${localSettings.launchAtStartup ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </label>
        </div>
      </section>

      {/* Inteligencia Artificial */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Inteligencia Artificial</h2>
          {!aiForm && (
            <button onClick={openAddAiForm}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-lg transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Agregar IA
            </button>
          )}
        </div>

        <p className="text-xs text-text-muted mb-3">
          Configura varios proveedores. Al analizar un crash, elige cuál usar o define uno por defecto.
          <br />
          <span className="text-amber-400/80">Ollama es gratuito y funciona sin internet — instálalo en tu PC.</span>
        </p>

        {/* List of configured AIs */}
        {aiConfigs.length > 0 && !aiForm && (
          <div className="space-y-2 mb-3">
            {aiConfigs.map(c => {
              const BADGE: Record<string, string> = {
                claude: 'bg-purple-500/15 text-purple-400', openai: 'bg-green-500/15 text-green-400',
                gemini: 'bg-blue-500/15 text-blue-400', grok: 'bg-orange-500/15 text-orange-400',
                ollama: 'bg-amber-500/15 text-amber-400'
              }
              const LABEL: Record<string, string> = {
                claude: 'Claude', openai: 'ChatGPT', gemini: 'Gemini', grok: 'Grok', ollama: 'Ollama'
              }
              const isDefault = settings.aiDefaultId === c.id
              return (
                <div key={c.id} className={`flex items-center gap-3 p-3 rounded-xl border ${isDefault ? 'border-accent/40 bg-accent/5' : 'border-border bg-bg-card'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-text-primary truncate">{c.label}</span>
                      {isDefault && <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-px rounded-full font-semibold">Predeterminado</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] px-1.5 py-px rounded font-medium ${BADGE[c.provider] ?? ''}`}>{LABEL[c.provider]}</span>
                      <span className="text-[11px] text-text-muted font-mono">{c.model}</span>
                    </div>
                  </div>
                  <button onClick={() => toggleAiDefault(c.id)} title={isDefault ? 'Quitar predeterminado' : 'Usar como predeterminado'}
                    className={`p-1.5 rounded-lg transition-colors ${isDefault ? 'text-accent' : 'text-text-muted hover:text-accent'}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={isDefault ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                  </button>
                  <button onClick={() => openEditAiForm(c)} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button onClick={() => deleteAiConfig(c.id)} className="p-1.5 rounded-lg text-text-muted hover:text-red-400 transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                      <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {aiConfigs.length === 0 && !aiForm && (
          <div className="border border-dashed border-border rounded-xl p-6 text-center mb-3">
            <p className="text-sm text-text-muted mb-1">Sin IAs configuradas</p>
            <p className="text-xs text-text-muted">Agrega Claude, ChatGPT, Gemini, Grok u Ollama (gratis, local).</p>
          </div>
        )}

        {/* Add / Edit form */}
        {aiForm && (
          <div className="bg-bg-card border border-accent/30 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-text-primary">{aiForm.id ? 'Editar IA' : 'Nueva IA'}</p>

            <div>
              <label className="block text-xs text-text-muted mb-1">Nombre</label>
              <input type="text" value={aiForm.label} onChange={e => setAiForm(f => f && ({ ...f, label: e.target.value }))}
                placeholder="Mi Claude rápido" className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Proveedor</label>
                <select value={aiForm.provider}
                  onChange={e => {
                    const p = e.target.value as AIConfig['provider']
                    const defaults: Record<string, string> = {
                      claude: 'claude-haiku-4-5-20251001', openai: 'gpt-4o-mini',
                      gemini: 'gemini-2.0-flash', grok: 'grok-3-mini', ollama: 'llama3.2'
                    }
                    setAiForm(f => f && ({ ...f, provider: p, model: defaults[p] ?? '' }))
                  }}
                  className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent">
                  <option value="claude">Claude (Anthropic)</option>
                  <option value="openai">ChatGPT (OpenAI)</option>
                  <option value="gemini">Gemini (Google)</option>
                  <option value="grok">Grok (xAI)</option>
                  <option value="ollama">Ollama — local, gratis</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Modelo</label>
                {aiForm.provider === 'ollama' ? (
                  <input type="text" value={aiForm.model} onChange={e => setAiForm(f => f && ({ ...f, model: e.target.value }))}
                    placeholder="llama3.2 / mistral / deepseek-r1"
                    className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent font-mono" />
                ) : (
                  <select value={aiForm.model} onChange={e => setAiForm(f => f && ({ ...f, model: e.target.value }))}
                    className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent">
                    {aiForm.provider === 'claude' && <>
                      <option value="claude-haiku-4-5-20251001">Haiku 4.5 — rápido y barato</option>
                      <option value="claude-sonnet-4-6">Sonnet 4.6 — equilibrado</option>
                      <option value="claude-opus-4-7">Opus 4.7 — el más potente</option>
                    </>}
                    {aiForm.provider === 'openai' && <>
                      <option value="gpt-4o-mini">GPT-4o mini — barato</option>
                      <option value="gpt-4o">GPT-4o — potente</option>
                      <option value="gpt-4.1">GPT-4.1</option>
                      <option value="o4-mini">o4-mini — razonamiento</option>
                    </>}
                    {aiForm.provider === 'gemini' && <>
                      <option value="gemini-2.0-flash">Gemini 2.0 Flash — rápido, gratis</option>
                      <option value="gemini-1.5-flash">Gemini 1.5 Flash — gratis</option>
                      <option value="gemini-2.5-pro">Gemini 2.5 Pro — el más potente</option>
                      <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                    </>}
                    {aiForm.provider === 'grok' && <>
                      <option value="grok-3-mini">Grok 3 Mini — barato</option>
                      <option value="grok-3">Grok 3 — potente</option>
                      <option value="grok-2">Grok 2</option>
                    </>}
                  </select>
                )}
              </div>
            </div>

            {aiForm.provider !== 'ollama' && (
              <div>
                <label className="block text-xs text-text-muted mb-1">Clave de API</label>
                <div className="flex gap-2">
                  <input type={showAiKey ? 'text' : 'password'} value={aiForm.apiKey}
                    onChange={e => setAiForm(f => f && ({ ...f, apiKey: e.target.value }))}
                    placeholder="sk-ant-... / sk-... / AIza... / xai-..."
                    className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent font-mono" />
                  <button onClick={() => setShowAiKey(v => !v)}
                    className="px-3 py-2 border border-border rounded-lg text-text-muted hover:text-text-primary transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {showAiKey
                        ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                        : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
                    </svg>
                  </button>
                </div>
                <p className="text-[11px] text-text-muted mt-1">Se guarda solo en tu equipo. Gemini tiene capa gratuita en Google AI Studio.</p>
              </div>
            )}

            {aiForm.provider === 'ollama' && (
              <div>
                <label className="block text-xs text-text-muted mb-1">URL de Ollama</label>
                <input type="text" value={aiForm.ollamaUrl}
                  onChange={e => setAiForm(f => f && ({ ...f, ollamaUrl: e.target.value }))}
                  placeholder="http://localhost:11434"
                  className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent font-mono" />
                <p className="text-[11px] text-text-muted mt-1">Instala Ollama en <span className="text-accent">ollama.com</span>, ejecuta <code className="bg-bg-primary px-1 rounded">ollama pull llama3.2</code> y listo.</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={saveAiConfig} disabled={!aiForm.label.trim() || !aiForm.model.trim()}
                className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white text-sm font-medium rounded-lg transition-colors">
                Guardar
              </button>
              <button onClick={() => setAiForm(null)}
                className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        )}
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
