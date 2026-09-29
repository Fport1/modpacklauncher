// Búsqueda de GIFs en Giphy, con la misma clave pública que usa la web
// (NEXT_PUBLIC_GIPHY_KEY: es una clave de cliente, pensada para ir en el
// navegador).

const GIPHY_KEY = 'ZTXD2qZDkEnxhIy50PnXgAvL9GFrnY7M'
export const GIF_PAGE = 24
const MAX_OFFSET = 4999

export interface GifItem { url: string; w: number; h: number; full: string }

interface GiphyImage { url?: string; width?: string; height?: string }
interface GiphyItem { images?: Record<string, GiphyImage> }

function pick(item: GiphyItem): GifItem | null {
  const im = item?.images ?? {}
  const c = im.fixed_height_small ?? im.fixed_height ?? im.downsized ?? im.original
  const full = im.downsized_medium ?? im.downsized ?? im.original ?? c
  if (!c?.url) return null
  return { url: c.url, w: Number(c.width) || 0, h: Number(c.height) || 0, full: full?.url ?? c.url }
}

export async function giphyFetch({ q = '', pos = '' }: { q?: string; pos?: string } = {}): Promise<{ data: GifItem[]; next: string }> {
  const url = new URL(q ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending')
  const offset = Number(pos) || 0
  url.searchParams.set('api_key', GIPHY_KEY)
  if (q) url.searchParams.set('q', q)
  url.searchParams.set('limit', String(GIF_PAGE))
  url.searchParams.set('rating', 'g')
  url.searchParams.set('lang', 'es')
  if (offset) url.searchParams.set('offset', String(offset))
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Giphy ${res.status}`)
  const json = await res.json() as { data?: GiphyItem[]; pagination?: { count?: number; total_count?: number } }
  const data = (json.data ?? []).map(pick).filter((x): x is GifItem => !!x)
  const next = offset + (json.pagination?.count ?? data.length)
  const total = json.pagination?.total_count ?? 0
  return { data, next: data.length > 0 && next < Math.min(total || Infinity, MAX_OFFSET) ? String(next) : '' }
}
