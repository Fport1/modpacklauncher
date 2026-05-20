import { useState, useEffect } from 'react'
import { useStore, activeAccount } from '../store'
import { useT } from '../i18n'
import type { Friend } from '../../../shared/types'

const WEB_BASE = 'https://fport1.vercel.app'

interface WebFriend {
  uid: string
  username: string | null
  profileName: string | null
  minecraftUsername: string | null
  minecraftUUID: string | null
  presence: { online?: boolean; playing?: boolean } | null
}

// ── Skin head ────────────────────────────────────────────────────────────────

function SkinHead({ uuid, name, size = 48 }: { uuid: string; name: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    window.api.skin.getHead(uuid).then(setSrc).catch(() => {})
  }, [uuid])

  const cls = `rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center`
  const style = { width: size, height: size }

  return src ? (
    <img src={src} alt={name} className={cls} style={{ ...style, imageRendering: 'pixelated' }} />
  ) : (
    <div className={cls} style={{ ...style, background: 'linear-gradient(135deg,#4c1d95,#1e3a5f)' }}>
      <span style={{ fontSize: size * 0.4, fontWeight: 700, color: '#a78bfa' }}>
        {name[0]?.toUpperCase()}
      </span>
    </div>
  )
}

function Initials({ name, size = 48 }: { name: string; size?: number }) {
  return (
    <div
      className="rounded-xl flex-shrink-0 flex items-center justify-center"
      style={{ width: size, height: size, background: 'linear-gradient(135deg,#4c1d95,#1e3a5f)' }}
    >
      <span style={{ fontSize: size * 0.4, fontWeight: 700, color: '#a78bfa' }}>
        {name[0]?.toUpperCase()}
      </span>
    </div>
  )
}

// ── Presence badge ────────────────────────────────────────────────────────────

function PresencePill({ presence }: { presence: WebFriend['presence'] }) {
  if (!presence) return <span className="text-[11px] text-text-muted">Desconectado</span>
  if (presence.playing) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-400">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
      </span>
      Jugando
    </span>
  )
  if (presence.online) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-400">
      <span className="h-2 w-2 rounded-full bg-blue-400 inline-block" />
      En línea
    </span>
  )
  return <span className="text-[11px] text-text-muted">Desconectado</span>
}

// ── Friend card ────────────────────────────────────────────────────────────────

function WebFriendCard({ f, onOpen }: { f: WebFriend; onOpen: () => void }) {
  const isPlaying = f.presence?.playing
  const isOnline = f.presence?.online

  return (
    <div
      className="relative flex items-center gap-3 rounded-2xl border p-3 transition-all duration-200 group cursor-default"
      style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        borderColor: isPlaying ? 'rgba(34,197,94,0.3)' : isOnline ? 'rgba(96,165,250,0.2)' : '#334155',
        boxShadow: isPlaying ? '0 0 12px rgba(34,197,94,0.08)' : undefined,
      }}
    >
      {/* Avatar */}
      <div className="relative">
        {f.minecraftUUID
          ? <SkinHead uuid={f.minecraftUUID} name={f.profileName ?? f.username ?? '?'} size={48} />
          : <Initials name={f.profileName ?? f.username ?? '?'} size={48} />
        }
        {/* Presence dot on avatar */}
        {isPlaying && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-green-400 border-2 border-bg-primary" />
        )}
        {!isPlaying && isOnline && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-blue-400 border-2 border-bg-primary" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">{f.profileName ?? f.username}</p>
        {f.username && (
          <p className="text-[11px] font-medium truncate" style={{ color: '#a78bfa' }}>{f.username}</p>
        )}
        <div className="mt-0.5">
          <PresencePill presence={f.presence} />
        </div>
        {f.minecraftUsername && (
          <p className="text-[10px] text-text-muted truncate mt-0.5">⛏ {f.minecraftUsername}</p>
        )}
      </div>

      {/* Open profile */}
      <button
        onClick={onOpen}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-xl hover:bg-white/5 text-text-muted hover:text-purple-400"
        title="Ver perfil en fport1"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </button>
    </div>
  )
}

// ── Local friend card ─────────────────────────────────────────────────────────

