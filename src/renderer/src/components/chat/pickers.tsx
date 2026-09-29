import { useEffect, useRef, useState } from 'react'
import { giphyFetch, type GifItem } from '../../lib/chat/giphy'

// ── Emojis ──────────────────────────────────────────────────────────────────

const EMOJI_GROUPS: { label: string; icon: string; list: string }[] = [
  { label: 'Recientes', icon: '🕘', list: '' },
  { label: 'Caras', icon: '😀', list: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖' },
  { label: 'Gestos', icon: '👍', list: '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁️ 👅 👄 💋' },
  { label: 'Corazones', icon: '❤️', list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤 ✨ 🔥 ⭐ 🌟' },
  { label: 'Juegos', icon: '🎮', list: '🎮 🕹️ 👾 🎲 🧩 ♟️ 🎯 🏆 🥇 🥈 🥉 🏅 🎖️ ⚽ 🏀 🏈 ⚾ 🎾 🏐 🎳 🏓 🥊 🎣 ⛏️ 🪓 🗡️ ⚔️ 🛡️ 🏹 🧱 🪵 💎 🪙 🔮 🧪 🗺️ 🧭 ⛺ 🏰 🏠 🌋 🗻' },
  { label: 'Naturaleza', icon: '🌿', list: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🕷️ 🐢 🐍 🦎 🐙 🦑 🐠 🐟 🐬 🐳 🦈 🐊 🐘 🦒 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🍁 🍂 🍄 🌸 🌹 🌻 🌼 🌙 ☀️ ⛅ 🌧️ ⛈️ ❄️ ☃️ 🌈 🌊' },
  { label: 'Comida', icon: '🍕', list: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥕 🌽 🌶️ 🥔 🍞 🥐 🧀 🥚 🍳 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🌮 🌯 🥗 🍝 🍜 🍣 🍱 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍿 ☕ 🍵 🧃 🥤 🍺 🍻 🥂 🍷' },
  { label: 'Objetos', icon: '💡', list: '⌚ 📱 💻 ⌨️ 🖥️ 🖱️ 💾 📷 🎥 📺 📻 🎙️ 🎧 🔋 🔌 💡 🔦 🕯️ 💸 💵 💰 💳 🔧 🔨 ⚙️ 🧲 🔫 💣 🔪 🧨 🎁 🎈 🎉 🎊 ✉️ 📦 📌 📎 ✂️ 🔒 🔑 🗝️ 🚪 🛏️ 🚗 🚀 ✈️ ⏰ ⌛ 📅 📝 📚 🎵 🎶 ✅ ❌ ❓ ❗ ⚠️ 🚫 🔴 🟢 🔵 🟡' }
]

const RECENT_KEY = 'ml-chat-recent-emojis'
function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}

export function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [group, setGroup] = useState(recent.length ? 0 : 1)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown) }
  }, [onClose])

  function pick(e: string): void {
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 32)
    setRecent(next)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* sin sitio */ }
    onPick(e)
  }

  const list = group === 0 ? recent : EMOJI_GROUPS[group].list.split(' ')

  return (
    <div ref={ref} className="absolute bottom-full mb-2 left-0 z-50 w-[340px] rounded-2xl border border-[#2a2a38] bg-[#18181f] shadow-2xl overflow-hidden chat-pop">
      <div className="flex border-b border-[#2a2a38] px-1">
        {EMOJI_GROUPS.map((g, i) => (
          <button key={g.label} title={g.label} onClick={() => setGroup(i)}
            className={`flex-1 py-2 text-lg transition-colors ${group === i ? 'bg-[#7c3aed]/20' : 'hover:bg-white/5'} ${i === 0 && !recent.length ? 'opacity-30 pointer-events-none' : ''}`}>
            {g.icon}
          </button>
        ))}
      </div>
      <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">{EMOJI_GROUPS[group].label}</p>
      <div className="grid grid-cols-8 gap-0.5 p-2 max-h-[240px] overflow-y-auto">
        {list.filter(Boolean).map((e, i) => (
          <button key={e + i} onClick={() => pick(e)} className="h-9 text-[22px] rounded-lg hover:bg-white/10 hover:scale-110 transition-transform">{e}</button>
        ))}
      </div>
    </div>
  )
}

// ── GIFs ────────────────────────────────────────────────────────────────────

export function GifPicker({ onPick, onClose }: { onPick: (g: GifItem) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<GifItem[]>([])
  const [next, setNext] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const reqId = useRef(0)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown) }
  }, [onClose])

  useEffect(() => {
    const id = ++reqId.current
    const t = setTimeout(async () => {
      setLoading(true); setError('')
      try {
        const r = await giphyFetch({ q: q.trim() })
        if (id !== reqId.current) return
        setItems(r.data); setNext(r.next)
      } catch { if (id === reqId.current) setError('No se pudieron cargar los GIFs') }
      finally { if (id === reqId.current) setLoading(false) }
    }, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [q])

  async function more(): Promise<void> {
    if (!next || loading) return
    setLoading(true)
    try {
      const r = await giphyFetch({ q: q.trim(), pos: next })
      setItems((prev) => [...prev, ...r.data]); setNext(r.next)
    } catch { /* se queda como está */ }
    finally { setLoading(false) }
  }

  return (
    <div ref={ref} className="absolute bottom-full mb-2 left-0 z-50 w-[380px] rounded-2xl border border-[#2a2a38] bg-[#18181f] shadow-2xl overflow-hidden chat-pop">
      <div className="p-2 border-b border-[#2a2a38]">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar GIFs en Giphy…"
          className="w-full bg-[#09090b] border border-[#2a2a38] focus:border-[#7c3aed] rounded-lg px-3 py-2 text-sm text-[#f4f4f5] outline-none" />
      </div>
      <div className="h-[300px] overflow-y-auto p-2" onScroll={(e) => {
        const el = e.currentTarget
        if (el.scrollTop + el.clientHeight > el.scrollHeight - 120) more()
      }}>
        {error && <p className="text-center text-sm text-[#f87171] py-8">{error}</p>}
        <div className="columns-2 gap-1.5">
          {items.map((g, i) => (
            <button key={g.url + i} onClick={() => onPick(g)} className="mb-1.5 block w-full overflow-hidden rounded-lg bg-white/5 hover:ring-2 hover:ring-[#a855f7] transition"
              style={{ aspectRatio: g.w && g.h ? `${g.w} / ${g.h}` : '4 / 3' }}>
              <img src={g.url} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
        {loading && <p className="text-center text-xs text-[#71717a] py-3">Cargando…</p>}
      </div>
      <div className="px-3 py-1.5 border-t border-[#2a2a38] text-[10px] text-[#71717a] text-right">Powered by GIPHY</div>
    </div>
  )
}
