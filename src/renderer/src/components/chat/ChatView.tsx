import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  collection, doc, documentId, getDoc, getDocs, limit, onSnapshot, orderBy, query, startAfter, where
} from 'firebase/firestore'
import { socialDb } from '../../lib/firebase'
import {
  REACTIONS, acceptRequest, clearConversation, createGroup, deleteConversation, deleteForEveryone, deleteForMe,
  destroyViewOnce, editMessage, forwardMessage, isUnread, lastAtMs, markConversationRead, openDirect,
  rejectRequest, renameGroup, sendMessage, setDisappearing, setRecording, setTyping, toMessage, toggleBlock,
  toggleFavorite, toggleMute, toggleReaction, tsMs, type ChatMessage, type Conversation, type OutgoingAttachment
} from '../../lib/chat/api'
import { hidratarAdjuntos } from '../../lib/chat/media'
import MessageBubble, { type Tick } from './MessageBubble'
import Composer, { type ComposerHandle } from './Composer'
import { useStore } from '../../store'
import { Lightbox } from './media'

export interface ChatUser {
  uid: string
  name: string
  photo: string
  slug: string | null
  deleted: boolean
  readReceipts: boolean
}

interface Props {
  user: User
  myName: string
  isFport1: boolean
  friends: { uid: string; profileName: string | null; usernameSlug: string | null }[]
  presenceLabel: (uid: string) => { text: string; color: string } | null
  openWith: string | null
  onOpened: () => void
  openCid: string | null
  onOpenedCid: () => void
}

const PAGE = 40
const NAME_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb923c', '#22d3ee', '#f87171']
const colorFor = (uid: string): string => NAME_COLORS[[...uid].reduce((a, c) => a + c.charCodeAt(0), 0) % NAME_COLORS.length]

const DISAPPEAR_OPTS = [
  { secs: 0, label: 'Desactivado' },
  { secs: 86400, label: '24 horas' },
  { secs: 604800, label: '7 días' },
  { secs: 7776000, label: '90 días' }
]

function toChatUser(uid: string, d: Record<string, any> | undefined): ChatUser {
  const deleted = d?.status === 'deleted' || d?.profile?.status === 'deleted'
  return {
    uid,
    deleted,
    name: deleted ? 'Cuenta eliminada' : (d?.profile?.profileName || d?.profileName || d?.displayName ||
      (typeof d?.username === 'string' ? d.username.replace(/^@/, '') : '') || d?.usernameSlug || 'Usuario'),
    photo: deleted ? '' : (d?.avatarUrl || d?.photoURL || ''),
    slug: d?.usernameSlug ?? null,
    readReceipts: d?.settings?.readReceipts !== false
  }
}

function Avatar({ src, name, size = 40, group }: { src?: string; name: string; size?: number; group?: boolean }) {
  if (src) return <img src={src} alt="" className="rounded-full object-cover shrink-0 border border-white/10" style={{ width: size, height: size }} />
  return (
    <div className="rounded-full shrink-0 flex items-center justify-center font-bold text-white select-none"
      style={{ width: size, height: size, fontSize: size * 0.4, background: group ? 'linear-gradient(135deg,#7c3aed,#db2777)' : `linear-gradient(135deg,${colorFor(name)}cc,#3f3f46)` }}>
      {group
        ? <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
        : (name.trim()[0] || '?').toUpperCase()}
    </div>
  )
}

function relTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Ayer'
  if (now.getTime() - ms < 6 * 86400000) return d.toLocaleDateString('es', { weekday: 'short' })
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

