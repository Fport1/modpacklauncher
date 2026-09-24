import { AsyncLocalStorage } from 'async_hooks'

export class CancelError extends Error {
  constructor() {
    super('Operation cancelled by user')
    this.name = 'CancelError'
  }
}

interface CancelScope {
  cancelled: boolean
  controller: AbortController
}

// Each cancellable operation runs inside its own scope, propagated implicitly
// through the async call chain. Starting a new operation no longer resets or
// resurrects the cancellation state of operations already in flight.
const als = new AsyncLocalStorage<CancelScope>()
const activeScopes = new Set<CancelScope>()

export async function runCancellable<T>(fn: () => Promise<T>): Promise<T> {
  const scope: CancelScope = { cancelled: false, controller: new AbortController() }
  activeScopes.add(scope)
  try {
    return await als.run(scope, fn)
  } finally {
    activeScopes.delete(scope)
  }
}

export function getAbortSignal(): AbortSignal | undefined {
  return als.getStore()?.controller.signal
}

// The UI exposes a single cancel button, so cancelling stops every running operation.
export function requestCancel(): void {
  for (const scope of activeScopes) {
    scope.cancelled = true
    scope.controller.abort()
  }
}

export function checkCancel(): void {
  if (als.getStore()?.cancelled) throw new CancelError()
}
