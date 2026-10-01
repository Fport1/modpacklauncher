import { useEffect, useState } from 'react'
import type { AiActivity } from '../../../../shared/types'
import AiToolPicker from './AiToolPicker'
import { useStore } from '../../store'

// La IA de todo el launcher (no de una instancia): ayuda con cualquier
// instancia, crea modelos, efectos, sonido o vídeo para Minecraft y convierte
// los archivos que le pases.

const CAN_DO: { icon: string; title: string; hint: string }[] = [
  { icon: '🧰', title: 'Cualquier instancia', hint: 'Arregla crashes, cambia mods y packs o mira un mundo de la instancia que le digas' },
  { icon: '🧊', title: 'Modelos y animaciones', hint: 'Bloques, ítems y entidades; Blockbench, GeckoLib, Blender y el sistema de modelos de Minecraft' },
  { icon: '✨', title: 'Efectos y shaders', hint: 'Partículas, post-procesado, shaderpacks y lo que equivale a VFX de Unity' },
  { icon: '🎵', title: 'Audio, vídeo e imágenes', hint: 'Convierte mp3, wav, mp4, gif o jpg a lo que Minecraft acepta y lo mete en un pack' },
]

export default function LauncherAiModal({ onClose }: { onClose: () => void }) {
  const instances = useStore((s) => s.instances)
  const [error, setError] = useState('')
  const [activity, setActivity] = useState<AiActivity[]>([])

  useEffect(() => {
    window.api.aiAgent.activity().then((l) => setActivity(l.slice(-60))).catch(() => {})
    return window.api.aiAgent.onActivity((a) => setActivity((l) => [...l.slice(-59), a]))
  }, [])

  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const nameOf = (id: string): string => instances.find((i) => i.id === id)?.name ?? id

  return (
    <div className="fixed inset-0 z-[260] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="w-[760px] max-h-[90vh] flex flex-col bg-bg-secondary border border-border rounded-3xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-6 py-5 border-b border-border" style={{ background: 'linear-gradient(115deg, rgba(217,119,87,0.25), rgba(168,85,247,0.12) 55%, transparent 85%)' }}>
          <div className="w-12 h-12 rounded-2xl bg-[#d97757]/20 text-[#e8a488] flex items-center justify-center">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M10 2.5c.4 3.9 2.1 5.6 6 6-3.9.4-5.6 2.1-6 6-.4-3.9-2.1-5.6-6-6 3.9-.4 5.6-2.1 6-6Z" /><path d="M18 12.5c.25 2.3 1.2 3.25 3.5 3.5-2.3.25-3.25 1.2-3.5 3.5-.25-2.3-1.2-3.25-3.5-3.5 2.3-.25 3.25-1.2 3.5-3.5Z" /></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-text-primary">IA del launcher</p>
            <p className="text-xs text-text-muted">Una IA para todo el launcher: todas tus instancias, crear contenido para Minecraft y convertir archivos</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-hover">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 gap-2.5">
            {CAN_DO.map((c) => (
              <div key={c.title} className="flex gap-3 p-3 rounded-2xl bg-bg-card border border-border">
                <span className="text-xl leading-none mt-0.5">{c.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary">{c.title}</p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-snug">{c.hint}</p>
                </div>
              </div>
            ))}
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Abrir la IA ya conectada al launcher</p>
            <AiToolPicker onError={setError} open={(tool) => window.api.aiAgent.openLauncherTerminal(tool)}
              extra={<button onClick={() => window.api.aiAgent.openLauncherFolder()} className="px-4 py-2 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover">Abrir carpeta</button>} />
            <p className="text-xs text-text-muted mt-2">
              Se abre en su propia carpeta, con la lista de tus {instances.length} instancias y las guías. Prueba a pedirle «convierte este mp3 en un sonido para mi pack de la instancia X», «haz una textura animada con este gif» o «¿cómo paso un modelo de Blender a GeckoLib?». Para trabajar a fondo en una sola instancia, usa el botón IA de sus detalles.
            </p>
            {error && <p className="text-sm text-red-300 mt-2">{error}</p>}
          </div>

          {activity.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted mb-2">Actividad de la IA en tus instancias</p>
              <div className="max-h-48 overflow-y-auto rounded-2xl bg-bg-card border border-border divide-y divide-border">
                {[...activity].reverse().map((a, i) => (
                  <div key={i} className="flex gap-3 px-3.5 py-2 text-xs">
                    <span className="text-text-muted shrink-0 tabular-nums">{new Date(a.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="text-text-muted shrink-0 max-w-[140px] truncate">{nameOf(a.instanceId)}</span>
                    <span className={a.kind === 'error' ? 'text-red-300' : a.kind === 'denied' ? 'text-amber-300' : a.kind === 'change' ? 'text-text-primary' : 'text-text-secondary'}>{a.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
