import { useState, useEffect, useCallback } from 'react'
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
  presence: { online?: boolean; playing?: boolean; lastSeen?: { _seconds?: number } } | null
}

function FriendHead({ uuid, username }: { uuid: string; username: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    window.api.skin.getHead(uuid).then(setSrc).catch(() => {})
  }, [uuid])

  return src ? (
    <img src={src} alt={username} className="w-10 h-10 rounded-lg flex-shrink-0" style={{ imageRendering: 'pixelated' }} />
  ) : (
    <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
      <span className="text-accent text-sm font-bold">{username[0]?.toUpperCase()}</span>
    </div>
  )
}

function PresenceDot({ presence }: { presence: WebFriend['presence'] }) {
  if (!presence) return null
  const color = presence.playing ? '#22c55e' : presence.online ? '#60a5fa' : '#6b7280'
  const label = presence.playing ? 'Jugando' : presence.online ? 'En línea' : 'Desconectado'
  return (
    <span className="flex items-center gap-1 text-[10px]" style={{ color }}>
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: color }} />
      {label}
    </span>
  )
}

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

  // fport1web social data
  const [webProfile, setWebProfile] = useState<{ uid: string; username: string | null; profileName: string | null } | null>(null)
  const [webFriends, setWebFriends] = useState<WebFriend[]>([])
  const [webLoading, setWebLoading] = useState(false)

  // Load local friends
  useEffect(() => {
    window.api.friends.list().then(setFriends).catch(() => {})
  }, [])

  // Fetch fport1web social friends by Minecraft UUID
  useEffect(() => {
    if (!account?.uuid) return
    setWebLoading(true)
    const uuid = account.uuid.replace(/-/g, '')
    fetch(`${WEB_BASE}/api/social?minecraftUUID=${uuid}`)
      .then(r => r.json())
      .then(data => {
        setWebProfile(data.profile ?? null)
        setWebFriends(data.friends ?? [])
      })
      .catch(() => {})
      .finally(() => setWebLoading(false))
  }, [account?.uuid])

  async function addLocalFriend() {
    if (!searchInput.trim() || adding) return
    setAdding(true)
    setAddMsg(null)
    try {
      const result = await window.api.friends.lookup(searchInput.trim())
      if (!result) { setAddMsg({ type: 'err', text: t('friends_not_found', { name: searchInput.trim() }) }); return }
      if (friends.find(f => f.uuid === result.uuid)) { setAddMsg({ type: 'err', text: t('friends_already', { name: result.username }) }); return }
      const friend: Friend = { id: result.uuid, username: result.username, uuid: result.uuid, addedAt: Date.now() }
      await window.api.friends.add(friend)
      addFriendLocal(friend)
      setAddMsg({ type: 'ok', text: t('friends_added', { name: result.username }) })
      setSearchInput('')
    } catch {
      setAddMsg({ type: 'err', text: t('error') })
    } finally { setAdding(false) }
  }

  async function removeFriend(uuid: string) {
    await window.api.friends.remove(uuid)
    removeFriendLocal(uuid)
  }

  function openWeb(path = '') {
    window.api.shell.openExternal(`${WEB_BASE}${path}`)
  }

  if (!account) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full text-text-muted text-sm">
        {t('friends_no_account')}
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">{t('friends_title')}</h1>
        <button
          onClick={() => openWeb('/amigos')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent rounded-lg text-xs font-medium transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          Abrir fport1
        </button>
      </div>

      {/* fport1web social section */}
      <section className="bg-bg-secondary border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-text-primary">Amigos en fport1</p>
          {webProfile ? (
            <button onClick={() => openWeb(`/friends/${webProfile.uid}`)} className="text-[11px] text-accent hover:underline">
              Ver mi perfil →
            </button>
          ) : (
            <button onClick={() => openWeb('/registro')} className="text-[11px] text-accent hover:underline">
              Crear cuenta →
            </button>
          )}
        </div>

        {webLoading ? (
          <p className="text-xs text-text-muted">Cargando...</p>
        ) : !webProfile ? (
          <div className="text-center py-3 space-y-2">
            <p className="text-sm text-text-secondary">Tu cuenta de Minecraft no está vinculada a fport1.</p>
            <p className="text-xs text-text-muted">Regístrate en fport1 con tu usuario de Minecraft para ver tus amigos aquí.</p>
            <button onClick={() => openWeb('/registro')} className="mt-1 px-3 py-1.5 bg-accent hover:bg-accent/80 text-white rounded-lg text-xs font-medium transition-colors">
              Crear cuenta en fport1
            </button>
          </div>
        ) : webFriends.length === 0 ? (
          <div className="text-center py-2 space-y-1">
            <p className="text-sm text-text-secondary">Hola, {webProfile.profileName ?? webProfile.username} 👋</p>
            <p className="text-xs text-text-muted">Aún no tienes amigos en fport1. Añádelos desde la web.</p>
            <button onClick={() => openWeb('/amigos')} className="mt-1 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent rounded-lg text-xs transition-colors">
              Ir a mis amigos en fport1
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {webFriends.map(f => (
              <div key={f.uid} className="flex items-center gap-3 bg-bg-primary border border-border rounded-xl px-3 py-2.5">
                {f.minecraftUUID ? (
                  <FriendHead uuid={f.minecraftUUID} username={f.minecraftUsername ?? f.profileName ?? '?'} />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-accent text-sm font-bold">{(f.profileName ?? f.username ?? '?')[0].toUpperCase()}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{f.profileName ?? f.username}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {f.username && <span className="text-[11px] text-text-muted">{f.username}</span>}
                    {f.minecraftUsername && <span className="text-[11px] text-text-muted">· {f.minecraftUsername}</span>}
                  </div>
                  <PresenceDot presence={f.presence} />
                </div>
                <button
                  onClick={() => openWeb(`/friends/${f.uid}`)}
                  title="Ver perfil"
                  className="p-1.5 text-text-muted hover:text-accent transition-colors rounded-lg hover:bg-accent/10"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Local Minecraft friends */}
      <section className="bg-bg-secondary border border-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-text-primary">Añadir por usuario de Minecraft</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={e => { setSearchInput(e.target.value); setAddMsg(null) }}
            onKeyDown={e => { if (e.key === 'Enter') addLocalFriend() }}
            placeholder={t('friends_add_placeholder')}
            className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
          />
          <button
            onClick={addLocalFriend}
            disabled={adding || !searchInput.trim()}
            className="px-4 py-2 bg-accent hover:bg-accent/80 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {adding ? t('friends_adding') : t('friends_add_btn')}
          </button>
        </div>
        {addMsg && <p className={`text-xs ${addMsg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{addMsg.text}</p>}

        {friends.length > 0 && (
          <div className="space-y-2 pt-1">
            {friends.map(friend => (
              <div key={friend.uuid} className="flex items-center gap-3 bg-bg-primary border border-border rounded-xl px-3 py-2.5">
                <FriendHead uuid={friend.uuid} username={friend.username} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{friend.username}</p>
                  <p className="text-xs text-text-muted">
                    {t('friends_added_at', { date: new Date(friend.addedAt).toLocaleDateString() })}
                  </p>
                </div>
                <button
                  onClick={() => removeFriend(friend.uuid)}
                  title={t('friends_remove')}
                  className="p-1.5 text-text-muted hover:text-red-400 transition-colors rounded-lg hover:bg-red-400/10"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
