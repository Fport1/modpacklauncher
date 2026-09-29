import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { guardChatFile, kindOf, type AttachmentKind } from '../../lib/chat/files'
import type { OutgoingAttachment } from '../../lib/chat/api'
import { EmojiPicker, GifPicker } from './pickers'

interface Staged { id: string; kind: AttachmentKind; file: File; preview?: string }

export interface ComposerHandle { addFiles: (files: File[]) => void; focus: () => void }

interface Props {
  disabled?: boolean
  disabledReason?: string
  draftKey: string
  replyTo: { id: string; text: string; senderName: string } | null
  onCancelReply: () => void
  onSend: (p: { text: string; attachments: OutgoingAttachment[]; viewOnce: boolean }) => void
  onTyping: (on: boolean) => void
  onRecording: (on: boolean) => void
  onError: (msg: string) => void
}

const DRAFT_KEY = 'ml-chat-drafts'
function loadDraft(k: string): string {
  try { return (JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') as Record<string, string>)[k] ?? '' } catch { return '' }
}
function saveDraft(k: string, v: string): void {
  try {
    const m = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') as Record<string, string>
    if (v) m[k] = v; else delete m[k]
    localStorage.setItem(DRAFT_KEY, JSON.stringify(m))
  } catch { /* sin sitio */ }
}

const Icon = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
)

const Composer = forwardRef<ComposerHandle, Props>(function Composer(p, ref) {
  const [text, setText] = useState(() => loadDraft(p.draftKey))
  const [staged, setStaged] = useState<Staged[]>([])
  const [viewOnce, setViewOnce] = useState(false)
  const [picker, setPicker] = useState<'emoji' | 'gif' | null>(null)
  const [recording, setRecording] = useState<{ start: number } | null>(null)
  const [recTime, setRecTime] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const recRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; stream: MediaStream; send: boolean } | null>(null)
  const typingRef = useRef<{ on: boolean; t?: ReturnType<typeof setTimeout> }>({ on: false })

  // Borrador por conversación
  useEffect(() => { setText(loadDraft(p.draftKey)); setStaged([]); setViewOnce(false) }, [p.draftKey])
  useEffect(() => { saveDraft(p.draftKey, text) }, [text, p.draftKey])
  useEffect(() => { if (p.replyTo) taRef.current?.focus() }, [p.replyTo])

  // Altura automática
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [text])

  useEffect(() => () => {
    staged.forEach((s) => s.preview && URL.revokeObjectURL(s.preview))
    recRef.current?.stream.getTracks().forEach((t) => t.stop())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function addFiles(files: File[]): Promise<void> {
    for (const f of files) {
      const kind = await kindOf(f)
      const g = await guardChatFile(f, kind)
      if (!g.ok) { p.onError(g.motivo); continue }
      setStaged((prev) => [...prev, {
        id: Math.random().toString(36).slice(2), kind, file: f,
        preview: kind === 'image' || kind === 'video' ? URL.createObjectURL(f) : undefined
      }].slice(0, 10))
    }
  }

  useImperativeHandle(ref, () => ({ addFiles: (f) => { addFiles(f) }, focus: () => taRef.current?.focus() }))

  function typing(): void {
    const t = typingRef.current
    if (!t.on) { t.on = true; p.onTyping(true) }
    clearTimeout(t.t)
    t.t = setTimeout(() => { t.on = false; p.onTyping(false) }, 4000)
  }
  function stopTyping(): void {
    const t = typingRef.current
    clearTimeout(t.t)
    if (t.on) { t.on = false; p.onTyping(false) }
  }

  function send(): void {
    if (p.disabled) return
    const body = text.trim()
    if (!body && !staged.length) return
    p.onSend({ text: body, attachments: staged.map((s) => ({ kind: s.kind, file: s.file, name: s.file.name })), viewOnce: viewOnce && staged.length > 0 })
    setText('')
    staged.forEach((s) => s.preview && URL.revokeObjectURL(s.preview))
    setStaged([])
    setViewOnce(false)
    stopTyping()
  }

  function insert(s: string): void {
    const ta = taRef.current
    if (!ta) { setText((t) => t + s); return }
    const a = ta.selectionStart ?? text.length
    const b = ta.selectionEnd ?? text.length
    const next = text.slice(0, a) + s + text.slice(b)
    setText(next)
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(a + s.length, a + s.length) })
  }

  // ── Nota de voz ──
  async function startRec(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      const state = { rec, chunks: [] as Blob[], stream, send: false }
      rec.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        p.onRecording(false)
        if (!state.send || !state.chunks.length) return
        const blob = new Blob(state.chunks, { type: 'audio/webm' })
        const file = new File([blob], `audio_${Date.now()}.webm`, { type: 'audio/webm' })
        p.onSend({ text: '', attachments: [{ kind: 'audio', file, name: file.name }], viewOnce: false })
      }
      recRef.current = state
      rec.start(250)
      setRecording({ start: Date.now() })
      p.onRecording(true)
    } catch {
      p.onError('No se pudo usar el micrófono. Revisa los permisos del sistema.')
    }
  }
  function stopRec(sendIt: boolean): void {
    const r = recRef.current
    if (!r) return
    r.send = sendIt
    r.rec.stop()
    recRef.current = null
    setRecording(null)
  }
  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => {
      const s = (Date.now() - recording.start) / 1000
      setRecTime(s)
      if (s >= 300) stopRec(true) // 5 min como mucho
    }, 200)
    return () => clearInterval(t)
  }, [recording]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasMedia = staged.some((s) => s.kind !== 'file')

  return (
    <div className="shrink-0 border-t border-[#2a2a38] bg-[#111118] px-3 pt-2 pb-3">
      {p.replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-[#18181f] border-l-4 border-[#a855f7] px-3 py-2 chat-slide-up">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-[#a855f7]">Respondiendo a {p.replyTo.senderName}</p>
            <p className="text-xs text-[#a1a1aa] truncate">{p.replyTo.text || 'Adjunto'}</p>
          </div>
          <button onClick={p.onCancelReply} className="text-[#71717a] hover:text-white w-7 h-7 rounded-full hover:bg-white/10">✕</button>
        </div>
      )}

      {staged.length > 0 && (
        <div className="mb-2 chat-slide-up">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {staged.map((s) => (
              <div key={s.id} className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-[#18181f] border border-[#2a2a38] group">
                {s.kind === 'image' && s.preview && <img src={s.preview} alt="" className="w-full h-full object-cover" />}
                {s.kind === 'video' && s.preview && <video src={s.preview} className="w-full h-full object-cover" muted />}
                {(s.kind === 'file' || s.kind === 'audio') && (
                  <div className="w-full h-full flex flex-col items-center justify-center p-1 text-center">
                    <span className="text-2xl">{s.kind === 'audio' ? '🎵' : '📄'}</span>
                    <span className="text-[9px] text-[#a1a1aa] truncate w-full">{s.file.name}</span>
                  </div>
                )}
                <button onClick={() => { if (s.preview) URL.revokeObjectURL(s.preview); setStaged((prev) => prev.filter((x) => x.id !== s.id)) }}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
              </div>
            ))}
          </div>
          {hasMedia && (
            <label className="mt-1.5 inline-flex items-center gap-2 text-xs text-[#a1a1aa] cursor-pointer select-none">
              <input type="checkbox" checked={viewOnce} onChange={(e) => setViewOnce(e.target.checked)} className="accent-[#7c3aed]" />
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-current text-[9px] font-bold">1</span>
              Ver una vez
            </label>
          )}
        </div>
      )}

      {recording ? (
        <div className="flex items-center gap-3 h-11 rounded-2xl bg-[#18181f] border border-[#f87171]/40 px-3 chat-slide-up">
          <span className="w-2.5 h-2.5 rounded-full bg-[#f87171] animate-pulse" />
          <span className="text-sm text-[#f4f4f5] tabular-nums">{Math.floor(recTime / 60)}:{String(Math.floor(recTime % 60)).padStart(2, '0')}</span>
          <div className="flex-1 flex items-center gap-[3px] h-6 overflow-hidden">
            {Array.from({ length: 40 }, (_, i) => (
              <span key={i} className="flex-1 rounded-full bg-[#f87171]/70 chat-rec-bar" style={{ animationDelay: `${(i % 8) * 0.08}s` }} />
            ))}
          </div>
          <button onClick={() => stopRec(false)} className="text-xs text-[#a1a1aa] hover:text-white px-2 py-1">Cancelar</button>
          <button onClick={() => stopRec(true)} className="w-9 h-9 rounded-full bg-[#7c3aed] hover:bg-[#8b5cf6] text-white flex items-center justify-center">
            <Icon d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" size={16} />
          </button>
        </div>
      ) : (
        <div className="relative flex items-end gap-1.5">
          {picker === 'emoji' && <EmojiPicker onPick={insert} onClose={() => setPicker(null)} />}
          {picker === 'gif' && (
            <GifPicker onClose={() => setPicker(null)} onPick={(g) => {
              setPicker(null)
              p.onSend({ text: '', attachments: [{ kind: 'image', url: g.full, name: 'gif.gif', isGif: true }], viewOnce: false })
            }} />
          )}
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          <button title="Emojis" disabled={p.disabled} onClick={() => setPicker(picker === 'emoji' ? null : 'emoji')}
            className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-xl transition-colors ${picker === 'emoji' ? 'bg-[#7c3aed]/25' : 'hover:bg-white/10'} disabled:opacity-40`}>😊</button>
          <button title="GIF" disabled={p.disabled} onClick={() => setPicker(picker === 'gif' ? null : 'gif')}
            className={`h-10 px-2 shrink-0 rounded-full text-[11px] font-extrabold tracking-wide transition-colors ${picker === 'gif' ? 'bg-[#7c3aed]/25 text-[#e9d5ff]' : 'text-[#a1a1aa] hover:bg-white/10 hover:text-white'} disabled:opacity-40`}>GIF</button>
          <button title="Adjuntar foto, video o archivo" disabled={p.disabled} onClick={() => fileRef.current?.click()}
            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[#a1a1aa] hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40">
            <Icon d="m21.44 11.05-9.19 9.19a6 6 0 01-8.49-8.49l8.57-8.57A4 4 0 1118 8.84l-8.59 8.57a2 2 0 01-2.83-2.83l8.49-8.48" />
          </button>
          <div className={`flex-1 min-w-0 rounded-2xl border bg-[#18181f] transition-colors ${p.disabled ? 'border-[#2a2a38] opacity-60' : 'border-[#2a2a38] focus-within:border-[#7c3aed]'}`}>
            <textarea ref={taRef} rows={1} value={text} disabled={p.disabled}
              placeholder={p.disabled ? (p.disabledReason ?? 'No puedes escribir aquí') : 'Escribe un mensaje…'}
              onChange={(e) => { setText(e.target.value); if (e.target.value) typing(); else stopTyping() }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files)
                if (files.length) { e.preventDefault(); addFiles(files) }
              }}
              className="w-full resize-none bg-transparent px-3.5 py-2.5 text-[14px] leading-5 text-[#f4f4f5] outline-none placeholder:text-[#71717a]" />
          </div>
          {text.trim() || staged.length ? (
            <button onClick={send} disabled={p.disabled} title="Enviar"
              className="w-10 h-10 shrink-0 rounded-full bg-[#7c3aed] hover:bg-[#8b5cf6] text-white flex items-center justify-center shadow-lg shadow-[#7c3aed]/30 transition-transform active:scale-90 chat-pop disabled:opacity-40">
              <Icon d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" size={17} />
            </button>
          ) : (
            <button onClick={startRec} disabled={p.disabled} title="Grabar nota de voz"
              className="w-10 h-10 shrink-0 rounded-full bg-[#18181f] border border-[#2a2a38] text-[#a1a1aa] hover:text-white hover:border-[#7c3aed] flex items-center justify-center transition-colors disabled:opacity-40">
              <Icon d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v3" size={18} />
            </button>
          )}
        </div>
      )}
    </div>
  )
})

export default Composer
