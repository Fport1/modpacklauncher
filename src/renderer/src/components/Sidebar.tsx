import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useStore, activeAccount } from '../store'
import { SkinAvatar } from '../pages/SettingsPage'
import { useT } from '../i18n'

const COMPACT_BREAKPOINT = 1080

const navItems = [
  {
    to: '/home',
    labelKey: 'nav_home' as const,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    )
  },
  {
    to: '/instances',
    labelKey: 'nav_instances' as const,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
  const sidebarCompact = useStore(s => s.sidebarCompact)
  const setSidebarCompact = useStore(s => s.setSidebarCompact)
  const isAdmin = account?.type === 'microsoft' && account.username.toLowerCase() === OWNER
  const navigate = useNavigate()

  // Auto-compact on window resize
  useEffect(() => {
    function onResize() {
      setSidebarCompact(window.innerWidth < COMPACT_BREAKPOINT)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [setSidebarCompact])

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

  const navLinkCls = (isActive: boolean) =>
    `flex items-center ${sidebarCompact ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
    }`

  const extraNavItems = [
    {
      to: '/discover',
      labelKey: 'nav_discover' as const,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
      show: true
    },
    {
      to: '/skins',
      labelKey: 'nav_skins' as const,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a5 5 0 100 10A5 5 0 0012 2z"/><path d="M12 14c-5.33 0-8 2.67-8 4v1h16v-1c0-1.33-2.67-4-8-4z"/></svg>,
      show: account?.type === 'microsoft'
    },
    {
      to: '/block-preview',
      labelKey: 'nav_blocks' as const,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
      show: true
    },
    {
      to: '/status',
      labelKey: 'nav_status' as const,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
      show: true
    },
    {
      to: '/friends',
      labelKey: 'nav_friends' as const,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
      show: true
    },
  ]

  return (
    <aside className={`${sidebarCompact ? 'w-14' : 'w-52'} flex flex-col bg-bg-secondary border-r border-border flex-shrink-0 transition-all duration-200`}>
      <nav className="flex-1 p-2 space-y-1 pt-4 overflow-y-auto">
        {navItems.map((item) => (
          <div key={item.to}>
            <NavLink
              to={item.to}
              title={sidebarCompact ? t(item.labelKey) : undefined}
              className={({ isActive }) => navLinkCls(isActive)}
            >
              {item.icon}
              {!sidebarCompact && t(item.labelKey)}
            </NavLink>
            {item.to === '/modpacks' && extraNavItems.filter(e => e.show).map(e => (
              <NavLink key={e.to} to={e.to} title={sidebarCompact ? t(e.labelKey) : undefined}
                className={({ isActive }) => navLinkCls(isActive)}>
                {e.icon}
                {!sidebarCompact && t(e.labelKey)}
              </NavLink>
            ))}
          </div>
        ))}

        {/* Recent instances */}
        {recentInstances.length > 0 && (
          <>
            <div className="pt-2 pb-1">
              <div className="h-px bg-border/60 mx-1" />
            </div>
            {!sidebarCompact && (
              <p className="px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">{t('nav_recent')}</p>
            )}
            {recentInstances.map(inst => (
              <button
                key={inst.id}
                onClick={() => openRecentInstance(inst.id)}
                title={inst.name}
                className={`w-full flex items-center ${sidebarCompact ? 'justify-center px-0' : 'gap-2.5 px-3'} py-2 rounded-lg text-sm transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary group`}
              >
                {recentIcons[inst.id] ? (
                  <img src={recentIcons[inst.id]} alt="" className={`${sidebarCompact ? 'w-7 h-7' : 'w-5 h-5'} rounded flex-shrink-0 object-cover`} />
                ) : (
                  <svg width={sidebarCompact ? 20 : 16} height={sidebarCompact ? 20 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-text-muted group-hover:text-text-secondary">
                    <rect x="2" y="3" width="20" height="14" rx="2"/>
                    <line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                  </svg>
                )}
                {!sidebarCompact && <span className="truncate text-xs">{inst.name}</span>}
              </button>
            ))}
          </>
        )}
      </nav>

      {isAdmin && (
        <div className="px-2 pb-1">
          <NavLink
            to="/admin"
            title={sidebarCompact ? 'Admin' : undefined}
            className={({ isActive }) => navLinkCls(isActive)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            {!sidebarCompact && 'Admin'}
          </NavLink>
        </div>
      )}

      <div className={`p-3 border-t border-border ${sidebarCompact ? 'flex flex-col items-center gap-2' : 'flex items-center gap-1'}`}>
        {/* Toggle compact/expand button */}
        <button
          onClick={() => setSidebarCompact(!sidebarCompact)}
          title={sidebarCompact ? 'Expandir sidebar' : 'Colapsar sidebar'}
          className={`${sidebarCompact ? 'w-8 h-8' : 'w-7 h-7 ml-auto mr-1'} flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors flex-shrink-0`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {sidebarCompact
              ? <><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></>
              : <><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></>
            }
          </svg>
        </button>
        {account ? (
          <div className={`flex items-center ${sidebarCompact ? 'justify-center' : 'gap-2.5 px-1 flex-1 min-w-0'} py-1`}>
            <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0 overflow-hidden" title={sidebarCompact ? account.username : undefined}>
              {account.type === 'microsoft'
                ? <SkinAvatar uuid={account.uuid} username={account.username} />
                : <span className="text-accent text-xs font-bold">{account.username[0].toUpperCase()}</span>
              }
            </div>
            {!sidebarCompact && (
              <div className="overflow-hidden">
                <p className="text-sm font-medium text-text-primary truncate">{account.username}</p>
                <p className="text-xs text-text-muted capitalize">{account.type}</p>
              </div>
            )}
          </div>
        ) : (
          <NavLink
            to="/settings"
            title={sidebarCompact ? 'Add Account' : undefined}
            className={`flex items-center ${sidebarCompact ? 'justify-center' : 'gap-2.5 px-2'} py-2 rounded-lg hover:bg-bg-hover transition-colors`}
          >
            <div className="w-8 h-8 rounded-full bg-border flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            {!sidebarCompact && <span className="text-sm text-text-secondary">{t('nav_add_account')}</span>}
          </NavLink>
        )}
      </div>
    </aside>
  )
}
