// Operaciones del chat de fport1social, con el mismo formato de datos que la
// web (src/app/mensajes/page.js de fport1web), para que un mensaje enviado
// desde el launcher se vea igual en la web y al revés.

import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs,
  limit, query, serverTimestamp, setDoc, updateDoc, where, writeBatch, type Timestamp
} from 'firebase/firestore'
import { deleteObject, ref as sRef, uploadBytesResumable } from 'firebase/storage'
import type { User } from 'firebase/auth'
import { socialDb, socialStorage } from '../firebase'
import { attachmentPreviewLabel, imageUrlFromText, tipoSeguro, type Attachment, type AttachmentKind } from './files'

export interface Conversation {
  id: string
  participantUids: string[]
  isGroup?: boolean
  anonymous?: boolean
  groupName?: string
  groupPhotoURL?: string
  startedBy?: string
  admins?: string[]
  status?: 'pending' | 'accepted'
  requestTo?: string
  requestFrom?: string
  pairKey?: string
  lastMessage?: { text?: string; senderUid?: string; at?: Timestamp | null } | null
  lastMessageAt?: Timestamp | null
  lastSenderUid?: string | null
  updatedAt?: Timestamp | null
  readAt?: Record<string, Timestamp | null>
  typing?: Record<string, Timestamp | null>
  recording?: Record<string, Timestamp | null>
  disappearingSecs?: number
}

export interface ChatMessage {
  id: string
  clientId?: string
  type?: string
  text: string
  attachments: Attachment[]
  meta?: { viewOnce?: boolean; forwarded?: boolean; viewOnceOpenedAt?: unknown; shareType?: string; [k: string]: unknown }
  senderUid: string
  senderProfileName?: string
  at: Timestamp | null
  reactions?: Record<string, Record<string, boolean>>
  editedAt?: Timestamp | null
  forwarded?: boolean
  deletedFor?: string[]
  replyToId?: string
  replyToText?: string
  replyToSenderName?: string
  /** Solo en local: mensaje aún subiéndose o que falló. */
  pending?: 'sending' | 'error'
  error?: string
  progress?: number
}

export const REACTIONS = [
  { key: 'heart', emoji: '❤️' },
  { key: 'laugh', emoji: '😂' },
  { key: 'wow', emoji: '😮' },
  { key: 'sad', emoji: '😢' },
  { key: 'angry', emoji: '😡' },
  { key: 'like', emoji: '👍' }
]

export const tsMs = (t: unknown): number => {
  const x = t as { toMillis?: () => number; seconds?: number } | null | undefined
  if (!x) return 0
  if (typeof x.toMillis === 'function') return x.toMillis()
  if (typeof x.seconds === 'number') return x.seconds * 1000
  if (x instanceof Date) return x.getTime()
  return 0
}

/**
 * Texto de un mensaje. Igual que la web: el mensaje vive solo en `textCipher`
 * (también al editarlo; el cifrado de lib/crypto.js de la web aún pasa el texto
 * tal cual). `text` solo se usa si no hay `textCipher`.
 */
export function messageText(d: Record<string, unknown>): string {
  if (typeof d.textCipher === 'string') return d.textCipher
  return typeof d.text === 'string' ? d.text : ''
}

export function toMessage(id: string, d: Record<string, unknown>): ChatMessage {
  const meta = (d.meta ?? {}) as ChatMessage['meta']
  return {
    id,
    clientId: d.clientId as string | undefined,
    type: (d.type as string) ?? 'text',
    text: messageText(d),
    attachments: Array.isArray(d.attachments) ? (d.attachments as Attachment[]) : [],
    meta,
    senderUid: (d.senderUid as string) ?? '',
    senderProfileName: d.senderProfileName as string | undefined,
    at: (d.at as Timestamp) ?? null,
    reactions: (d.reactions ?? {}) as ChatMessage['reactions'],
    editedAt: (d.editedAt as Timestamp) ?? null,
    forwarded: !!(d.forwarded || meta?.forwarded),
    deletedFor: Array.isArray(d.deletedFor) ? (d.deletedFor as string[]) : undefined,
    replyToId: d.replyToId as string | undefined,
    replyToText: d.replyToText as string | undefined,
    replyToSenderName: d.replyToSenderName as string | undefined
  }
}