function dayLabel(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Hoy'
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Ayer'
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

type Filter = 'all' | 'unread' | 'groups' | 'favorites' | 'requests'

export default function ChatView(p: Props) {
  const uid = p.user.uid
  const [convs, setConvs] = useState<Conversation[]>([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [users, setUsers] = useState<Record<string, ChatUser>>({})
  const fetchedUsers = useRef(new Set<string>())
  const [muted, setMuted] = useState<string[]>([])
  const [blocked, setBlocked] = useState<string[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [myReceipts, setMyReceipts] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [activeCid, setActiveCid] = useState<string | null>(null)

  const [serverMsgs, setServerMsgs] = useState<ChatMessage[]>([])
  const [olderMsgs, setOlderMsgs] = useState<ChatMessage[]>([])
  const [pendingMsgs, setPendingMsgs] = useState<(ChatMessage & { cid: string; retry?: () => void })[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const oldestRef = useRef<unknown>(null)

  const [replyTo, setReplyTo] = useState<{ id: string; text: string; senderName: string } | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [ctx, setCtx] = useState<{ msg: ChatMessage; x: number; y: number } | null>(null)
  const [convMenu, setConvMenu] = useState<{ conv: Conversation; x: number; y: number } | null>(null)
  const [lightbox, setLightbox] = useState<{ src: string; name?: string; protectedView?: boolean } | null>(null)
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; action: () => Promise<void> | void } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 3500) }, [])

  // ── Datos de usuarios ─────────────────────────────────────────────────────
  const ensureUsers = useCallback((uids: string[]) => {
    const missing = uids.filter((u) => u && !fetchedUsers.current.has(u))
    if (!missing.length) return
    missing.forEach((u) => fetchedUsers.current.add(u))
    Promise.all(missing.map(async (u) => {
      try { const s = await getDoc(doc(socialDb, 'users', u)); return toChatUser(u, s.exists() ? s.data() : undefined) }
      catch { return toChatUser(u, undefined) }
    })).then((list) => setUsers((prev) => { const n = { ...prev }; list.forEach((x) => { n[x.uid] = x }); return n }))
  }, [])

  // Mis ajustes: silenciados, bloqueados, favoritos, confirmaciones de lectura
  useEffect(() => {
    const u1 = onSnapshot(doc(socialDb, 'users', uid, 'private', 'settings'), (s) => {
      const d = s.data() ?? {}
      setMuted(Array.isArray(d.mutedChats) ? d.mutedChats : [])
      setBlocked(Array.isArray(d.blockedUsers) ? d.blockedUsers : [])
    }, () => {})
    const u2 = onSnapshot(doc(socialDb, 'users', uid), (s) => {
      const d = s.data() ?? {}
      setFavorites(Array.isArray(d.chatFavorites) ? d.chatFavorites : [])
      setMyReceipts(d.settings?.readReceipts !== false)
    }, () => {})
    return () => { u1(); u2() }
  }, [uid])

  // ── Conversaciones ────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(socialDb, 'conversations'), where('participantUids', 'array-contains', uid))
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as Omit<Conversation, 'id'>) }))
      list.sort((a, b) => lastAtMs(b) - lastAtMs(a))
      setConvs(list)
      setLoadingConvs(false)
      ensureUsers([...new Set(list.flatMap((c) => c.participantUids))])
    }, () => setLoadingConvs(false))
  }, [uid, ensureUsers])

  const convName = useCallback((c: Conversation): string => {
    if (c.isGroup) return c.groupName || 'Grupo'
    const other = c.participantUids.find((u) => u !== uid)
    return other ? (users[other]?.name ?? '…') : 'Tú'
  }, [users, uid])
  const convPhoto = (c: Conversation): string => {
    if (c.isGroup) return c.groupPhotoURL || ''
    const other = c.participantUids.find((u) => u !== uid)
    return other ? users[other]?.photo ?? '' : ''
  }
  const otherOf = (c: Conversation | null): string | null => (c && !c.isGroup ? c.participantUids.find((u) => u !== uid) ?? null : null)

  const isRequestForMe = (c: Conversation): boolean => c.status === 'pending' && c.requestTo === uid
  const requests = convs.filter(isRequestForMe)

  const visibleConvs = useMemo(() => {
    const s = search.trim().toLowerCase()
    return convs.filter((c) => {
      if (filter === 'requests') { if (!isRequestForMe(c)) return false }
      else if (isRequestForMe(c)) return false
      if (filter === 'unread' && !isUnread(c, uid)) return false
      if (filter === 'groups' && !c.isGroup) return false
      if (filter === 'favorites' && !favorites.includes(c.id)) return false
      if (s && !convName(c).toLowerCase().includes(s)) return false
      return true
    }).sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)) || lastAtMs(b) - lastAtMs(a))
  }, [convs, filter, search, favorites, uid, convName]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = convs.find((c) => c.id === activeCid) ?? null
  const activeOther = otherOf(active)

  // Abrir un chat pedido desde fuera (botón "Mensaje" de un amigo, notificación)
  useEffect(() => {
    if (!p.openWith) return
    const target = p.openWith
    p.onOpened()
    openDirect(uid, target).then(setActiveCid).catch(() => flash('No se pudo abrir el chat'))
  }, [p.openWith]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!p.openCid) return
    setActiveCid(p.openCid)
    p.onOpenedCid()
  }, [p.openCid]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    useStore.getState().setActiveChatCid(activeCid)
    return () => useStore.getState().setActiveChatCid(null)
  }, [activeCid])

  // ── Mensajes del chat abierto ─────────────────────────────────────────────
  useEffect(() => {
    setServerMsgs([]); setOlderMsgs([]); setHasMore(false); oldestRef.current = null
    setReplyTo(null); setEditing(null); setShowInfo(false)
    if (!activeCid) return
    setLoadingMsgs(true)
    let cancelled = false
    let first = true
    const q = query(collection(socialDb, 'conversations', activeCid, 'messages'), orderBy('at', 'desc'), limit(PAGE))
    const unsub = onSnapshot(q, async (snap) => {
      if (cancelled) return
      const rows = snap.docs.map((d) => toMessage(d.id, d.data({ serverTimestamps: 'estimate' }))).reverse()
      if (first) { first = false; setHasMore(snap.docs.length === PAGE); oldestRef.current = snap.docs[snap.docs.length - 1] ?? null }
      setServerMsgs(rows)
      setLoadingMsgs(false)
      // Quitar los pendientes que ya llegaron del servidor
      const ids = new Set(rows.map((r) => r.clientId).filter(Boolean))
      setPendingMsgs((prev) => prev.filter((m) => !(m.clientId && ids.has(m.clientId))))
      try {
        const h = await hidratarAdjuntos(activeCid, rows)
        if (!cancelled && h !== rows) setServerMsgs(h)
      } catch { /* sin enlaces */ }
    }, () => { if (!cancelled) setLoadingMsgs(false) })
    return () => { cancelled = true; unsub() }
  }, [activeCid])

  async function loadOlder(): Promise<void> {
    if (!activeCid || !oldestRef.current || loadingOlder) return
    setLoadingOlder(true)
    const el = scrollRef.current
    const prevH = el?.scrollHeight ?? 0
    try {
      const snap = await getDocs(query(collection(socialDb, 'conversations', activeCid, 'messages'),
        orderBy('at', 'desc'), startAfter(oldestRef.current), limit(PAGE)))
      oldestRef.current = snap.docs[snap.docs.length - 1] ?? oldestRef.current
      setHasMore(snap.docs.length === PAGE)
      const rows = await hidratarAdjuntos(activeCid, snap.docs.map((d) => toMessage(d.id, d.data({ serverTimestamps: 'estimate' }))).reverse())
      setOlderMsgs((prev) => [...rows, ...prev])
      requestAnimationFrame(() => { if (el) el.scrollTop += el.scrollHeight - prevH })
    } catch { /* se puede reintentar */ }
    finally { setLoadingOlder(false) }
  }

  const messages = useMemo(() => {
    const seen = new Set<string>()
    const all: ChatMessage[] = []
    for (const m of [...olderMsgs, ...serverMsgs]) { if (!seen.has(m.id)) { seen.add(m.id); all.push(m) } }
    all.push(...pendingMsgs.filter((m) => m.cid === activeCid))
    const secs = active?.disappearingSecs || 0
    const now = Date.now()
    return all
      .filter((m) => !(m.deletedFor ?? []).includes(uid))
      .filter((m) => !secs || m.pending || !tsMs(m.at) || (now - tsMs(m.at)) / 1000 <= secs)
      .sort((a, b) => (tsMs(a.at) || Number.MAX_SAFE_INTEGER) - (tsMs(b.at) || Number.MAX_SAFE_INTEGER))
  }, [olderMsgs, serverMsgs, pendingMsgs, activeCid, active?.disappearingSecs, uid])

  // Marcar como leído al abrir y al llegar mensajes (si la ventana está a la vista)
  useEffect(() => {
    if (!active || !document.hasFocus()) return
    if (isUnread(active, uid) || !tsMs(active.readAt?.[uid])) markConversationRead(active.id, uid)
  }, [active?.id, active?.lastMessage?.at, uid]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const f = (): void => { if (active && isUnread(active, uid)) markConversationRead(active.id, uid) }
    window.addEventListener('focus', f)
    return () => window.removeEventListener('focus', f)
  }, [active, uid])

  // Bajar al final al abrir y con mensajes nuevos si ya estabas abajo
  const lastMsgKey = messages[messages.length - 1]?.id
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (atBottom || messages[messages.length - 1]?.senderUid === uid) {
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
    }
  }, [lastMsgKey, activeCid]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Enviar ────────────────────────────────────────────────────────────────
  function doSend(payload: { text: string; attachments: OutgoingAttachment[]; viewOnce: boolean }): void {
    if (!active) return
    if (editing) {
      const t = payload.text.trim()
      if (t && t !== editing.text) editMessage(active.id, editing.id, t).catch(() => flash('No se pudo editar'))
      setEditing(null)
      return
    }
    const conv = active
    const clientId = crypto.randomUUID()
    const localId = 'local-' + clientId
    const reply = replyTo
    setReplyTo(null)
    const preview: ChatMessage & { cid: string } = {
      id: localId, cid: conv.id, clientId, text: payload.text, senderUid: uid, at: null, pending: 'sending', progress: 0,
      meta: { viewOnce: payload.viewOnce },
      attachments: payload.attachments.map((a) => ({
        kind: a.kind, name: a.name, isGif: a.isGif,
        url: a.url ?? (a.file && (a.kind === 'image' || a.kind === 'video' || a.kind === 'audio') ? URL.createObjectURL(a.file) : undefined)
      })),
      ...(reply ? { replyToId: reply.id, replyToText: reply.text, replyToSenderName: reply.senderName } : {})
    }
    const run = (): void => {
      setPendingMsgs((prev) => prev.map((m) => (m.id === localId ? { ...m, pending: 'sending', error: undefined } : m)))
      sendMessage({
        user: p.user, conv, myName: p.myName, text: payload.text, attachments: payload.attachments,
        viewOnce: payload.viewOnce, replyTo: reply, clientId,
        onProgress: (f) => setPendingMsgs((prev) => prev.map((m) => (m.id === localId ? { ...m, progress: f } : m)))
      }).catch((e: unknown) => {
        const msg = e instanceof Error ? (/permission/i.test(e.message) ? 'sin permiso' : e.message) : 'error'
        setPendingMsgs((prev) => prev.map((m) => (m.id === localId ? { ...m, pending: 'error', error: msg } : m)))
      })
    }
    setPendingMsgs((prev) => [...prev, { ...preview, retry: run }])
    setAtBottom(true)
    run()
  }

  // ── Acciones sobre mensajes ───────────────────────────────────────────────
  const senderName = useCallback((m: ChatMessage): string =>
    m.senderUid === uid ? 'Tú' : (m.senderProfileName || users[m.senderUid]?.name || 'Usuario'), [uid, users])

  const onReply = useCallback((m: ChatMessage) => {
    setReplyTo({ id: m.id, text: m.text || (m.attachments[0] ? (m.attachments[0].isGif ? 'GIF' : m.attachments[0].kind === 'image' ? '📷 Foto' : m.attachments[0].kind === 'audio' ? '🎤 Audio' : m.attachments[0].kind === 'video' ? '🎥 Video' : '📎 Archivo') : ''), senderName: senderName(m) })
    composerRef.current?.focus()
  }, [senderName])

  const onReact = useCallback((m: ChatMessage, key: string) => {
    if (!activeCid || m.pending) return
    toggleReaction(activeCid, m, key, uid).catch(() => {})
  }, [activeCid, uid])

  const onContext = useCallback((e: React.MouseEvent, m: ChatMessage) => {
    e.preventDefault(); e.stopPropagation()
    if (m.pending) return
    setCtx({ msg: m, x: Math.min(e.clientX, window.innerWidth - 250), y: Math.min(e.clientY, window.innerHeight - 380) })
  }, [])

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`)
    if (!el) { flash('Ese mensaje es más antiguo; sube para cargarlo'); return }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlight(id)
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1600)
  }, [flash])

  const openImage = useCallback((src: string, name?: string) => setLightbox({ src, name }), [])
  const openViewOnce = useCallback((m: ChatMessage) => {
    const a = m.attachments[0]
    if (!a?.url || !activeCid) return
    const img = new Image()
    img.onload = img.onerror = () => {
      setLightbox({ src: a.url!, protectedView: true })
      destroyViewOnce(activeCid, m)
    }
    img.src = a.url
  }, [activeCid])
  const onAudioViewOnceEnd = useCallback((m: ChatMessage) => { if (activeCid) destroyViewOnce(activeCid, m) }, [activeCid])
  const onRetry = useCallback((m: ChatMessage) => { (m as ChatMessage & { retry?: () => void }).retry?.() }, [])

  function tickFor(m: ChatMessage): Tick {
    if (m.senderUid !== uid) return null
    if (m.pending) return m.pending
    if (!active) return 'sent'
    const others = active.participantUids.filter((u) => u !== uid)
    const at = tsMs(m.at)
    if (!myReceipts || !at) return 'sent'
    const readByAll = others.length > 0 && others.every((o) => users[o]?.readReceipts !== false && tsMs(active.readAt?.[o]) >= at)
    return readByAll ? 'read' : 'sent'
  }

  // ── Indicadores del otro lado ─────────────────────────────────────────────
  const [, setNow] = useState(0)
  useEffect(() => { const t = setInterval(() => setNow((n) => n + 1), 3000); return () => clearInterval(t) }, [])
  function liveStatus(): string | null {
    if (!active) return null
    const fresh = (m?: Record<string, unknown>): string[] => Object.entries(m ?? {})
      .filter(([u, t]) => u !== uid && t && Date.now() - tsMs(t) < 7000).map(([u]) => u)
    const rec = fresh(active.recording)
    const typ = fresh(active.typing)
    const names = (l: string[]): string => active.isGroup ? l.map((u) => users[u]?.name ?? '…').join(', ') + ' ' : ''
    if (rec.length) return `${names(rec)}grabando audio…`
    if (typ.length) return `${names(typ)}${active.isGroup && typ.length > 1 ? 'escriben' : 'escribiendo'}…`
    return null
  }

  function handleRecording(on: boolean): void {
    if (!activeCid) return
    if (recTimer.current) { clearInterval(recTimer.current); recTimer.current = null }
    setRecording(activeCid, uid, on)
    if (on) {
      const cid = activeCid
      recTimer.current = setInterval(() => setRecording(cid, uid, true), 4000)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const status = liveStatus()
  const unreadTotal = convs.filter((c) => !isRequestForMe(c) && isUnread(c, uid)).length
  const isBlocked = !!activeOther && blocked.includes(activeOther)
  const isAdmin = !!active?.isGroup && (active.startedBy === uid || (active.admins ?? []).includes(uid))
  const pendingSent = active?.status === 'pending' && active.requestFrom === uid

  return (
    <div className="flex-1 flex overflow-hidden bg-[#09090b] relative" onClick={() => { setCtx(null); setConvMenu(null) }}>
      {/* ── Lista de chats ── */}
      <aside className="w-[300px] shrink-0 border-r border-[#2a2a38] bg-[#111118] flex flex-col">
        <div className="px-3 pt-3 pb-2 space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[#f4f4f5] flex items-center gap-2">
              Chats
              {unreadTotal > 0 && <span className="text-[11px] min-w-[20px] h-5 px-1.5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center chat-pop">{unreadTotal}</span>}
            </h2>
            <button onClick={() => setShowNew(true)} title="Nuevo chat"
              className="w-9 h-9 rounded-full bg-[#7c3aed] hover:bg-[#8b5cf6] text-white flex items-center justify-center shadow-lg shadow-[#7c3aed]/30 transition-transform hover:scale-105">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" /></svg>
            </button>
          </div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717a]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar chat…"
              className="w-full bg-[#09090b] border border-[#2a2a38] focus:border-[#7c3aed] rounded-xl pl-9 pr-3 py-2 text-sm text-[#f4f4f5] outline-none placeholder:text-[#71717a]" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {([['all', 'Todos'], ['unread', 'No leídos'], ['groups', 'Grupos'], ['favorites', '★ Favoritos'], ['requests', `Solicitudes${requests.length ? ` · ${requests.length}` : ''}`]] as [Filter, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${filter === k ? 'bg-[#7c3aed] border-[#7c3aed] text-white' : 'border-[#2a2a38] text-[#a1a1aa] hover:bg-white/5'} ${k === 'requests' && requests.length ? 'border-[#f87171]/50' : ''}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingConvs && <p className="text-center text-sm text-[#71717a] py-10">Cargando chats…</p>}
          {!loadingConvs && visibleConvs.length === 0 && (
            <div className="text-center py-12 px-6">
              <p className="text-3xl mb-2">💬</p>
              <p className="text-sm text-[#a1a1aa]">{filter === 'requests' ? 'No tienes solicitudes' : search ? 'Ningún chat coincide' : 'Aún no tienes chats'}</p>
              {filter === 'all' && !search && <button onClick={() => setShowNew(true)} className="mt-3 text-sm text-[#a855f7] hover:underline">Empieza uno</button>}
            </div>
          )}
          {visibleConvs.map((c) => {
            const unread = isUnread(c, uid)
            const last = c.lastMessage
            const mineLast = last?.senderUid === uid
            const name = convName(c)
            const other = otherOf(c)
            const pres = other ? p.presenceLabel(other) : null
            return (
              <button key={c.id} onClick={() => setActiveCid(c.id)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setConvMenu({ conv: c, x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 220) }) }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-l-[3px] ${activeCid === c.id ? 'bg-[#7c3aed]/15 border-[#a855f7]' : 'border-transparent hover:bg-white/[.03]'}`}>
                <div className="relative">
                  <Avatar src={convPhoto(c)} name={name} size={46} group={c.isGroup} />
                  {pres?.color && <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-[#111118]" style={{ background: pres.color }} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className={`text-[14px] truncate flex-1 ${unread ? 'font-bold text-white' : 'font-medium text-[#e4e4e7]'}`}>{name}</p>
                    <span className={`text-[11px] shrink-0 ${unread ? 'text-[#a855f7] font-semibold' : 'text-[#71717a]'}`}>{relTime(lastAtMs(c))}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <p className={`text-[12.5px] truncate flex-1 ${unread ? 'text-[#e4e4e7]' : 'text-[#71717a]'}`}>
                      {isRequestForMe(c) ? <span className="text-[#fbbf24]">Quiere hablar contigo</span>
                        : c.status === 'pending' && c.requestFrom === uid ? <span className="italic">Solicitud enviada</span>
                        : last?.text ? <>{mineLast ? 'Tú: ' : c.isGroup && last.senderUid ? `${users[last.senderUid]?.name?.split(' ')[0] ?? ''}: ` : ''}{last.text}</>
                        : <span className="italic">Sin mensajes</span>}
                    </p>
                    {favorites.includes(c.id) && <span className="text-[#fbbf24] text-xs">★</span>}
                    {muted.includes(c.id) && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2"><path d="M11 5 6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6" /></svg>}
                    {unread && <span className="w-2.5 h-2.5 rounded-full bg-[#a855f7] shrink-0 chat-pop" />}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* ── Hilo ── */}
      {!active ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#7c3aed]/30 to-[#db2777]/20 flex items-center justify-center text-5xl mb-4 chat-float">💬</div>
          <p className="text-lg font-semibold text-[#f4f4f5]">Tus mensajes de fport1social</p>
          <p className="text-sm text-[#71717a] mt-1 max-w-sm">Los mismos chats que en la web: fotos, GIFs, notas de voz y archivos. Elige una conversación o empieza una nueva.</p>
          <button onClick={() => setShowNew(true)} className="mt-5 px-5 py-2.5 rounded-xl bg-[#7c3aed] hover:bg-[#8b5cf6] text-white text-sm font-semibold">Nuevo chat</button>
        </div>
      ) : (
        <section className="flex-1 flex flex-col min-w-0 relative"
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true) } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); composerRef.current?.addFiles(Array.from(e.dataTransfer.files)) }}>
          {/* Cabecera */}
          <header className="h-16 shrink-0 flex items-center gap-3 px-4 border-b border-[#2a2a38] bg-[#111118]/80 backdrop-blur">
            <Avatar src={convPhoto(active)} name={convName(active)} size={40} group={active.isGroup} />
            <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setShowInfo((v) => !v)}>
              <p className="font-semibold text-[15px] text-[#f4f4f5] truncate flex items-center gap-2">
                {convName(active)}
                {active.anonymous && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-[#a1a1aa] font-medium">Anónimo</span>}
              </p>
              <p className={`text-xs truncate ${status ? 'text-[#4ade80]' : 'text-[#71717a]'}`}>
                {status ?? (active.isGroup
                  ? (active.anonymous && !isAdmin ? 'Grupo anónimo' : `${active.participantUids.length} miembros`)
                  : (activeOther && p.presenceLabel(activeOther)?.text) || (activeOther && users[activeOther]?.slug ? `@${users[activeOther]!.slug}` : ''))}
              </p>
            </div>
            {active.disappearingSecs ? <span title="Mensajes temporales" className="text-[#a1a1aa]">⏱</span> : null}
            <button onClick={() => setShowInfo((v) => !v)} title="Información del chat"
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${showInfo ? 'bg-[#7c3aed]/25 text-white' : 'text-[#a1a1aa] hover:bg-white/10'}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            </button>
          </header>

          {isRequestForMe(active) && (
            <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-[#fbbf24]/10 border-b border-[#fbbf24]/30 chat-slide-up">
              <p className="flex-1 text-sm text-[#fde68a]"><b>{convName(active)}</b> quiere enviarte mensajes. ¿Aceptas la solicitud?</p>
              <button onClick={() => rejectRequest(active).then(() => setActiveCid(null)).catch(() => flash('No se pudo rechazar'))} className="px-3 py-1.5 rounded-lg border border-[#2a2a38] text-sm text-[#a1a1aa] hover:text-white">Rechazar</button>
              <button onClick={() => acceptRequest(uid, active).then(() => setFilter('all')).catch(() => flash('No se pudo aceptar'))} className="px-3 py-1.5 rounded-lg bg-[#7c3aed] hover:bg-[#8b5cf6] text-sm text-white font-semibold">Aceptar</button>
            </div>
          )}

          <div className="flex-1 flex min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
              {/* Mensajes */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto py-3 space-y-1.5 chat-bg"
                onScroll={(e) => {
                  const el = e.currentTarget
                  setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
                  if (el.scrollTop < 60 && hasMore && !loadingOlder) loadOlder()
                }}>
                {loadingOlder && <p className="text-center text-xs text-[#71717a] py-2">Cargando anteriores…</p>}
                {!hasMore && !loadingMsgs && messages.length > 0 && (
                  <p className="text-center text-[11px] text-[#52525b] py-2">Inicio de la conversación</p>
                )}
                {loadingMsgs && messages.length === 0 && <p className="text-center text-sm text-[#71717a] py-10">Cargando mensajes…</p>}
                {!loadingMsgs && messages.length === 0 && (
                  <div className="text-center py-16 chat-fade">
                    <p className="text-4xl mb-2">👋</p>
                    <p className="text-sm text-[#a1a1aa]">{pendingSent ? 'Solicitud enviada. Puedes escribirle ya: lo verá al aceptar.' : 'Saluda para empezar la conversación'}</p>
                  </div>
                )}
                {messages.map((m, i) => {
                  const prev = messages[i - 1]
                  const at = tsMs(m.at) || Date.now()
                  const pAt = prev ? (tsMs(prev.at) || Date.now()) : 0
                  const newDay = !prev || new Date(at).toDateString() !== new Date(pAt).toDateString()
                  const mine = m.senderUid === uid
                  const showSender = !!active.isGroup && !mine && (newDay || prev?.senderUid !== m.senderUid)
                  return (
                    <div key={m.id}>
                      {newDay && (
                        <div className="flex justify-center my-3">
                          <span className="px-3 py-1 rounded-full bg-[#18181f] border border-[#2a2a38] text-[11px] text-[#a1a1aa] capitalize">{dayLabel(at)}</span>
                        </div>
                      )}
                      <MessageBubble msg={m} mine={mine} myUid={uid} showSender={showSender}
                        senderName={senderName(m)} senderColor={colorFor(m.senderUid)} tick={tickFor(m)} highlighted={highlight === m.id}
                        onContext={onContext} onReply={onReply} onReact={onReact} onJumpTo={jumpTo}
                        onOpenImage={openImage} onOpenViewOnce={openViewOnce} onAudioViewOnceEnd={onAudioViewOnceEnd} onRetry={onRetry} />
                    </div>
                  )
                })}
              </div>

              {!atBottom && (
                <button onClick={() => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }}
                  className="absolute right-6 bottom-24 w-10 h-10 rounded-full bg-[#18181f] border border-[#2a2a38] text-white shadow-xl flex items-center justify-center hover:bg-[#232330] chat-pop z-10">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6" /></svg>
                </button>
              )}

              {editing && (
                <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-[#18181f] border-t border-[#2a2a38] chat-slide-up">
                  <span className="text-[#a855f7]">✎</span>
                  <p className="flex-1 text-xs text-[#a1a1aa] truncate">Editando: {editing.text}</p>
                  <button onClick={() => setEditing(null)} className="text-xs text-[#71717a] hover:text-white">Cancelar</button>
                </div>
              )}

              <Composer ref={composerRef} key={activeCid + (editing ? ':edit:' + editing.id : '')}
                draftKey={editing ? `edit:${editing.id}` : active.id}
                disabled={isBlocked}
                disabledReason={isBlocked ? 'Has bloqueado a esta persona' : undefined}
                replyTo={replyTo} onCancelReply={() => setReplyTo(null)}
                onSend={doSend}
                onTyping={(on) => setTyping(active.id, uid, on)}
                onRecording={handleRecording}
                onError={flash} />
            </div>

            {showInfo && (
              <InfoPanel conv={active} uid={uid} users={users} name={convName(active)} photo={convPhoto(active)}
                muted={muted.includes(active.id)} blocked={isBlocked} favorite={favorites.includes(active.id)} isAdmin={isAdmin}
                sharedImages={messages.flatMap((m) => m.attachments.filter((a) => a.kind === 'image' && a.url && !m.meta?.viewOnce).map((a) => a.url!)).slice(-12).reverse()}
                onOpenImage={openImage}
                onClose={() => setShowInfo(false)}
                onToggleMute={() => toggleMute(uid, active.id, muted.includes(active.id)).catch(() => flash('No se pudo cambiar'))}
                onToggleBlock={() => activeOther && toggleBlock(uid, activeOther, isBlocked).catch(() => flash('No se pudo cambiar'))}
                onToggleFav={() => toggleFavorite(uid, active.id, favorites.includes(active.id)).catch(() => flash('No se pudo cambiar'))}
                onDisappearing={(s) => setDisappearing(active.id, s).catch(() => flash('No se pudo cambiar'))}
                onRename={(n) => renameGroup(active.id, n).catch(() => flash('Solo un admin puede renombrar el grupo'))}
                onClear={() => setConfirm({ title: 'Vaciar chat', message: 'Se borrarán todos los mensajes para todos los participantes.', label: 'Vaciar', action: () => clearConversation(active.id) })}
                onDelete={() => setConfirm({ title: 'Eliminar chat', message: '¿Eliminar el chat completo? No se puede deshacer.', label: 'Eliminar', action: async () => { await deleteConversation(active.id); setActiveCid(null) } })} />
            )}
          </div>

          {dragOver && (
            <div className="absolute inset-0 z-20 bg-[#7c3aed]/15 border-2 border-dashed border-[#a855f7] rounded-lg m-2 flex items-center justify-center pointer-events-none chat-fade">
              <p className="text-lg font-semibold text-white bg-[#18181f]/90 px-5 py-3 rounded-2xl">Suelta para adjuntar</p>
            </div>
          )}
        </section>
      )}

      {/* ── Menú de un mensaje ── */}
      {ctx && active && (
        <div className="fixed z-[2000] w-[240px] rounded-2xl border border-[#2a2a38] bg-[#18181f] shadow-2xl overflow-hidden chat-pop" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between px-2 py-2 border-b border-[#2a2a38]">
            {REACTIONS.map((r) => (
              <button key={r.key} onClick={() => { onReact(ctx.msg, r.key); setCtx(null) }}
                className={`w-9 h-9 rounded-full text-xl hover:scale-125 transition-transform ${ctx.msg.reactions?.[r.key]?.[uid] ? 'bg-[#7c3aed]/30' : 'hover:bg-white/10'}`}>{r.emoji}</button>
            ))}
          </div>
          {ctx.msg.type !== 'deleted' && <>
            <MenuItem label="Responder" icon="M9 17 4 12l5-5M20 18v-2a4 4 0 00-4-4H4" onClick={() => { onReply(ctx.msg); setCtx(null) }} />
            {ctx.msg.text && <MenuItem label="Copiar texto" icon="M8 8h12v12H8zM4 16V4h12" onClick={() => { navigator.clipboard.writeText(ctx.msg.text).catch(() => {}); setCtx(null); flash('Copiado') }} />}
            {ctx.msg.senderUid === uid && ctx.msg.text && !ctx.msg.attachments.length && (
              <MenuItem label="Editar" icon="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" onClick={() => { setEditing({ id: ctx.msg.id, text: ctx.msg.text }); setCtx(null) }} />
            )}
            {!ctx.msg.meta?.viewOnce && <MenuItem label="Reenviar" icon="m15 17 5-5-5-5M4 18v-2a4 4 0 014-4h12" onClick={() => { setForwarding(ctx.msg); setCtx(null) }} />}
            {ctx.msg.attachments.filter((a) => a.url && !ctx.msg.meta?.viewOnce).map((a, i) => (
              <MenuItem key={i} label={`Guardar ${a.isGif ? 'GIF' : a.kind === 'image' ? 'foto' : a.kind === 'video' ? 'video' : a.kind === 'audio' ? 'audio' : 'archivo'}`} icon="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
                onClick={() => { window.api.social.saveFile(a.url!, a.name || 'archivo').catch(() => flash('No se pudo guardar')); setCtx(null) }} />
            ))}
          </>}
          <div className="border-t border-[#2a2a38]" />
          <MenuItem label="Eliminar para mí" icon="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" danger onClick={() => { deleteForMe(active.id, ctx.msg.id, uid).catch(() => flash('No se pudo eliminar')); setCtx(null) }} />
          {(ctx.msg.senderUid === uid || isAdmin) && ctx.msg.type !== 'deleted' && (
            <MenuItem label="Eliminar para todos" icon="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6" danger onClick={() => {
              const m = ctx.msg; setCtx(null)
              setConfirm({ title: 'Eliminar para todos', message: 'El mensaje desaparecerá para todos los participantes.', label: 'Eliminar', action: () => deleteForEveryone(active.id, m) })
            }} />
          )}
        </div>
      )}

      {/* ── Menú de una conversación ── */}
      {convMenu && (
        <div className="fixed z-[2000] w-[220px] rounded-2xl border border-[#2a2a38] bg-[#18181f] shadow-2xl overflow-hidden chat-pop py-1" style={{ left: convMenu.x, top: convMenu.y }} onClick={(e) => e.stopPropagation()}>
          <MenuItem label={favorites.includes(convMenu.conv.id) ? 'Quitar de favoritos' : 'Añadir a favoritos'} icon="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"
            onClick={() => { toggleFavorite(uid, convMenu.conv.id, favorites.includes(convMenu.conv.id)).catch(() => {}); setConvMenu(null) }} />
          <MenuItem label={muted.includes(convMenu.conv.id) ? 'Activar avisos' : 'Silenciar'} icon="M11 5 6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6"
            onClick={() => { toggleMute(uid, convMenu.conv.id, muted.includes(convMenu.conv.id)).catch(() => {}); setConvMenu(null) }} />
          {isUnread(convMenu.conv, uid) && <MenuItem label="Marcar como leído" icon="M20 6 9 17l-5-5" onClick={() => { markConversationRead(convMenu.conv.id, uid); setConvMenu(null) }} />}
          <div className="border-t border-[#2a2a38] my-1" />
          <MenuItem label="Eliminar chat" icon="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" danger onClick={() => {
            const c = convMenu.conv; setConvMenu(null)
            setConfirm({ title: 'Eliminar chat', message: `¿Eliminar el chat con ${convName(c)}? No se puede deshacer.`, label: 'Eliminar', action: async () => { await deleteConversation(c.id); if (activeCid === c.id) setActiveCid(null) } })
          }} />
        </div>
      )}

      {forwarding && (
        <ForwardModal convs={convs.filter((c) => c.id !== activeCid && !isRequestForMe(c))} name={convName} photo={convPhoto}
          onClose={() => setForwarding(null)}
          onPick={async (c) => {
            const m = forwarding; setForwarding(null)
            try { await forwardMessage(p.user, p.myName, c, m); flash(`Reenviado a ${convName(c)}`) } catch { flash('No se pudo reenviar') }
          }} />
      )}

      {showNew && (
        <NewChatModal uid={uid} friends={p.friends} isFport1={p.isFport1} onClose={() => setShowNew(false)}
          onOpenDirect={async (other) => { setShowNew(false); try { setActiveCid(await openDirect(uid, other)); setFilter('all') } catch { flash('No se pudo abrir el chat') } }}
          onCreateGroup={async (name, uids, anon) => { setShowNew(false); try { setActiveCid(await createGroup(uid, name, uids, anon)); setFilter('all') } catch { flash('No se pudo crear el grupo') } }} />
      )}

      {confirm && (
        <div className="fixed inset-0 z-[2500] bg-black/60 flex items-center justify-center chat-fade" onClick={() => setConfirm(null)}>
          <div className="w-[360px] rounded-2xl bg-[#18181f] border border-[#2a2a38] p-5 chat-zoom" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-semibold text-white">{confirm.title}</p>
            <p className="text-sm text-[#a1a1aa] mt-1.5">{confirm.message}</p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 rounded-lg border border-[#2a2a38] text-sm text-[#a1a1aa] hover:text-white">Cancelar</button>
              <button onClick={async () => { const c = confirm; setConfirm(null); try { await c.action() } catch { flash('No se pudo completar') } }}
                className="px-4 py-2 rounded-lg bg-[#dc2626] hover:bg-[#ef4444] text-sm text-white font-semibold">{confirm.label}</button>
            </div>
          </div>
        </div>
      )}

      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.name} protectedView={lightbox.protectedView} onClose={() => setLightbox(null)} />}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[3100] px-4 py-2.5 rounded-xl bg-[#18181f] border border-[#2a2a38] text-sm text-white shadow-2xl chat-slide-up">{toast}</div>
      )}
    </div>
  )
}

