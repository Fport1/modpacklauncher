import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile,
  signInWithCredential, GoogleAuthProvider, fetchSignInMethodsForEmail,
  deleteUser, sendPasswordResetEmail, type User,
} from 'firebase/auth'
import {
  doc, getDoc, setDoc, writeBatch, onSnapshot, collection, deleteDoc, serverTimestamp,
  addDoc, query, where, limit, updateDoc, getDocs, documentId, arrayUnion, arrayRemove,
} from 'firebase/firestore'
import { socialAuth, socialDb } from '../lib/firebase'
import { useStore, activeAccount } from '../store'
import {
  reserveUsernameAndUpsertProfile, validateHandle, normalizeHandle,
  USERNAME_MIN, USERNAME_MAX, DISPLAY_NAME_MAX,
} from '../lib/username'

const WEB = 'https://fport1web.vercel.app'

interface Conversation {
  id: string
  participantUids: string[]
  lastMessage: any
  lastMessageAt: any
  lastSenderUid: string | null
  otherUid: string
  otherName: string | null
  groupName?: string | null
  isGroup?: boolean
  hasUnread: boolean
}


interface ChatMessage {
  id: string
  text: string
  senderUid: string
  at: any
  reactions: Record<string, string[]>
  edited?: boolean
  forwarded?: boolean
  replyTo?: { msgId: string; text: string; senderUid: string } | null
}

const REACTIONS = ['👍','❤️','😂','😮','😢','😡','🎉','🔥']

function convLastText(lastMessage: any): string {
  if (!lastMessage) return ''
  if (typeof lastMessage === 'string') return lastMessage
  return lastMessage?.text ?? ''
}

function convLastAt(conv: Conversation): any {
  return conv.lastMessageAt ?? conv.lastMessage?.at ?? null
}

function fmtTime(ts: any): string {
  if (!ts) return ''
  const d: Date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000)       return 'ahora'
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

function fmtMsgTime(ts: any): string {
  if (!ts) return ''
  const d: Date = ts?.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return d.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' })
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function fmtDateSep(ts: any): string {
  const d: Date = ts?.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  const now = new Date()
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  if (isSameDay(d, now)) return 'Hoy'
  if (isSameDay(d, yesterday)) return 'Ayer'
  return d.toLocaleDateString('es-ES', { weekday:'short', day:'numeric', month:'short' })
}

// ── Design tokens — fport1web exact palette ────────────────────────────────────
const C = {
  bg:      '#09090b',
  card:    '#111118',
  card2:   '#18181f',
  border:  '#2a2a38',
  text:    '#f4f4f5',
  sub:     '#a1a1aa',
  muted:   '#71717a',
  accent:  '#7c3aed',
  accent2: '#a855f7',
  green:   '#4ade80',
  blue:    '#60a5fa',
  red:     '#f87171',
  yellow:  '#facc15',
}

// ── CSS injected once ─────────────────────────────────────────────────────────
const STYLES = `
  @keyframes fadeUp      { from { opacity:0; transform:translateY(18px); filter:blur(4px) } to { opacity:1; transform:translateY(0); filter:blur(0) } }
  @keyframes fadeIn      { from { opacity:0 } to { opacity:1 } }
  @keyframes slideTab    { from { opacity:0; transform:translateX(10px) } to { opacity:1; transform:translateX(0) } }
  @keyframes slideTabOut { from { opacity:1; transform:translateX(0) }    to { opacity:0; transform:translateX(-8px) } }
  @keyframes ping        { 0%   { transform:scale(1); opacity:.75 }       100% { transform:scale(2.8); opacity:0 } }
  @keyframes spin        { to   { transform:rotate(360deg) } }
  @keyframes glow        { 0%,100% { opacity:.35 } 50% { opacity:.65 } }
  @keyframes float       { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-14px) } }
  @keyframes cardIn      { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
  @keyframes emptyPulse  { 0%,100% { transform:scale(1); opacity:.7 } 50% { transform:scale(1.12); opacity:1 } }
  @keyframes typingDot   { 0%,80%,100% { transform:scale(0.6); opacity:.4 } 40% { transform:scale(1); opacity:1 } }

  .f1-card:hover { transform:translateY(-2px); box-shadow:0 0 60px rgba(124,58,237,.12), 0 8px 28px rgba(0,0,0,.5) !important; }
  .f1-card { transition: transform .18s, box-shadow .18s; }

  .f1-btn-primary { box-shadow: 0 0 20px rgba(124,58,237,.3); transition: box-shadow .18s, transform .1s; }
  .f1-btn-primary:hover:not(:disabled) { box-shadow: 0 0 32px rgba(168,85,247,.55) !important; transform:scale(0.99); }
  .f1-btn-primary:active:not(:disabled) { transform:scale(0.97); }

  .f1-google:hover:not(:disabled) { background:#18181f !important; border-color:#a855f7 !important; }
  .f1-google { transition: background .15s, border-color .15s; }

  .f1-tab { transition: background .18s, color .18s; }
  .f1-input { transition: border-color .2s, box-shadow .2s; }
  .f1-input:focus { box-shadow: 0 0 0 3px rgba(124,58,237,.18) !important; }
  .f1-conv-item:hover { background: rgba(124,58,237,.07) !important; }
  .f1-conv-item { transition: background .15s; }
`

// ── Small helpers ──────────────────────────────────────────────────────────────

function TinySpinner() {
  return <span style={{ display:'inline-block', width:10, height:10, verticalAlign:'middle', border:`1.5px solid ${C.yellow}`, borderTopColor:'transparent', borderRadius:'50%', animation:'spin .7s linear infinite', marginRight:4 }} />
}

function Spinner({ color = C.accent, size = 22 }: { color?: string; size?: number }) {
  return (
    <svg style={{ animation:'spin .7s linear infinite', width:size, height:size }} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity=".18"/>
      <path d="M21 12a9 9 0 00-9-9"/>
    </svg>
  )
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22"/>
    </svg>
  )
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <label style={{ fontSize:13, color:C.sub, fontWeight:500 }}>{label}</label>
      {children}
    </div>
  )
}

function Hint({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ fontSize:12, color }}>{children}</span>
}

function StatusHint({ status, syntaxOk, touched, msg, checkingText, availableText, takenText }: {
  status: string; syntaxOk: boolean; touched: boolean; msg?: string
  checkingText: string; availableText: string; takenText: string
}) {
  if (status === 'checking') return <Hint color={C.yellow}><TinySpinner />{checkingText}</Hint>
  if (status === 'available' && syntaxOk) return <Hint color={C.green}>{availableText}</Hint>
  if (status === 'taken') return <Hint color={C.red}>{takenText}</Hint>
  if (touched && !syntaxOk && msg) return <Hint color={C.red}>{msg}</Hint>
  return null
}

function Divider() {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, margin:'18px 0' }}>
      <div style={{ flex:1, height:1, background:C.border }} />
      <span style={{ fontSize:12, color:C.muted }}>o con email</span>
      <div style={{ flex:1, height:1, background:C.border }} />
    </div>
  )
}

const borderColor = {
  idle:     C.border,
  ok:       'rgba(74,222,128,.5)',
  error:    'rgba(239,68,68,.6)',
  checking: 'rgba(250,204,21,.5)',
}

function inputSx(state: 'idle'|'ok'|'error'|'checking' = 'idle'): React.CSSProperties {
  return {
    padding:'11px 14px', borderRadius:10,
    border:`1px solid ${borderColor[state]}`,
    background:C.card, color:C.text, fontSize:14,
    outline:'none', width:'100%', boxSizing:'border-box',
  }
}

const googleBtnSx: React.CSSProperties = {
  width:'100%', display:'flex', alignItems:'center', justifyContent:'center',
  gap:10, padding:'12px 16px', border:`1px solid ${C.border}`,
  borderRadius:12, background:C.card, color:C.text, fontSize:14,
  fontWeight:500, cursor:'pointer', marginBottom:0,
}

const eyeBtnSx: React.CSSProperties = {
  position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
  background:'none', border:'none', cursor:'pointer', color:C.muted,
  display:'flex', alignItems:'center', padding:4,
}

// ── Skin head / Avatar ─────────────────────────────────────────────────────────

function SkinHead({ uuid, name, size = 46 }: { uuid: string; name: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { window.api.skin.getHead(uuid).then(setSrc).catch(() => {}) }, [uuid])
  const style: React.CSSProperties = { width:size, height:size, borderRadius:10, flexShrink:0 }
  return src
    ? <img src={src} alt={name} style={{ ...style, imageRendering:'pixelated' }} />
    : <Avatar name={name} size={size} />
}

function Avatar({ name, size = 46 }: { name: string; size?: number }) {
  return (
    <div style={{ width:size, height:size, borderRadius:10, flexShrink:0, background:'linear-gradient(135deg,#4c1d95,#1e3a5f)', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <span style={{ fontSize:size*.4, fontWeight:700, color:'#a78bfa' }}>{(name[0]??'?').toUpperCase()}</span>
    </div>
  )
}

// ── Presence ──────────────────────────────────────────────────────────────────

interface SocialFriend {
  uid: string
  profileName: string | null
  username: string | null
  minecraftUsername: string | null
  minecraftUUID: string | null
  presence: { online?: boolean; playing?: boolean } | null
}

function PresencePill({ p }: { p: SocialFriend['presence'] }) {
  if (p?.playing) return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:600, color:C.green }}>
      <span style={{ position:'relative', width:8, height:8, display:'inline-flex' }}>
        <span style={{ position:'absolute', inset:0, borderRadius:'50%', background:C.green, opacity:.6, animation:'ping 1.8s cubic-bezier(0,0,.2,1) infinite' }} />
        <span style={{ position:'relative', width:8, height:8, borderRadius:'50%', background:C.green }} />
      </span>
      Jugando
    </span>
  )
  if (p?.online) return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:600, color:C.blue }}>
      <span style={{ width:7, height:7, borderRadius:'50%', background:C.blue, display:'inline-block' }} />
      En línea
    </span>
  )
  return <span style={{ fontSize:11, color:C.muted }}>Desconectado</span>
}

function FriendCard({ f, delay = 0 }: { f: SocialFriend; delay?: number }) {
  const isPlaying = !!f.presence?.playing
  const isOnline  = !!f.presence?.online
  return (
    <div className="f1-card" style={{
      display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
      borderRadius:14,
      borderTop:   `1px solid ${isPlaying ? 'rgba(74,222,128,.28)' : isOnline ? 'rgba(96,165,250,.18)' : C.border}`,
      borderRight: `1px solid ${isPlaying ? 'rgba(74,222,128,.28)' : isOnline ? 'rgba(96,165,250,.18)' : C.border}`,
      borderBottom:`1px solid ${isPlaying ? 'rgba(74,222,128,.28)' : isOnline ? 'rgba(96,165,250,.18)' : C.border}`,
      borderLeft:  isPlaying ? `3px solid ${C.green}` : `1px solid ${isOnline ? 'rgba(96,165,250,.18)' : C.border}`,
      background:`linear-gradient(135deg,${C.card},${C.card2})`,
      boxShadow: isPlaying ? '0 0 22px rgba(74,222,128,.08)' : '0 2px 8px rgba(0,0,0,.3)',
      animation:`cardIn .3s ease both`, animationDelay:`${delay}ms`,
      position:'relative', overflow:'hidden',
    }}>
      {isPlaying && <div style={{ position:'absolute', inset:0, background:'linear-gradient(135deg,rgba(74,222,128,.04),transparent)', pointerEvents:'none' }} />}
      <div style={{ position:'relative', flexShrink:0 }}>
        {f.minecraftUUID
          ? <SkinHead uuid={f.minecraftUUID} name={f.profileName ?? f.username ?? '?'} size={46} />
          : <Avatar name={f.profileName ?? f.username ?? '?'} size={46} />
        }
        {isPlaying && <span style={{ position:'absolute', bottom:-2, right:-2, width:11, height:11, borderRadius:'50%', background:C.green, border:`2px solid ${C.bg}` }} />}
        {!isPlaying && isOnline && <span style={{ position:'absolute', bottom:-2, right:-2, width:11, height:11, borderRadius:'50%', background:C.blue, border:`2px solid ${C.bg}` }} />}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontSize:14, fontWeight:600, color:C.text, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {f.profileName ?? f.username ?? 'Usuario'}
        </p>
        {f.username && <p style={{ fontSize:11, fontWeight:500, color:C.accent2, margin:'1px 0 2px' }}>{f.username}</p>}
        <PresencePill p={f.presence} />
        {f.minecraftUsername && <p style={{ fontSize:10, color:C.muted, margin:'2px 0 0' }}>⛏ {f.minecraftUsername}</p>}
      </div>
    </div>
  )
}

// ── Login form ─────────────────────────────────────────────────────────────────

