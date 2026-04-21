import { create } from 'zustand'
import type { Instance, MinecraftAccount, Settings, DownloadProgress } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/types'

interface UpdateInfo {
  version: string
  releaseNotes?: string
  date?: string
  files: { win32?: string; darwin?: string; linux?: string }
}

interface AppState {
  instances: Instance[]
  accounts: MinecraftAccount[]
  activeAccountId?: string
  settings: Settings
  progress: DownloadProgress | null
  progressStartedAt: number | null
  pendingUpdate: UpdateInfo | null
  updateModalOpen: boolean
  gameLogs: Record<string, string[]>
  runningInstances: Set<string>

  setInstances: (instances: Instance[]) => void
  addInstance: (instance: Instance) => void
  updateInstance: (instance: Instance) => void
  removeInstance: (id: string) => void

  setAccounts: (accounts: MinecraftAccount[]) => void
  addAccount: (account: MinecraftAccount) => void
  removeAccount: (id: string) => void
  setActiveAccountId: (id: string | undefined) => void

  setSettings: (settings: Partial<Settings>) => void
  addProgress: (progress: DownloadProgress) => void
  clearProgress: () => void
  setPendingUpdate: (update: UpdateInfo | null) => void
  setUpdateModalOpen: (open: boolean) => void
  appendGameLog: (instanceId: string, line: string) => void
  clearGameLog: (instanceId: string) => void
  setInstanceRunning: (instanceId: string, running: boolean) => void
}

export const useStore = create<AppState>((set) => ({
  instances: [],
  accounts: [],
  activeAccountId: undefined,
  settings: DEFAULT_SETTINGS,
  progress: null,
  progressStartedAt: null,
  pendingUpdate: null,
  updateModalOpen: false,
  gameLogs: {},
  runningInstances: new Set(),

  setInstances: (instances) => set({ instances }),
  addInstance: (instance) => set((s) => ({ instances: [instance, ...s.instances] })),
  updateInstance: (instance) =>
    set((s) => ({ instances: s.instances.map((i) => (i.id === instance.id ? instance : i)) })),
  removeInstance: (id) => set((s) => ({ instances: s.instances.filter((i) => i.id !== id) })),

  setAccounts: (accounts) => set({ accounts }),
  addAccount: (account) =>
    set((s) => ({
      accounts: [...s.accounts.filter((a) => a.id !== account.id), account],
      activeAccountId: account.id
    })),
  removeAccount: (id) =>
    set((s) => ({
      accounts: s.accounts.filter((a) => a.id !== id),
      activeAccountId: s.activeAccountId === id ? s.accounts[0]?.id : s.activeAccountId
    })),
  setActiveAccountId: (id) => set({ activeAccountId: id }),

  setSettings: (settings) => set((s) => ({ settings: { ...s.settings, ...settings } })),
  addProgress: (progress) =>
    set((s) => ({
      progress,
      progressStartedAt: s.progress === null ? Date.now() : s.progressStartedAt
    })),
  clearProgress: () => set({ progress: null, progressStartedAt: null }),
  setPendingUpdate: (update) => set({ pendingUpdate: update }),
  setUpdateModalOpen: (open) => set({ updateModalOpen: open }),
  appendGameLog: (instanceId, line) =>
    set((s) => {
      const prev = s.gameLogs[instanceId] ?? []
      const next = prev.length > 2000 ? prev.slice(-1900) : prev
      return { gameLogs: { ...s.gameLogs, [instanceId]: [...next, line] } }
    }),
  clearGameLog: (instanceId) =>
    set((s) => ({ gameLogs: { ...s.gameLogs, [instanceId]: [] } })),
  setInstanceRunning: (instanceId, running) =>
    set((s) => {
      const next = new Set(s.runningInstances)
      running ? next.add(instanceId) : next.delete(instanceId)
      return { runningInstances: next }
    })
}))

export const activeAccount = (state: AppState) =>
  state.accounts.find((a) => a.id === state.activeAccountId)