function MenuItem({ label, icon, onClick, danger }: { label: string; icon: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-3.5 py-2 text-sm text-left transition-colors ${danger ? 'text-[#f87171] hover:bg-[#f87171]/10' : 'text-[#e4e4e7] hover:bg-white/5'}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-80"><path d={icon} /></svg>
      {label}
    </button>
  )
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: () => void; label: string; hint?: string }) {
  return (
    <button onClick={onChange} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[.03] text-left">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#e4e4e7]">{label}</p>
        {hint && <p className="text-[11px] text-[#71717a]">{hint}</p>}
      </div>
      <span className={`w-10 h-6 rounded-full relative transition-colors ${on ? 'bg-[#7c3aed]' : 'bg-[#3f3f46]'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

function InfoPanel(p: {
  conv: Conversation; uid: string; users: Record<string, ChatUser>; name: string; photo: string
  muted: boolean; blocked: boolean; favorite: boolean; isAdmin: boolean; sharedImages: string[]
  onOpenImage: (s: string) => void; onClose: () => void
  onToggleMute: () => void; onToggleBlock: () => void; onToggleFav: () => void
  onDisappearing: (s: number) => void; onRename: (n: string) => void; onClear: () => void; onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(p.conv.groupName ?? '')
  const other = !p.conv.isGroup ? p.conv.participantUids.find((u) => u !== p.uid) : null
  const showMembers = p.conv.isGroup && (!p.conv.anonymous || p.isAdmin)
  return (
    <aside className="w-[290px] shrink-0 border-l border-[#2a2a38] bg-[#111118] overflow-y-auto chat-slide-left">
      <div className="flex items-center justify-between px-4 h-12 border-b border-[#2a2a38]">
        <p className="text-sm font-semibold text-white">Información</p>
        <button onClick={p.onClose} className="w-7 h-7 rounded-full text-[#71717a] hover:bg-white/10 hover:text-white">✕</button>
      </div>
      <div className="flex flex-col items-center text-center px-4 py-5 border-b border-[#2a2a38]">
        <Avatar src={p.photo} name={p.name} size={84} group={p.conv.isGroup} />
        {renaming ? (
          <form className="mt-3 flex gap-1.5 w-full" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) p.onRename(newName); setRenaming(false) }}>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60}
              className="flex-1 min-w-0 bg-[#09090b] border border-[#7c3aed] rounded-lg px-2.5 py-1.5 text-sm text-white outline-none" />
            <button className="px-3 rounded-lg bg-[#7c3aed] text-white text-sm">OK</button>
          </form>
        ) : (
          <p className="mt-3 text-lg font-bold text-white flex items-center gap-1.5">
            {p.name}
            {p.conv.isGroup && p.isAdmin && <button onClick={() => setRenaming(true)} title="Renombrar" className="text-[#71717a] hover:text-white text-sm">✎</button>}
          </p>
        )}
        {other && p.users[other]?.slug && <p className="text-sm text-[#a855f7]">@{p.users[other]!.slug}</p>}
        {p.conv.isGroup && <p className="text-xs text-[#71717a] mt-0.5">{p.conv.anonymous && !p.isAdmin ? 'Grupo anónimo' : `${p.conv.participantUids.length} miembros`}</p>}
      </div>

      <div className="py-2 border-b border-[#2a2a38]">
        <Toggle on={p.favorite} onChange={p.onToggleFav} label="Favorito" hint="Aparece arriba de la lista" />
        <Toggle on={p.muted} onChange={p.onToggleMute} label="Silenciar" hint="Sin avisos de este chat" />
        {other && <Toggle on={p.blocked} onChange={p.onToggleBlock} label="Bloquear" hint="No podrás escribirle ni recibir avisos suyos" />}
      </div>

      <div className="px-4 py-3 border-b border-[#2a2a38]">
        <p className="text-xs font-semibold text-[#a1a1aa] mb-2">Mensajes temporales</p>
        <div className="flex flex-wrap gap-1.5">
          {DISAPPEAR_OPTS.map((o) => (
            <button key={o.secs} onClick={() => p.onDisappearing(o.secs)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${(p.conv.disappearingSecs || 0) === o.secs ? 'bg-[#7c3aed] border-[#7c3aed] text-white' : 'border-[#2a2a38] text-[#a1a1aa] hover:bg-white/5'}`}>{o.label}</button>
          ))}
        </div>
      </div>

      {p.sharedImages.length > 0 && (
        <div className="px-4 py-3 border-b border-[#2a2a38]">
          <p className="text-xs font-semibold text-[#a1a1aa] mb-2">Fotos compartidas</p>
          <div className="grid grid-cols-3 gap-1">
            {p.sharedImages.map((s, i) => (
              <button key={i} onClick={() => p.onOpenImage(s)} className="aspect-square rounded-lg overflow-hidden bg-white/5">
                <img src={s} alt="" className="w-full h-full object-cover hover:scale-105 transition-transform" />
              </button>
            ))}
          </div>
        </div>
      )}

      {showMembers && (
        <div className="px-2 py-3 border-b border-[#2a2a38]">
          <p className="text-xs font-semibold text-[#a1a1aa] mb-1 px-2">Miembros</p>
          {p.conv.participantUids.map((u) => (
            <div key={u} className="flex items-center gap-2.5 px-2 py-1.5">
              <Avatar src={p.users[u]?.photo} name={p.users[u]?.name ?? '?'} size={30} />
              <p className="flex-1 text-sm text-[#e4e4e7] truncate">{u === p.uid ? 'Tú' : p.users[u]?.name ?? '…'}</p>
              {(p.conv.startedBy === u || (p.conv.admins ?? []).includes(u)) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#7c3aed]/25 text-[#c4b5fd]">Admin</span>}
            </div>
          ))}
        </div>
      )}

      <div className="py-2">
        <MenuItem label="Vaciar chat" icon="M3 6h18M8 6V4h8v2" danger onClick={p.onClear} />
        <MenuItem label="Eliminar chat" icon="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" danger onClick={p.onDelete} />
      </div>
    </aside>
  )
}