function LoginForm({ onGoogleAuth }: { onGoogleAuth: () => void }) {
  const [email, setEmail] = useState('')
  const [pass,  setPass]  = useState('')
  const [show,  setShow]  = useState(false)
  const [err,   setErr]   = useState('')
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setResetSent(false); setLoading(true)
    try {
      await signInWithEmailAndPassword(socialAuth, email.trim(), pass)
    } catch (ex: any) {
      setErr(
        ex.code === 'auth/invalid-credential'                        ? 'Email o contraseña incorrectos. Si te registraste con Google, usa el botón de arriba.' :
        ex.code === 'auth/account-exists-with-different-credential'  ? 'Ese email ya usa Google. Usa "Entrar con Google".' :
        ex.code === 'auth/too-many-requests'                         ? 'Demasiados intentos. Espera un momento.' :
        ex.code === 'auth/network-request-failed'                    ? 'Error de red. Comprueba tu conexión.' :
        'Error al iniciar sesión.'
      )
    } finally { setLoading(false) }
  }

  async function handleReset() {
    if (!email.trim()) { setErr('Escribe tu email primero.'); return }
    setErr(''); setResetSent(false)
    try {
      await sendPasswordResetEmail(socialAuth, email.trim())
      setResetSent(true)
    } catch { setErr('Error enviando el correo de restablecimiento.') }
  }

  return (
    <div style={{ animation:'slideTab .22s ease both' }}>
      <button onClick={onGoogleAuth} className="f1-google" style={googleBtnSx}>
        <GoogleLogo /> Entrar con Google
      </button>
      <Divider />
      <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <Field label="Correo electrónico">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            placeholder="tucorreo@ejemplo.com" className="f1-input" style={inputSx()} />
        </Field>
        <Field label="Contraseña">
          <div style={{ position:'relative' }}>
            <input type={show ? 'text' : 'password'} value={pass} onChange={e => setPass(e.target.value)} required
              placeholder="Tu contraseña" className="f1-input"
              style={{ ...inputSx(), paddingRight:44 }} />
            <button type="button" onClick={() => setShow(v => !v)} style={eyeBtnSx}>
              <EyeIcon open={show} />
            </button>
          </div>
        </Field>
        {err && <div style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:8, padding:'10px 14px', color:C.red, fontSize:13 }}>{err}</div>}
        <button type="submit" disabled={loading} className="f1-btn-primary" style={{
          padding:'12px', borderRadius:10, border:'none', fontWeight:600, fontSize:14,
          cursor: loading ? 'wait' : 'pointer',
          background: loading ? C.card2 : `linear-gradient(135deg,${C.accent},#6d28d9)`,
          color: loading ? C.muted : '#fff',
        }}>
          {loading ? <><Spinner size={14} color={C.muted} /> Entrando...</> : 'Iniciar sesión'}
        </button>
        {resetSent
          ? <p style={{ fontSize:12, color:C.green, textAlign:'center', margin:'4px 0 0' }}>Correo de restablecimiento enviado. Revisa tu bandeja.</p>
          : <button type="button" onClick={handleReset} style={{ background:'none', border:'none', color:C.muted, fontSize:12, cursor:'pointer', padding:'4px 0', textDecoration:'underline', alignSelf:'center' }}>¿Olvidaste tu contraseña?</button>
        }
      </form>
    </div>
  )
}

// ── Register form ──────────────────────────────────────────────────────────────

function RegisterForm({ onGoogleAuth, defaultMc }: { onGoogleAuth: () => void; defaultMc: string }) {
  const [form, setForm] = useState({
    profileName: '', handle: '', email: '', pass: '', pass2: '',
    minecraftUsername: defaultMc, acepta: false,
  })
  const [touched, setTouched] = useState({
    profileName:false, handle:false, email:false, pass:false, pass2:false, acepta:false,
  })
  const [show1, setShow1] = useState(false)
  const [show2, setShow2] = useState(false)
  const [emailStatus,  setEmailStatus]  = useState<'idle'|'invalid'|'checking'|'available'|'taken'|'error'>('idle')
  const [handleStatus, setHandleStatus] = useState<'idle'|'invalid'|'checking'|'available'|'taken'|'error'>('idle')
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  const up = (k: keyof typeof form, v: any) => setForm(f => ({ ...f, [k]: v }))
  const touch = (k: keyof typeof touched) => setTouched(t => ({ ...t, [k]: true }))

  const emailNorm    = form.email.trim().toLowerCase()
  const emailFmtOk   = /\S+@\S+\.\S+/.test(emailNorm)
  const passLenOk    = form.pass.length >= 8
  const passMatch    = form.pass === form.pass2
  const passMismatch = form.pass.length > 0 && form.pass2.length > 0 && !passMatch
  const profileOk    = form.profileName.trim().length >= 2
  const handleCheck  = useMemo(() => validateHandle(form.handle), [form.handle])
  const handleSynOk  = handleCheck.ok

  const canSubmit = profileOk && handleSynOk && handleStatus === 'available' &&
    emailFmtOk && emailStatus === 'available' && passLenOk && passMatch && form.acepta && !loading

  // Email availability
  useEffect(() => {
    let cancel = false
    if (!emailNorm) { setEmailStatus('idle'); return }
    if (!emailFmtOk) { setEmailStatus('invalid'); return }
    setEmailStatus('checking')
    const t = setTimeout(async () => {
      try {
        const methods = await fetchSignInMethodsForEmail(socialAuth, emailNorm)
        if (!cancel) setEmailStatus(methods.length > 0 ? 'taken' : 'available')
      } catch { if (!cancel) setEmailStatus('error') }
    }, 500)
    return () => { cancel = true; clearTimeout(t) }
  }, [emailNorm, emailFmtOk])

  // Handle availability
  useEffect(() => {
    let cancel = false
    const norm = normalizeHandle(form.handle)
    if (!norm) { setHandleStatus('idle'); return }
    if (!handleSynOk) { setHandleStatus('invalid'); return }
    setHandleStatus('checking')
    const t = setTimeout(async () => {
      try {
        const snap = await getDoc(doc(socialDb, 'usernames', norm))
        if (!cancel) setHandleStatus(snap.exists() ? 'taken' : 'available')
      } catch { if (!cancel) setHandleStatus('error') }
    }, 450)
    return () => { cancel = true; clearTimeout(t) }
  }, [form.handle, handleSynOk])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched({ profileName:true, handle:true, email:true, pass:true, pass2:true, acepta:true })
    setServerError('')
    if (!canSubmit) return
    setLoading(true)
    try {
      // Race-condition guard
      const methods = await fetchSignInMethodsForEmail(socialAuth, emailNorm)
      if (methods.length > 0) { setEmailStatus('taken'); throw new Error('Ese correo ya está registrado.') }
      const slug = normalizeHandle(form.handle)
      const unameSnap = await getDoc(doc(socialDb, 'usernames', slug))
      if (unameSnap.exists()) { setHandleStatus('taken'); throw new Error('Ese usuario ya está en uso.') }

      const cred = await createUserWithEmailAndPassword(socialAuth, emailNorm, form.pass)
      await updateProfile(cred.user, { displayName: form.profileName.trim() })

      let mcUUID: string | null = null
      if (form.minecraftUsername.trim()) {
        try {
          const r = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(form.minecraftUsername.trim())}`)
          if (r.ok) mcUUID = (await r.json()).id
        } catch { /* ignore */ }
      }

      await reserveUsernameAndUpsertProfile({
        uid: cred.user.uid, email: emailNorm,
        profileName: form.profileName.trim(),
        handleInput: form.handle,
        minecraftUsername: form.minecraftUsername.trim() || null,
        minecraftUUID: mcUUID,
      })
      // onAuthStateChanged will update UI automatically
    } catch (ex: any) {
      const code = ex?.code ?? ''
      const msg  = ex?.message ?? ''
      if (code === 'auth/weak-password')        setServerError('La contraseña es muy débil.')
      else if (code === 'auth/invalid-email')   setServerError('Correo inválido.')
      else if (code === 'auth/email-already-in-use' || /correo ya est/i.test(msg)) setServerError('Ese correo ya está registrado.')
      else if (/usuario ya est/i.test(msg))     setServerError('Ese usuario ya está en uso. Elige otro.')
      else                                      setServerError('Ocurrió un error creando la cuenta.')
      const u = socialAuth.currentUser
      if (u) { try { await deleteUser(u) } catch { /* ignore */ } }
    } finally { setLoading(false) }
  }

  const emailState = (): 'idle'|'ok'|'error'|'checking' =>
    emailStatus === 'checking' ? 'checking' :
    (emailStatus === 'available' && emailFmtOk) ? 'ok' :
    (touched.email && (!emailFmtOk || emailStatus === 'taken')) ? 'error' : 'idle'

  const handleState = (): 'idle'|'ok'|'error'|'checking' =>
    handleStatus === 'checking' ? 'checking' :
    (handleStatus === 'available' && handleSynOk) ? 'ok' :
    (touched.handle && (!handleSynOk || handleStatus === 'taken')) ? 'error' : 'idle'

  return (
    <div style={{ animation:'slideTab .22s ease both' }}>
      <button onClick={onGoogleAuth} className="f1-google" style={googleBtnSx}>
        <GoogleLogo /> Registrarse con Google
      </button>
      <Divider />
      <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <Field label="Nombre de perfil">
          <input type="text" placeholder="Cómo quieres que te vean (apodo, alias…)"
            value={form.profileName} onChange={e => up('profileName', e.target.value)}
            onBlur={() => touch('profileName')} maxLength={DISPLAY_NAME_MAX}
            className="f1-input" style={inputSx(touched.profileName && !profileOk ? 'error' : 'idle')} />
          {touched.profileName && !profileOk && <Hint color={C.red}>Mínimo 2 caracteres.</Hint>}
        </Field>

        <Field label="Usuario">
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ color:C.muted, fontSize:14 }}>@</span>
            <input type="text" placeholder="tu_usuario"
              value={form.handle} onChange={e => up('handle', normalizeHandle(e.target.value))}
              onBlur={() => touch('handle')} maxLength={USERNAME_MAX}
              className="f1-input" style={{ ...inputSx(handleState()), flex:1 }} />
          </div>
          <StatusHint status={handleStatus} syntaxOk={handleSynOk} touched={touched.handle}
            msg={handleCheck.msg} checkingText="Comprobando…"
            availableText="Disponible ✓" takenText="Ese usuario ya está en uso." />
          <Hint color={C.muted}>Solo minúsculas, números, - y _. {USERNAME_MIN}–{USERNAME_MAX} caracteres.</Hint>
        </Field>

        <Field label="Correo electrónico">
          <input type="email" placeholder="tucorreo@ejemplo.com"
            value={form.email} onChange={e => up('email', e.target.value)}
            onBlur={() => touch('email')}
            className="f1-input" style={inputSx(emailState())} />
          <StatusHint status={emailStatus} syntaxOk={emailFmtOk} touched={touched.email}
            checkingText="Comprobando…" availableText="Disponible ✓"
            takenText="Ese correo ya está registrado." />
          {touched.email && !emailFmtOk && form.email && <Hint color={C.red}>Correo inválido.</Hint>}
        </Field>

        <Field label="Contraseña">
          <div style={{ position:'relative' }}>
            <input type={show1 ? 'text' : 'password'} placeholder="Mínimo 8 caracteres"
              value={form.pass} onChange={e => up('pass', e.target.value)}
              onBlur={() => touch('pass')}
              className="f1-input" style={{ ...inputSx(touched.pass && !passLenOk ? 'error' : 'idle'), paddingRight:44 }} />
            <button type="button" onClick={() => setShow1(v => !v)} style={eyeBtnSx}><EyeIcon open={show1} /></button>
          </div>
          {touched.pass && !passLenOk && <Hint color={C.red}>Mínimo 8 caracteres.</Hint>}
        </Field>

        <Field label="Confirmar contraseña">
          <div style={{ position:'relative' }}>
            <input type={show2 ? 'text' : 'password'} placeholder="Repite tu contraseña"
              value={form.pass2} onChange={e => up('pass2', e.target.value)}
              onBlur={() => touch('pass2')}
              className="f1-input" style={{ ...inputSx(passMismatch ? 'error' : 'idle'), paddingRight:44 }} />
            <button type="button" onClick={() => setShow2(v => !v)} style={eyeBtnSx}><EyeIcon open={show2} /></button>
          </div>
          {passMismatch && <Hint color={C.red}>Las contraseñas no coinciden.</Hint>}
        </Field>

        <Field label="Usuario de Minecraft (opcional)">
          <input type="text" placeholder="TuNombreEnMinecraft"
            value={form.minecraftUsername} onChange={e => up('minecraftUsername', e.target.value)}
            className="f1-input" style={inputSx()} />
          <Hint color={C.muted}>Para mostrar tu skin en el perfil. No necesitas cuenta premium.</Hint>
        </Field>

        <label style={{ display:'flex', alignItems:'flex-start', gap:10, fontSize:13, color:C.sub, cursor:'pointer', marginTop:2 }}>
          <input type="checkbox" checked={form.acepta} onChange={e => up('acepta', e.target.checked)}
            onBlur={() => touch('acepta')}
            style={{ marginTop:2, accentColor:C.accent, width:15, height:15, flexShrink:0 }} />
          <span>
            Acepto los{' '}
            <button type="button" onClick={() => window.api.shell.openExternal(`${WEB}/terminos`)}
              style={{ background:'none', border:'none', color:C.accent2, cursor:'pointer', padding:0, fontSize:13, textDecoration:'underline' }}>Términos</button>
            {' '}y la{' '}
            <button type="button" onClick={() => window.api.shell.openExternal(`${WEB}/privacidad`)}
              style={{ background:'none', border:'none', color:C.accent2, cursor:'pointer', padding:0, fontSize:13, textDecoration:'underline' }}>Política de privacidad</button>.
          </span>
        </label>
        {touched.acepta && !form.acepta && <Hint color={C.red}>Debes aceptar los términos para continuar.</Hint>}

        {serverError && (
          <div style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:8, padding:'10px 14px', color:C.red, fontSize:13 }}>
            {serverError}
          </div>
        )}

        <button type="submit" disabled={!canSubmit} className="f1-btn-primary" style={{
          padding:'12px', borderRadius:10, border:'none', fontSize:14, fontWeight:600,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          background: canSubmit ? `linear-gradient(135deg,${C.accent},#6d28d9)` : C.card2,
          color: canSubmit ? '#fff' : C.muted,
        }}>
          {loading ? <><Spinner size={14} color={C.muted} /> Creando cuenta...</> : 'Crear cuenta'}
        </button>
      </form>
    </div>
  )
}

