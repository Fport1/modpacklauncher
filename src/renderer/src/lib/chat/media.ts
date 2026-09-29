// Enlaces temporales para los adjuntos del chat (igual que chatMedia.js de la
// web): en Firestore solo se guarda la ruta, y /api/chat-media entrega un
// enlace firmado que caduca en una hora tras comprobar que participas.

import { socialAuth } from '../firebase'
import type { Attachment } from './files'

const cache = new Map<string, { url: string; expiraEn: number }>()
const enVuelo = new Map<string, Promise<void>>()
const MARGEN_MS = 5 * 60 * 1000

const vigente = (e?: { expiraEn: number }): boolean => !!e && e.expiraEn - MARGEN_MS > Date.now()

async function pedir(cid: string, paths: string[]): Promise<void> {
  const user = socialAuth.currentUser
  if (!user) return
  try {
    const res = await window.api.social.webPost('/api/chat-media', await user.getIdToken(), { cid, paths })
    if (res.status !== 200) return
    const { urls, expiresAt } = res.data as { urls?: Record<string, string>; expiresAt?: number }
    for (const [ruta, url] of Object.entries(urls ?? {})) {
      cache.set(ruta, { url, expiraEn: expiresAt ?? Date.now() + 3_600_000 })
    }
  } catch { /* sin enlace: el adjunto se muestra como no disponible */ }
}

export async function resolverMedia(cid: string, paths: string[]): Promise<Record<string, string>> {
  const unicas = [...new Set(paths.filter(Boolean))]
  const faltantes = unicas.filter((p) => !vigente(cache.get(p)))
  const nuevas = faltantes.filter((p) => !enVuelo.has(p))
  if (nuevas.length) {
    const prom = pedir(cid, nuevas)
    nuevas.forEach((p) => enVuelo.set(p, prom))
    try { await prom } finally { nuevas.forEach((p) => enVuelo.delete(p)) }
  }
  await Promise.all(faltantes.map((p) => enVuelo.get(p)).filter(Boolean))
  const out: Record<string, string> = {}
  for (const p of unicas) {
    const e = cache.get(p)
    if (vigente(e)) out[p] = e!.url
  }
  return out
}

/** Rellena `url` en los adjuntos que solo traen `path`. */
export async function hidratarAdjuntos<T extends { attachments?: Attachment[] }>(cid: string, mensajes: T[]): Promise<T[]> {
  const rutas: string[] = []
  for (const m of mensajes) for (const a of m.attachments ?? []) if (a?.path && !a.url) rutas.push(a.path)
  if (!rutas.length) return mensajes
  const urls = await resolverMedia(cid, rutas)
  if (!Object.keys(urls).length) return mensajes
  return mensajes.map((m) =>
    m.attachments?.some((a) => a?.path && !a.url)
      ? { ...m, attachments: m.attachments.map((a) => (a?.path && !a.url && urls[a.path] ? { ...a, url: urls[a.path] } : a)) }
      : m
  )
}