function ForwardModal({ convs, name, photo, onClose, onPick }: {
  convs: Conversation[]; name: (c: Conversation) => string; photo: (c: Conversation) => string
  onClose: () => void; onPick: (c: Conversation) => void
}) {
  const [q, setQ] = useState('')
  const list = convs.filter((c) => name(c).toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="fixed inset-0 z-[2500] bg-black/60 flex items-center justify-center chat-fade" onClick={onClose}>
      <div className="w-[360px] max-h-[70vh] flex flex-col rounded-2xl bg-[#18181f] border border-[#2a2a38] overflow-hidden chat-zoom" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-[#2a2a38]">
          <p className="text-base font-semibold text-white mb-2">Reenviar a…</p>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar chat"
            className="w-full bg-[#09090b] border border-[#2a2a38] focus:border-[#7c3aed] rounded-lg px-3 py-2 text-sm text-white outline-none" />
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {list.length === 0 && <p className="text-center text-sm text-[#71717a] py-6">Sin chats</p>}
          {list.map((c) => (
            <button key={c.id} onClick={() => onPick(c)} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-white/5 text-left">
              <Avatar src={photo(c)} name={name(c)} size={36} group={c.isGroup} />
              <span className="text-sm text-[#e4e4e7] truncate">{name(c)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function NewChatModal({ uid, friends, isFport1, onClose, onOpenDirect, onCreateGroup }: {
  uid: string
  friends: { uid: string; profileName: string | null; usernameSlug: string | null }[]
  isFport1: boolean
  onClose: () => void
  onOpenDirect: (uid: string) => void
  onCreateGroup: (name: string, uids: string[], anonymous: boolean) => void
}) {
  const [mode, setMode] = useState<'direct' | 'group'>('direct')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ uid: string; slug: string; name: string }[]>([])
  const [picked, setPicked] = useState<{ uid: string; name: string }[]>([])
  const [groupName, setGroupName] = useState('')
  const [anon, setAnon] = useState(false)

  // Buscar por @usuario en la colección usernames (igual que añadir amigo)
  useEffect(() => {
    const s = q.trim().toLowerCase().replace(/^@/, '')
    if (s.length < 2) { setFound([]); return }
    const t = setTimeout(async () => {
      try {
        const snap = await getDocs(query(collection(socialDb, 'usernames'), where(documentId(), '>=', s), where(documentId(), '<=', s + ''), limit(8)))
        const rows = await Promise.all(snap.docs.map(async (d) => {
          const u = (d.data() as { uid: string }).uid
          let name = d.id
          try { const us = await getDoc(doc(socialDb, 'users', u)); name = us.data()?.profileName ?? d.id } catch { /* sin permiso */ }
          return { uid: u, slug: d.id, name }
        }))
        setFound(rows.filter((r) => r.uid !== uid))
      } catch { setFound([]) }
    }, 250)
    return () => clearTimeout(t)
  }, [q, uid])

  const friendRows = friends.filter((f) => {
    const s = q.trim().toLowerCase().replace(/^@/, '')
    return !s || (f.profileName ?? '').toLowerCase().includes(s) || (f.usernameSlug ?? '').includes(s)
  })

  function choose(u: string, name: string): void {
    if (mode === 'direct') { onOpenDirect(u); return }
    setPicked((p) => (p.some((x) => x.uid === u) ? p.filter((x) => x.uid !== u) : [...p, { uid: u, name }]))
  }

  return (
    <div className="fixed inset-0 z-[2500] bg-black/60 flex items-center justify-center chat-fade" onClick={onClose}>
      <div className="w-[420px] max-h-[80vh] flex flex-col rounded-2xl bg-[#18181f] border border-[#2a2a38] overflow-hidden chat-zoom" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 space-y-3 border-b border-[#2a2a38]">
          <div className="flex items-center justify-between">
            <p className="text-base font-semibold text-white">Nuevo chat</p>
            <button onClick={onClose} className="w-7 h-7 rounded-full text-[#71717a] hover:bg-white/10 hover:text-white">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#09090b]">
            {(['direct', 'group'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === m ? 'bg-[#7c3aed] text-white' : 'text-[#a1a1aa] hover:text-white'}`}>
                {m === 'direct' ? 'Mensaje directo' : 'Grupo'}
              </button>
            ))}
          </div>
          {mode === 'group' && (
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Nombre del grupo" maxLength={60}
              className="w-full bg-[#09090b] border border-[#2a2a38] focus:border-[#7c3aed] rounded-lg px-3 py-2 text-sm text-white outline-none" />
          )}
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar amigo o @usuario"
            className="w-full bg-[#09090b] border border-[#2a2a38] focus:border-[#7c3aed] rounded-lg px-3 py-2 text-sm text-white outline-none" />
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {picked.map((x) => (
                <span key={x.uid} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-[#7c3aed]/25 text-xs text-[#e9d5ff]">
                  {x.name}<button onClick={() => setPicked((p) => p.filter((y) => y.uid !== x.uid))} className="w-4 h-4 rounded-full hover:bg-white/20">✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {friendRows.length > 0 && <p className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Amigos</p>}
          {friendRows.map((f) => (
            <Row key={f.uid} name={f.profileName ?? f.usernameSlug ?? 'Amigo'} sub={f.usernameSlug ? `@${f.usernameSlug}` : ''}
              selected={picked.some((x) => x.uid === f.uid)} group={mode === 'group'}
              onClick={() => choose(f.uid, f.profileName ?? f.usernameSlug ?? 'Amigo')} />
          ))}
          {found.filter((r) => !friends.some((f) => f.uid === r.uid)).length > 0 && <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">Usuarios</p>}
          {found.filter((r) => !friends.some((f) => f.uid === r.uid)).map((r) => (
            <Row key={r.uid} name={r.name} sub={`@${r.slug}`} selected={picked.some((x) => x.uid === r.uid)} group={mode === 'group'} onClick={() => choose(r.uid, r.name)} />
          ))}
          {!friendRows.length && !found.length && <p className="text-center text-sm text-[#71717a] py-8">Escribe al menos 2 letras del @usuario</p>}
        </div>
        {mode === 'group' && (
          <div className="p-4 border-t border-[#2a2a38] space-y-3">
            {isFport1 && (
              <label className="flex items-center gap-2 text-sm text-[#a1a1aa] cursor-pointer">
                <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="accent-[#7c3aed]" />
                Grupo anónimo (nadie ve la lista de miembros)
              </label>
            )}
            <button disabled={!picked.length || !groupName.trim()} onClick={() => onCreateGroup(groupName, picked.map((x) => x.uid), anon)}
              className="w-full py-2.5 rounded-xl bg-[#7c3aed] hover:bg-[#8b5cf6] disabled:opacity-40 text-white text-sm font-semibold">
              Crear grupo{picked.length ? ` (${picked.length + 1})` : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ name, sub, selected, group, onClick }: { name: string; sub: string; selected: boolean; group: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-white/5 text-left">
      <Avatar name={name} size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[#e4e4e7] truncate">{name}</p>
        {sub && <p className="text-xs text-[#71717a] truncate">{sub}</p>}
      </div>
      {group && (
        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${selected ? 'bg-[#7c3aed] border-[#7c3aed]' : 'border-[#52525b]'}`}>
          {selected && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5"><path d="M20 6 9 17l-5-5" /></svg>}
        </span>
      )}
    </button>
  )
}
