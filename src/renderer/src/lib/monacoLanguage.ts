/**
 * Lenguaje de Monaco para resaltar un archivo según su extensión.
 *
 * Compartido entre el editor de config de las instancias y el de archivos de
 * servidores, para que los dos resalten igual lo mismo.
 */
export function getMonacoLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['json', 'json5', 'mcmeta'].includes(ext)) return 'json'
  if (['yaml', 'yml'].includes(ext)) return 'yaml'
  if (ext === 'toml') return 'toml'
  if (['ini', 'cfg', 'conf', 'properties'].includes(ext)) return 'ini'
  if (ext === 'xml') return 'xml'
  if (ext === 'lua') return 'lua'
  return 'plaintext'
}

/** Extensiones que tiene sentido abrir en el editor de texto. */
const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'json', 'json5', 'mcmeta', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
  'properties', 'xml', 'lua', 'md', 'csv', 'sh', 'bat', 'cmd', 'js', 'ts', 'zs', 'mcfunction', 'snbt', 'lang'
])

export function isTextFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  // Sin extensión (eula, LICENSE…) también suele ser texto
  return !filename.includes('.') || TEXT_EXTENSIONS.has(ext)
}
