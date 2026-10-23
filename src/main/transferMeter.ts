// Velocidad y tiempo restante de una descarga a partir de muestras de «bytes hasta ahora».
// La velocidad es la media de los últimos segundos: una muestra suelta salta demasiado.

const WINDOW_MS = 5000

export class TransferMeter {
  private samples: { t: number; b: number }[] = []

  /** Apunta los bytes llevados hasta ahora y devuelve la velocidad en bytes/s. */
  sample(bytes: number, now = Date.now()): number {
    this.samples.push({ t: now, b: bytes })
    while (this.samples.length > 2 && now - this.samples[0].t > WINDOW_MS) this.samples.shift()
    const first = this.samples[0]
    const dt = (now - first.t) / 1000
    if (dt <= 0) return 0
    return Math.max(0, (bytes - first.b) / dt)
  }

  /** Segundos que faltan, o undefined si no se puede saber. */
  static eta(bytes: number, total: number, speed: number): number | undefined {
    if (!total || speed <= 0 || bytes >= total) return undefined
    return Math.round((total - bytes) / speed)
  }
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}
