const stack: Array<() => void> = []

export const nav = {
  push(backFn: () => void): void {
    stack.push(backFn)
  },
  pop(): void {
    stack.pop()?.()
  },
  size(): number {
    return stack.length
  },
  clearFrom(index: number): void {
    stack.length = index
  }
}