// ── Leído en local (readLocal.js de la web) ──────────────────────────────────
// serverTimestamp() llega en dos pasos y entre medias readAt es null: sin esto
// el chat vuelve a contar como no leído justo al abrirlo.
const READ_KEY = 'fport1_chat_read'
function readMap(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(READ_KEY) || '{}') } catch { return {} }
}
export function markReadLocal(cid: string): void {
  const m = readMap(); m[cid] = Date.now()
  try { localStorage.setItem(READ_KEY, JSON.stringify(m)) } catch { /* sin sitio */ }
}
export const readLocalAt = (cid: string): number => readMap()[cid] ?? 0

export function lastAtMs(c: Conversation): number {
  return tsMs(c.lastMessage?.at) || tsMs(c.lastMessageAt) || tsMs(c.updatedAt)
}

export function isUnread(c: Conversation, uid: string): boolean {
  const lastAt = tsMs(c.lastMessage?.at) || tsMs(c.lastMessageAt)
  const sender = c.lastMessage?.senderUid ?? c.lastSenderUid
  const readMs = Math.max(tsMs(c.readAt?.[uid]), readLocalAt(c.id))
  return !!lastAt && lastAt > readMs && !!sender && sender !== uid
}

export async function markConversationRead(cid: string, uid: string): Promise<void> {
  markReadLocal(cid)
  await updateDoc(doc(socialDb, 'conversations', cid), { [`readAt.${uid}`]: serverTimestamp() }).catch(() => {})
}

// ── Envío ─────────────────────────────────────────────────────────────────────

export interface OutgoingAttachment { kind: AttachmentKind; file?: File | Blob; name?: string; url?: string; isGif?: boolean }

const safeName = (name: string): string => String(name || 'file').replace(/[^\w.-]+/g, '_')

async function uploadAttachment(uid: string, cid: string, a: OutgoingAttachment, viewOnce: boolean, onProgress: (p: number) => void): Promise<Attachment> {
  const file = a.file!
  const name = a.name ?? (file as File).name ?? a.kind
  const base = `${Date.now()}_${uid}_${safeName(name)}`
  const path = viewOnce ? `viewonce/${uid}/conversations/${cid}/${base}` : `uploads/${uid}/conversations/${cid}/${base}`
  const contentType = await tipoSeguro(Object.assign(file, { name }))
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(sRef(socialStorage, path), file, { contentType })
    task.on('state_changed', (s) => onProgress(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0), reject, () => resolve())
  })
  // Sin getDownloadURL: esa URL es permanente y se salta las reglas. Se
  // guarda la ruta y el enlace se pide al mostrarlo.
  return { kind: a.kind, name, path, size: file.size || null, contentType }
}

export interface SendParams {
  user: User
  conv: Conversation
  myName: string
  text: string
  attachments?: OutgoingAttachment[]
  viewOnce?: boolean
  replyTo?: { id: string; text: string; senderName: string } | null
  clientId: string
  onProgress?: (p: number) => void
}

export async function sendMessage(p: SendParams): Promise<void> {
  const { user, conv } = p
  let text = p.text
  let atts = p.attachments ?? []
  const viewOnce = !!p.viewOnce

  if (!atts.length) {
    const img = imageUrlFromText(text)
    if (img) { atts = [{ kind: 'image', url: img.url, name: img.isGif ? 'gif.gif' : 'image', isGif: img.isGif }]; text = '' }
  }

  const toUpload = atts.filter((a) => a.file)
  const passthrough: Attachment[] = atts.filter((a) => !a.file && a.url)
    .map((a) => ({ kind: a.kind, name: a.name ?? 'gif', url: a.url, ...(a.isGif ? { isGif: true } : {}) }))

  if (toUpload.length) {
    // Cupo de subidas por usuario (disuasorio, como en la web)
    try {
      const r = await window.api.social.webPost('/api/chat-upload-check', await user.getIdToken(), { cantidad: toUpload.length })
      if (r.status === 429) throw new Error((r.data as { reason?: string })?.reason || 'Has enviado demasiados archivos seguidos.')
    } catch (e) {
      if (e instanceof Error && /demasiados|reason/i.test(e.message)) throw e
    }
  }

  const uploaded: Attachment[] = []
  for (let i = 0; i < toUpload.length; i++) {
    uploaded.push(await uploadAttachment(user.uid, conv.id, toUpload[i], viewOnce, (f) => p.onProgress?.((i + f) / toUpload.length)))
  }
  const all = [...uploaded, ...passthrough]

  await addDoc(collection(socialDb, 'conversations', conv.id, 'messages'), {
    clientId: p.clientId,
    type: all.length ? all[0].kind : 'text',
    textCipher: text,
    attachments: all,
    meta: { viewOnce },
    senderUid: user.uid,
    ...(conv.isGroup ? { senderProfileName: p.myName } : {}),
    at: serverTimestamp(),
    ...(p.replyTo ? { replyToId: p.replyTo.id, replyToText: p.replyTo.text, replyToSenderName: p.replyTo.senderName } : {})
  })

  const preview = text || (all.length ? attachmentPreviewLabel(all[0], viewOnce) : '')
  await updateDoc(doc(socialDb, 'conversations', conv.id), {
    updatedAt: serverTimestamp(),
    lastMessage: { text: preview, senderUid: user.uid, at: serverTimestamp() },
    // Campos que leían versiones anteriores del launcher
    lastSenderUid: user.uid,
    lastMessageAt: serverTimestamp(),
    [`readAt.${user.uid}`]: serverTimestamp()
  })
  markReadLocal(conv.id)

  // Push a los demás (lo decide la web: respeta silenciados y bloqueos)
  user.getIdToken().then((token) => {
    const title = conv.isGroup ? (conv.groupName || 'Grupo') : p.myName
    const body = conv.isGroup ? `${p.myName}: ${text || '📎 Adjunto'}` : (text || '📎 Adjunto')
    return window.api.social.webPost('/api/notify', token, { cid: conv.id, title, body })
  }).catch(() => {})
}

