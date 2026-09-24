// Mensajes JSON sobre un RTCDataChannel, con archivos binarios dentro.
//
// Un canal de datos no acepta mensajes enormes (Chromium corta hacia los
// 256 KB), así que lo grande se parte en trozos y se vuelve a juntar al otro
// lado. Los Uint8Array viajan en base64 dentro del JSON.

const CHUNK = 60_000
const HIGH_WATER = 4 * 1024 * 1024

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function encode(msg: unknown): string {
  return JSON.stringify(msg, (_k, v) => (v instanceof Uint8Array ? { __b64: toBase64(v) } : v))
}

export function decode(text: string): unknown {
  return JSON.parse(text, (_k, v) => (v && typeof v === 'object' && typeof v.__b64 === 'string' ? fromBase64(v.__b64) : v))
}

export class AssistChannel {
  private parts = new Map<string, string[]>()
  private listeners: Array<(msg: unknown) => void> = []
  private seq = 0

  constructor(private dc: RTCDataChannel) {
    dc.bufferedAmountLowThreshold = 1024 * 1024
    dc.onmessage = (e) => this.receive(String(e.data))
  }

  onMessage(cb: (msg: unknown) => void): void {
    this.listeners.push(cb)
  }

  private receive(frame: string): void {
    if (frame[0] === 'M') {
      this.emit(frame.slice(1))
      return
    }
    // P<id>|<índice>|<total>|<trozo>
    const [id, i, n] = frame.slice(1).split('|', 3)
    const body = frame.slice(1 + id.length + i.length + n.length + 3)
    const list = this.parts.get(id) ?? new Array<string>(Number(n))
    list[Number(i)] = body
    this.parts.set(id, list)
    if (list.filter((x) => x !== undefined).length === Number(n)) {
      this.parts.delete(id)
      this.emit(list.join(''))
    }
  }

  private emit(text: string): void {
    let msg: unknown
    try { msg = decode(text) } catch { return }
    for (const l of this.listeners) l(msg)
  }

  /** Espera a que se vacíe el búfer si va muy lleno, para no ahogar la conexión. */
  private async drain(): Promise<void> {
    if (this.dc.bufferedAmount < HIGH_WATER) return
    await new Promise<void>((resolve) => {
      const done = (): void => { this.dc.removeEventListener('bufferedamountlow', done); resolve() }
      this.dc.addEventListener('bufferedamountlow', done)
    })
  }

  async send(msg: unknown): Promise<void> {
    if (this.dc.readyState !== 'open') throw new Error('connection closed')
    const text = encode(msg)
    if (text.length <= CHUNK) {
      await this.drain()
      this.dc.send('M' + text)
      return
    }
    const id = `${Date.now().toString(36)}${(this.seq++).toString(36)}`
    const n = Math.ceil(text.length / CHUNK)
    for (let i = 0; i < n; i++) {
      await this.drain()
      if (this.dc.readyState !== 'open') throw new Error('connection closed')
      this.dc.send(`P${id}|${i}|${n}|${text.slice(i * CHUNK, (i + 1) * CHUNK)}`)
    }
  }
}

/** STUN públicos para que los dos equipos se encuentren a través de sus routers. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' }
]

/**
 * Espera a tener todas las rutas posibles antes de mandar la oferta o la
 * respuesta: así basta con un solo intercambio por Firebase, sin ir y venir.
 */
export function waitIceGathering(pc: RTCPeerConnection, timeoutMs = 5000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve() }
    const check = (): void => { if (pc.iceGatheringState === 'complete') done() }
    const timer = setTimeout(done, timeoutMs)
    pc.addEventListener('icegatheringstatechange', check)
  })
}

/** Código fácil de dictar: sin 0/O ni 1/I/L. */
export function makeCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

export const normalizeCode = (raw: string): string => {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean
}
