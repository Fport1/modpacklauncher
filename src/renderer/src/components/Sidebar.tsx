import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useStore, activeAccount } from '../store'
import { SkinAvatar } from '../pages/SettingsPage'
import { useT } from '../i18n'

const ICO = 22

const navItems = [
  {
    to: '/home',
    labelKey: 'nav_home' as const,
    icon: (
      <svg width={ICO} height={ICO} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    )
  },
  {
    to: '/instances',
    labelKey: 'nav_instances' as const,
    icon: (
      <svg width={ICO} height={ICO} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    )
  },
  {
    to: '/modpacks',
    labelKey: 'nav_modpacks' as const,
    icon: (
      <svg width={ICO} height={ICO} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <polyline points="16 16 12 12 8 16" />
        <line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
      </svg>
    )
  },
  {
    to: '/settings',
    labelKey: 'nav_settings' as const,
    icon: (
      <svg width={ICO} height={ICO} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    )
  }
]

const OWNER = 'devora60'

export default function Sidebar() {
  const t = useT()
  const account = useStore(activeAccount)
  const instances = useStore(s => s.instances)
  const setOpenDetailInstanceId = useStore(s => s.setOpenDetailInstanceId)
  const isAdmin = account?.type === 'microsoft' && account.username.toLowerCase() === OWNER
  const navigate = useNavigate()

  const recentInstances = [...instances]
    .filter(i => i.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
    .slice(0, 3)

  const [recentIcons, setRecentIcons] = useState<Record<string, string>>({})
  useEffect(() => {
    recentInstances.forEach(inst => {
      window.api.instances.getIcon(inst.id)
        .then(icon => { if (icon) setRecentIcons(prev => ({ ...prev, [inst.id]: icon })) })
        .catch(() => {})
    })
  }, [recentInstances.map(i => i.id).join(',')])

  function openRecentInstance(id: string) {
    setOpenDetailInstanceId(id)
    navigate('/instances')
  }

  const navCls = (isActive: boolean) =>
    `flex items-center justify-center w-10 h-10 rounded-xl transition-colors ${
      isActive ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
    }`

  const extraNavItems = [
    {
      to: '/discover',
      labelKey: 'nav_discover' as const,
      icon: <svg width={ICO} height={ICO} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
      show: true
    },
    {
      to: '/skins',
      labelKey: 'nav_skins' as const,
      icon: <svg width={ICO} height={ICO} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2a5 5 0 100 10A5 5 0 0012 2z"/><path d="M12 14c-5.33 0-8 2.67-8 4v1h16v-1c0-1.33-2.67-4-8-4z"/></svg>,
      show: account?.type === 'microsoft'
    },
    {
      to: '/block-preview',
      labelKey: 'nav_blocks' as const,
      icon: <svg width={ICO} height={ICO} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
      show: true
    },
    {
      to: '/status',
      labelKey: 'nav_status' as const,
      icon: <svg width={ICO} height={ICO} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
      show: true
    },
    {
      to: '/friends',
      labelKey: 'nav_friends' as const,
      icon: <svg width={ICO} height={ICO} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
      show: true
    },
  ]

  return (
    <aside className="w-16 flex flex-col bg-bg-secondary border-r border-border flex-shrink-0">
      <nav className="flex-1 flex flex-col items-center py-4 gap-1 overflow-y-auto">
        {navItems.map((item) => (
          <div key={item.to} className="flex flex-col items-center gap-1">
            <NavLink to={item.to} title={t(item.labelKey)} className={({ isActive }) => navCls(isActive)}>
              {item.icon}
            </NavLink>
            {item.to === '/modpacks' && extraNavItems.filter(e => e.show).map(e => (
              <NavLink key={e.to} to={e.to} title={t(e.labelKey)} className={({ isActive }) => navCls(isActive)}>
                {e.icon}
              </NavLink>
            ))}
          </div>
        ))}

        {/* Separator */}
        {recentInstances.length > 0 && (
          <>
            <div className="h-px bg-border/60 w-8 my-1" />
            {recentInstances.map(inst => (
              <button
                key={inst.id}
                onClick={() => openRecentInstance(inst.id)}
                title={inst.name}
                className="w-10 h-10 flex items-center justify-center rounded-xl text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                {recentIcons[inst.id] ? (
                  <img src={recentIcons[inst.id]} alt="" className="w-7 h-7 rounded-lg object-cover" />
                ) : (
                  <svg width={ICO} height={ICO} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="2" y="3" width="20" height="14" rx="2"/>
                    <line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                  </svg>
                )}
              </button>
            ))}
          </>
        )}
      </nav>

      {isAdmin && (
        <div className="flex justify-center pb-1">
          <NavLink to="/admin" title="Admin" className={({ isActive }) => navCls(isActive)}>
            <svg width={ICO} height={ICO} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </NavLink>
        </div>
      )}

      <div className="p-2 border-t border-border flex justify-center">
        <NavLink to="/settings" title={account ? account.username : t('nav_add_account')}>
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center overflow-hidden hover:bg-accent/20 transition-colors">
            {account ? (
              account.type === 'microsoft'
                ? <SkinAvatar uuid={account.uuid} username={account.username} />
                : <span className="text-accent text-sm font-bold">{account.username[0].toUpperCase()}</span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            )}
          </div>
        </NavLink>
      </div>
    </aside>
  )
}