export async function editMessage(cid: string, msgId: string, text: string): Promise<void> {
  // Como la web: solo textCipher, sin dejar copia en claro
  await updateDoc(doc(socialDb, 'conversations', cid, 'messages', msgId), { textCipher: text, editedAt: serverTimestamp() })
}

export async function toggleReaction(cid: string, msg: ChatMessage, key: string, uid: string): Promise<void> {
  const mine = !!msg.reactions?.[key]?.[uid]
  await updateDoc(doc(socialDb, 'conversations', cid, 'messages', msg.id), { [`reactions.${key}.${uid}`]: mine ? deleteField() : true })
}

export async function deleteForMe(cid: string, msgId: string, uid: string): Promise<void> {
  await updateDoc(doc(socialDb, 'conversations', cid, 'messages', msgId), { deletedFor: arrayUnion(uid) })
}

export async function deleteForEveryone(cid: string, msg: ChatMessage): Promise<void> {
  for (const a of msg.attachments) {
    if (a.path) await deleteObject(sRef(socialStorage, a.path)).catch(() => {})
  }
  await updateDoc(doc(socialDb, 'conversations', cid, 'messages', msg.id), { attachments: [], type: 'deleted', text: '', textCipher: '' })
}

/** "Ver/escuchar una vez": se borra el archivo y el mensaje queda como abierto. */
export async function destroyViewOnce(cid: string, msg: ChatMessage): Promise<void> {
  const a = msg.attachments[0]
  if (a?.path) await deleteObject(sRef(socialStorage, a.path)).catch(() => {})
  await updateDoc(doc(socialDb, 'conversations', cid, 'messages', msg.id), {
    attachments: [],
    'meta.viewOnceOpenedAt': serverTimestamp(),
    type: 'viewonce_opened',
    text: msg.text || ''
  }).catch(() => {})
}

export async function forwardMessage(user: User, myName: string, target: Conversation, msg: ChatMessage): Promise<void> {
  // Los adjuntos subidos son de su conversación (las rutas incluyen el id):
  // se reenvía el texto y los GIF/enlaces externos.
  const atts = msg.attachments.filter((a) => !a.path && a.url)
  const preview = msg.text || (atts.length ? attachmentPreviewLabel(atts[0]) : '')
  await addDoc(collection(socialDb, 'conversations', target.id, 'messages'), {
    type: atts.length ? atts[0].kind : 'text',
    textCipher: msg.text,
    attachments: atts,
    meta: { forwarded: true },
    senderUid: user.uid,
    ...(target.isGroup ? { senderProfileName: myName } : {}),
    at: serverTimestamp()
  })
  await updateDoc(doc(socialDb, 'conversations', target.id), {
    updatedAt: serverTimestamp(),
    lastMessage: { text: preview, senderUid: user.uid, at: serverTimestamp() },
    lastSenderUid: user.uid,
    lastMessageAt: serverTimestamp(),
    [`readAt.${user.uid}`]: serverTimestamp()
  })
}

// ── Indicadores "escribiendo" / "grabando" ───────────────────────────────────

export function setTyping(cid: string, uid: string, on: boolean): void {
  updateDoc(doc(socialDb, 'conversations', cid), { [`typing.${uid}`]: on ? serverTimestamp() : deleteField() }).catch(() => {})
}
export function setRecording(cid: string, uid: string, on: boolean): void {
  updateDoc(doc(socialDb, 'conversations', cid), { [`recording.${uid}`]: on ? serverTimestamp() : deleteField() }).catch(() => {})
}

