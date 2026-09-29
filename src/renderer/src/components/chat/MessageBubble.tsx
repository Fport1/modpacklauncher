import { memo, useState } from 'react'
import { REACTIONS, tsMs, type ChatMessage } from '../../lib/chat/api'
import type { Attachment } from '../../lib/chat/files'
import { AudioMessage, FileAttachment } from './media'

export type Tick = 'sending' | 'sent' | 'read' | 'error' | null

interface Props {
  msg: ChatMessage
  mine: boolean
  myUid: string
  showSender: boolean
  senderName: string
  senderColor: string
  tick: Tick
  highlighted?: boolean
  onContext: (e: React.MouseEvent, msg: ChatMessage) => void
  onReply: (msg: ChatMessage) => void
  onReact: (msg: ChatMessage, key: string) => void
  onJumpTo: (id: string) => void
  onOpenImage: (src: string, name?: string) => void
  onOpenViewOnce: (msg: ChatMessage) => void
  onAudioViewOnceEnd: (msg: ChatMessage) => void
  onRetry: (msg: ChatMessage) => void
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g

function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1
          ? <a key={i} href={p} onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.api.shell.openExternal(p) }}
              className="underline decoration-white/40 hover:decoration-white break-all">{p}</a>
          : <span key={i}>{p}</span>
      )}
    </>
  )
}

function emojiOnly(s: string): number {
  const t = s.trim()
  if (!t || t.length > 24) return 0
  const re = /\p{Extended_Pictographic}(?:️|︎)?(?:‍\p{Extended_Pictographic}(?:️|︎)?)*/gu
  const m = t.match(re)
  if (!m) return 0
  return t.replace(re, '').replace(/[\s️‍]/g, '') === '' ? m.length : 0
}

const fmtTime = (ms: number): string =>
  ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

function Ticks({ tick }: { tick: Tick }) {
  if (!tick) return null
  if (tick === 'sending') return <svg className="animate-spin opacity-70" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 11-6.2-8.56" /></svg>
  if (tick === 'error') return <span className="text-[#f87171] font-bold">!</span>
  if (tick === 'read') return <span className="text-[#7dd3fc] font-semibold tracking-[-3px] pr-0.5">✓✓</span>
  return <span className="opacity-70">✓</span>
}

function Images({ atts, onOpen }: { atts: Attachment[]; onOpen: (src: string, name?: string) => void }) {
  const n = atts.length
  return (
    <div className={`grid gap-1 ${n === 1 ? 'grid-cols-1' : 'grid-cols-2'} max-w-[320px]`}>
      {atts.slice(0, 4).map((a, i) => (
        <button key={i} onClick={(e) => { e.stopPropagation(); if (a.url) onOpen(a.url, a.name) }}
          className={`relative overflow-hidden rounded-xl bg-black/30 ${n === 1 ? '' : 'aspect-square'} ${n === 3 && i === 0 ? 'col-span-2 aspect-[2/1]' : ''}`}>
          {a.url
            ? <img src={a.url} alt="" loading="lazy" className={`w-full h-full object-cover ${n === 1 ? 'max-h-[340px] min-h-[80px]' : ''} hover:scale-[1.03] transition-transform duration-300`} />
            : <div className="w-full h-40 animate-pulse bg-white/5" />}
          {i === 3 && n > 4 && <span className="absolute inset-0 bg-black/60 flex items-center justify-center text-2xl font-bold">+{n - 4}</span>}
        </button>
      ))}
    </div>
  )
}

