import { useState, useEffect, useMemo } from 'react'
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile,
  signInWithCredential, GoogleAuthProvider, fetchSignInMethodsForEmail,
  deleteUser, type User,
} from 'firebase/auth'
import {
  doc, getDoc, onSnapshot, collection, deleteDoc,
} from 'firebase/firestore'
import { socialAuth, socialDb } from '../lib/firebase'
import { useStore, activeAccount } from '../store'
import {
  reserveUsernameAndUpsertProfile, validateHandle, normalizeHandle,
  USERNAME_MIN, USERNAME_MAX, DISPLAY_NAME_MAX,
} from '../lib/username'

const WEB = 'https://fport1web.vercel.app'

// ── Design tokens (match fport1web dark theme + launcher navy) ─────────────────
const C = {
  bg:      '#0b0b10',
  card:    '#111118',
  card2:   '#16161f',
  border:  '#1e293b',
  text:    '#e2e8f0',
  sub:     '#94a3b8',
  muted:   '#64748b',
  accent:  '#7c3aed',
  accent2: '#a855f7',
  green:   '#4ade80',
  blue:    '#60a5fa',
  red:     '#f87171',
  yellow:  '#facc15',
}

// ── CSS injected once ─────────────────────────────────────────────────────────
const STYLES = `
  @keyframes fadeUp   { from { opacity:0; transform:translateY(18px) } to { opacity:1; transform:translateY(0) } }
  @keyframes fadeIn   { from { opacity:0 } to { opacity:1 } }
  @keyframes slideTab { from { opacity:0; transform:translateX(10px) } to { opacity:1; transform:translateX(0) } }
  @keyframes ping     { 0%   { transform:scale(1); opacity:.75 } 100% { transform:scale(2.2); opacity:0 } }
  @keyframes spin     { to   { transform:rotate(360deg) } }
  @keyframes glow     { 0%,100% { opacity:.35 } 50% { opacity:.65 } }
  @keyframes float    { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-14px) } }
  @keyframes cardIn   { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }

  .f1-card:hover { transform:translateY(-2px); box-shadow:0 8px 28px rgba(0,0,0,.45) !important; }
  .f1-card { transition: transform .18s, box-shadow .18s; }

  .f1-btn-primary:hover:not(:disabled) { filter:brightness(1.12); transform:scale(0.99); }
  .f1-btn-primary:active:not(:disabled) { transform:scale(0.97); }
  .f1-btn-primary { transition: filter .15s, transform .1s; }

  .f1-google:hover:not(:disabled) { background:#1c1c28 !important; border-color:#334155 !important; }
  .f1-google { transition: background .15s, border-color .15s; }

  .f1-tab { transition: background .18s, color .18s; }
  .f1-input { transition: border-color .2s, box-shadow .2s; }
  .f1-input:focus { box-shadow: 0 0 0 3px rgba(124,58,237,.18) !important; }
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
        <span style={{ position:'absolute', inset:0, borderRadius:'50%', background:C.green, opacity:.6, animation:'ping 1.2s cubic-bezier(0,0,.2,1) infinite' }} />
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
      borderRadius:14, border:`1px solid ${isPlaying ? 'rgba(74,222,128,.28)' : isOnline ? 'rgba(96,165,250,.18)' : C.border}`,
      background:`linear-gradient(135deg,${C.card},${C.card2})`,
      boxShadow: isPlaying ? '0 0 18px rgba(74,222,128,.06)' : '0 2px 8px rgba(0,0,0,.3)',
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

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true)
    try {
      await signInWithEmailAndPassword(socialAuth, email.trim(), pass)
    } catch (ex: any) {
      setErr(
        ex.code === 'auth/invalid-credential'     ? 'Email o contraseña incorrectos.' :
        ex.code === 'auth/too-many-requests'       ? 'Demasiados intentos. Espera un momento.' :
        ex.code === 'auth/network-request-failed'  ? 'Error de red. Comprueba tu conexión.' :
        'Error al iniciar sesión.'
      )
    } finally { setLoading(false) }
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
  const [tab,            setTab]           = useState<'login'|'register'>('login')
  const [waitingGoogle,  setWaitingGoogle] = useState(false)
  const [googleErr,      setGoogleErr]     = useState('')

  function handleGoogleAuth() {
    setGoogleErr('')
    setWaitingGoogle(true)

    // Generate a short random session code
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(36)).join('').slice(0, 10)

    // Open the web auth page with the code so it can write to Firestore
    window.api.shell.openExternal(`https://fport1web.vercel.app/auth/launcher?code=${code}`)

    // Watch Firestore for the session doc the web page will create
    const sessionRef = doc(socialDb, 'launcher_sessions', code)
    const unsubSnap = onSnapshot(sessionRef, async snap => {
      if (!snap.exists()) return
      unsubSnap()

      const { idToken, accessToken } = snap.data() as { idToken: string; accessToken: string }
      if (!idToken) { setGoogleErr('No se recibió el token. Intenta de nuevo.'); setWaitingGoogle(false); return }

      try {
        const credential = GoogleAuthProvider.credential(idToken, accessToken || null)
        await signInWithCredential(socialAuth, credential)
        // Clean up the session doc
        await deleteDoc(sessionRef).catch(() => {})
        setWaitingGoogle(false)
      } catch (ex: any) {
        setGoogleErr(ex.message ?? 'Error al iniciar sesión con Google.')
        setWaitingGoogle(false)
      }
    }, () => { setGoogleErr('Error de conexión con Firestore.'); setWaitingGoogle(false) })

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
        <p style={{ fontSize:13, color:C.muted, margin:0, textAlign:'center', maxWidth:280, animation:'fadeUp .3s ease both .05s' }}>
          Completa el inicio de sesión con Google en tu navegador y vuelve aquí automáticamente.
        </p>
        <button onClick={() => setWaitingGoogle(false)} style={{
          marginTop:8, padding:'7px 16px', borderRadius:10, border:`1px solid ${C.border}`,
          background:'transparent', color:C.muted, fontSize:12, cursor:'pointer',
        }}>
          Cancelar
        </button>
      </div>
    )
  }

  return (
    <div style={{ height:'100%', overflowY:'auto', background:C.bg }}>
      {/* Purple top strip */}
      <div style={{ height:3, background:`linear-gradient(90deg,${C.accent},${C.accent2},${C.accent})` }} />

      {/* Hero */}
      <div style={{ position:'relative', padding:'32px 24px 24px', overflow:'hidden', borderBottom:`1px solid ${C.border}` }}>
        <div style={{ position:'absolute', top:-40, right:-40, width:220, height:220, borderRadius:'50%', background:`radial-gradient(circle,rgba(124,58,237,.18),transparent 70%)`, animation:'glow 3s ease-in-out infinite', pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:-60, left:-30, width:160, height:160, borderRadius:'50%', background:`radial-gradient(circle,rgba(168,85,247,.12),transparent 70%)`, animation:'glow 4s ease-in-out infinite 1s', pointerEvents:'none' }} />
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
            <button key={t} onClick={() => setTab(t)} className="f1-tab" style={{
              flex:1, padding:'8px', borderRadius:9, border:'none', fontSize:13, fontWeight:600,
              cursor:'pointer',
              background: tab === t ? `linear-gradient(135deg,${C.accent},#6d28d9)` : 'transparent',
              color: tab === t ? '#fff' : C.muted,
            }}>
              {t === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
            </button>
          ))}
        </div>

        {tab === 'login'
          ? <LoginForm key="login" onGoogleAuth={handleGoogleAuth} />
          : <RegisterForm key="register" onGoogleAuth={handleGoogleAuth} defaultMc={mcUsername} />
        }
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
        <p style={{ fontSize:11, fontWeight:700, letterSpacing:'0.12em', color:C.accent, textTransform:'uppercase', margin:'0 0 6px' }}>fport1-social</p>
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