// ── Conversaciones ───────────────────────────────────────────────────────────

const pairKey = (a: string, b: string): string => [a, b].sort().join('_')

/** Abre (o crea) el chat directo con otra persona, con el sistema de solicitudes de la web. */
export async function openDirect(uid: string, otherUid: string): Promise<string> {
  const pk = pairKey(uid, otherUid)
  const ex = await getDocs(query(collection(socialDb, 'conversations'),
    where('participantUids', 'array-contains', uid), where('pairKey', '==', pk), limit(1)))
  if (!ex.empty) return ex.docs[0].id

  // Chats antiguos del launcher, sin pairKey
  const legacy = await getDocs(query(collection(socialDb, 'conversations'), where('participantUids', 'array-contains', uid)))
  const old = legacy.docs.find((d) => {
    const x = d.data() as Conversation
    return !x.isGroup && x.participantUids.length === 2 && x.participantUids.includes(otherUid)
  })
  if (old) return old.id

  // Entra directo solo si el otro me sigue (o somos amigos); si no, es una solicitud
  let trusted = false
  try { trusted = (await getDoc(doc(socialDb, 'users', otherUid, 'following', uid))).exists() } catch { /* sin permiso */ }
  if (!trusted) {
    try { trusted = (await getDoc(doc(socialDb, 'users', uid, 'friends', otherUid))).exists() } catch { /* sin permiso */ }
  }
  const ref = await addDoc(collection(socialDb, 'conversations'), {
    participantUids: [uid, otherUid],
    pairKey: pk,
    startedBy: uid,
    status: trusted ? 'accepted' : 'pending',
    requestTo: otherUid,
    requestFrom: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessage: null
  })
  return ref.id
}

export async function createGroup(uid: string, groupName: string, uids: string[], anonymous: boolean): Promise<string> {
  const ref = await addDoc(collection(socialDb, 'conversations'), {
    isGroup: true,
    anonymous,
    groupName: groupName.trim(),
    participantUids: [uid, ...uids],
    startedBy: uid,
    admins: [uid],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessage: null
  })
  return ref.id
}

export async function acceptRequest(uid: string, c: Conversation): Promise<void> {
  await updateDoc(doc(socialDb, 'conversations', c.id), { status: 'accepted', updatedAt: serverTimestamp() })
  if (c.requestFrom) await setDoc(doc(socialDb, 'users', uid, 'dmAccepted', c.requestFrom), { at: serverTimestamp() }).catch(() => {})
}

export async function rejectRequest(c: Conversation): Promise<void> {
  await deleteDoc(doc(socialDb, 'conversations', c.id))
}

export async function deleteConversation(cid: string): Promise<void> {
  for (;;) {
    const snap = await getDocs(query(collection(socialDb, 'conversations', cid, 'messages'), limit(100)))
    if (snap.empty) break
    const batch = writeBatch(socialDb)
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
  await deleteDoc(doc(socialDb, 'conversations', cid))
}

export async function clearConversation(cid: string): Promise<void> {
  for (;;) {
    const snap = await getDocs(query(collection(socialDb, 'conversations', cid, 'messages'), limit(100)))
    if (snap.empty) break
    const batch = writeBatch(socialDb)
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
  await updateDoc(doc(socialDb, 'conversations', cid), { lastMessage: null })
}

export async function setDisappearing(cid: string, secs: number): Promise<void> {
  await updateDoc(doc(socialDb, 'conversations', cid), { disappearingSecs: secs || deleteField() })
}

export async function toggleMute(uid: string, cid: string, muted: boolean): Promise<void> {
  await setDoc(doc(socialDb, 'users', uid, 'private', 'settings'), { mutedChats: muted ? arrayRemove(cid) : arrayUnion(cid) }, { merge: true })
}

export async function toggleBlock(uid: string, other: string, blocked: boolean): Promise<void> {
  await setDoc(doc(socialDb, 'users', uid, 'private', 'settings'), { blockedUsers: blocked ? arrayRemove(other) : arrayUnion(other) }, { merge: true })
}

export async function toggleFavorite(uid: string, cid: string, fav: boolean): Promise<void> {
  await updateDoc(doc(socialDb, 'users', uid), { chatFavorites: fav ? arrayRemove(cid) : arrayUnion(cid) })
}

export async function renameGroup(cid: string, name: string): Promise<void> {
  await updateDoc(doc(socialDb, 'conversations', cid), { groupName: name.trim() })
}
