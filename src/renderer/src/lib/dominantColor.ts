// Color principal de una imagen, para teñir fondos con el color del icono.
//
// Se recorren todos los píxeles (con la imagen como mucho a 256 px de lado),
// se agrupan por color parecido y gana el grupo con más peso. Los píxeles
// transparentes no cuentan y los grises pesan poco: si no, casi cualquier
// icono con fondo oscuro saldría gris.

const cache = new Map<string, string | null>()

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

/** El color ya calculado de una imagen (undefined si aún no se ha calculado). */
export function cachedDominantColor(src: string): string | null | undefined {
  return cache.get(src)
}

export function dominantColor(src: string): Promise<string | null> {
  if (cache.has(src)) return Promise.resolve(cache.get(src)!)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const scale = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, 0, 0, w, h)
        const px = ctx.getImageData(0, 0, w, h).data
        const buckets = new Map<number, { weight: number; r: number; g: number; b: number; n: number }>()
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3]
          if (a < 128) continue
          const r = px[i], g = px[i + 1], b = px[i + 2]
          const [, s, l] = toHsl(r, g, b)
          // Saturados y de luz media pesan más; negros, blancos y grises casi nada
          const weight = 0.08 + s * s * (1 - Math.abs(l - 0.5) * 1.6)
          if (weight <= 0) continue
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
          const bk = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0, n: 0 }
          bk.weight += weight; bk.r += r; bk.g += g; bk.b += b; bk.n++
          buckets.set(key, bk)
        }
        let best: { weight: number; r: number; g: number; b: number; n: number } | null = null
        for (const bk of buckets.values()) if (!best || bk.weight > best.weight) best = bk
        const out = best ? `rgb(${Math.round(best.r / best.n)}, ${Math.round(best.g / best.n)}, ${Math.round(best.b / best.n)})` : null
        cache.set(src, out)
        resolve(out)
      } catch {
        cache.set(src, null)
        resolve(null)
      }
    }
    img.onerror = () => { cache.set(src, null); resolve(null) }
    img.src = src
  })
}
