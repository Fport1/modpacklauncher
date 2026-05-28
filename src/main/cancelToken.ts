export class CancelError extends Error {
  constructor() {
    super('Operation cancelled by user')
    this.name = 'CancelError'
  }
}

let _cancelled = false
let _abortController = new AbortController()

export function getAbortSignal(): AbortSignal {
  return _abortController.signal
}

export function requestCancel(): void {
  _cancelled = true
  _abortController.abort()
}

export function resetCancel(): void {
  _cancelled = false
  _abortController = new AbortController()
}

export function checkCancel(): void {
  if (_cancelled) {
    _cancelled = false
    throw new CancelError()
  }
}
