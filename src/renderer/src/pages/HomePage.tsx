import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, activeAccount } from '../store'
import type { Instance } from '../../../shared/types'
import { APP_VERSION } from '../../../shared/types'
import UpdateCheckBtn from '../components/UpdateCheckBtn'

export default function HomePage() {
  const account = useStore(activeAccount)
  const { setInstances } = useStore()
  const [recent, setRecent] = useState<Instance[]>([])
  const [launching, setLaunching] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.instances.list().then((all) => {
      setInstances(all)
      setRecent(all.slice(0, 3))
    })
  }, [])

  async function play(instanceId: string) {
    if (!account) { setError('Select an account in Settings first.'); return }
    setError('')
    setLaunching(instanceId)
    try {
      await window.api.launcher.launch(instanceId)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Launch failed')
    } finally {
      setLaunching(null)
    }
  }

  return (
    <div className="p-6">
      {/* Welcome */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-1">
            {account ? `Welcome back, ${account.username}!` : 'Welcome to ModpackLauncher'}
          </h1>
          <p className="text-text-secondary text-sm">
            {account
              ? 'Your instances and modpacks are ready to go.'
              : 'Add an account in Settings to start playing.'}
          </p>
        </div>
        <UpdateCheckBtn />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Instances', value: useStore.getState().instances.length, to: '/instances' },
          {
            label: 'Account',
            value: account?.username ?? 'None',
            to: '/settings'
          },
          { label: 'Version', value: `v${APP_VERSION}`, to: '/settings' }
        ].map((stat) => (
          <Link
            key={stat.label}
            to={stat.to}
            className="bg-bg-card border border-border rounded-xl p-4 hover:border-accent/40 transition-colors"
          >
            <p className="text-xs text-text-muted mb-1">{stat.label}</p>
            <p className="text-lg font-semibold text-text-primary truncate">{stat.value}</p>
          </Link>
        ))}
      </div>

      {/* Recent instances */}
      {recent.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-text-primary">Recent Instances</h2>
            <Link to="/instances" className="text-xs text-accent hover:text-accent-hover">
              View all
            </Link>
          </div>
          <div className="space-y-2">
            {recent.map((inst) => (
              <div
                key={inst.id}
                className="flex items-center gap-4 bg-bg-card border border-border rounded-xl p-3 hover:border-accent/30 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-bg-hover flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="font-medium text-text-primary truncate">{inst.name}</p>
                  <p className="text-xs text-text-muted">
                    MC {inst.minecraft} · {inst.modloader}
                  </p>
                </div>
                <button
                  onClick={() => play(inst.id)}
                  disabled={!!launching}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {launching === inst.id ? 'Launching...' : 'Play'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <p className="text-text-muted mb-3">No instances yet</p>
          <Link
            to="/instances"
            className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
          >
            Create your first instance
          </Link>
        </div>
      )}
    </div>
  )
}
