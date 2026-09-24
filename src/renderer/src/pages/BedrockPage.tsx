import { useEffect, useState } from 'react'
import type { BedrockEdition, BedrockStatus } from '../../../shared/types'
import { useStore, activeAccount } from '../store'
import { useTextures } from '../lib/mcTextures'
import { IconPlay, IconDownload, IconRefresh, IconCheck } from '../components/ui/icons'

// Minecraft Bedrock (Minecraft for Windows) como en el launcher oficial:
// jugar si está instalado, instalar si no. Lo instala y actualiza la
// Microsoft Store; aquí se detecta, se abre y se lleva a la Store.

export default function BedrockPage() {
  const account = useStore(activeAccount)
  const [status, setStatus] = useState<BedrockStatus | null>(null)
  const [owned, setOwned] = useState<boolean | null>(null)
  const [launching, setLaunching] = useState<BedrockEdition | null>(null)
  const [error, setError] = useState('')

  async function refresh(): Promise<void> {
    setStatus(await window.api.bedrock.status().catch(() => ({ supported: true, editions: {} })))
  }

  // Se vuelve a mirar cada pocos segundos: así se ve al momento si se abre,
  // se cierra o se termina de instalar desde la Store
  useEffect(() => {
    refresh()
    const t = setInterval(() => { if (!document.hidden) refresh() }, 5000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    setOwned(null)
    if (account?.type === 'microsoft') window.api.bedrock.owned(account.id).then(setOwned).catch(() => setOwned(null))
  }, [account?.id])

  async function play(edition: BedrockEdition): Promise<void> {
    setError('')
    setLaunching(edition)
    try {
      await window.api.bedrock.launch(edition)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setTimeout(() => setLaunching(null), 4000)
    }
  }

  const release = status?.editions.release
  const preview = status?.editions.preview
  const isMicrosoft = account?.type === 'microsoft'

  return (
    <div className="h-full overflow-y-auto">
      {/* Portada */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 30% 20%, rgba(92,160,64,0.35), transparent 60%), linear-gradient(180deg, #1b2a1a 0%, #0f0f14 100%)' }} />
        <div className="relative px-10 pt-12 pb-10 flex items-center gap-10 flex-wrap">
          <GrassBlock size={150} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-widest text-[#8bd26a] uppercase">Minecraft</p>
            <h1 className="text-4xl font-extrabold text-white mt-1">Bedrock Edition</h1>
            <p className="text-sm text-white/60 mt-2 max-w-lg">
              La versión de Minecraft para Windows con juego cruzado con consolas y móviles, Marketplace y Realms.
            </p>

            <div className="mt-6 flex items-center gap-3 flex-wrap">
              {!status ? (
                <div className="h-14 w-56 rounded-xl bg-white/5 animate-pulse" />
              ) : release ? (
                <button type="button" onClick={() => play('release')} disabled={!!launching || release.running}
                  className="h-14 px-10 rounded-xl bg-[#3c8527] hover:bg-[#4aa032] disabled:opacity-70 text-white text-lg font-bold tracking-wide shadow-lg shadow-black/40 flex items-center gap-3 transition-colors border-b-4 border-[#1d4d13]">
                  {release.running ? <><IconCheck size={20} />Abierto</>
                    : launching === 'release' ? <><Spinner />Abriendo…</>
                      : <><IconPlay size={20} />JUGAR</>}
                </button>
              ) : (
                <button type="button" onClick={() => window.api.bedrock.store('release')}
                  className="h-14 px-10 rounded-xl bg-[#3c8527] hover:bg-[#4aa032] text-white text-lg font-bold tracking-wide shadow-lg shadow-black/40 flex items-center gap-3 transition-colors border-b-4 border-[#1d4d13]">
                  <IconDownload size={20} />INSTALAR
                </button>
              )}
              {release && (
                <button type="button" onClick={() => window.api.bedrock.store('release', true)}
                  className="h-11 px-4 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-white/80 text-sm flex items-center gap-2">
                  <IconRefresh size={15} />Buscar actualizaciones
                </button>
              )}
            </div>

            <div className="mt-4 flex items-center gap-3 flex-wrap text-xs">
              {release && <span className="px-2.5 py-1 rounded-full bg-white/10 text-white/70">Instalado · paquete {release.version}</span>}
              {!release && status && <span className="px-2.5 py-1 rounded-full bg-white/10 text-white/70">No está instalado en este equipo</span>}
              {isMicrosoft && owned === true && <span className="px-2.5 py-1 rounded-full bg-[#3c8527]/30 text-[#8bd26a]">✓ Incluido en tu cuenta</span>}
              {isMicrosoft && owned === false && (
                <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300">
                  Esta cuenta no tiene Bedrock: puedes comprarlo en la Store
                </span>
              )}
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          </div>
        </div>
      </div>

      <div className="px-10 py-8 space-y-6 max-w-4xl">
        {!isMicrosoft && (
          <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
            Para jugar a Bedrock hace falta haber iniciado sesión en Windows con la cuenta de Microsoft que lo compró.
          </p>
        )}

        {/* Preview */}
        <div className="flex items-center gap-4 p-4 rounded-2xl bg-bg-card border border-border">
          <GrassBlock size={48} tint="#e8a93a" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary">Minecraft Preview</p>
            <p className="text-xs text-text-muted">
              {preview ? `Instalado · paquete ${preview.version}` : 'Las novedades antes que nadie, en una instalación aparte. Puede tener fallos.'}
            </p>
          </div>
          {preview ? (
            <button type="button" onClick={() => play('preview')} disabled={!!launching}
              className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-60">
              {launching === 'preview' ? <><Spinner />Abriendo…</> : <><IconPlay size={14} />Jugar</>}
            </button>
          ) : (
            <button type="button" onClick={() => window.api.bedrock.store('preview')}
              className="px-4 py-2 rounded-xl border border-border text-sm text-text-secondary hover:text-text-primary hover:border-accent/50 flex items-center gap-2">
              <IconDownload size={14} />Instalar
            </button>
          )}
        </div>

        <p className="text-xs text-text-muted leading-relaxed">
          Bedrock lo instala y lo actualiza la Microsoft Store: el launcher lo abre y te lleva a la Store para instalarlo o
          actualizarlo. Las partidas, mundos y compras del Marketplace son las de siempre.
        </p>
      </div>
    </div>
  )
}

function Spinner() {
  return <span className="w-5 h-5 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
}

/**
 * Bloque de hierba en 3D con las texturas del juego (las de la versión que
 * tenga descargada el launcher). La textura de arriba es gris en el juego y se
 * tiñe de verde según el bioma: aquí, con el verde de las llanuras.
 */
export function GrassBlock({ size = 120, tint = '#79c05a' }: { size?: number; tint?: string }) {
  const tex = useTextures(['block/grass_block_side', 'block/grass_block_top', 'block/dirt'])
  const side = tex['block/grass_block_side']
  const top = tex['block/grass_block_top']
  const half = size / 2
  const face = (extra: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute', width: size, height: size, imageRendering: 'pixelated',
    backgroundSize: '100% 100%', backfaceVisibility: 'hidden', ...extra
  })
  if (!side || !top) {
    // Sin texturas (el launcher aún no ha descargado ninguna versión): un bloque dibujado
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" className="shrink-0 drop-shadow-2xl">
        <polygon points="32,4 60,18 32,32 4,18" fill={tint} />
        <polygon points="4,18 32,32 32,60 4,46" fill="#8b5a2b" />
        <polygon points="60,18 32,32 32,60 60,46" fill="#6b4422" />
        <polygon points="4,18 32,32 32,38 4,24" fill={tint} opacity="0.85" />
        <polygon points="60,18 32,32 32,38 60,24" fill={tint} opacity="0.7" />
      </svg>
    )
  }
  return (
    <div className="shrink-0" style={{ width: size * 1.45, height: size * 1.45, display: 'flex', alignItems: 'center', justifyContent: 'center', perspective: size * 8 }}>
      <div style={{ position: 'relative', width: size, height: size, transformStyle: 'preserve-3d', transform: 'rotateX(-28deg) rotateY(45deg)', filter: 'drop-shadow(0 20px 25px rgba(0,0,0,0.5))' }}>
        {/* Frente y derecha (con la hierba asomando por el borde) */}
        <div style={face({ backgroundImage: `url(${side})`, transform: `translateZ(${half}px)` })} />
        <div style={face({ backgroundImage: `url(${side})`, transform: `rotateY(90deg) translateZ(${half}px)`, filter: 'brightness(0.72)' })} />
        {/* Arriba: textura gris teñida */}
        <div style={face({ transform: `rotateX(90deg) translateZ(${half}px)`, backgroundColor: tint, overflow: 'hidden' })}>
          <div style={{ width: '100%', height: '100%', backgroundImage: `url(${top})`, backgroundSize: '100% 100%', imageRendering: 'pixelated', mixBlendMode: 'multiply' }} />
        </div>
      </div>
    </div>
  )
}
