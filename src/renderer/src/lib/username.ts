import { doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { socialDb } from './firebase'

export const USERNAME_MIN = 3
export const USERNAME_MAX = 15
export const DISPLAY_NAME_MAX = 50

export function normalizeHandle(input: string): string {
  if (!input) return ''
  let s = String(input).trim().toLowerCase()
  if (s.startsWith('@')) s = s.slice(1)
  s = s.replace(/[^a-z0-9_-]/g, '')
  return s
}

export function validateHandle(input: string): { ok: boolean; slug: string; msg: string } {
  const slug = normalizeHandle(input)
  if (slug.length < USERNAME_MIN) return { ok: false, slug, msg: `Mínimo ${USERNAME_MIN} caracteres.` }
  if (slug.length > USERNAME_MAX) return { ok: false, slug, msg: `Máximo ${USERNAME_MAX} caracteres.` }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) return { ok: false, slug, msg: "Solo minúsculas, números, '-' y '_'." }
  return { ok: true, slug, msg: '' }
}

export async function reserveUsernameAndUpsertProfile({ uid, email, profileName, handleInput, minecraftUsername = null, minecraftUUID = null }: {
  uid: string
  email: string
  profileName: string
  handleInput: string
  minecraftUsername?: string | null
  minecraftUUID?: string | null
}): Promise<string> {
  const { ok, slug, msg } = validateHandle(handleInput)
  if (!ok) throw new Error(msg)

  const unameRef = doc(socialDb, 'usernames', slug)
  const userRef  = doc(socialDb, 'users', uid)

  await runTransaction(socialDb, async (tx) => {
    const unameSnap = await tx.get(unameRef)
    if (unameSnap.exists()) throw new Error('Ese usuario ya está en uso.')

    const now = serverTimestamp()
    const base: Record<string, unknown> = {
      uid,
      email: email || null,
      username: `@${slug}`,
      usernameSlug: slug,
      profileName: String(profileName || '').slice(0, DISPLAY_NAME_MAX),
      minecraftUsername: minecraftUsername || null,
      minecraftUUID: minecraftUUID || null,
      updatedAt: now,
    }

    const current = await tx.get(userRef)
    if (!current.exists()) base.createdAt = now

    tx.set(unameRef, { uid, createdAt: now })
    tx.set(userRef, base, { merge: true })
  })

  return `@${slug}`
}