// ── Main page ──────────────────────────────────────────────────────────────────

export default function FriendsPage() {
  const account = useStore(activeAccount)
  const [socialUser,    setSocialUser]    = useState<User | null | undefined>(undefined)
  const [needsProfile,  setNeedsProfile]  = useState(false)
  const [profile,       setProfile]       = useState<{ username: string|null; profileName: string|null } | null>(null)
  const [friends,       setFriends]       = useState<SocialFriend[]>([])
  const [loadingFriends,setLoadingFriends] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(socialAuth, u => setSocialUser(u))
    return unsub
  }, [])

  useEffect(() => {
    if (!socialUser) { setFriends([]); setProfile(null); setNeedsProfile(false); return }

    getDoc(doc(socialDb, 'users', socialUser.uid)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setNeedsProfile(!d.usernameSlug)
        setProfile({ username: d.username ?? null, profileName: d.profileName ?? d.displayName ?? null })
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
        const pr = presences[i].exists() ? presences[i].data() : null
        return {
          uid: uids[i],
          profileName:       d.profileName ?? d.displayName ?? null,
          username:          d.username ?? null,
          minecraftUsername: d.minecraftUsername ?? null,
          minecraftUUID:     d.minecraftUUID ?? null,
          presence:          pr ? { online: pr.online, playing: pr.playing } : null,
        }
      }))
      setLoadingFriends(false)
    })
    return unsub
  }, [socialUser])

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
          setProfile({ username, profileName })
          setNeedsProfile(false)
        }} />
      </>
    )
  }

  // Signed in
  const playing = friends.filter(f => f.presence?.playing)
  const online  = friends.filter(f => !f.presence?.playing && f.presence?.online)
  const offline = friends.filter(f => !f.presence?.playing && !f.presence?.online)

  return (
    <div style={{ height:'100%', overflowY:'auto', background:C.bg, animation:'fadeIn .25s ease' }}>
      <style>{STYLES}</style>

      {/* Hero */}
      <div style={{
        position:'relative', padding:'28px 24px 20px',
        background:`linear-gradient(135deg,${C.bg} 0%,#1a1a2e 50%,#1e1040 100%)`,
        borderBottom:`1px solid ${C.border}`, overflow:'hidden',
      }}>
        <div style={{ position:'absolute', top:0, right:0, width:240, height:140, background:`radial-gradient(ellipse at top right,rgba(124,58,237,.22) 0%,transparent 70%)`, animation:'glow 3s ease-in-out infinite', pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:-20, left:60, width:120, height:120, background:`radial-gradient(circle,rgba(168,85,247,.1),transparent 70%)`, animation:'glow 4s ease-in-out infinite 1.5s', pointerEvents:'none' }} />

        <p style={{ fontSize:11, fontWeight:700, letterSpacing:'0.12em', color:C.accent, textTransform:'uppercase', margin:'0 0 4px', animation:'fadeUp .3s ease both' }}>fport1-social</p>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:12 }}>
          <div style={{ animation:'fadeUp .32s ease both .05s' }}>
            <h1 style={{ fontSize:22, fontWeight:700, color:C.text, margin:'0 0 2px' }}>Amigos</h1>
            {profile && (
              <p style={{ fontSize:13, color:C.muted, margin:0 }}>
                {profile.profileName}
                {profile.username && <span style={{ color:C.accent2, marginLeft:6, fontWeight:500 }}>{profile.username}</span>}
              </p>
            )}
          </div>
          <button onClick={() => signOut(socialAuth)} className="f1-google" style={{
            padding:'6px 14px', borderRadius:10, border:`1px solid ${C.border}`,
            background:'rgba(255,255,255,.04)', color:C.muted, fontSize:12, cursor:'pointer', whiteSpace:'nowrap',
          }}>
            Cerrar sesión
          </button>
        </div>
      </div>

      {/* Friends list */}
      <div style={{ padding:'20px', maxWidth:520, animation:'fadeUp .3s ease both .1s' }}>
        {loadingFriends ? (
          <div style={{ display:'flex', alignItems:'center', gap:8, color:C.muted, fontSize:13, padding:'20px 0' }}>
            <Spinner size={16} color={C.muted} /> Cargando amigos...
          </div>
        ) : friends.length === 0 ? (
          <div style={{ borderRadius:18, border:`1px solid ${C.border}`, background:C.card, padding:'32px 20px', textAlign:'center', animation:'fadeUp .3s ease both .15s' }}>
            <div style={{ fontSize:36, marginBottom:10 }}>👾</div>
            <p style={{ fontSize:14, fontWeight:500, color:C.sub, margin:'0 0 6px' }}>Sin amigos aún</p>
            <p style={{ fontSize:12, color:C.muted, margin:'0 0 16px' }}>Añade amigos desde fport1-social y aparecerán aquí en tiempo real.</p>
            <button onClick={() => window.api.shell.openExternal(`${WEB}/amigos`)} className="f1-btn-primary" style={{
              padding:'8px 18px', borderRadius:10, border:'none',
              background:`linear-gradient(135deg,rgba(124,58,237,.25),rgba(109,40,217,.25))`,
              color:C.accent2, fontSize:12, fontWeight:600, cursor:'pointer',
              outline:`1px solid rgba(124,58,237,.3)`,
            }}>
              Abrir fport1-social →
            </button>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:22 }}>
            {playing.length > 0 && (
              <div>
                <SectionLabel label="Jugando ahora" count={playing.length} color={C.green} />
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {playing.map((f, i) => <FriendCard key={f.uid} f={f} delay={i * 40} />)}
                </div>
              </div>
            )}
            {online.length > 0 && (
              <div>
                <SectionLabel label="En línea" count={online.length} color={C.blue} />
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {online.map((f, i) => <FriendCard key={f.uid} f={f} delay={i * 40} />)}
                </div>
              </div>
            )}
            {offline.length > 0 && (
              <div style={{ opacity:.7 }}>
                <SectionLabel label="Desconectados" count={offline.length} color={C.muted} />
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {offline.map((f, i) => <FriendCard key={f.uid} f={f} delay={i * 30} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