function MessageBubble(p: Props) {
  const { msg, mine } = p
  const [hover, setHover] = useState(false)
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([])
  const at = tsMs(msg.at)
  const atts = msg.attachments ?? []
  const images = atts.filter((a) => a.kind === 'image')
  const video = atts.find((a) => a.kind === 'video')
  const audio = atts.find((a) => a.kind === 'audio')
  const files = atts.filter((a) => a.kind === 'file')
  const viewOnce = !!msg.meta?.viewOnce && atts.length > 0
  const deleted = msg.type === 'deleted'
  const opened = msg.type === 'viewonce_opened'
  const onlyGif = !msg.text && images.length === 1 && images[0].isGif && !viewOnce
  const big = !atts.length && !deleted ? emojiOnly(msg.text) : 0
  const bare = onlyGif || (big > 0 && big <= 3) || (!!video && !msg.text && !viewOnce) || (images.length > 0 && !msg.text && !viewOnce)
  const reactions = REACTIONS.filter((r) => Object.keys(msg.reactions?.[r.key] ?? {}).length > 0)

  function dbl(e: React.MouseEvent): void {
    if (deleted || msg.pending) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const id = Date.now() + Math.random()
    setHearts((h) => [...h, { id, x: e.clientX - r.left, y: e.clientY - r.top }])
    setTimeout(() => setHearts((h) => h.filter((x) => x.id !== id)), 850)
    if (!msg.reactions?.heart?.[p.myUid]) p.onReact(msg, 'heart')
  }

  const bubbleCls = bare
    ? ''
    : mine
      ? 'bg-gradient-to-br from-[#7c3aed] to-[#6d28d9] text-white rounded-2xl rounded-br-md shadow-md shadow-[#7c3aed]/20'
      : 'bg-[#1f1f2a] text-[#f4f4f5] rounded-2xl rounded-bl-md border border-white/5'

  return (
    <div id={`msg-${msg.id}`} className={`group flex ${mine ? 'justify-end' : 'justify-start'} px-4 chat-msg-in`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className={`relative flex items-end gap-1.5 max-w-[78%] ${mine ? 'flex-row-reverse' : ''}`}>
        <div className="min-w-0">
          {p.showSender && !mine && (
            <p className="text-[11px] font-semibold mb-0.5 ml-2" style={{ color: p.senderColor }}>{p.senderName}</p>
          )}
          <div data-bubble onDoubleClick={dbl} onContextMenu={(e) => p.onContext(e, msg)}
            className={`relative ${bubbleCls} ${bare ? '' : 'px-3 py-2'} ${p.highlighted ? 'ring-2 ring-[#60a5fa] ring-offset-2 ring-offset-[#09090b]' : ''} transition-shadow`}>
            {hearts.map((h) => (
              <span key={h.id} className="chat-float-heart" style={{ left: h.x - 14, top: h.y - 20 }}>❤️</span>
            ))}

            {msg.forwarded && !deleted && (
              <p className={`text-[11px] italic mb-1 flex items-center gap-1 ${bare ? 'text-[#71717a]' : 'opacity-70'}`}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 17 5-5-5-5M4 18v-2a4 4 0 014-4h12" /></svg>
                Reenviado
              </p>
            )}

            {msg.replyToId && !deleted && (
              <button onClick={(e) => { e.stopPropagation(); p.onJumpTo(msg.replyToId!) }}
                className={`block w-full text-left mb-1.5 rounded-lg px-2.5 py-1.5 border-l-[3px] ${mine ? 'bg-black/20 border-white/60' : 'bg-white/5 border-[#a855f7]'}`}>
                <p className={`text-[11px] font-semibold ${mine ? 'text-white/90' : 'text-[#a855f7]'}`}>{msg.replyToSenderName || 'Mensaje'}</p>
                <p className="text-xs opacity-75 truncate max-w-[260px]">{msg.replyToText || 'Adjunto'}</p>
              </button>
            )}

            {deleted ? (
              <p className="italic text-sm opacity-60 flex items-center gap-1.5">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></svg>
                Mensaje eliminado
              </p>
            ) : opened ? (
              <p className="italic text-sm opacity-70 flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-current text-[9px] font-bold not-italic">1</span>
                {mine ? 'Abierto' : 'Ya lo abriste'}
              </p>
            ) : viewOnce ? (
              mine ? (
                <p className="text-sm flex items-center gap-2 py-0.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border-2 border-current text-[10px] font-bold">1</span>
                  {images.length ? 'Foto' : video ? 'Video' : 'Audio'} de ver una vez
                </p>
              ) : audio && audio.url ? (
                <AudioMessage src={audio.url} mine={mine} onEnded={() => p.onAudioViewOnceEnd(msg)} />
              ) : (
                <button onClick={(e) => { e.stopPropagation(); p.onOpenViewOnce(msg) }} disabled={!atts[0]?.url}
                  className="flex items-center gap-2.5 py-1 text-sm font-medium hover:opacity-80 disabled:opacity-50">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-[#a855f7] text-[#a855f7] text-xs font-bold chat-pulse-ring">1</span>
                  {atts[0]?.url ? `Toca para ver la ${images.length ? 'foto' : 'imagen'}` : 'Cargando…'}
                </button>
              )
            ) : (
              <>
                {images.length > 0 && <Images atts={images} onOpen={p.onOpenImage} />}
                {video && (
                  video.url
                    ? <video src={video.url} controls preload="metadata" className="rounded-xl max-w-[320px] max-h-[360px] bg-black" onClick={(e) => e.stopPropagation()} />
                    : <div className="w-[260px] h-40 rounded-xl animate-pulse bg-white/5" />
                )}
                {audio && (audio.url ? <AudioMessage src={audio.url} mine={mine} /> : <p className="text-sm opacity-60 py-2">🎤 Cargando audio…</p>)}
                {files.map((f, i) => <div key={i} className={i ? 'mt-1.5' : ''}><FileAttachment att={f} mine={mine} /></div>)}
                {msg.text && (
                  <p className={`whitespace-pre-wrap break-words ${big && big <= 3 ? 'text-5xl leading-tight py-1' : 'text-[14px] leading-[1.4]'} ${atts.length ? 'mt-1.5 px-0.5' : ''}`}>
                    <Linkified text={msg.text} />
                  </p>
                )}
              </>
            )}

            {msg.pending === 'sending' && msg.progress !== undefined && msg.progress < 1 && atts.length > 0 && (
              <div className="mt-1.5 h-1 rounded-full bg-white/20 overflow-hidden"><div className="h-full bg-white transition-all" style={{ width: `${Math.round(msg.progress * 100)}%` }} /></div>
            )}

            <div className={`flex items-center justify-end gap-1 text-[10px] leading-none mt-1 select-none ${bare ? 'text-[#71717a] px-1' : 'opacity-70'}`}>
              {msg.editedAt && !deleted && <span className="italic">editado</span>}
              <span>{fmtTime(at || Date.now())}</span>
              {mine && <Ticks tick={p.tick} />}
            </div>
          </div>

          {msg.pending === 'error' && (
            <button onClick={() => p.onRetry(msg)} className="mt-1 text-[11px] text-[#f87171] hover:underline block ml-auto" title={msg.error}>
              No se envió · {msg.error ? `${msg.error} · ` : ''}Reintentar
            </button>
          )}

          {reactions.length > 0 && (
            <div className={`flex gap-1 -mt-1.5 relative z-10 ${mine ? 'justify-end pr-2' : 'pl-2'}`}>
              {reactions.map((r) => {
                const who = Object.keys(msg.reactions?.[r.key] ?? {})
                const me = who.includes(p.myUid)
                return (
                  <button key={r.key} onClick={() => p.onReact(msg, r.key)}
                    className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border shadow chat-pop transition-colors ${me ? 'bg-[#7c3aed]/40 border-[#a855f7]/60' : 'bg-[#18181f] border-[#2a2a38] hover:bg-[#232330]'}`}>
                    <span>{r.emoji}</span>{who.length > 1 && <span className="text-[10px] text-[#d4d4d8]">{who.length}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Acciones al pasar el ratón */}
        {!deleted && !msg.pending && (
          <div className={`flex items-center gap-0.5 self-center transition-opacity ${hover ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button title="Responder" onClick={() => p.onReply(msg)} className="w-7 h-7 rounded-full text-[#a1a1aa] hover:bg-white/10 hover:text-white flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 17 4 12l5-5M20 18v-2a4 4 0 00-4-4H4" /></svg>
            </button>
            <button title="Más" onClick={(e) => p.onContext(e, msg)} className="w-7 h-7 rounded-full text-[#a1a1aa] hover:bg-white/10 hover:text-white flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(MessageBubble)
