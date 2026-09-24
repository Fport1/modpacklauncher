// server.properties: leerlo, cambiar valores sin tocar el resto del archivo
// (comentarios, orden, líneas que no conocemos) y describir cada opción en
// cristiano para el modo sencillo.

// ── Formato .properties de Java ─────────────────────────────────────────────

function unescape(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) => {
    if (c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16))
    return c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c
  })
}

/** Como lo escribe el propio servidor: lo que no es ASCII (el § del MOTD) como \uXXXX. */
function escapeValue(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (code > 0x7e || code < 0x20) out += '\\u' + code.toString(16).toUpperCase().padStart(4, '0')
    else out += ch
  }
  return out
}

export function parseProperties(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimStart()
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    const m = /^((?:\\.|[^=:\s\\])+)\s*[=:]?\s*(.*)$/.exec(line)
    if (m) map.set(unescape(m[1]), unescape(m[2]))
  }
  return map
}

/** Cambia (o añade al final) una clave sin tocar el resto de líneas. */
export function setProperty(text: string, key: string, value: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const line = `${key}=${escapeValue(value)}`
  const i = lines.findIndex((l) => {
    const t = l.trimStart()
    if (!t || t.startsWith('#') || t.startsWith('!')) return false
    const m = /^((?:\\.|[^=:\s\\])+)/.exec(t)
    return !!m && unescape(m[1]) === key
  })
  if (i >= 0) lines[i] = line
  else {
    // Antes de la línea vacía final, si la hay
    if (lines.length && lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, line)
    else lines.push(line)
  }
  return lines.join(eol)
}

// ── Qué es cada opción ──────────────────────────────────────────────────────

export type PropType = 'bool' | 'int' | 'text' | 'enum' | 'motd' | 'password'

export interface PropMeta {
  key: string
  label: string
  desc: string
  type: PropType
  section: string
  options?: [string, string][]
  min?: number
  max?: number
}

export const SECTIONS = ['General', 'Juego', 'Mundo', 'Jugadores y permisos', 'Red y seguridad', 'Rendimiento', 'Otras opciones']

const P = (key: string, label: string, section: string, type: PropType, desc: string, extra: Partial<PropMeta> = {}): PropMeta =>
  ({ key, label, section, type, desc, ...extra })

