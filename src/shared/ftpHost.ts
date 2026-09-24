import type { FtpProtocol } from './types'

export interface ParsedHost {
  protocol?: FtpProtocol
  host: string
  port?: number
  user?: string
  /** Carpeta que venía detrás del servidor, si la había. */
  path?: string
}

/**
 * Separa una dirección pegada tal cual la da un hosting.
 *
 * Los paneles (Pterodactyl, el de holy.gg y la mayoría) muestran la dirección
 * SFTP como `sftp://usuario@servidor:2022/carpeta`, y es lo que la gente copia
 * en el campo de servidor. Buscar eso en el DNS falla con ENOTFOUND; hay que
 * quedarse con el nombre del servidor y repartir el resto en sus campos.
 */
export function parseHostInput(raw: string): ParsedHost {
  let rest = raw.trim()
  let protocol: FtpProtocol | undefined

  const scheme = /^([a-z]+):\/\//i.exec(rest)
  if (scheme) {
    const s = scheme[1].toLowerCase()
    protocol = s === 'sftp' || s === 'ssh' ? 'sftp'
      : s === 'ftps' || s === 'ftpes' ? 'ftps'
        : s === 'ftp' ? 'ftp'
          : undefined
    rest = rest.slice(scheme[0].length)
  }

  let path: string | undefined
  const slash = rest.indexOf('/')
  if (slash >= 0) {
    path = rest.slice(slash)
    rest = rest.slice(0, slash)
  }

  let user: string | undefined
  const at = rest.lastIndexOf('@')
  if (at >= 0) {
    user = decodeURIComponent(rest.slice(0, at))
    rest = rest.slice(at + 1)
  }

  let port: number | undefined
  const withPort = /^([^:]+):(\d+)$/.exec(rest)
  if (withPort) {
    rest = withPort[1]
    port = Number(withPort[2])
  }

  return { protocol, host: rest, port, user, path: path && path !== '/' ? path : undefined }
}
