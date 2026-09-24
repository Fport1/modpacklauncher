import path from 'path'

/**
 * Resolves `rel` inside `root` and returns null if the result escapes `root`
 * (protects against zip-slip and path traversal like `../` or absolute paths).
 */
export function trySafeJoin(root: string, rel: string): string | null {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, rel)
  const relative = path.relative(resolvedRoot, resolved)
  if (relative === '') return resolvedRoot
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return resolved
}

/** Like trySafeJoin but throws on unsafe paths. */
export function safeJoin(root: string, rel: string): string {
  const resolved = trySafeJoin(root, rel)
  if (resolved === null) throw new Error(`Ruta no permitida: ${rel}`)
  return resolved
}