function LocalFriendCard({ f, onRemove }: { f: Friend; onRemove: () => void }) {
  const t = useT()
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border border-border p-3 group"
      style={{ background: '#16213e' }}
    >
      <SkinHead uuid={f.uuid} name={f.username} size={44} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">{f.username}</p>
        <p className="text-[10px] text-text-muted mt-0.5">
          Añadido {new Date(f.addedAt).toLocaleDateString()}
        </p>
      </div>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-xl hover:bg-red-500/10 text-text-muted hover:text-red-400"
        title={t('friends_remove')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FriendsPage() {
  const t = useT()
  const account = useStore(activeAccount)
  const friends = useStore(s => s.friends)
  const setFriends = useStore(s => s.setFriends)
  const addFriendLocal = useStore(s => s.addFriendLocal)
  const removeFriendLocal = useStore(s => s.removeFriendLocal)

  const [searchInput, setSearchInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [webProfile, setWebProfile] = useState<{ uid: string; username: string | null; profileName: string | null } | null | undefined>(undefined)
  const [webFriends, setWebFriends] = useState<WebFriend[]>([])
  const [webLoading, setWebLoading] = useState(false)

  useEffect(() => {
    window.api.friends.list().then(setFriends).catch(() => {})
  }, [])

  useEffect(() => {
    if (!account?.uuid) return
    setWebLoading(true)
    const uuid = account.uuid.replace(/-/g, '')
    fetch(`${WEB_BASE}/api/social?minecraftUUID=${uuid}`)
      .then(r => r.json())
      .then(data => { setWebProfile(data.profile ?? null); setWebFriends(data.friends ?? []) })
      .catch(() => setWebProfile(null))
      .finally(() => setWebLoading(false))
  }, [account?.uuid])

  async function addLocalFriend() {
    if (!searchInput.trim() || adding) return
    setAdding(true); setAddMsg(null)
    try {
      const result = await window.api.friends.lookup(searchInput.trim())
      if (!result) { setAddMsg({ type: 'err', text: t('friends_not_found', { name: searchInput.trim() }) }); return }
      if (friends.find(f => f.uuid === result.uuid)) { setAddMsg({ type: 'err', text: t('friends_already', { name: result.username }) }); return }
      const friend: Friend = { id: result.uuid, username: result.username, uuid: result.uuid, addedAt: Date.now() }
      await window.api.friends.add(friend)
      addFriendLocal(friend)
      setAddMsg({ type: 'ok', text: t('friends_added', { name: result.username }) })
      setSearchInput('')
    } catch { setAddMsg({ type: 'err', text: t('error') }) }
    finally { setAdding(false) }
  }

  function openWeb(path = '') { window.api.shell.openExternal(`${WEB_BASE}${path}`) }

  if (!account) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-text-muted text-sm">{t('friends_no_account')}</p>
    </div>
  )

  const playingFriends = webFriends.filter(f => f.presence?.playing)
  const onlineFriends = webFriends.filter(f => !f.presence?.playing && f.presence?.online)
  const offlineFriends = webFriends.filter(f => !f.presence?.playing && !f.presence?.online)

  return (
    <div className="h-full overflow-y-auto">
      {/* Hero banner */}
      <div
        className="relative px-6 pt-8 pb-6 flex items-end gap-4"
        style={{
          background: 'linear-gradient(135deg, #0f0f14 0%, #1a1a2e 40%, #1e1040 100%)',
          borderBottom: '1px solid #334155',
        }}
      >
        {/* Glow accent */}
        <div
          className="absolute top-0 right-0 w-64 h-32 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at top right, rgba(124,58,237,0.18) 0%, transparent 70%)' }}
        />

        <div className="relative z-10 flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#7c3aed' }}>
            Social
          </p>
          <h1 className="text-2xl font-bold text-text-primary">Amigos</h1>
          {webProfile && (
            <p className="text-sm text-text-muted mt-0.5">
              {webProfile.profileName ?? webProfile.username}
              {webProfile.username && (
                <span className="ml-2 font-medium" style={{ color: '#a78bfa' }}>{webProfile.username}</span>
              )}
            </p>
          )}
        </div>

        <div className="relative z-10 flex gap-2">
          {webProfile ? (
            <button
              onClick={() => openWeb(`/friends/${webProfile.uid}`)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)' }}
            >
              Mi perfil →
            </button>
          ) : null}
          <button
            onClick={() => openWeb('/amigos')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid #334155' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            fport1
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-2xl">

        {/* fport1web social section */}
        {webLoading ? (
          <div className="flex items-center gap-2 text-text-muted text-sm py-4">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.2"/>
              <path d="M21 12a9 9 0 00-9-9"/>
            </svg>
            Cargando amigos de fport1...
          </div>
        ) : webProfile === null ? (
          /* Not linked */
          <div
            className="rounded-2xl p-5 flex items-center gap-4"
            style={{
              background: 'linear-gradient(135deg, #1a1a2e, #1e1040)',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(124,58,237,0.15)' }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.8">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                <path d="M16 3.13a4 4 0 010 7.75"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary">Conecta tu cuenta de fport1</p>
              <p className="text-xs text-text-muted mt-0.5">
                Regístrate con tu usuario de Minecraft <span className="font-medium text-text-secondary">{account.username}</span> para ver tus amigos aquí.
              </p>
            </div>
            <button
              onClick={() => openWeb('/registro')}
              className="flex-shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff' }}
            >
              Crear cuenta
            </button>
          </div>
        ) : webFriends.length === 0 && webProfile ? (
          /* No friends yet */
          <div
            className="rounded-2xl p-5 text-center"
            style={{ background: '#1a1a2e', border: '1px solid #334155' }}
          >
            <div className="text-2xl mb-2">👾</div>
            <p className="text-sm font-medium text-text-secondary">Aún no tienes amigos en fport1</p>
            <p className="text-xs text-text-muted mt-1">Añade amigos desde la web y aparecerán aquí con su estado en tiempo real.</p>
            <button
              onClick={() => openWeb('/amigos')}
              className="mt-3 px-4 py-1.5 rounded-xl text-xs font-semibold transition-all inline-block"
              style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)' }}
            >
              Ir a mis amigos →
            </button>
          </div>
        ) : webFriends.length > 0 ? (
          <div className="space-y-3">
            {/* Playing now */}
            {playingFriends.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2 px-1">
                  Jugando ahora — {playingFriends.length}
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {playingFriends.map(f => (
                    <WebFriendCard key={f.uid} f={f} onOpen={() => openWeb(`/friends/${f.uid}`)} />
                  ))}
                </div>
              </div>
            )}

            {/* Online */}
            {onlineFriends.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2 px-1">
                  En línea — {onlineFriends.length}
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {onlineFriends.map(f => (
                    <WebFriendCard key={f.uid} f={f} onOpen={() => openWeb(`/friends/${f.uid}`)} />
                  ))}
                </div>
              </div>
            )}

            {/* Offline */}
            {offlineFriends.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-1">
                  Desconectados — {offlineFriends.length}
                </p>
                <div className="grid grid-cols-1 gap-2 opacity-60">
                  {offlineFriends.map(f => (
                    <WebFriendCard key={f.uid} f={f} onOpen={() => openWeb(`/friends/${f.uid}`)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border/50" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">Minecraft</span>
          <div className="h-px flex-1 bg-border/50" />
        </div>

        {/* Local Minecraft friends: add */}
        <div
          className="rounded-2xl p-4 space-y-3"
          style={{ background: '#16213e', border: '1px solid #334155' }}
        >
          <p className="text-sm font-semibold text-text-primary">Añadir por usuario de Minecraft</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={e => { setSearchInput(e.target.value); setAddMsg(null) }}
              onKeyDown={e => { if (e.key === 'Enter') addLocalFriend() }}
              placeholder="Nombre de usuario..."
              className="flex-1 bg-bg-primary border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
            />
            <button
              onClick={addLocalFriend}
              disabled={adding || !searchInput.trim()}
              className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-bg-primary rounded-xl text-sm font-semibold transition-colors"
            >
              {adding ? '...' : 'Añadir'}
            </button>
          </div>
          {addMsg && (
            <p className={`text-xs ${addMsg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{addMsg.text}</p>
          )}
        </div>

        {/* Local friends list */}
        {friends.length > 0 && (
          <div className="space-y-2">
            {friends.map(f => (
              <LocalFriendCard
                key={f.uuid}
                f={f}
                onRemove={async () => { await window.api.friends.remove(f.uuid); removeFriendLocal(f.uuid) }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