export const PROPERTIES: PropMeta[] = [
  P('motd', 'Mensaje del servidor (MOTD)', 'General', 'motd', 'Lo que se ve debajo del nombre en la lista de servidores. Dos líneas como mucho.'),
  P('max-players', 'Jugadores máximos', 'General', 'int', 'Cuántos pueden estar conectados a la vez.', { min: 0, max: 100000 }),
  P('white-list', 'Lista blanca', 'General', 'bool', 'Solo pueden entrar los jugadores de whitelist.json.'),
  P('enforce-whitelist', 'Echar a los que no estén en la lista', 'General', 'bool', 'Al activar la lista blanca, expulsa a los conectados que no estén en ella.'),
  P('online-mode', 'Modo online (cuentas oficiales)', 'General', 'bool', 'Comprueba que cada jugador tenga una cuenta de Minecraft de pago. Desactivarlo permite cuentas no oficiales y cualquiera puede entrar con cualquier nombre.'),
  P('server-port', 'Puerto', 'General', 'int', 'En hostings suele venir fijado por el panel: no lo cambies si no sabes cuál te dieron.', { min: 1, max: 65535 }),

  P('gamemode', 'Modo de juego', 'Juego', 'enum', 'Con el que entran los jugadores nuevos.', { options: [['survival', 'Supervivencia'], ['creative', 'Creativo'], ['adventure', 'Aventura'], ['spectator', 'Espectador']] }),
  P('force-gamemode', 'Forzar el modo de juego', 'Juego', 'bool', 'Pone el modo de arriba a todos cada vez que entran, no solo la primera.'),
  P('difficulty', 'Dificultad', 'Juego', 'enum', '', { options: [['peaceful', 'Pacífico'], ['easy', 'Fácil'], ['normal', 'Normal'], ['hard', 'Difícil']] }),
  P('hardcore', 'Extremo (hardcore)', 'Juego', 'bool', 'Al morir, el jugador pasa a espectador para siempre.'),
  P('pvp', 'PvP', 'Juego', 'bool', 'Los jugadores se pueden hacer daño entre ellos.'),
  P('allow-flight', 'Permitir volar', 'Juego', 'bool', 'Actívalo si usáis mods o plugins que dejan volar; si no, el servidor los echa pensando que hacen trampas.'),
  P('spawn-protection', 'Protección del spawn', 'Juego', 'int', 'Radio en bloques alrededor del spawn donde solo los OP pueden construir. 0 = sin protección.', { min: 0, max: 1000 }),
  P('player-idle-timeout', 'Echar por inactividad', 'Juego', 'int', 'Minutos sin moverse antes de echar al jugador. 0 = nunca.', { min: 0, max: 10000 }),
  P('spawn-monsters', 'Aparecen monstruos', 'Juego', 'bool', ''),
  P('spawn-animals', 'Aparecen animales', 'Juego', 'bool', ''),
  P('spawn-npcs', 'Aparecen aldeanos', 'Juego', 'bool', ''),
  P('allow-nether', 'Permitir el Nether', 'Juego', 'bool', ''),

  P('level-name', 'Carpeta del mundo', 'Mundo', 'text', 'El nombre de la carpeta del mundo que se carga. Cambiarlo carga (o crea) otro mundo.'),
  P('level-seed', 'Semilla', 'Mundo', 'text', 'Solo cuenta al crear un mundo nuevo.'),
  P('level-type', 'Tipo de mundo', 'Mundo', 'enum', 'Solo cuenta al crear un mundo nuevo.', { options: [['minecraft:normal', 'Normal'], ['minecraft:flat', 'Plano'], ['minecraft:large_biomes', 'Biomas grandes'], ['minecraft:amplified', 'Amplificado'], ['minecraft:single_biome_surface', 'Un solo bioma']] }),
  P('generate-structures', 'Generar estructuras', 'Mundo', 'bool', 'Aldeas, templos, etc. en el terreno nuevo.'),
  P('max-world-size', 'Tamaño máximo del mundo', 'Mundo', 'int', 'Radio del borde del mundo en bloques.', { min: 1, max: 29999984 }),
  P('view-distance', 'Distancia de visión', 'Mundo', 'int', 'Chunks que se envían a cada jugador. Más = más bonito y más carga para el servidor.', { min: 3, max: 32 }),
  P('simulation-distance', 'Distancia de simulación', 'Mundo', 'int', 'Chunks alrededor de cada jugador donde las cosas se mueven y crecen.', { min: 3, max: 32 }),

  P('op-permission-level', 'Poder de los OP', 'Jugadores y permisos', 'enum', '', { options: [['1', '1 · Saltarse la protección del spawn'], ['2', '2 · Comandos de trucos y bloques de comandos'], ['3', '3 · Comandos de moderación (ban, kick…)'], ['4', '4 · Todo, incluido /stop']] }),
  P('function-permission-level', 'Permiso de las funciones', 'Jugadores y permisos', 'enum', 'Qué pueden hacer las funciones de los datapacks.', { options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']] }),
  P('enable-command-block', 'Bloques de comandos', 'Jugadores y permisos', 'bool', ''),
  P('hide-online-players', 'Ocultar quién está conectado', 'Jugadores y permisos', 'bool', 'La lista de servidores no enseña los nombres.'),
  P('broadcast-console-to-ops', 'Enseñar la consola a los OP', 'Jugadores y permisos', 'bool', ''),

  P('enforce-secure-profile', 'Exigir chat firmado', 'Red y seguridad', 'bool', 'Si da problemas con el chat de algunos jugadores o launchers, desactívalo.'),
  P('prevent-proxy-connections', 'Bloquear conexiones por proxy/VPN', 'Red y seguridad', 'bool', ''),
  P('enable-status', 'Aparecer como en línea', 'Red y seguridad', 'bool', 'Desactivado, el servidor aparece como apagado en la lista (pero se puede entrar).'),
  P('resource-pack', 'Paquete de recursos (URL)', 'Red y seguridad', 'text', 'Enlace directo a un .zip que se ofrece a los jugadores al entrar.'),
  P('resource-pack-sha1', 'SHA-1 del paquete', 'Red y seguridad', 'text', ''),
  P('require-resource-pack', 'Paquete obligatorio', 'Red y seguridad', 'bool', 'Quien lo rechace no puede entrar.'),
  P('resource-pack-prompt', 'Mensaje al ofrecer el paquete', 'Red y seguridad', 'text', ''),
  P('enable-rcon', 'RCON (consola remota)', 'Red y seguridad', 'bool', ''),
  P('rcon.port', 'Puerto de RCON', 'Red y seguridad', 'int', '', { min: 1, max: 65535 }),
  P('rcon.password', 'Contraseña de RCON', 'Red y seguridad', 'password', ''),
  P('enable-query', 'Query', 'Red y seguridad', 'bool', 'Protocolo para que webs y bots consulten el estado del servidor.'),
  P('query.port', 'Puerto de query', 'Red y seguridad', 'int', '', { min: 1, max: 65535 }),
  P('server-ip', 'IP del servidor', 'Red y seguridad', 'text', 'Déjalo vacío salvo que tu hosting diga lo contrario.'),

  P('network-compression-threshold', 'Compresión de red', 'Rendimiento', 'int', 'Tamaño en bytes a partir del que se comprimen los paquetes. -1 = sin comprimir.', { min: -1, max: 1000000 }),
  P('max-tick-time', 'Tiempo máximo por tick', 'Rendimiento', 'int', 'Milisegundos antes de que el servidor se reinicie por colgado. -1 = nunca (útil con muchos mods).', { min: -1 }),
  P('sync-chunk-writes', 'Guardado de chunks seguro', 'Rendimiento', 'bool', 'Más seguro ante apagones, algo más lento.'),
  P('entity-broadcast-range-percentage', 'Distancia de las entidades', 'Rendimiento', 'int', 'Porcentaje de la distancia a la que se ven las entidades.', { min: 10, max: 1000 }),
  P('pause-when-empty-seconds', 'Pausar sin jugadores', 'Rendimiento', 'int', 'Segundos sin nadie antes de pausar el servidor. 0 = nunca.', { min: 0 }),
  P('region-file-compression', 'Compresión del mundo', 'Rendimiento', 'enum', 'Cómo se comprimen los archivos del mundo al guardar.', { options: [['deflate', 'Normal (deflate)'], ['lz4', 'Rápida, ocupa más (lz4)'], ['none', 'Sin comprimir']] }),
  P('max-chained-neighbor-updates', 'Actualizaciones de bloques en cadena', 'Rendimiento', 'int', 'Límite de reacciones en cadena (redstone, arena que cae…) para que una máquina no cuelgue el servidor. -1 = sin límite.', { min: -1 }),
  P('use-native-transport', 'Red optimizada de Linux', 'Rendimiento', 'bool', 'Mejora el rendimiento de red en servidores Linux. Déjalo activado.'),
  P('enable-jmx-monitoring', 'Monitorización JMX', 'Rendimiento', 'bool', 'Expone datos de rendimiento para herramientas de Java. Solo para quien sabe usarlas.'),
  P('debug', 'Modo depuración', 'Rendimiento', 'bool', 'Más información en los registros. Normalmente desactivado.'),
  P('max-build-height', 'Altura máxima de construcción', 'Mundo', 'int', 'Solo en versiones antiguas (1.16 y anteriores).', { min: 1, max: 256 }),
  P('generator-settings', 'Ajustes del generador', 'Mundo', 'text', 'JSON con los ajustes del mundo plano o del bioma único. Solo cuenta al crear el mundo.'),
  P('initial-enabled-packs', 'Datapacks activados al crear', 'Mundo', 'text', 'Separados por comas. Solo al crear un mundo nuevo (p. ej. vanilla,update_1_21).'),
  P('initial-disabled-packs', 'Datapacks desactivados al crear', 'Mundo', 'text', 'Separados por comas. Solo al crear un mundo nuevo.'),
  P('announce-player-achievements', 'Anunciar logros', 'Jugadores y permisos', 'bool', 'Solo en versiones antiguas: en las nuevas es la regla announceAdvancements.'),
  P('broadcast-rcon-to-ops', 'Enseñar a los OP los comandos por RCON', 'Jugadores y permisos', 'bool', ''),
  P('accepts-transfers', 'Aceptar jugadores transferidos', 'Red y seguridad', 'bool', 'Deja entrar a jugadores que otro servidor manda aquí con /transfer (1.20.5+).'),
  P('log-ips', 'Guardar IPs en el registro', 'Red y seguridad', 'bool', 'Si se apuntan las IPs de quien entra.'),
  P('rate-limit', 'Límite de paquetes', 'Red y seguridad', 'int', 'Paquetes por segundo antes de echar a un jugador. 0 = sin límite.', { min: 0 }),
  P('bug-report-link', 'Enlace para reportar fallos', 'Red y seguridad', 'text', 'Sale en la pantalla de desconexión y en el menú de pausa (1.21+).'),
  P('resource-pack-id', 'ID del paquete de recursos', 'Red y seguridad', 'text', 'UUID del paquete, para que el juego sepa si ya lo tiene.'),
  P('text-filtering-config', 'Filtro de chat', 'Red y seguridad', 'text', 'Configuración de un servicio de filtrado de texto. Normalmente vacío.'),
  P('text-filtering-version', 'Versión del filtro de chat', 'Red y seguridad', 'int', '', { min: 0 }),
  P('previews-chat', 'Vista previa del chat', 'Red y seguridad', 'bool', 'Solo en la 1.19–1.19.2.'),
  P('snooper-enabled', 'Enviar estadísticas a Mojang', 'Red y seguridad', 'bool', 'Solo en versiones antiguas.'),
  P('management-server-enabled', 'Servidor de administración', 'Red y seguridad', 'bool', 'Protocolo para administrar el servidor desde otras herramientas (1.21.9+).'),
  P('management-server-host', 'Dirección de administración', 'Red y seguridad', 'text', ''),
  P('management-server-port', 'Puerto de administración', 'Red y seguridad', 'int', '0 = puerto automático.', { min: 0, max: 65535 }),
  P('management-server-secret', 'Clave de administración', 'Red y seguridad', 'password', 'Quien la tenga puede administrar el servidor: no la compartas.'),
  P('management-server-tls-enabled', 'Cifrar la administración (TLS)', 'Red y seguridad', 'bool', ''),
  P('management-server-tls-keystore', 'Almacén de certificados', 'Red y seguridad', 'text', ''),
  P('management-server-tls-keystore-password', 'Contraseña del almacén', 'Red y seguridad', 'password', ''),
  P('status-heartbeat-interval', 'Latido de estado', 'Red y seguridad', 'int', 'Segundos entre avisos de estado a las herramientas de administración. 0 = desactivado.', { min: 0 })
]

export const PROPERTY_BY_KEY = new Map(PROPERTIES.map((p) => [p.key, p]))

/**
 * Valor por defecto de cada opción en un servidor recién creado (1.21), para
 * las que no están en el archivo: al cambiarlas se añaden al final.
 */
export const DEFAULTS: Record<string, string> = {
  'accepts-transfers': 'false', 'allow-flight': 'false', 'allow-nether': 'true', 'broadcast-console-to-ops': 'true',
  'broadcast-rcon-to-ops': 'true', 'difficulty': 'easy', 'enable-command-block': 'false', 'enable-jmx-monitoring': 'false',
  'enable-query': 'false', 'enable-rcon': 'false', 'enable-status': 'true', 'enforce-secure-profile': 'true',
  'enforce-whitelist': 'false', 'entity-broadcast-range-percentage': '100', 'force-gamemode': 'false',
  'function-permission-level': '2', 'gamemode': 'survival', 'generate-structures': 'true', 'hardcore': 'false',
  'hide-online-players': 'false', 'level-name': 'world', 'level-type': 'minecraft:normal', 'log-ips': 'true',
  'max-chained-neighbor-updates': '1000000', 'max-players': '20', 'max-tick-time': '60000', 'max-world-size': '29999984',
  'motd': 'A Minecraft Server', 'network-compression-threshold': '256', 'online-mode': 'true', 'op-permission-level': '4',
  'pause-when-empty-seconds': '60', 'player-idle-timeout': '0', 'prevent-proxy-connections': 'false', 'pvp': 'true',
  'query.port': '25565', 'rate-limit': '0', 'rcon.port': '25575', 'region-file-compression': 'deflate',
  'require-resource-pack': 'false', 'server-port': '25565', 'simulation-distance': '10', 'spawn-monsters': 'true',
  'spawn-protection': '16', 'sync-chunk-writes': 'true', 'use-native-transport': 'true', 'view-distance': '10',
  'white-list': 'false'
}
