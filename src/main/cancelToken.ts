export class CancelError extends Error {
  constructor() {
    super('Operation cancelled by user')
    this.name = 'CancelError'
  }
}

let _cancelled = false

export function requestCancel(): void {
  _cancelled = true
}

export function resetCancel(): void {
  _cancelled = false
}

export function checkCancel(): void {
  if (_cancelled) {
    _cancelled = false
    throw new CancelError()
  }
}
