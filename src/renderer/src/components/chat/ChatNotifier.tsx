import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore'
import { socialAuth, socialDb } from '../../lib/firebase'
import { isUnread, lastAtMs, type Conversation } from '../../lib/chat/api'
import { useStore } from '../../store'

/**
 * Vigila los chats de fport1social mientras el launcher está abierto, esté
 * donde esté el usuario: lleva la cuenta de no leídos para el menú y avisa
 * con una notificación del sistema cuando llega un mensaje (salvo chats
 * silenciados, personas bloqueadas o el chat que ya tienes delante).
 */
export default function ChatNotifier() {
  const navigate = useNavigate()
  const setChatUnread = useStore((s) => s.setChatUnread)
  const setPendingChatCid = useStore((s) => s.setPendingChatCid)
  const seen = useRef<Record<string, number> | null>(null)
  const names = useRef<Record<string, string>>({})

  useEffect(() => {
    let unsubConvs: (() => void) | null = null
    let unsubPriv: (() => void) | null = null
    const unsubAuth = onAuthStateChanged(socialAuth, (user) => {
      unsubConvs?.(); unsubPriv?.(); seen.current = null
      if (!user) { setChatUnread(0); return }
      let muted: string[] = []
      let blocked: string[] = []
      unsubPriv = onSnapshot(doc(socialDb, 'users', user.uid, 'private', 'settings'), (s) => {
        muted = s.data()?.mutedChats ?? []
        blocked = s.data()?.blockedUsers ?? []
      }, () => {})

      const q = query(collection(socialDb, 'conversations'), where('participantUids', 'array-contains', user.uid))
      unsubConvs = onSnapshot(q, async (snap) => {
        const convs = snap.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as Omit<Conversation, 'id'>) }))
        setChatUnread(convs.filter((c) => !(c.status === 'pending' && c.requestTo === user.uid) && isUnread(c, user.uid)).length)

        const first = seen.current === null
        const prev = seen.current ?? {}
        const next: Record<string, number> = {}
        for (const c of convs) {
          const at = lastAtMs(c)
          next[c.id] = at
          if (first || at <= (prev[c.id] ?? 0)) continue
          const sender = c.lastMessage?.senderUid ?? c.lastSenderUid
          if (!sender || sender === user.uid || muted.includes(c.id) || blocked.includes(sender)) continue
          // El chat abierto y a la vista no avisa
          if (document.hasFocus() && location.hash.startsWith('#/friends') && useStore.getState().activeChatCid === c.id) continue
          if (typeof Notification === 'undefined' || Notification.permission === 'denied') continue
          if (Notification.permission === 'default') { Notification.requestPermission().catch(() => {}); continue }

          if (!names.current[sender]) {
            try {
              const u = (await getDoc(doc(socialDb, 'users', sender))).data()
              names.current[sender] = u?.profileName || u?.username || 'Alguien'
            } catch { names.current[sender] = 'Alguien' }
          }
          const who = names.current[sender]
          const n = new Notification(c.isGroup ? (c.groupName || 'Grupo') : who, {
            body: c.isGroup ? `${who}: ${c.lastMessage?.text ?? ''}` : (c.lastMessage?.text || 'Nuevo mensaje'),
            tag: c.id
          })
          n.onclick = () => {
            window.focus()
            setPendingChatCid(c.id)
            navigate('/friends')
          }
        }
        seen.current = next
      }, () => {})
    })
    return () => { unsubAuth(); unsubConvs?.(); unsubPriv?.() }
  }, [navigate, setChatUnread, setPendingChatCid])

  return null
}
