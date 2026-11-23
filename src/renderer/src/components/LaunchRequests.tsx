import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { useT } from '../i18n'
import type { ShortcutUpdateInfo, ShortcutErrorInfo } from '../../../preload'

/** Sin el «Error invoking remote method 'x': Error:» que añade Electron a los errores del proceso principal. */
function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

type Prompt =
  | { kind: 'update'; info: ShortcutUpdateInfo }
  | { kind: 'error'; info: ShortcutErrorInfo }

/**
 * Lo que pide el sistema al abrir el launcher: un .fpack con doble clic o un
 * acceso directo de instancia. El proceso principal los guarda hasta que esto
 * se monta y avisa (launchRequests.ready), así no se pierden si llegan con el
 * launcher cerrado, antes de que la interfaz esté lista.
 */
export default function LaunchRequests() {
  const navigate = useNavigate()
  const t = useT()
  const setPendingFpackFile = useStore(s => s.setPendingFpackFile)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [busy, setBusy] = useState<'update' | 'play' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const openFpack = (path: string): void => {
      setPendingFpackFile(path)
      navigate('/modpacks')
    }
    const showUpdate = (info: ShortcutUpdateInfo): void => { setError(''); setPrompt({ kind: 'update', info }) }
    const showError = (info: ShortcutErrorInfo): void => { setError(''); setPrompt({ kind: 'error', info }) }

    const unsubs = [
      window.api.fpack.onOpen(openFpack),
      window.api.launchRequests.onShortcutUpdate(showUpdate),
      window.api.launchRequests.onShortcutError(showError),
    ]
    // Lo que llegó antes de estar escuchando
    window.api.launchRequests.ready().then(items => {
      for (const { channel, args } of items) {
        if (channel === 'fpack:open') openFpack(args[0] as string)
        else if (channel === 'instance-shortcut:update') showUpdate(args[0] as ShortcutUpdateInfo)
        else if (channel === 'instance-shortcut:error') showError(args[0] as ShortcutErrorInfo)
      }
    }).catch(() => {})
    return () => { for (const u of unsubs) u() }
  }, [])

  if (!prompt) return null

  const close = (): void => { if (!busy) { setPrompt(null); setError('') } }

  async function play(instanceId: string): Promise<void> {
    await window.api.launcher.launch(instanceId)
    setPrompt(null)
  }

  async function updateAndPlay(info: ShortcutUpdateInfo): Promise<void> {
    setBusy('update')
    setError('')
    try {
      const r = await window.api.modpacks.update(info.instanceId, info.modpackUrl)
      const inst = useStore.getState().instances.find(i => i.id === info.instanceId)
      if (inst) useStore.getState().updateInstance({ ...inst, modpackVersion: r.manifest.version })
      setBusy('play')
      await play(info.instanceId)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  async function playWithoutUpdate(info: ShortcutUpdateInfo): Promise<void> {
    setBusy('play')
    setError('')
    try { await play(info.instanceId) }
    catch (e) { setError(errorText(e)) }
    finally { setBusy(null) }
  }

  function openInstance(instanceId: string): void {
    useStore.getState().setOpenDetailInstanceId(instanceId)
    navigate('/instances')
    close()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[500]" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="bg-bg-secondary border border-border rounded-2xl p-6 w-[440px] shadow-2xl">
        {prompt.kind === 'update' ? (
          <>
            <h2 className="text-base font-bold text-text-primary mb-2">{t('shortcut_update_title', { name: prompt.info.name })}</h2>
            <p className="text-sm text-text-muted mb-1">
              {prompt.info.currentVersion
                ? t('shortcut_update_versions', { current: prompt.info.currentVersion, latest: prompt.info.latestVersion })
                : t('shortcut_update_version', { latest: prompt.info.latestVersion })}
            </p>
            <p className="text-sm text-text-muted mb-5">{t('shortcut_update_hint')}</p>
            {error && <p className="text-sm text-red-400 mb-4 whitespace-pre-line">{error}</p>}
            <div className="flex flex-col gap-2">
              <button onClick={() => updateAndPlay(prompt.info)} disabled={!!busy}
                className="w-full py-2 bg-accent hover:bg-accent/90 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors">
                {busy === 'update' ? t('shortcut_updating') : busy === 'play' ? t('playing') : t('shortcut_update_and_play')}
              </button>
              <div className="flex gap-2">
                <button onClick={() => playWithoutUpdate(prompt.info)} disabled={!!busy}
                  className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary disabled:opacity-60 rounded-lg text-sm transition-colors">
                  {t('shortcut_play_without_update')}
                </button>
                <button onClick={close} disabled={!!busy}
                  className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary disabled:opacity-60 rounded-lg text-sm transition-colors">
                  {t('shortcut_not_now')}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-base font-bold text-text-primary mb-2">
              {prompt.info.name ? t('shortcut_error_title', { name: prompt.info.name }) : t('shortcut_error_title_generic')}
            </h2>
            <p className="text-sm text-text-muted mb-5 whitespace-pre-line">{prompt.info.message}</p>
            <div className="flex gap-2">
              {prompt.info.name && (
                <button onClick={() => openInstance(prompt.info.instanceId)}
                  className="flex-1 py-2 border border-border text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors">
                  {t('shortcut_open_instance')}
                </button>
              )}
              <button onClick={close}
                className="flex-1 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium transition-colors">
                {t('close')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