// ── Auth gate ──────────────────────────────────────────────────────────────────

function AuthGate({ mcUsername }: { mcUsername: string }) {
  const [tab,           setTab]          = useState<'login'|'register'>('login')
  const [displayTab,    setDisplayTab]   = useState<'login'|'register'>('login')
  const [leaving,       setLeaving]      = useState(false)
  const [waitingGoogle, setWaitingGoogle] = useState(false)
  const [googleErr,     setGoogleErr]    = useState('')
  const [sessionCode,   setSessionCode]  = useState('')

  function switchTab(t: 'login'|'register') {
    if (t === displayTab || leaving) return
    setTab(t)
    setLeaving(true)
    setTimeout(() => { setDisplayTab(t); setLeaving(false) }, 150)
  }

  function handleGoogleAuth() {
    setGoogleErr('')
    setWaitingGoogle(true)

    // Generate a short random session code
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(36)).join('').slice(0, 10)
    setSessionCode(code)

    // Open the web auth page with the code so it can write to Firestore
    window.api.shell.openExternal(`https://fport1web.vercel.app/auth/launcher?code=${code}`)

    // Watch Firestore for the session doc the web page will create
    const sessionRef = doc(socialDb, 'launcher_sessions', code)
    const unsubSnap = onSnapshot(sessionRef, async snap => {
      if (!snap.exists()) return
      unsubSnap()

      const data = snap.data()
      const { idToken, accessToken } = data as { idToken: string; accessToken: string }

      if (!idToken) {
        const keys = Object.keys(data ?? {}).join(', ')
        setGoogleErr(`No se recibió el token. Campos recibidos: [${keys || 'ninguno'}]. Inténtalo de nuevo.`)
        setWaitingGoogle(false)
        return
      }

      try {
        const credential = GoogleAuthProvider.credential(idToken, accessToken || null)
        await signInWithCredential(socialAuth, credential)
        await deleteDoc(sessionRef).catch(() => {})
        setWaitingGoogle(false)
      } catch (ex: any) {
        const code = (ex as any)?.code ?? 'unknown'
        setGoogleErr(`Error al iniciar sesión: ${ex?.message ?? 'desconocido'} [${code}]`)
        setWaitingGoogle(false)
      }
    }, (err) => { setGoogleErr(`Error de conexión con Firestore: ${err.message}`); setWaitingGoogle(false) })

    // Timeout after 5 minutes
    setTimeout(() => {
      unsubSnap()
      setWaitingGoogle(false)
      setGoogleErr('Tiempo de espera agotado. Intenta de nuevo.')
    }, 5 * 60 * 1000)
  }

  if (waitingGoogle) {
    return (
      <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, background:C.bg, padding:24 }}>
        <div style={{ position:'relative', width:56, height:56 }}>
          <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:`radial-gradient(circle,rgba(124,58,237,.3),transparent)`, animation:'glow 2s ease-in-out infinite' }} />
          <div style={{ position:'absolute', inset:8, borderRadius:'50%', background:C.card, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <GoogleLogo />
          </div>
        </div>
        <p style={{ fontSize:15, fontWeight:600, color:C.text, margin:0, animation:'fadeUp .3s ease both' }}>Esperando autenticación…</p>
        <p style={{ fontSize:13, color:C.muted, margin:0, textAlign:'center', maxWidth:300, animation:'fadeUp .3s ease both .05s' }}>
          Completa el inicio de sesión con Google en tu navegador y vuelve aquí automáticamente.
        </p>
        {sessionCode && (
          <p style={{ fontSize:10, color:C.muted, margin:0, fontFamily:'monospace' }}>
            código: {sessionCode}
          </p>
        )}
        {googleErr && (
          <div style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:10, padding:'10px 14px', color:C.red, fontSize:12, maxWidth:320, textAlign:'center' }}>
            {googleErr}
          </div>
        )}
        <button onClick={() => { setWaitingGoogle(false); setGoogleErr('') }} style={{
          marginTop:8, padding:'7px 16px', borderRadius:10, border:`1px solid ${C.border}`,
          background:'transparent', color:C.muted, fontSize:12, cursor:'pointer',
        }}>
          Cancelar
        </button>
      </div>
    )
  }

  return (
    <div style={{
      height:'100%', overflowY:'auto', backgroundColor:C.bg,
      backgroundImage:`linear-gradient(rgba(124,58,237,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(124,58,237,.04) 1px,transparent 1px)`,
      backgroundSize:'40px 40px',
    }}>
      {/* Purple top strip */}
      <div style={{ height:3, background:`linear-gradient(90deg,${C.accent},${C.accent2},${C.accent})` }} />

      {/* Hero */}
      <div style={{ position:'relative', padding:'32px 24px 24px', overflow:'hidden', borderBottom:`1px solid ${C.border}` }}>
        <div style={{ position:'absolute', top:-30, right:-20, width:280, height:280, borderRadius:'50%', background:`radial-gradient(circle,rgba(124,58,237,.32),transparent 68%)`, animation:'glow 3s ease-in-out infinite', pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:-50, left:-20, width:200, height:200, borderRadius:'50%', background:`radial-gradient(circle,rgba(168,85,247,.22),transparent 68%)`, animation:'glow 4s ease-in-out infinite 1s', pointerEvents:'none' }} />
        <p style={{ fontSize:11, fontWeight:700, letterSpacing:'0.12em', color:C.accent, textTransform:'uppercase', margin:'0 0 4px', animation:'fadeUp .3s ease both' }}>fport1-social</p>
        <h2 style={{ fontSize:24, fontWeight:700, color:C.text, margin:'0 0 6px', animation:'fadeUp .35s ease both .04s' }}>Tu cuenta social</h2>
        <p style={{ fontSize:13, color:C.muted, margin:0, animation:'fadeUp .35s ease both .08s' }}>
          Conecta con amigos y ve quién está jugando Minecraft en tiempo real.
        </p>
      </div>

      <div style={{ padding:'24px 20px', maxWidth:440, margin:'0 auto', animation:'fadeUp .3s ease both .1s' }}>
        {googleErr && (
          <div style={{ marginBottom:14, background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:10, padding:'10px 14px', color:C.red, fontSize:13 }}>
            {googleErr}
          </div>
        )}

        {/* Tab toggle */}
        <div style={{ display:'flex', background:C.card, borderRadius:12, padding:4, marginBottom:22, border:`1px solid ${C.border}` }}>
          {(['login', 'register'] as const).map(t => (
            <button key={t} onClick={() => switchTab(t)} className="f1-tab" style={{
              flex:1, padding:'8px', borderRadius:9, border:'none', fontSize:13, fontWeight:600,
              cursor:'pointer',
              background: tab === t ? `linear-gradient(135deg,${C.accent},#6d28d9)` : 'transparent',
              color: tab === t ? '#fff' : C.muted,
            }}>
              {t === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
            </button>
          ))}
        </div>

        <div style={{ animation: leaving ? 'slideTabOut .15s ease forwards' : undefined }}>
          {displayTab === 'login'
            ? <LoginForm key="login" onGoogleAuth={handleGoogleAuth} />
            : <RegisterForm key="register" onGoogleAuth={handleGoogleAuth} defaultMc={mcUsername} />
          }
        </div>
      </div>
    </div>
  )
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionLabel({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <p style={{ fontSize:11, fontWeight:700, color, letterSpacing:'0.1em', textTransform:'uppercase', margin:'0 0 8px 2px' }}>
      {label} · {count}
    </p>
  )
}

// ── Profile completion (after Google sign-in with no @handle yet) ──────────────

function CompleteProfileForm({ user, onDone }: { user: User; onDone: (username: string, profileName: string) => void }) {
  const [form,    setForm]    = useState({ profileName: user.displayName ?? '', handle: '' })
  const [touched, setTouched] = useState({ profileName: false, handle: false })
  const [handleStatus, setHandleStatus] = useState<'idle'|'checking'|'available'|'taken'|'invalid'|'error'>('idle')
  const [err,     setErr]     = useState('')
  const [loading, setLoading] = useState(false)

  const up    = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))
  const touch = (k: keyof typeof touched) => setTouched(t => ({ ...t, [k]: true }))

  const handleCheck = useMemo(() => validateHandle(form.handle), [form.handle])
  const handleSynOk = handleCheck.ok
  const profileOk   = form.profileName.trim().length >= 2
  const canSubmit   = profileOk && handleSynOk && handleStatus === 'available' && !loading

  useEffect(() => {
    let cancel = false
    const norm = normalizeHandle(form.handle)
    if (!norm) { setHandleStatus('idle'); return }
    if (!handleSynOk) { setHandleStatus('invalid'); return }
    setHandleStatus('checking')
    const t = setTimeout(async () => {
      try {
        const snap = await getDoc(doc(socialDb, 'usernames', norm))
        if (!cancel) setHandleStatus(snap.exists() ? 'taken' : 'available')
      } catch { if (!cancel) setHandleStatus('error') }
    }, 450)
    return () => { cancel = true; clearTimeout(t) }
  }, [form.handle, handleSynOk])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched({ profileName: true, handle: true })
    if (!canSubmit) return
    setLoading(true); setErr('')
    try {
      const slug = normalizeHandle(form.handle)
      await reserveUsernameAndUpsertProfile({
        uid: user.uid, email: user.email ?? '',
        profileName: form.profileName.trim(),
        handleInput: form.handle,
        minecraftUsername: null, minecraftUUID: null,
      })
      onDone(`@${slug}`, form.profileName.trim())
    } catch (ex: any) {
      setErr(ex.message ?? 'Error al guardar el perfil.')
    } finally { setLoading(false) }
  }

  const handleState = (): 'idle'|'ok'|'error'|'checking' =>
    handleStatus === 'checking' ? 'checking' :
    (handleStatus === 'available' && handleSynOk) ? 'ok' :
    (touched.handle && (!handleSynOk || handleStatus === 'taken')) ? 'error' : 'idle'

  return (
    <div style={{ height:'100%', overflowY:'auto', background:C.bg }}>
      <div style={{ height:3, background:`linear-gradient(90deg,${C.accent},${C.accent2},${C.accent})` }} />
      <div style={{ padding:'32px 20px', maxWidth:420, margin:'0 auto', animation:'fadeUp .3s ease both' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:6 }}>
          <p style={{ fontSize:11, fontWeight:700, letterSpacing:'0.12em', color:C.accent, textTransform:'uppercase', margin:0 }}>fport1-social</p>
          <button onClick={() => signOut(socialAuth)} style={{ background:'none', border:'none', color:C.muted, fontSize:12, cursor:'pointer', padding:0 }}>
            Cerrar sesión
          </button>
        </div>
        <h2 style={{ fontSize:22, fontWeight:700, color:C.text, margin:'0 0 6px' }}>Completa tu perfil</h2>
        <p style={{ fontSize:13, color:C.muted, margin:'0 0 24px' }}>Elige un nombre y @usuario para tu cuenta.</p>

        <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <Field label="Nombre de perfil">
            <input type="text" placeholder="Cómo quieres que te vean"
              value={form.profileName} onChange={e => up('profileName', e.target.value)}
              onBlur={() => touch('profileName')} maxLength={DISPLAY_NAME_MAX}
              className="f1-input" style={inputSx(touched.profileName && !profileOk ? 'error' : 'idle')} />
            {touched.profileName && !profileOk && <Hint color={C.red}>Mínimo 2 caracteres.</Hint>}
          </Field>
          <Field label="Usuario">
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ color:C.muted, fontSize:14 }}>@</span>
              <input type="text" placeholder="tu_usuario"
                value={form.handle} onChange={e => up('handle', normalizeHandle(e.target.value))}
                onBlur={() => touch('handle')} maxLength={USERNAME_MAX}
                className="f1-input" style={{ ...inputSx(handleState()), flex:1 }} />
            </div>
            <StatusHint status={handleStatus} syntaxOk={handleSynOk} touched={touched.handle}
              msg={handleCheck.msg} checkingText="Comprobando…" availableText="Disponible ✓" takenText="Ya está en uso." />
            <Hint color={C.muted}>Solo minúsculas, números, - y _. {USERNAME_MIN}–{USERNAME_MAX} caracteres.</Hint>
          </Field>
          {err && <div style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:8, padding:'10px 14px', color:C.red, fontSize:13 }}>{err}</div>}
          <button type="submit" disabled={!canSubmit} className="f1-btn-primary" style={{
            padding:'12px', borderRadius:10, border:'none', fontSize:14, fontWeight:600,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            background: canSubmit ? `linear-gradient(135deg,${C.accent},#6d28d9)` : C.card2,
            color: canSubmit ? '#fff' : C.muted,
          }}>
            {loading ? <><Spinner size={14} color={C.muted} /> Guardando…</> : 'Continuar'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Presence ──────────────────────────────────────────────────────────────────

async function startPresence(uid: string) {
  await setDoc(doc(socialDb, 'presence', uid), { online: true, playing: false, lastSeen: serverTimestamp() }, { merge: true })
  const timer = setInterval(() => {
    updateDoc(doc(socialDb, 'presence', uid), { lastSeen: serverTimestamp() }).catch(() => {})
  }, 55_000)
  return timer
}

function stopPresence(uid: string) {
  updateDoc(doc(socialDb, 'presence', uid), { online: false, lastSeen: serverTimestamp() }).catch(() => {})
}

function setPlaying(uid: string, playing: boolean) {
  updateDoc(doc(socialDb, 'presence', uid), { playing, lastSeen: serverTimestamp() }).catch(() => {})
}

function resolvePresence(data: any): { online: boolean; playing: boolean } | null {
  if (!data) return null
  const vis = data.visibility ?? 'everyone'
  if (vis === 'nobody') return null
  const lastSeen: Date | null = data.lastSeen?.toDate?.() ?? null
  const stale = lastSeen ? Date.now() - lastSeen.getTime() > 90_000 : false
  return { online: stale ? false : !!data.online, playing: stale ? false : !!data.playing }
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function FriendsPage() {
  const account          = useStore(activeAccount)
  const runningInstances = useStore(s => s.runningInstances)

  const presenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [socialUser,    setSocialUser]    = useState<User | null | undefined>(undefined)
  const [needsProfile,  setNeedsProfile]  = useState(false)
  const [profile,       setProfile]       = useState<{ username: string|null; usernameSlug: string|null; profileName: string|null } | null>(null)
  const [friends,       setFriends]       = useState<SocialFriend[]>([])
  const [loadingFriends,setLoadingFriends] = useState(false)

  const [addInput,  setAddInput]  = useState('')
  const [addState,  setAddState]  = useState<'idle'|'searching'|'found'|'notfound'|'adding'|'done'|'self'|'already'|'error'>('idle')
  const [addResult, setAddResult] = useState<{
    uid: string; profileName: string|null; username: string|null
    usernameSlug: string|null; photoURL: string|null
  } | null>(null)

  // Chat state
  const [mainTab,        setMainTab]        = useState<'friends'|'chat'>('friends')
  const [conversations,  setConversations]  = useState<Conversation[]>([])
  const [loadingConvs,   setLoadingConvs]   = useState(false)
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)
  const [messages,       setMessages]       = useState<ChatMessage[]>([])
  const [loadingMsgs,    setLoadingMsgs]    = useState(false)
  const [msgInput,       setMsgInput]       = useState('')
  const [sendingMsg,     setSendingMsg]     = useState(false)
  const msgEndRef = useRef<HTMLDivElement>(null)
  const taRef     = useRef<HTMLTextAreaElement>(null)

  // Live search suggestions (add friend)
  const [suggestions,  setSuggestions]  = useState<{ slug: string; uid: string }[]>([])
  const [loadingSugg,  setLoadingSugg]  = useState(false)

  // Message actions
  const [ctxMenu,      setCtxMenu]      = useState<{ msg: ChatMessage; x: number; y: number } | null>(null)
  const [editingId,    setEditingId]    = useState<string | null>(null)
  const [editText,     setEditText]     = useState('')
  const [selectMode,   setSelectMode]   = useState(false)
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set())
  const [replyTo,      setReplyTo]      = useState<ChatMessage | null>(null)
  const [fwdMsg,       setFwdMsg]       = useState<ChatMessage | null>(null)

  // New chat modal
  const [showNewChat,       setShowNewChat]       = useState(false)
  const [newChatInput,      setNewChatInput]      = useState('')
  const [newChatSugg,       setNewChatSugg]       = useState<{ slug: string; uid: string }[]>([])
  const [newChatType,       setNewChatType]       = useState<'direct'|'group'>('direct')
  const [newChatGroupName,  setNewChatGroupName]  = useState('')
  const [newChatTargets,    setNewChatTargets]    = useState<{ uid: string; slug: string }[]>([])

  // Friend requests
  const [friendRequests, setFriendRequests] = useState<{ uid: string; profileName: string|null; username: string|null; usernameSlug: string|null }[]>([])

  // Conversation hover menu
  const [hoveredConvId, setHoveredConvId] = useState<string|null>(null)
  const [convMenuId,    setConvMenuId]    = useState<string|null>(null)

  // Message hover (3-dot button)
  const [hoveredMsgId,  setHoveredMsgId]  = useState<string|null>(null)

  // Emoji picker
  const [showEmoji, setShowEmoji] = useState(false)

  // Read receipts
  const [otherReadAt, setOtherReadAt] = useState<Date|null>(null)
  const prevConvTimestampsRef = useRef<Record<string, number>>({})

  // Typing indicator
  const [otherIsTyping, setOtherIsTyping] = useState(false)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function selectSuggestion(slug: string, uid: string) {
    setSuggestions([])
    if (!socialUser) return
    if (uid === socialUser.uid) { setAddState('self'); return }
    if (friends.some(f => f.uid === uid)) { setAddState('already'); return }
    setAddState('searching')
    try {
      const profileSnap = await getDoc(doc(socialDb, 'users', uid))
      const d = profileSnap.exists() ? profileSnap.data() : {}
      setAddInput(slug)
      setAddResult({ uid, profileName: d.profileName ?? null, username: '@' + slug, usernameSlug: slug, photoURL: d.photoURL ?? null })
      setAddState('found')
    } catch { setAddState('error') }
  }

  async function searchFriend() {
    const slug = normalizeHandle(addInput)
    if (!slug || !socialUser) return
    setAddState('searching'); setAddResult(null)
    try {
      const unameSnap = await getDoc(doc(socialDb, 'usernames', slug))
      if (!unameSnap.exists()) { setAddState('notfound'); return }
      const { uid } = unameSnap.data() as { uid: string }
      if (uid === socialUser.uid) { setAddState('self'); return }
      const already = friends.some(f => f.uid === uid)
      if (already) { setAddState('already'); return }
      const profileSnap = await getDoc(doc(socialDb, 'users', uid))
      const d = profileSnap.exists() ? profileSnap.data() : {}
      setAddResult({
        uid,
        profileName:  d.profileName  ?? null,
        username:     d.username     ?? null,
        usernameSlug: d.usernameSlug ?? null,
        photoURL:     d.photoURL     ?? null,
      })
      setAddState('found')
    } catch { setAddState('error') }
  }

  async function confirmAddFriend() {
    if (!addResult || !socialUser) return
    setAddState('adding')
    try {
      // Send a friend request to the other user's inbox
      await setDoc(doc(socialDb, 'users', addResult.uid, 'friendRequests', socialUser.uid), {
        profileName:  profile?.profileName  ?? null,
        username:     profile?.username     ?? null,
        usernameSlug: profile?.usernameSlug ?? null,
        photoURL:     socialUser.photoURL   ?? null,
        sentAt:       serverTimestamp(),
      })
      setAddState('done')
      setAddInput('')
      setTimeout(() => { setAddState('idle'); setAddResult(null) }, 2500)
    } catch { setAddState('error') }
  }

  async function acceptFriendRequest(req: { uid: string; profileName: string|null; username: string|null; usernameSlug: string|null }) {
    if (!socialUser) return
    const batch = writeBatch(socialDb)
    const now   = serverTimestamp()
    batch.set(doc(socialDb, 'users', socialUser.uid, 'friends', req.uid), {
      addedAt: now, profileName: req.profileName, username: req.username, usernameSlug: req.usernameSlug,
    })
    batch.set(doc(socialDb, 'users', req.uid, 'friends', socialUser.uid), {
      addedAt: now, profileName: profile?.profileName ?? null, username: profile?.username ?? null, usernameSlug: profile?.usernameSlug ?? null,
    })
    batch.delete(doc(socialDb, 'users', socialUser.uid, 'friendRequests', req.uid))
    await batch.commit()
  }

  async function rejectFriendRequest(uid: string) {
    if (!socialUser) return
    await deleteDoc(doc(socialDb, 'users', socialUser.uid, 'friendRequests', uid)).catch(() => {})
  }

  useEffect(() => {
    let prevUid: string | null = null
    const unsub = onAuthStateChanged(socialAuth, async u => {
      setSocialUser(u)
      if (u) {
        const timer = await startPresence(u.uid)
        presenceTimerRef.current = timer
        prevUid = u.uid
      } else {
        if (presenceTimerRef.current) { clearInterval(presenceTimerRef.current); presenceTimerRef.current = null }
        if (prevUid) { stopPresence(prevUid); prevUid = null }
      }
    })
    return () => { unsub(); if (presenceTimerRef.current) clearInterval(presenceTimerRef.current) }
  }, [])

  // Sync Minecraft running state to presence
  useEffect(() => {
    if (!socialUser) return
    setPlaying(socialUser.uid, runningInstances.size > 0)
  }, [runningInstances, socialUser?.uid])

  // Live search as user types
  useEffect(() => {
    const slug = normalizeHandle(addInput)
    if (!slug || slug.length < 2) { setSuggestions([]); setLoadingSugg(false); return }
    setLoadingSugg(true)
    const t = setTimeout(async () => {
      try {
        const q = query(
          collection(socialDb, 'usernames'),
          where(documentId(), '>=', slug),
          where(documentId(), '<', slug + ''),
          limit(6)
        )
        const snap = await getDocs(q)
        setSuggestions(snap.docs.map(d => ({ slug: d.id, uid: (d.data() as any).uid })))
      } catch { setSuggestions([]) }
      finally { setLoadingSugg(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [addInput])

  // Live search for new chat
  useEffect(() => {
    const slug = normalizeHandle(newChatInput)
    if (!slug || slug.length < 2) { setNewChatSugg([]); return }
    const t = setTimeout(async () => {
      try {
        const q = query(
          collection(socialDb, 'usernames'),
          where(documentId(), '>=', slug),
          where(documentId(), '<', slug + ''),
          limit(6)
        )
        const snap = await getDocs(q)
        setNewChatSugg(snap.docs.map(d => ({ slug: d.id, uid: (d.data() as any).uid })))
      } catch { setNewChatSugg([]) }
    }, 300)
    return () => clearTimeout(t)
  }, [newChatInput])

  useEffect(() => {
    if (!socialUser) { setFriends([]); setProfile(null); setNeedsProfile(false); return }

    getDoc(doc(socialDb, 'users', socialUser.uid)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setNeedsProfile(!d.usernameSlug)
        setProfile({ username: d.username ?? null, usernameSlug: d.usernameSlug ?? null, profileName: d.profileName ?? d.username ?? null })
      } else {
        setNeedsProfile(true)
      }
    })

    setLoadingFriends(true)
    const q = collection(socialDb, 'users', socialUser.uid, 'friends')
    const unsub = onSnapshot(q, async snapshot => {
      const uids = snapshot.docs.map(d => d.id)
      if (uids.length === 0) { setFriends([]); setLoadingFriends(false); return }

      const [profiles, presences] = await Promise.all([
        Promise.all(uids.map(uid => getDoc(doc(socialDb, 'users', uid)))),
        Promise.all(uids.map(uid => getDoc(doc(socialDb, 'presence', uid)))),
      ])

      setFriends(profiles.map((snap, i) => {
        const d  = snap.exists() ? snap.data() : {}
        return {
          uid: uids[i],
          profileName:       d.profileName ?? d.username ?? null,
          username:          d.username ?? null,
          minecraftUsername: d.minecraftUsername ?? null,
          minecraftUUID:     d.minecraftUUID ?? null,
          presence:          resolvePresence(presences[i].exists() ? presences[i].data() : null),
        }
      }))
      setLoadingFriends(false)
    })
    return unsub
  }, [socialUser])

  // Friend requests listener
  useEffect(() => {
    if (!socialUser) { setFriendRequests([]); return }
    const q = collection(socialDb, 'users', socialUser.uid, 'friendRequests')
    const unsub = onSnapshot(q, async snapshot => {
      const uids = snapshot.docs.map(d => d.id)
      if (uids.length === 0) { setFriendRequests([]); return }
      const profiles = await Promise.all(uids.map(uid => getDoc(doc(socialDb, 'users', uid))))
      setFriendRequests(profiles.map((snap, i) => {
        const d = snap.exists() ? snap.data() : {}
        return { uid: uids[i], profileName: d.profileName ?? d.username ?? null, username: d.username ?? null, usernameSlug: d.usernameSlug ?? null }
      }))
    }, () => {})
    return unsub
  }, [socialUser?.uid])

  // Load conversations
  useEffect(() => {
    if (!socialUser) { setConversations([]); return }
    setLoadingConvs(true)
    const q = query(
      collection(socialDb, 'conversations'),
      where('participantUids', 'array-contains', socialUser.uid)
    )
    const unsub = onSnapshot(q, async snapshot => {
      const raw = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
      raw.sort((a, b) => {
        const aAt = a.lastMessageAt?.seconds ?? a.lastMessage?.at?.seconds ?? 0
        const bAt = b.lastMessageAt?.seconds ?? b.lastMessage?.at?.seconds ?? 0
        return bAt - aAt
      })

      const enriched: Conversation[] = await Promise.all(raw.map(async conv => {
        const isGroup = !!(conv.isGroup || (conv.participantUids as string[]).length > 2)
        const groupName: string|null = conv.groupName ?? null
        const otherUid: string = isGroup
          ? socialUser.uid
          : ((conv.participantUids as string[]).find(u => u !== socialUser.uid) ?? conv.participantUids[0])
        let otherName: string | null = isGroup ? (groupName ?? 'Grupo') : null
        if (!isGroup) {
          try {
            const snap = await getDoc(doc(socialDb, 'users', otherUid))
            if (snap.exists()) {
              const d = snap.data()
              otherName = d.profileName ?? d.username ?? null
            }
          } catch { /* ignore */ }
        }
        const lastMsgAt  = conv.lastMessageAt?.seconds ?? conv.lastMessage?.at?.seconds ?? 0
        const myReadAt   = conv.readAt?.[socialUser.uid]?.seconds ?? 0
        const hasUnread  = lastMsgAt > 0
                        && (conv.lastSenderUid ?? conv.lastMessage?.senderUid ?? null) !== socialUser.uid
                        && lastMsgAt > myReadAt
        return {
          id:             conv.id,
          participantUids: conv.participantUids,
          lastMessage:    conv.lastMessage    ?? null,
          lastMessageAt:  conv.lastMessageAt  ?? null,
          lastSenderUid:  conv.lastSenderUid  ?? null,
          otherUid,
          otherName,
          groupName,
          isGroup,
          hasUnread,
        }
      }))
      setConversations(enriched)
      setLoadingConvs(false)
    }, () => setLoadingConvs(false))
    return unsub
  }, [socialUser?.uid])

  // Load messages for selected conversation
  useEffect(() => {
    if (!selectedConvId) { setMessages([]); return }
    setLoadingMsgs(true)
    // No orderBy — avoids needing a Firestore index; we sort client-side
    const q = query(
      collection(socialDb, 'conversations', selectedConvId, 'messages'),
      limit(120)
    )
    const unsub = onSnapshot(q, snapshot => {
      const msgs: ChatMessage[] = snapshot.docs.map(d => {
        const data = d.data()
        // Try every known field name, then fall back to any non-empty string value in the doc
        const text: string =
          data.textCipher ?? data.text ?? data.content ?? data.message ?? data.body ?? data.msg ??
          (Object.values(data).find(v => typeof v === 'string' && (v as string).length > 0) as string | undefined) ?? ''
        const at = data.at ?? data.sentAt ?? data.createdAt ?? data.timestamp ?? null
        return {
          id:        d.id,
          text,
          senderUid:  data.senderUid ?? data.from ?? data.uid ?? '',
          at,
          reactions:  (data.reactions ?? {}) as Record<string, string[]>,
          edited:     data.edited ?? false,
          forwarded:  data.forwarded ?? false,
          replyTo:    data.replyTo ?? null,
        }
      })
      msgs.sort((a, b) => (a.at?.seconds ?? 0) - (b.at?.seconds ?? 0))
      setMessages(msgs)
      setLoadingMsgs(false)
    }, () => setLoadingMsgs(false))
    return unsub
  }, [selectedConvId])

  // Mark conversation as read when opened / new messages arrive
  useEffect(() => {
    if (!selectedConvId || !socialUser) return
    updateDoc(doc(socialDb, 'conversations', selectedConvId), {
      [`readAt.${socialUser.uid}`]: serverTimestamp(),
    }).catch(() => {})
  }, [selectedConvId, messages.length])

  // Watch other person's lastReadAt for read receipts
  useEffect(() => {
    if (!selectedConvId || !socialUser) { setOtherReadAt(null); return }
    const unsub = onSnapshot(doc(socialDb, 'conversations', selectedConvId), snap => {
      if (!snap.exists()) return
      const data = snap.data()
      const participants: string[] = data.participantUids ?? []
      const otherUid = participants.find(u => u !== socialUser.uid) ?? null
      if (!otherUid) { setOtherReadAt(null); return }
      const ts = data.readAt?.[otherUid]
      setOtherReadAt(ts?.toDate?.() ?? null)
    }, () => {})
    return unsub
  }, [selectedConvId, socialUser?.uid])

  // Scroll to bottom on new messages
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Typing indicator listener
  useEffect(() => {
    if (!selectedConvId || !selectedConv || !socialUser) { setOtherIsTyping(false); return }
    const otherUid = selectedConv.participantUids.find(u => u !== socialUser.uid) ?? null
    if (!otherUid) { setOtherIsTyping(false); return }
    const unsub = onSnapshot(doc(socialDb, 'conversations', selectedConvId), snap => {
      const d = snap.data()
      const ts = d?.typing?.[otherUid]
      if (!ts) { setOtherIsTyping(false); return }
      const date: Date = ts?.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
      setOtherIsTyping(Date.now() - date.getTime() < 5000)
    }, () => {})
    return unsub
  }, [selectedConvId, socialUser?.uid])

  // Request notification permission when user logs in
  useEffect(() => {
    if (!socialUser) return
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [socialUser?.uid])

  // Notify when new messages arrive on non-selected conversations
  useEffect(() => {
    if (!socialUser || conversations.length === 0) return
    const prev = prevConvTimestampsRef.current
    for (const conv of conversations) {
      const lastAt = conv.lastMessageAt?.seconds ?? conv.lastMessage?.at?.seconds ?? 0
      const prevAt = prev[conv.id] ?? -1
      if (prevAt >= 0 && lastAt > prevAt && conv.lastSenderUid !== socialUser.uid && conv.id !== selectedConvId) {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`${conv.otherName ?? 'Alguien'} te envió un mensaje`, {
            body: convLastText(conv.lastMessage) || '…',
          })
        }
      }
      prev[conv.id] = lastAt
    }
  }, [conversations, selectedConvId, socialUser?.uid])

  async function sendMessage() {
    if (!msgInput.trim() || !selectedConvId || !socialUser || sendingMsg) return
    setSendingMsg(true)
    const text    = msgInput.trim()
    const replySnap = replyTo ? { msgId: replyTo.id, text: replyTo.text, senderUid: replyTo.senderUid } : null
    setMsgInput('')
    setReplyTo(null)
    try {
      await addDoc(collection(socialDb, 'conversations', selectedConvId, 'messages'), {
        textCipher: text,
        text,
        senderUid: socialUser.uid,
        at:        serverTimestamp(),
        type:      'text',
        attachments: [],
        ...(replySnap ? { replyTo: replySnap } : {}),
      })
      await updateDoc(doc(socialDb, 'conversations', selectedConvId), {
        lastMessage:    { text, senderUid: socialUser.uid, at: new Date() },
        lastSenderUid:  socialUser.uid,
        lastMessageAt:  serverTimestamp(),
        [`readAt.${socialUser.uid}`]: serverTimestamp(),
      })
    } catch { setMsgInput(text) }
    finally { setSendingMsg(false) }
  }

  // ── Message actions ───────────────────────────────────────────────────────────

  function openCtxMenu(e: React.MouseEvent, msg: ChatMessage) {
    e.preventDefault()
    const menuW = 250
    const menuH = 420
    const x = (e.clientX + menuW > window.innerWidth)
      ? Math.max(0, e.clientX - menuW)
      : e.clientX
    const y = Math.min(e.clientY, window.innerHeight - menuH)
    setCtxMenu({ msg, x, y })
  }

  function copyMsg(text: string) {
    navigator.clipboard.writeText(text).catch(() => {})
    setCtxMenu(null)
  }

  async function deleteForEveryone(msgId: string) {
    if (!selectedConvId) return
    await deleteDoc(doc(socialDb, 'conversations', selectedConvId, 'messages', msgId)).catch(() => {})
    setCtxMenu(null)
  }

  function deleteForMe(msgId: string) {
    setMessages(prev => prev.filter(m => m.id !== msgId))
    setCtxMenu(null)
  }

  function startEdit(msg: ChatMessage) {
    setEditingId(msg.id); setEditText(msg.text); setCtxMenu(null)
  }

  async function saveEdit() {
    if (!selectedConvId || !editingId || !editText.trim()) { setEditingId(null); return }
    await updateDoc(doc(socialDb, 'conversations', selectedConvId, 'messages', editingId), {
      textCipher: editText.trim(), text: editText.trim(), editedAt: serverTimestamp(),
    }).catch(() => {})
    setEditingId(null)
  }

  async function toggleReaction(msgId: string, emoji: string) {
    if (!selectedConvId || !socialUser) return
    const msg  = messages.find(m => m.id === msgId)
    const mine = (msg?.reactions?.[emoji] ?? []).includes(socialUser.uid)
    const ref  = doc(socialDb, 'conversations', selectedConvId, 'messages', msgId)
    await updateDoc(ref, {
      [`reactions.${emoji}`]: mine ? arrayRemove(socialUser.uid) : arrayUnion(socialUser.uid),
    }).catch(() => {})
    setCtxMenu(null)
  }

  async function doForward(toConvId: string) {
    if (!fwdMsg || !socialUser) return
    const text = fwdMsg.text
    await addDoc(collection(socialDb, 'conversations', toConvId, 'messages'), {
      textCipher: text,
      text,
      senderUid: socialUser.uid,
      at: serverTimestamp(),
      type: 'text',
      attachments: [],
      meta: { forwarded: true },
    })
    await updateDoc(doc(socialDb, 'conversations', toConvId), {
      updatedAt: serverTimestamp(),
      lastMessage: { text, senderUid: socialUser.uid, at: serverTimestamp() },
      lastSenderUid: socialUser.uid,
      lastMessageAt: serverTimestamp(),
      [`readAt.${socialUser.uid}`]: serverTimestamp(),
    })
    setFwdMsg(null)
  }

  function toggleSelectMsg(msgId: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(msgId) ? n.delete(msgId) : n.add(msgId); return n })
  }

  async function deleteSelectedMsgs() {
    if (!selectedConvId) return
    await Promise.all([...selectedIds].map(id =>
      deleteDoc(doc(socialDb, 'conversations', selectedConvId, 'messages', id)).catch(() => {})
    ))
    setSelectedIds(new Set()); setSelectMode(false)
  }

  function closeNewChat() {
    setShowNewChat(false); setNewChatInput(''); setNewChatSugg([])
    setNewChatType('direct'); setNewChatGroupName(''); setNewChatTargets([])
  }

  async function startNewChat(uid: string) {
    if (!socialUser) return
    const existing = conversations.find(c => !c.isGroup && c.participantUids.includes(uid))
    if (existing) { setSelectedConvId(existing.id); closeNewChat(); return }
    const ref = await addDoc(collection(socialDb, 'conversations'), {
      participantUids: [socialUser.uid, uid],
      createdAt: serverTimestamp(),
      lastMessage: null, lastMessageAt: null,
    })
    setSelectedConvId(ref.id); closeNewChat()
  }

  async function createGroupChat() {
    if (!socialUser || newChatTargets.length === 0) return
    const name = newChatGroupName.trim() || 'Grupo'
    const ref = await addDoc(collection(socialDb, 'conversations'), {
      participantUids: [socialUser.uid, ...newChatTargets.map(t => t.uid)],
      groupName: name,
      isGroup: true,
      createdAt: serverTimestamp(),
      lastMessage: null, lastMessageAt: null,
    })
    setSelectedConvId(ref.id); closeNewChat()
  }

  function deleteConvForMe(convId: string) {
    setConversations(prev => prev.filter(c => c.id !== convId))
    if (selectedConvId === convId) setSelectedConvId(null)
    setConvMenuId(null)
  }

  async function deleteConvForBoth(convId: string) {
    try {
      const msgsSnap = await getDocs(collection(socialDb, 'conversations', convId, 'messages'))
      const batch = writeBatch(socialDb)
      msgsSnap.docs.forEach(d => batch.delete(d.ref))
      batch.delete(doc(socialDb, 'conversations', convId))
      await batch.commit()
    } catch { /* ignore */ }
    if (selectedConvId === convId) setSelectedConvId(null)
    setConvMenuId(null)
  }

  // Firebase auth initializing
  if (socialUser === undefined) {
    return (
      <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', background:C.bg }}>
        <style>{STYLES}</style>
        <Spinner />
      </div>
    )
  }

  // Not signed in
  if (!socialUser) {
    return (
      <>
        <style>{STYLES}</style>
        <AuthGate mcUsername={account?.username ?? ''} />
      </>
    )
  }

  // Signed in but needs to complete profile (Google sign-in with no handle yet)
  if (needsProfile) {
    return (
      <>
        <style>{STYLES}</style>
        <CompleteProfileForm user={socialUser} onDone={(username, profileName) => {
          setProfile({ username, usernameSlug: null, profileName })
          setNeedsProfile(false)
        }} />
      </>
    )
  }

  // Signed in
  const playing = friends.filter(f => f.presence?.playing)
  const online  = friends.filter(f => !f.presence?.playing && f.presence?.online)
  const offline = friends.filter(f => !f.presence?.playing && !f.presence?.online)
  const selectedConv = conversations.find(c => c.id === selectedConvId) ?? null

  return (
    <div
      style={{ height:'100%', display:'flex', flexDirection:'column', background:C.bg, animation:'fadeIn .25s ease' }}
      onClick={() => { if (ctxMenu) setCtxMenu(null); if (showEmoji) setShowEmoji(false) }}
    >
      <style>{STYLES}</style>

      {/* Hero */}
      <div style={{
        position:'relative', padding:'20px 24px 16px', flexShrink:0,
        background:`linear-gradient(160deg,#0d0d18 0%,#11112e 30%,#1a0d3e 65%,#1e0a38 100%)`,
        borderBottom:`1px solid ${C.border}`, overflow:'hidden',
      }}>
        <div style={{ position:'absolute', top:-10, right:-10, width:300, height:180, background:`radial-gradient(ellipse at top right,rgba(124,58,237,.38) 0%,transparent 65%)`, animation:'glow 3s ease-in-out infinite', pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:-30, left:40, width:160, height:160, background:`radial-gradient(circle,rgba(168,85,247,.22),transparent 68%)`, animation:'glow 4s ease-in-out infinite 1.5s', pointerEvents:'none' }} />

        <p style={{ fontSize:10, fontWeight:700, letterSpacing:'0.12em', color:C.accent, textTransform:'uppercase', margin:'0 0 4px' }}>fport1-social</p>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          <div>
            {profile && (
              <>
                <p style={{ fontSize:14, fontWeight:700, color:C.text, margin:0 }}>{profile.profileName}</p>
                {profile.username && <p style={{ fontSize:11, color:C.accent2, margin:'1px 0 0', fontWeight:600 }}>{profile.username}</p>}
              </>
            )}
          </div>
          <button onClick={() => signOut(socialAuth)} className="f1-google" style={{
            padding:'5px 12px', borderRadius:9, border:`1px solid ${C.border}`,
            background:'rgba(255,255,255,.04)', color:C.muted, fontSize:11, cursor:'pointer', whiteSpace:'nowrap',
          }}>
            Cerrar sesión
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', flexShrink:0, background:C.card, borderBottom:`1px solid ${C.border}` }}>
        {(['friends','chat'] as const).map(t => (
          <button key={t} onClick={() => { setMainTab(t); setSelectedConvId(null); setSelectMode(false); setSelectedIds(new Set()); setCtxMenu(null) }} style={{
            flex:1, padding:'10px 0', border:'none', background:'none', cursor:'pointer',
            fontSize:12, fontWeight:600,
            color: mainTab === t ? C.accent2 : C.muted,
            borderBottom: mainTab === t ? `2px solid ${C.accent2}` : '2px solid transparent',
            transition:'color .15s, border-color .15s',
          }}>
            <span style={{ display:'flex', alignItems:'center', gap:5, justifyContent:'center' }}>
              {t === 'friends'
                ? <>Amigos{friends.length > 0 ? ` · ${friends.length}` : ''}{friendRequests.length > 0 && <span style={{ width:7, height:7, borderRadius:'50%', background:C.red, display:'inline-block', flexShrink:0 }} />}</>
                : `Mensajes${conversations.length > 0 ? ` · ${conversations.length}` : ''}`
              }
            </span>
          </button>
        ))}
      </div>

      {/* ── Friends tab ── */}
      {mainTab === 'friends' && (
        <div style={{ flex:1, overflowY:'auto' }}>
          {/* Friend requests */}
          {friendRequests.length > 0 && (
            <div style={{ padding:'12px 16px 0' }}>
              <p style={{ fontSize:11, fontWeight:700, color:C.red, textTransform:'uppercase', letterSpacing:'0.1em', margin:'0 0 8px 2px' }}>
                Solicitudes · {friendRequests.length}
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {friendRequests.map(req => (
                  <div key={req.uid} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:12, background:C.card2, border:`1px solid rgba(248,113,113,.2)`, animation:'cardIn .2s ease both' }}>
                    <Avatar name={req.profileName ?? '?'} size={36} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:13, fontWeight:600, color:C.text, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{req.profileName ?? 'Usuario'}</p>
                      {req.username && <p style={{ fontSize:11, color:C.accent2, margin:'1px 0 0' }}>{req.username}</p>}
                    </div>
                    <div style={{ display:'flex', gap:5, flexShrink:0 }}>
                      <button onClick={() => acceptFriendRequest(req)} style={{ padding:'5px 11px', borderRadius:8, border:'none', background:`linear-gradient(135deg,${C.accent},#6d28d9)`, color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer' }}>✓</button>
                      <button onClick={() => rejectFriendRequest(req.uid)} style={{ padding:'5px 9px', borderRadius:8, border:`1px solid rgba(248,113,113,.35)`, background:'rgba(248,113,113,.08)', color:C.red, fontSize:12, cursor:'pointer' }}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add friend — live search */}
          <div style={{ padding:'12px 16px 0', position:'relative' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, background:C.card, border:`1px solid ${addInput ? C.accent : C.border}`, borderRadius:12, padding:'0 12px', transition:'border-color .2s' }}>
              <span style={{ color:C.muted, fontSize:14, flexShrink:0 }}>@</span>
              <input
                type="text" placeholder="Buscar usuario…" value={addInput}
                onChange={e => { setAddInput(normalizeHandle(e.target.value)); setAddState('idle'); setAddResult(null) }}
                onKeyDown={e => e.key === 'Enter' && suggestions.length > 0 && selectSuggestion(suggestions[0].slug, suggestions[0].uid)}
                onBlur={() => setTimeout(() => setSuggestions([]), 150)}
                style={{ flex:1, background:'transparent', border:'none', outline:'none', boxShadow:'none', color:C.text, fontSize:13, padding:'10px 0', boxSizing:'border-box' }}
              />
              {loadingSugg && <Spinner size={12} color={C.muted} />}
              {addInput && !loadingSugg && <button onClick={() => { setAddInput(''); setSuggestions([]); setAddState('idle'); setAddResult(null) }} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', padding:2, fontSize:14, lineHeight:1 }}>✕</button>}
            </div>

            {/* Suggestions dropdown */}
            {suggestions.length > 0 && (
              <div style={{ position:'absolute', left:16, right:16, top:'calc(100% + 2px)', zIndex:10, background:C.card2, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden', boxShadow:`0 8px 32px rgba(0,0,0,.5)` }}>
                {suggestions.map(s => (
                  <button key={s.slug} onMouseDown={() => selectSuggestion(s.slug, s.uid)} className="f1-conv-item" style={{
                    width:'100%', display:'flex', alignItems:'center', gap:10, padding:'9px 14px', border:'none', background:'none', cursor:'pointer', textAlign:'left',
                  }}>
                    <div style={{ width:28, height:28, borderRadius:7, background:'linear-gradient(135deg,#4c1d95,#1e3a5f)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <span style={{ fontSize:11, fontWeight:700, color:'#a78bfa' }}>{s.slug[0].toUpperCase()}</span>
                    </div>
                    <span style={{ fontSize:13, color:C.text }}>@{s.slug}</span>
                  </button>
                ))}
              </div>
            )}

            {addState === 'self'     && <p style={{ fontSize:12, color:C.muted, margin:'6px 0 0 4px' }}>No puedes añadirte a ti mismo.</p>}
            {addState === 'already'  && <p style={{ fontSize:12, color:C.muted, margin:'6px 0 0 4px' }}>Ya es tu amigo.</p>}
            {addState === 'error'    && <p style={{ fontSize:12, color:C.red, margin:'6px 0 0 4px' }}>Error al buscar. Inténtalo de nuevo.</p>}
            {addState === 'done'     && <p style={{ fontSize:12, color:C.green, margin:'6px 0 0 4px' }}>¡Solicitud enviada!</p>}
            {addState === 'found' && addResult && (
              <div style={{ marginTop:8, display:'flex', alignItems:'center', justifyContent:'space-between', background:C.card2, border:`1px solid rgba(124,58,237,.25)`, borderRadius:12, padding:'10px 14px', animation:'fadeUp .2s ease both' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:32, height:32, borderRadius:8, background:'linear-gradient(135deg,#4c1d95,#1e3a5f)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:'#a78bfa' }}>{((addResult.profileName ?? addResult.username ?? '?')[0]).toUpperCase()}</span>
                  </div>
                  <div>
                    <p style={{ fontSize:13, fontWeight:600, color:C.text, margin:0 }}>{addResult.profileName ?? addResult.username}</p>
                    {addResult.username && <p style={{ fontSize:11, color:C.accent2, margin:'1px 0 0' }}>{addResult.username}</p>}
                  </div>
                </div>
                <button onClick={confirmAddFriend} disabled={addState === 'adding' as any} className="f1-btn-primary" style={{ padding:'6px 14px', borderRadius:9, border:'none', fontSize:12, fontWeight:600, background:`linear-gradient(135deg,${C.accent},#6d28d9)`, color:'#fff', cursor:'pointer' }}>
                  {addState === 'adding' as any ? <Spinner size={12} color="#fff" /> : 'Añadir'}
                </button>
              </div>
            )}
          </div>

          {/* Friends list */}
          <div style={{ padding:'16px' }}>
            {loadingFriends ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, color:C.muted, fontSize:13, padding:'20px 0' }}>
                <Spinner size={16} color={C.muted} /> Cargando amigos...
              </div>
            ) : friends.length === 0 ? (
              <div style={{ borderRadius:20, border:`1px solid rgba(124,58,237,.2)`, background:`linear-gradient(135deg,${C.card},#13131e)`, padding:'32px 20px', textAlign:'center', position:'relative', overflow:'hidden' }}>
                <div style={{ position:'absolute', inset:0, background:`radial-gradient(ellipse at top,rgba(124,58,237,.07),transparent 60%)`, pointerEvents:'none' }} />
                <div style={{ width:56, height:56, borderRadius:16, margin:'0 auto 12px', background:`linear-gradient(135deg,rgba(124,58,237,.2),rgba(168,85,247,.12))`, border:`1px solid rgba(124,58,237,.25)`, display:'flex', alignItems:'center', justifyContent:'center', animation:'emptyPulse 3s ease-in-out infinite', fontSize:24, position:'relative' }}>👾</div>
                <p style={{ fontSize:14, fontWeight:600, color:C.text, margin:'0 0 6px' }}>Sin amigos aún</p>
                <p style={{ fontSize:12, color:C.muted, margin:'0 0 16px', lineHeight:1.6 }}>Añade amigos con el campo de arriba.</p>
                <button onClick={() => window.api.shell.openExternal(`${WEB}/amigos`)} className="f1-btn-primary" style={{ padding:'8px 18px', borderRadius:10, border:'none', background:`linear-gradient(135deg,${C.accent},#6d28d9)`, color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                  Abrir fport1-social →
                </button>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
                {playing.length > 0 && (
                  <div>
                    <SectionLabel label="Jugando ahora" count={playing.length} color={C.green} />
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      {playing.map((f, i) => <FriendCard key={f.uid} f={f} delay={i * 60} />)}
                    </div>
                  </div>
                )}
                {online.length > 0 && (
                  <div>
                    <SectionLabel label="En línea" count={online.length} color={C.blue} />
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      {online.map((f, i) => <FriendCard key={f.uid} f={f} delay={i * 60} />)}
                    </div>
                  </div>
                )}
                {offline.length > 0 && (
                  <div style={{ opacity:.7 }}>
                    <SectionLabel label="Desconectados" count={offline.length} color={C.muted} />
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      {offline.map((f, i) => <FriendCard key={f.uid} f={f} delay={i * 60} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Chat tab — split pane ── */}
      {mainTab === 'chat' && (
        <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

          {/* Left panel: conversation list */}
          <div style={{ width:240, borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', flexShrink:0, background:C.card }}>
            {/* Header row */}
            <div style={{ padding:'12px 12px 10px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
              <span style={{ fontSize:18, fontWeight:600, color:C.text }}>Chatear</span>
              <button onClick={() => setShowNewChat(true)} title="Nueva conversación" style={{
                width:32, height:32, borderRadius:'50%',
                border:`1px solid ${C.border}`,
                background:'none', color:C.text, fontSize:20, cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center',
                lineHeight:1,
              }}>+</button>
            </div>

            {/* Conversation list */}
            <div style={{ flex:1, overflowY:'auto' }}>
              {loadingConvs ? (
                <div style={{ padding:'20px 8px', display:'flex', justifyContent:'center' }}><Spinner size={14} color={C.muted} /></div>
              ) : conversations.length === 0 ? (
                <div style={{ padding:'16px 10px', textAlign:'center' }}>
                  <p style={{ fontSize:10, color:C.muted, margin:'0 0 8px', lineHeight:1.5 }}>Sin conversaciones</p>
                  <button onClick={() => window.api.shell.openExternal(`${WEB}/mensajes`)} style={{ padding:'4px 8px', borderRadius:6, border:`1px solid ${C.border}`, background:'transparent', color:C.muted, fontSize:10, cursor:'pointer' }}>Abrir →</button>
                </div>
              ) : conversations.map(conv => {
                const active   = selectedConvId === conv.id
                const hovered  = hoveredConvId === conv.id
                const menuOpen = convMenuId === conv.id
                const convFriend    = friends.find(f => f.uid === conv.otherUid)
                const convPresence  = !conv.isGroup ? (convFriend?.presence ?? null) : null
                const isPlayingConv = !!convPresence?.playing
                const isOnlineConv  = !isPlayingConv && !!convPresence?.online
                return (
                  <div key={conv.id} style={{ position:'relative' }}
                    onMouseEnter={() => setHoveredConvId(conv.id)}
                    onMouseLeave={() => { setHoveredConvId(null); if (convMenuId === conv.id) setConvMenuId(null) }}
                  >
                    <button onClick={() => { setSelectedConvId(conv.id); setSelectMode(false); setSelectedIds(new Set()) }} className="f1-conv-item" style={{
                      width:'100%', display:'flex', alignItems:'center', gap:10,
                      padding:'10px 12px', border:'none', borderBottom:`1px solid ${C.border}`,
                      cursor:'pointer', textAlign:'left', boxSizing:'border-box',
                      background: active ? C.card2 : 'none',
                    }}>
                      {/* Avatar + presencia */}
                      <div style={{ position:'relative', flexShrink:0 }}>
                        <Avatar name={conv.otherName ?? '?'} size={46} />
                        {isPlayingConv && <span style={{ position:'absolute', bottom:-2, right:-2, width:12, height:12, borderRadius:'50%', background:C.green, border:`2px solid ${C.card}` }} />}
                        {isOnlineConv  && <span style={{ position:'absolute', bottom:-2, right:-2, width:12, height:12, borderRadius:'50%', background:C.blue,  border:`2px solid ${C.card}` }} />}
                      </div>
                      {/* Contenido */}
                      <div style={{ flex:1, minWidth:0 }}>
                        {/* Fila 1: nombre + timestamp */}
                        <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:2 }}>
                          <span style={{ fontSize:14, fontWeight: conv.hasUnread ? 700 : 600, color: active || conv.hasUnread ? C.text : C.sub, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
                            {conv.otherName ?? 'Usuario'}
                          </span>
                          {convLastAt(conv) && (
                            <span style={{ fontSize:11, color: conv.hasUnread ? C.accent2 : C.muted, fontWeight: conv.hasUnread ? 500 : 400, whiteSpace:'nowrap', flexShrink:0 }}>
                              {fmtTime(convLastAt(conv))}
                            </span>
                          )}
                        </div>
                        {/* Fila 2: último mensaje + badge/menú */}
                        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                          <p style={{ fontSize:12, color: conv.hasUnread ? 'rgba(255,255,255,.75)' : C.muted, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
                            {convLastText(conv.lastMessage) || '—'}
                          </p>
                          {conv.hasUnread && !(hovered || menuOpen) && (
                            <span style={{ flexShrink:0, background:'#7c3aed', color:'#fff', fontSize:10, fontWeight:700, lineHeight:1, padding:'2px 5px', borderRadius:99, minWidth:16, textAlign:'center' }}>NEW</span>
                          )}
                          {(hovered || menuOpen) && (
                            <span
                              onClick={e => { e.stopPropagation(); setConvMenuId(menuOpen ? null : conv.id) }}
                              style={{ fontSize:15, color:C.muted, padding:'0 2px', lineHeight:1, cursor:'pointer', flexShrink:0 }}
                            >⋯</span>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Conversation menu */}
                    {menuOpen && (
                      <div style={{ position:'absolute', top:'100%', right:8, zIndex:50, background:C.card2, border:`1px solid ${C.border}`, borderRadius:10, overflow:'hidden', boxShadow:'0 4px 16px rgba(0,0,0,.5)', minWidth:180 }}>
                        {([
                          { label:'Eliminar para mí',     fn: () => deleteConvForMe(conv.id),     red: false },
                          { label:'Eliminar para ambos',  fn: () => deleteConvForBoth(conv.id),   red: true  },
                          { label:'Abrir en web →',       fn: () => { setConvMenuId(null); window.api.shell.openExternal(`${WEB}/mensajes`) }, red: false },
                        ] as {label:string;fn:()=>void;red:boolean}[]).map(item => (
                          <button key={item.label} onClick={item.fn} style={{ width:'100%', padding:'9px 14px', border:'none', background:'none', color: item.red ? C.red : C.text, fontSize:12, cursor:'pointer', textAlign:'left' }}
                            onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.06)'}
                            onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'none'}
                          >{item.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right panel */}
          {!selectedConvId ? (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8 }}>
              <p style={{ fontSize:13, color:C.muted, margin:0 }}>Selecciona una conversación</p>
            </div>
          ) : (
            <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
              {/* Header */}
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px', borderBottom:`1px solid ${C.border}`, flexShrink:0, background:C.card }}>
                <Avatar name={selectedConv?.otherName ?? '?'} size={40} />
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontSize:13, fontWeight:600, color:C.text, margin:0 }}>{selectedConv?.otherName ?? 'Usuario'}</p>
                  {selectedConv && !selectedConv.isGroup && (() => {
                    const otherFriend = friends.find(f => f.uid === selectedConv.otherUid)
                    const slug = otherFriend?.username?.replace(/^@/, '') ?? null
                    return slug ? <p style={{ fontSize:11, color:C.muted, margin:'1px 0 0' }}>@{slug}</p> : null
                  })()}
                </div>
                {selectMode ? (
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{ fontSize:11, color:C.muted, marginRight:2 }}>{selectedIds.size} sel.</span>
                    <button onClick={() => setSelectedIds(new Set(messages.map(m => m.id)))} style={{ padding:'3px 9px', borderRadius:6, border:`1px solid rgba(168,85,247,.4)`, background:'rgba(124,58,237,.12)', color:C.accent2, fontSize:11, cursor:'pointer', fontWeight:600 }}>Todo</button>
                    <button onClick={deleteSelectedMsgs} disabled={selectedIds.size === 0} style={{ padding:'3px 9px', borderRadius:6, border:`1px solid ${selectedIds.size > 0 ? 'rgba(248,113,113,.4)' : C.border}`, background: selectedIds.size > 0 ? 'rgba(248,113,113,.1)' : 'transparent', color: selectedIds.size > 0 ? C.red : C.muted, fontSize:11, cursor: selectedIds.size > 0 ? 'pointer' : 'default', fontWeight:600 }}>Borrar</button>
                    <button onClick={() => { setSelectMode(false); setSelectedIds(new Set()) }} style={{ padding:'3px 8px', borderRadius:6, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.05)', color:C.muted, fontSize:12, cursor:'pointer' }}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => setSelectMode(true)} style={{ padding:'4px 8px', borderRadius:6, border:'none', background:'none', color:C.muted, fontSize:11, cursor:'pointer' }}>Selec.</button>
                )}
              </div>

              {/* Messages */}
              <div style={{ flex:1, overflowY:'auto', padding:'12px 14px', display:'flex', flexDirection:'column', gap:4 }}>
                {loadingMsgs ? (
                  <div style={{ display:'flex', justifyContent:'center', padding:'20px 0' }}><Spinner color={C.muted} /></div>
                ) : messages.length === 0 ? (
                  <p style={{ fontSize:12, color:C.muted, textAlign:'center', marginTop:24 }}>Ningún mensaje aún. ¡Di hola!</p>
                ) : messages.map((m, index) => {
                  const mine      = m.senderUid === socialUser.uid
                  const isEditing = editingId === m.id
                  const isSelected = selectedIds.has(m.id)
                  const reacts    = Object.entries(m.reactions ?? {}).filter(([, uids]) => uids.length > 0)

                  const msgAt     = m.at?.toDate ? m.at.toDate() : (m.at ? new Date(m.at.seconds * 1000) : null)
                  const isRead    = !!(mine && otherReadAt && msgAt && otherReadAt >= msgAt)

                  const showDots = hoveredMsgId === m.id && !selectMode && !isEditing

                  const prevMsg  = index > 0 ? messages[index - 1] : null
                  const prevAt   = prevMsg?.at?.toDate ? prevMsg.at.toDate() : (prevMsg?.at ? new Date(prevMsg.at.seconds * 1000) : null)
                  const showDateSep = msgAt && (!prevAt || !isSameDay(msgAt, prevAt))

                  return (
                    <React.Fragment key={m.id}>
                    {showDateSep && (
                      <div style={{ textAlign:'center', margin:'16px 0 8px' }}>
                        <span style={{ fontSize:12, color:C.muted, opacity:0.7 }}>{fmtDateSep(m.at)}</span>
                      </div>
                    )}
                    <div
                      style={{ display:'flex', alignItems:'center', gap:6, padding:'1px 0', borderRadius:8, background: isSelected ? 'rgba(124,58,237,.18)' : 'transparent', transition:'background .1s' }}
                      onClick={() => selectMode && toggleSelectMsg(m.id)}
                      onDoubleClick={() => !selectMode && toggleReaction(m.id, '❤️')}
                      onContextMenu={e => !selectMode && openCtxMenu(e, m)}
                      onMouseEnter={() => setHoveredMsgId(m.id)}
                      onMouseLeave={() => setHoveredMsgId(null)}
                    >
                      {/* Checkbox — always left, vertically centred */}
                      {selectMode && (
                        <div style={{ width:20, height:20, borderRadius:6, border:`2px solid ${isSelected ? C.accent : C.muted}`, background: isSelected ? C.accent : 'transparent', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', marginLeft:4, boxShadow: isSelected ? `0 0 8px rgba(124,58,237,.4)` : 'none', transition:'all .12s' }}>
                          {isSelected && <span style={{ color:'#fff', fontSize:12, lineHeight:1, fontWeight:700 }}>✓</span>}
                        </div>
                      )}

                      {/* Message column — takes remaining width, aligns content by sender */}
                      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems: mine ? 'flex-end' : 'flex-start', minWidth:0 }}>
                        {/* Reply quote */}
                        {m.replyTo && (
                          <div style={{ fontSize:11, color:C.muted, background:'rgba(255,255,255,.06)', borderLeft:`2px solid ${C.accent}`, padding:'3px 8px', borderRadius:6, marginBottom:3, maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {m.replyTo.text}
                          </div>
                        )}

                        {/* Bubble — 3-dot is absolute so it never shifts layout */}
                        {isEditing ? (
                          <div style={{ display:'flex', gap:4, maxWidth:300 }}>
                            <input
                              autoFocus value={editText} onChange={e => setEditText(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null) }}
                              style={{ flex:1, background:C.card, border:`1px solid ${C.accent}`, borderRadius:8, padding:'6px 10px', color:C.text, fontSize:13, outline:'none' }}
                            />
                            <button onClick={saveEdit} style={{ padding:'6px 10px', borderRadius:8, border:'none', background:`linear-gradient(135deg,${C.accent},#6d28d9)`, color:'#fff', cursor:'pointer', fontSize:12 }}>✓</button>
                            <button onClick={() => setEditingId(null)} style={{ padding:'6px 8px', borderRadius:8, border:`1px solid ${C.border}`, background:'transparent', color:C.muted, cursor:'pointer', fontSize:12 }}>✕</button>
                          </div>
                        ) : (
                          <div style={{
                            position:'relative',
                            maxWidth:'78%', padding:'9px 14px',
                            wordBreak:'break-word', overflowWrap:'break-word',
                            borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                            background: isSelected ? (mine ? 'rgba(124,58,237,.5)' : 'rgba(255,255,255,.12)') : (mine ? '#7c3aed' : C.card2),
                            color: mine ? '#fff' : C.text,
                            fontSize:14, lineHeight:1.5,
                            border: 'none',
                            cursor: selectMode ? 'pointer' : 'default',
                          }}>
                            {m.forwarded && <span style={{ fontSize:11, color: mine ? 'rgba(255,255,255,.6)' : C.muted, display:'block', marginBottom:2 }}>↪ Reenviado</span>}
                            {m.text}
                            {m.edited && <span style={{ fontSize:10, color: mine ? 'rgba(255,255,255,.5)' : C.muted, marginLeft:5 }}>editado</span>}
                            {/* Timestamp + read receipt — inside bubble, bottom-right */}
                            <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', gap:3, marginTop:3, marginBottom:-2 }}>
                              <span style={{ fontSize:11, color: mine ? 'rgba(255,255,255,.7)' : C.muted }}>{fmtMsgTime(m.at)}</span>
                              {mine && (
                                isRead
                                  ? <span style={{ fontSize:11, color:'#a855f7', lineHeight:1, marginLeft:2 }}>✓✓</span>
                                  : <span style={{ fontSize:12, color:'rgba(255,255,255,.5)', lineHeight:1, marginLeft:2 }}>✓</span>
                              )}
                            </div>
                            {showDots && (
                              <button
                                onClick={e => { e.stopPropagation(); openCtxMenu(e, m) }}
                                style={{
                                  position:'absolute', top:'50%', transform:'translateY(-50%)',
                                  ...(mine ? { right:'calc(100% + 6px)' } : { left:'calc(100% + 6px)' }),
                                  width:28, height:28, borderRadius:'50%',
                                  background:'rgba(30,30,40,.95)', border:`1px solid ${C.border}`,
                                  color:C.sub, cursor:'pointer', fontSize:14,
                                  display:'flex', alignItems:'center', justifyContent:'center',
                                  zIndex:10, flexShrink:0,
                                }}
                              >⋮</button>
                            )}
                          </div>
                        )}

                        {/* Reactions */}
                        {reacts.length > 0 && (
                          <div style={{ display:'flex', flexWrap:'wrap', gap:3, marginTop:3 }}>
                            {reacts.map(([emoji, uids]) => (
                              <button key={emoji} onClick={() => !selectMode && toggleReaction(m.id, emoji)} style={{
                                background: uids.includes(socialUser.uid) ? 'rgba(124,58,237,.25)' : 'rgba(255,255,255,.07)',
                                border:`1px solid ${uids.includes(socialUser.uid) ? 'rgba(124,58,237,.45)' : C.border}`,
                                borderRadius:20, padding:'1px 6px', fontSize:12, cursor:'pointer', color:C.text, display:'inline-flex', alignItems:'center', gap:2,
                              }}>
                                {emoji}{uids.length > 1 && <span style={{ fontSize:10 }}>{uids.length}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    </React.Fragment>
                  )
                })}
                <div ref={msgEndRef} />
              </div>

              {/* Reply preview */}
              {replyTo && (
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 14px', borderTop:`1px solid ${C.border}`, background:'rgba(124,58,237,.08)', flexShrink:0 }}>
                  <div style={{ width:2, height:28, background:C.accent, borderRadius:2, flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:10, color:C.accent2, margin:'0 0 1px', fontWeight:600 }}>Respondiendo</p>
                    <p style={{ fontSize:11, color:C.muted, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{replyTo.text}</p>
                  </div>
                  <button onClick={() => setReplyTo(null)} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:16, padding:4, lineHeight:1 }}>✕</button>
                </div>
              )}

              {/* Typing indicator */}
              {otherIsTyping && (
                <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 14px 0', fontSize:12, color:C.muted, opacity:0.7, userSelect:'none' }}>
                  <div style={{ display:'flex', gap:3 }}>
                    {[0,1,2].map(i => (
                      <span key={i} style={{ width:5, height:5, borderRadius:'50%', background:C.muted, display:'inline-block', animation:'typingDot 1.2s infinite ease-in-out', animationDelay:`${i * 0.2}s` }} />
                    ))}
                  </div>
                  {selectedConv?.otherName ?? 'Alguien'} está escribiendo…
                </div>
              )}

              {/* Input */}
              <div style={{ borderTop: replyTo ? 'none' : `1px solid ${C.border}`, flexShrink:0, position:'relative' }}>
                {/* Emoji picker panel */}
                {showEmoji && (
                  <div style={{ position:'absolute', bottom:'100%', left:0, right:0, background:C.card2, border:`1px solid ${C.border}`, borderRadius:'12px 12px 0 0', padding:'10px 12px', maxHeight:200, overflowY:'auto' }}>
                    {[
                      ['😀','😂','🥰','😎','😢','😡','🤔','😅','🤣','😊','🥺','😏','🤩','😭','🥳','😬'],
                      ['👍','👎','👋','🤝','🙏','👏','💪','✌️','👌','🤙','🫶','🤜','🤛','✊','👊','🫂'],
                      ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💞','💓','💗','💖','💝','🔥'],
                      ['🎉','🎊','✨','⭐','🌟','💯','🎯','💎','🏆','🎮','🎸','🍕','🐶','🐱','🦆','👀'],
                    ].map((row, i) => (
                      <div key={i} style={{ display:'flex', flexWrap:'wrap', gap:2, marginBottom:4 }}>
                        {row.map(e => (
                          <button key={e} onClick={() => setMsgInput(v => v + e)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, padding:'2px 3px', borderRadius:4, lineHeight:1 }}
                            onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.1)'}
                            onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'none'}
                          >{e}</button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px' }}>
                  <button onClick={() => setShowEmoji(v => !v)} style={{ background: showEmoji ? 'rgba(124,58,237,.15)' : 'none', border:'none', color: showEmoji ? C.accent2 : C.muted, cursor:'pointer', fontSize:18, padding:'4px 7px', borderRadius:8, lineHeight:1, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>😊</button>
                  {/* Pill: textarea + send */}
                  <div style={{ flex:1, display:'flex', alignItems:'flex-end', border:`1px solid ${C.border}`, borderRadius:9999, padding:'2px 4px', background:'transparent', overflow:'hidden' }}>
                    <textarea
                      ref={taRef}
                      placeholder="Mensaje"
                      value={msgInput}
                      rows={1}
                      onChange={e => {
                        setMsgInput(e.target.value)
                        e.target.style.height = 'auto'
                        e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
                        if (selectedConvId && socialUser) {
                          updateDoc(doc(socialDb, 'conversations', selectedConvId), {
                            [`typing.${socialUser.uid}`]: serverTimestamp(),
                          }).catch(() => {})
                          if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
                          typingTimerRef.current = setTimeout(() => {
                            updateDoc(doc(socialDb, 'conversations', selectedConvId), {
                              [`typing.${socialUser.uid}`]: null,
                            }).catch(() => {})
                          }, 4000)
                        }
                      }}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                      onFocus={() => setShowEmoji(false)}
                      style={{ flex:1, background:'transparent', border:'none', color:C.text, fontSize:14, outline:'none', resize:'none', lineHeight:'20px', minHeight:36, maxHeight:160, overflowY:'auto', padding:'8px 4px' }}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!msgInput.trim() || sendingMsg}
                      style={{
                        flexShrink:0, width:36, height:36, borderRadius:'50%', border:'none',
                        background: msgInput.trim() && !sendingMsg ? '#7c3aed' : 'rgba(255,255,255,.08)',
                        color: msgInput.trim() && !sendingMsg ? '#fff' : 'rgba(255,255,255,.3)',
                        cursor: msgInput.trim() && !sendingMsg ? 'pointer' : 'default',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        marginBottom:2, transition:'background .15s',
                      }}
                    >
                      {sendingMsg ? <Spinner size={14} color="#fff" /> : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform:'rotate(-45deg)' }}>
                          <line x1="22" y1="2" x2="11" y2="13"/>
                          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── New conversation modal ── */}
      {showNewChat && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.65)', zIndex:2500, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={closeNewChat}>
          <div style={{ background:C.card2, border:`1px solid ${C.border}`, borderRadius:20, width:500, maxHeight:'80vh', overflow:'hidden', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,.7)', animation:'fadeUp .2s ease both' }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ padding:'18px 20px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <p style={{ fontSize:16, fontWeight:700, color:C.text, margin:0 }}>Nueva conversación</p>
              <button onClick={closeNewChat} style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:8, color:C.muted, cursor:'pointer', fontSize:16, padding:'2px 10px', lineHeight:1.4 }}>×</button>
            </div>

            {/* Type toggle */}
            <div style={{ padding:'16px 20px 0', display:'flex', gap:8 }}>
              <button onClick={() => { setNewChatType('direct'); setNewChatTargets([]) }} style={{
                flex:1, padding:'11px', borderRadius:12, border:'none', fontWeight:600, fontSize:14, cursor:'pointer',
                background: newChatType === 'direct' ? `linear-gradient(135deg,${C.accent},#6d28d9)` : C.card,
                color: newChatType === 'direct' ? '#fff' : C.muted,
              }}>Chat directo</button>
              <button onClick={() => { setNewChatType('group'); setNewChatTargets([]) }} style={{
                flex:1, padding:'11px', borderRadius:12, border:`1px solid ${C.border}`, fontWeight:600, fontSize:14, cursor:'pointer',
                background: newChatType === 'group' ? `linear-gradient(135deg,${C.accent},#6d28d9)` : 'transparent',
                color: newChatType === 'group' ? '#fff' : C.muted,
              }}>👥 Crear grupo</button>
            </div>

            {/* Group name (only for group) */}
            {newChatType === 'group' && (
              <div style={{ padding:'12px 20px 0' }}>
                <input type="text" placeholder="Nombre del grupo…" value={newChatGroupName}
                  onChange={e => setNewChatGroupName(e.target.value)}
                  style={{ width:'100%', background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'10px 14px', color:C.text, fontSize:14, outline:'none', boxSizing:'border-box' }} />
              </div>
            )}

            {/* Search */}
            <div style={{ padding:'12px 20px 0', position:'relative' }}>
              <input autoFocus type="text" placeholder="Buscar @usuario…"
                value={newChatInput}
                onChange={e => setNewChatInput(normalizeHandle(e.target.value))}
                style={{ width:'100%', background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'10px 14px', color:C.text, fontSize:14, outline:'none', boxSizing:'border-box' }} />
              {newChatSugg.length > 0 && (
                <div style={{ marginTop:6, background:C.card, border:`1px solid ${C.border}`, borderRadius:10, overflow:'hidden' }}>
                  {newChatSugg.map(s => (
                    <button key={s.slug} onMouseDown={() => {
                      if (newChatType === 'direct') {
                        startNewChat(s.uid)
                      } else {
                        if (!newChatTargets.find(t => t.uid === s.uid)) {
                          setNewChatTargets(prev => [...prev, s])
                        }
                        setNewChatInput(''); setNewChatSugg([])
                      }
                    }} style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 14px', border:'none', borderBottom:`1px solid ${C.border}`, background:'none', cursor:'pointer', textAlign:'left' }}
                      onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.06)'}
                      onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'none'}
                    >
                      <Avatar name={s.slug} size={28} />
                      <span style={{ fontSize:14, color:C.text }}>@{s.slug}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected group members */}
            {newChatType === 'group' && newChatTargets.length > 0 && (
              <div style={{ padding:'10px 20px 0', display:'flex', flexWrap:'wrap', gap:6 }}>
                {newChatTargets.map(t => (
                  <span key={t.uid} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:20, background:'rgba(124,58,237,.18)', border:`1px solid rgba(124,58,237,.3)`, fontSize:12, color:C.text }}>
                    @{t.slug}
                    <button onClick={() => setNewChatTargets(prev => prev.filter(x => x.uid !== t.uid))} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', padding:0, fontSize:14, lineHeight:1 }}>×</button>
                  </span>
                ))}
              </div>
            )}

            {/* Actions */}
            <div style={{ padding:'16px 20px', display:'flex', gap:8, justifyContent:'flex-end', marginTop:'auto' }}>
              <button onClick={closeNewChat} style={{ padding:'10px 20px', borderRadius:10, border:`1px solid ${C.border}`, background:'transparent', color:C.muted, fontSize:14, cursor:'pointer' }}>Cancelar</button>
              <button
                disabled={newChatType === 'group' ? newChatTargets.length === 0 : false}
                onClick={() => newChatType === 'group' ? createGroupChat() : undefined}
                style={{ padding:'10px 20px', borderRadius:10, border:'none', fontSize:14, fontWeight:600, cursor: newChatType === 'group' && newChatTargets.length > 0 ? 'pointer' : 'not-allowed',
                  background: newChatType === 'group' && newChatTargets.length > 0 ? `linear-gradient(135deg,${C.accent},#6d28d9)` : C.card,
                  color: newChatType === 'group' && newChatTargets.length > 0 ? '#fff' : C.muted,
                }}>
                {newChatType === 'direct' ? 'Buscar' : 'Crear grupo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div
          style={{ position:'fixed', top:ctxMenu.y, left:ctxMenu.x, zIndex:3000, background:C.card2, border:`1px solid ${C.border}`, borderRadius:14, boxShadow:'0 8px 32px rgba(0,0,0,.7)', minWidth:190, overflow:'hidden' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Reaction bar */}
          <div style={{ display:'flex', padding:'7px 8px', gap:1, borderBottom:`1px solid ${C.border}` }}>
            {REACTIONS.map(e => (
              <button key={e} onClick={() => toggleReaction(ctxMenu.msg.id, e)}
                style={{ background:'none', border:'none', cursor:'pointer', fontSize:17, padding:'2px 5px', borderRadius:6 }}
                onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.1)'}
                onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'none'}
              >{e}</button>
            ))}
          </div>
          {/* Menu items */}
          {([
            { label:'Copiar',          fn: () => copyMsg(ctxMenu.msg.text) },
            { label:'Responder',       fn: () => { setReplyTo(ctxMenu.msg); setCtxMenu(null) } },
            { label:'Reenviar',        fn: () => { setFwdMsg(ctxMenu.msg); setCtxMenu(null) } },
            { label:'Seleccionar',     fn: () => { setSelectMode(true); toggleSelectMsg(ctxMenu.msg.id); setCtxMenu(null) } },
            ...(ctxMenu.msg.senderUid === socialUser.uid ? [
              { label:'Editar',            fn: () => startEdit(ctxMenu.msg) },
              { label:'Borrar para todos', fn: () => deleteForEveryone(ctxMenu.msg.id), red: true },
            ] : []),
            { label:'Borrar para mí',  fn: () => deleteForMe(ctxMenu.msg.id), red: true },
          ] as { label: string; fn: () => void; red?: boolean }[]).map(item => (
            <button key={item.label} onClick={item.fn} style={{
              width:'100%', padding:'9px 16px', background:'none', border:'none',
              color: item.red ? C.red : C.text, fontSize:13, cursor:'pointer',
              textAlign:'left', display:'flex', alignItems:'center', transition:'background .12s',
            }}
              onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.06)'}
              onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'none'}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Forward modal ── */}
      {fwdMsg && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.65)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setFwdMsg(null)}>
          <div style={{ background:C.card2, border:`1px solid ${C.border}`, borderRadius:18, width:280, maxHeight:380, overflow:'hidden', display:'flex', flexDirection:'column' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding:'14px 16px', borderBottom:`1px solid ${C.border}` }}>
              <p style={{ fontSize:14, fontWeight:600, color:C.text, margin:0 }}>Reenviar mensaje</p>
              <p style={{ fontSize:11, color:C.muted, margin:'3px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>"{fwdMsg.text}"</p>
            </div>
            <div style={{ overflowY:'auto', flex:1 }}>
              {conversations.filter(c => c.id !== selectedConvId).length === 0 ? (
                <p style={{ fontSize:12, color:C.muted, textAlign:'center', padding:'20px 16px', margin:0 }}>Sin otras conversaciones</p>
              ) : conversations.filter(c => c.id !== selectedConvId).map(conv => (
                <button key={conv.id} onClick={() => doForward(conv.id)} style={{
                  width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 16px',
                  border:'none', borderBottom:`1px solid ${C.border}`, background:'none', cursor:'pointer', textAlign:'left',
                }}
                  onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,.1)'}
                  onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'none'}
                >
                  <Avatar name={conv.otherName ?? '?'} size={28} />
                  <span style={{ fontSize:13, color:C.text }}>{conv.otherName ?? 'Usuario'}</span>
                </button>
              ))}
            </div>
            <div style={{ padding:'10px 14px', borderTop:`1px solid ${C.border}` }}>
              <button onClick={() => setFwdMsg(null)} style={{ width:'100%', padding:'8px', borderRadius:8, border:`1px solid ${C.border}`, background:'transparent', color:C.muted, fontSize:12, cursor:'pointer' }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
