import { create } from 'zustand'
import type { Instance, MinecraftAccount, Settings, DownloadProgress, Friend, Operation, OperationType } from '../../../shared/types'
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
  operations: Map<string, Operation>
  pendingUpdate: UpdateInfo | null
  updateModalOpen: boolean
  gameLogs: Record<string, string[]>
  runningInstances: Set<string>
  openDetailInstanceId: string | null
  sidebarCompact: boolean

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
  upsertOperation: (update: Partial<Operation> & { id: string }) => void
  removeOperation: (id: string) => void
  setPendingUpdate: (update: UpdateInfo | null) => void
  setUpdateModalOpen: (open: boolean) => void
  appendGameLog: (instanceId: string, line: string) => void
  clearGameLog: (instanceId: string) => void
  setInstanceRunning: (instanceId: string, running: boolean) => void
  setOpenDetailInstanceId: (id: string | null) => void
  setSidebarCompact: (compact: boolean) => void

  friends: Friend[]
  setFriends: (friends: Friend[]) => void
  addFriendLocal: (friend: Friend) => void
  removeFriendLocal: (uuid: string) => void
}

export const useStore = create<AppState>((set) => ({
  instances: [],
  accounts: [],
  activeAccountId: undefined,
  settings: DEFAULT_SETTINGS,
  progress: null,
  progressStartedAt: null,
  operations: new Map(),
  pendingUpdate: null,
  updateModalOpen: false,
  gameLogs: {},
  runningInstances: new Set(),
  openDetailInstanceId: null,
  sidebarCompact: localStorage.getItem('ml-sidebar-compact') === 'true',
  friends: [],

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
  upsertOperation: (update) => set((s) => {
    const existing = s.operations.get(update.id)
    const merged: Operation = existing
      ? { ...existing, ...update }
      : { name: '', type: 'install-modpack' as OperationType, status: 'running', startedAt: Date.now(), ...update } as Operation
    const next = new Map(s.operations)
    next.set(update.id, merged)
    if (merged.status === 'done') {
      setTimeout(() => useStore.getState().removeOperation(update.id), 3000)
    }
    return { operations: next }
  }),
  removeOperation: (id) => set((s) => {
    const next = new Map(s.operations)
    next.delete(id)
    return { operations: next }
  }),
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
    }),
  setOpenDetailInstanceId: (id) => set({ openDetailInstanceId: id }),
  setSidebarCompact: (compact) => {
    localStorage.setItem('ml-sidebar-compact', String(compact))
    set({ sidebarCompact: compact })
  },

  setFriends: (friends) => set({ friends }),
  addFriendLocal: (friend) => set((s) => ({
    friends: s.friends.find(f => f.uuid === friend.uuid) ? s.friends : [...s.friends, friend]
  })),
  removeFriendLocal: (uuid) => set((s) => ({ friends: s.friends.filter(f => f.uuid !== uuid) })),
}))

export const activeAccount = (state: AppState) =>
  state.accounts.find((a) => a.id === state.activeAccountId)
