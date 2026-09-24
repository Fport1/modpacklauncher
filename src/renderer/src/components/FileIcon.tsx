// Icono por tipo de archivo, para distinguir de un vistazo qué hay en una
// carpeta de servidor o de instancia: mods, mundos, configuración, registros…

type Kind =
  | 'folder' | 'jar' | 'archive' | 'config' | 'json' | 'text' | 'log'
  | 'image' | 'world' | 'script' | 'audio' | 'file'

const BY_EXT: Record<string, Kind> = {
  jar: 'jar',
  zip: 'archive', gz: 'archive', tgz: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', mrpack: 'archive', fpack: 'archive',
  properties: 'config', toml: 'config', yml: 'config', yaml: 'config', cfg: 'config', conf: 'config', ini: 'config',
  json: 'json', json5: 'json', mcmeta: 'json',
  txt: 'text', md: 'text', lang: 'text', snbt: 'text', mcfunction: 'text', csv: 'text',
  log: 'log',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  mca: 'world', mcr: 'world', dat: 'world', dat_old: 'world', nbt: 'world', schem: 'world', schematic: 'world', litematic: 'world',
  sh: 'script', bat: 'script', cmd: 'script', ps1: 'script', js: 'script', zs: 'script', lua: 'script',
  ogg: 'audio', mp3: 'audio', wav: 'audio'
}

export function fileKind(name: string, isDir: boolean): Kind {
  if (isDir) return 'folder'
  const lower = name.toLowerCase()
  if (lower.endsWith('.log.gz')) return 'log'
  const ext = lower.includes('.') ? lower.split('.').pop()! : ''
  return BY_EXT[ext] ?? (ext ? 'file' : 'text')
}

const COLOR: Record<Kind, string> = {
  folder: '#f5b83d',
  jar: '#e76f51',
  archive: '#b388eb',
  config: '#4fc3f7',
  json: '#fbc02d',
  text: '#cfd8dc',
  log: '#90a4ae',
  image: '#66bb6a',
  world: '#26a69a',
  script: '#ff8a65',
  audio: '#f06292',
  file: '#9e9e9e'
}

export default function FileIcon({ name, isDir, size = 18 }: { name: string; isDir: boolean; size?: number }) {
  const kind = fileKind(name, isDir)
  const c = COLOR[kind]

  if (kind === 'folder') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
        <path d="M2 6.5A2.5 2.5 0 014.5 4h4.3l2 2.2h8.7A2.5 2.5 0 0122 8.7v8.8a2.5 2.5 0 01-2.5 2.5h-15A2.5 2.5 0 012 17.5z" fill={c} />
        <path d="M2 9.5h20v8a2.5 2.5 0 01-2.5 2.5h-15A2.5 2.5 0 012 17.5z" fill="#ffd166" opacity="0.55" />
      </svg>
    )
  }

  // Hoja con la esquina doblada y una marca de color según el tipo
  const badge: Record<Exclude<Kind, 'folder'>, string> = {
    jar: 'JAR', archive: 'ZIP', config: 'CFG', json: '{ }', text: 'TXT', log: 'LOG',
    image: 'IMG', world: 'MAP', script: '>_', audio: '♪', file: ''
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
      <path d="M6 2h8l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" fill="#2a2f3a" stroke={c} strokeWidth="1.3" />
      <path d="M14 2v5h5" fill="none" stroke={c} strokeWidth="1.3" />
      {badge[kind as Exclude<Kind, 'folder'>] && (
        <text x="11.5" y="17.2" textAnchor="middle" fontSize={badge[kind as Exclude<Kind, 'folder'>].length > 2 ? 5.4 : 6.5}
          fontWeight="700" fill={c} fontFamily="system-ui, sans-serif">
          {badge[kind as Exclude<Kind, 'folder'>]}
        </text>
      )}
    </svg>
  )
}
