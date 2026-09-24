import { lazy, Suspense, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { getMonacoLanguage } from '../../lib/monacoLanguage'
import EditorShell, { useSaver, type CloseRequest } from './EditorShell'
import { errText } from './shared'

// El mismo editor que la pestaña de config de las instancias (Monaco), dentro
// del cuadro. Nada se escribe hasta pulsar Guardar o Ctrl+S; deshacer y
// rehacer (Ctrl+Z, Ctrl+Y) los trae Monaco de serie.
const ConfigFileEditor = lazy(() => import('../ConfigFileEditor'))

interface Props {
  name: string
  location: string
  load: () => Promise<string>
  save: (content: string) => Promise<void>
  onClose: () => void
  closeRef?: MutableRefObject<CloseRequest | null>
  headerExtra?: ReactNode
}

export default function TextEditor({ name, location, load, save, onClose, closeRef, headerExtra }: Props) {
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const contentRef = useRef(content)
  contentRef.current = content
  const dirty = content !== saved

  const saver = useSaver(async () => {
    const toSave = contentRef.current
    await save(toSave)
    setSaved(toSave)
  }, '✓ Guardado')
  // Monaco registra el atajo una sola vez: con una referencia llama siempre a la versión actual
  const saveRef = useRef(saver.run)
  saveRef.current = saver.run

  useEffect(() => {
    load()
      .then((text) => { setContent(text); setSaved(text) })
      .catch((e) => setLoadError(errText(e)))
      .finally(() => setLoading(false))
  }, [])

  const spinner = (
    <div className="w-full h-full flex items-center justify-center" style={{ background: '#1e1e1e' }}>
      <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <EditorShell code title={name} subtitle={location} dirty={dirty} onSave={saver.run} saving={saver.saving}
      status={saver.status} onClose={onClose} closeRef={closeRef} headerExtra={headerExtra}>
      <div className="relative flex-1 min-h-0">
        <div className="absolute inset-0">
          {loading ? spinner : loadError ? (
            <div className="w-full h-full flex items-center justify-center p-8 text-center">
              <p className="text-sm text-[#f48771]">{loadError}</p>
            </div>
          ) : (
            <Suspense fallback={spinner}>
              <ConfigFileEditor
                language={getMonacoLanguage(name)}
                value={content}
                onChange={setContent}
                onMount={(editor, monacoInstance) => {
                  editor.addAction({
                    id: 'save-text-file',
                    label: 'Guardar archivo',
                    keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS],
                    run: () => { saveRef.current() }
                  })
                  editor.focus()
                }}
                loadingNode={spinner}
              />
            </Suspense>
          )}
        </div>
      </div>
      <div className="flex items-center px-3 text-xs text-white shrink-0" style={{ height: 22, background: '#007acc' }}>
        <span className="opacity-90">{getMonacoLanguage(name).toUpperCase()}</span>
        <span className="ml-4 opacity-70 truncate">Ctrl+S guardar · Ctrl+Z deshacer · Ctrl+Y rehacer</span>
      </div>
    </EditorShell>
  )
}
