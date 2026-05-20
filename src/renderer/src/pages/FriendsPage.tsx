import { useState, useEffect, useCallback } from 'react'
import { useStore, activeAccount } from '../store'
import { useT } from '../i18n'
import type { Friend } from '../../../shared/types'

function FriendHead({ uuid, username }: { uuid: string; username: string }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    window.api.skin.getHead(uuid).then(setSrc).catch(() => {})
  }, [uuid])

  if (src) {
    return (
      <img
        src={src}
        alt={username}
        className="w-10 h-10 rounded-lg"
        style={{ imageRendering: 'pixelated' }}
      />
    )
  }

  return (
    <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
      <span className="text-accent text-sm font-bold">{username[0]?.toUpperCase()}</span>
    </div>
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
  const [copied, setCopied] = useState(false)

  const myFriendLink = account
    ? `modpacklauncher://friend-add?username=${encodeURIComponent(account.username)}&uuid=${account.uuid}`
    : null

  const copyLink = useCallback(async () => {
    if (!myFriendLink) return
    try {
      await window.api.clipboard.writeText(myFriendLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }, [myFriendLink])

  async function addFriend() {
    if (!searchInput.trim() || adding) return
    setAdding(true)
    setAddMsg(null)
    try {
      const result = await window.api.friends.lookup(searchInput.trim())
      if (!result) {
        setAddMsg({ type: 'err', text: t('friends_not_found', { name: searchInput.trim() }) })
        return
      }
      if (friends.find(f => f.uuid === result.uuid)) {
        setAddMsg({ type: 'err', text: t('friends_already', { name: result.username }) })
        return
      }
      const friend: Friend = {
        id: result.uuid,
        username: result.username,
        uuid: result.uuid,
        addedAt: Date.now()
      }
      await window.api.friends.add(friend)
      addFriendLocal(friend)
      setAddMsg({ type: 'ok', text: t('friends_added', { name: result.username }) })
      setSearchInput('')
    } catch {
      setAddMsg({ type: 'err', text: t('error') })
    } finally {
      setAdding(false)
    }
  }

  async function removeFriend(uuid: string) {
    await window.api.friends.remove(uuid)
    removeFriendLocal(uuid)
  }

  // Load friends from main process on mount
  useEffect(() => {
    window.api.friends.list().then(setFriends).catch(() => {})
  }, [])

  if (!account) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full text-text-muted text-sm">
        {t('friends_no_account')}
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-text-primary">{t('friends_title')}</h1>

      {/* Your friend link */}
      <section className="bg-bg-secondary border border-border rounded-xl p-4 space-y-2">
        <p className="text-sm font-semibold text-text-primary">{t('friends_my_code')}</p>
        <p className="text-xs text-text-muted">{t('friends_my_code_hint')}</p>
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-xs text-text-secondary font-mono truncate">
            {myFriendLink}
          </div>
          <button
            onClick={copyLink}
            className="shrink-0 px-3 py-2 bg-accent hover:bg-accent/80 text-white rounded-lg text-xs font-medium transition-colors"
          >
            {copied ? t('friends_copied') : t('friends_copy_link')}
          </button>
        </div>
      </section>

      {/* Add friend */}
      <section className="bg-bg-secondary border border-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-text-primary">{t('friends_add_title')}</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={e => { setSearchInput(e.target.value); setAddMsg(null) }}
            onKeyDown={e => { if (e.key === 'Enter') addFriend() }}
            placeholder={t('friends_add_placeholder')}
            className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
          />
          <button
            onClick={addFriend}
            disabled={adding || !searchInput.trim()}
            className="px-4 py-2 bg-accent hover:bg-accent/80 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {adding ? t('friends_adding') : t('friends_add_btn')}
          </button>
        </div>
        {addMsg && (
          <p className={`text-xs ${addMsg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
            {addMsg.text}
          </p>
        )}
      </section>

      {/* Friends list */}
      <section className="space-y-3">
        <p className="text-sm font-semibold text-text-primary">{t('friends_list')}</p>
        {friends.length === 0 ? (
          <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center space-y-1">
            <p className="text-sm text-text-secondary">{t('friends_empty')}</p>
            <p className="text-xs text-text-muted">{t('friends_empty_sub')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {friends.map(friend => (
              <div
                key={friend.uuid}
                className="flex items-center gap-3 bg-bg-secondary border border-border rounded-xl px-4 py-3"
              >
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
