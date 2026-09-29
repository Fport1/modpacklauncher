// Fuente «Fport1» de Explorar: creaciones publicadas por @fport1 para que
// cualquiera las instale desde el launcher, al estilo de Modrinth.
//
// Firestore:
//   fport1_projects/{projectId}                 ficha del proyecto
//   fport1_projects/{projectId}/versions/{vid}  cada versión (release/beta/alpha)
// Storage:
//   fport1/projects/{projectId}/...             icono, galería y archivos
//
// Lectura pública solo de lo publicado; escribir solo @fport1 (reglas en
// fport1web).

import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, increment, orderBy, query, serverTimestamp,
  setDoc, updateDoc, where, type Timestamp
} from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref as sRef, uploadBytesResumable } from 'firebase/storage'
import { socialDb, socialStorage } from './firebase'

export type Fport1Type = 'modpack' | 'mod' | 'resourcepack' | 'datapack' | 'shader' | 'plugin'
export type Channel = 'release' | 'beta' | 'alpha'

export interface Fport1File { url: string; path: string; filename: string; size: number; sha1: string; primary: boolean }

export interface Fport1Project {
  id: string
  title: string
  slug: string
  summary: string
  description: string
  type: Fport1Type
  iconUrl: string | null
  gallery: { url: string; path: string; title?: string }[]
  categories: string[]
  loaders: string[]
  gameVersions: string[]
  clientSide: 'required' | 'optional' | 'unsupported'
  serverSide: 'required' | 'optional' | 'unsupported'
  downloads: number
  published: boolean
  featured?: boolean
  latestVersion?: { id: string; versionNumber: string; channel: Channel } | null
  createdAt?: Timestamp | null
  updatedAt?: Timestamp | null
}

/** Dependencia de una versión: un proyecto de Modrinth, CurseForge o de Fport1. */
export interface Fport1Dependency { source: 'modrinth' | 'curseforge' | 'fport1'; projectId: string; type: 'required' | 'optional' }

/** "sodium" → Modrinth, "cf:238222" → CurseForge, "f1:<id>" → Fport1 */
export function parseDependencies(text: string, type: Fport1Dependency['type']): Fport1Dependency[] {
  return text.split(/[,\n]/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /^(cf|curseforge|f1|fport1|mr|modrinth):(.+)$/i.exec(x)
    const src = m?.[1].toLowerCase()
    return { source: src === 'cf' || src === 'curseforge' ? 'curseforge' : src === 'f1' || src === 'fport1' ? 'fport1' : 'modrinth', projectId: (m ? m[2] : x).trim(), type }
  })
}

export interface Fport1Version {
  id: string
  name: string
  versionNumber: string
  channel: Channel
  loaders: string[]
  gameVersions: string[]
  changelog: string
  files: Fport1File[]
  downloads: number
  dependencies: Fport1Dependency[]
  publishedAt?: Timestamp | null
}

const PROJECTS = 'fport1_projects'

const ms = (t?: Timestamp | null): number => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0)

function toProject(id: string, d: Record<string, any>): Fport1Project {
  return {
    id,
    title: d.title ?? 'Sin título',
    slug: d.slug ?? id,
    summary: d.summary ?? '',
    description: d.description ?? '',
    type: d.type ?? 'mod',
    iconUrl: d.iconUrl ?? null,
    gallery: Array.isArray(d.gallery) ? d.gallery : [],
    categories: Array.isArray(d.categories) ? d.categories : [],
    loaders: Array.isArray(d.loaders) ? d.loaders : [],
    gameVersions: Array.isArray(d.gameVersions) ? d.gameVersions : [],
    clientSide: d.clientSide ?? 'required',
    serverSide: d.serverSide ?? 'optional',
    downloads: d.downloads ?? 0,
    published: !!d.published,
    featured: !!d.featured,
    latestVersion: d.latestVersion ?? null,
    createdAt: d.createdAt ?? null,
    updatedAt: d.updatedAt ?? null
  }
}

function toVersion(id: string, d: Record<string, any>): Fport1Version {
  return {
    id,
    name: d.name ?? d.versionNumber ?? '',
    versionNumber: d.versionNumber ?? '',
    channel: d.channel ?? 'release',
    loaders: Array.isArray(d.loaders) ? d.loaders : [],
    gameVersions: Array.isArray(d.gameVersions) ? d.gameVersions : [],
    changelog: d.changelog ?? '',
    files: Array.isArray(d.files) ? d.files : [],
    downloads: d.downloads ?? 0,
    dependencies: Array.isArray(d.dependencies) ? d.dependencies : [],
    publishedAt: d.publishedAt ?? null
  }
}

export const projectUpdatedMs = (p: Fport1Project): number => ms(p.updatedAt) || ms(p.createdAt)
export const versionPublishedMs = (v: Fport1Version): number => ms(v.publishedAt)

/** Proyectos publicados (el catálogo es pequeño: se filtra en el cliente). */
export async function listPublished(): Promise<Fport1Project[]> {
  const snap = await getDocs(query(collection(socialDb, PROJECTS), where('published', '==', true)))
  return snap.docs.map((d) => toProject(d.id, d.data()))
}

/** Todos, publicados o no (solo @fport1 tiene permiso). */
export async function listAll(): Promise<Fport1Project[]> {
  const snap = await getDocs(collection(socialDb, PROJECTS))
  return snap.docs.map((d) => toProject(d.id, d.data())).sort((a, b) => projectUpdatedMs(b) - projectUpdatedMs(a))
}

export async function getProject(id: string): Promise<Fport1Project | null> {
  const s = await getDoc(doc(socialDb, PROJECTS, id))
  return s.exists() ? toProject(s.id, s.data()) : null
}

export async function listVersions(projectId: string): Promise<Fport1Version[]> {
  const snap = await getDocs(query(collection(socialDb, PROJECTS, projectId, 'versions'), orderBy('publishedAt', 'desc')))
  return snap.docs.map((d) => toVersion(d.id, d.data()))
}

/** Cuenta una descarga (las reglas solo dejan sumar 1 a `downloads`). */
export async function countDownload(projectId: string, versionId: string): Promise<void> {
  await Promise.all([
    updateDoc(doc(socialDb, PROJECTS, projectId), { downloads: increment(1) }),
    updateDoc(doc(socialDb, PROJECTS, projectId, 'versions', versionId), { downloads: increment(1) })
  ]).catch(() => {})
}

// ── Publicar (solo @fport1) ─────────────────────────────────────────────────

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'proyecto'
}

export type ProjectInput = Omit<Fport1Project, 'id' | 'downloads' | 'createdAt' | 'updatedAt' | 'latestVersion' | 'loaders' | 'gameVersions'>

export async function createProject(input: ProjectInput): Promise<string> {
  const ref = await addDoc(collection(socialDb, PROJECTS), {
    ...input, loaders: [], gameVersions: [], downloads: 0, latestVersion: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  })
  return ref.id
}

export async function updateProject(id: string, patch: Partial<ProjectInput>): Promise<void> {
  await updateDoc(doc(socialDb, PROJECTS, id), { ...patch, updatedAt: serverTimestamp() })
}

export async function uploadFile(path: string, file: Blob, contentType: string | undefined, onProgress?: (f: number) => void): Promise<string> {
  const r = sRef(socialStorage, path)
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(r, file, contentType ? { contentType } : undefined)
    task.on('state_changed', (s) => onProgress?.(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0), reject, () => resolve())
  })
  // Contenido público a propósito: la URL con token es la de descarga
  return getDownloadURL(r)
}

export async function removeFile(path: string): Promise<void> {
  await deleteObject(sRef(socialStorage, path)).catch(() => {})
}

async function sha1Of(file: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', await file.arrayBuffer())
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const cleanName = (n: string): string => n.replace(/[^\w.\-+]+/g, '_')

export interface VersionInput {
  name: string
  versionNumber: string
  channel: Channel
  loaders: string[]
  gameVersions: string[]
  changelog: string
  dependencies?: Fport1Dependency[]
}

/** Sube el archivo y crea la versión; actualiza loaders/versiones del proyecto. */
export async function publishVersion(projectId: string, input: VersionInput, file: File, onProgress?: (f: number) => void): Promise<string> {
  const vref = doc(collection(socialDb, PROJECTS, projectId, 'versions'))
  const filename = cleanName(file.name)
  const path = `fport1/projects/${projectId}/versions/${vref.id}/${filename}`
  const [sha1, url] = await Promise.all([
    sha1Of(file),
    uploadFile(path, file, file.type || 'application/octet-stream', onProgress)
  ])
  await setDoc(vref, {
    ...input,
    files: [{ url, path, filename, size: file.size, sha1, primary: true }],
    downloads: 0,
    publishedAt: serverTimestamp()
  })
  // Índice por sha1: así el launcher reconoce el archivo ya instalado en una instancia
  await setDoc(doc(socialDb, 'fport1_files', sha1), { projectId, versionId: vref.id }).catch(() => {})
  await refreshProjectMeta(projectId)
  return vref.id
}

export async function updateVersion(projectId: string, versionId: string, patch: Partial<VersionInput>): Promise<void> {
  await updateDoc(doc(socialDb, PROJECTS, projectId, 'versions', versionId), patch)
  await refreshProjectMeta(projectId)
}

export async function deleteVersion(projectId: string, v: Fport1Version): Promise<void> {
  for (const f of v.files) {
    await removeFile(f.path)
    if (f.sha1) await deleteDoc(doc(socialDb, 'fport1_files', f.sha1)).catch(() => {})
  }
  await deleteDoc(doc(socialDb, PROJECTS, projectId, 'versions', v.id))
  await refreshProjectMeta(projectId)
}

export async function deleteProject(p: Fport1Project): Promise<void> {
  const versions = await listVersions(p.id).catch(() => [])
  for (const v of versions) await deleteVersion(p.id, v).catch(() => {})
  for (const g of p.gallery) await removeFile(g.path)
  if (p.iconUrl) await removeFile(`fport1/projects/${p.id}/icon`)
  await deleteDoc(doc(socialDb, PROJECTS, p.id))
}

/** Loaders, versiones de Minecraft y última versión, sacados de las versiones. */
async function refreshProjectMeta(projectId: string): Promise<void> {
  const versions = await listVersions(projectId)
  const loaders = [...new Set(versions.flatMap((v) => v.loaders))]
  const gameVersions = [...new Set(versions.flatMap((v) => v.gameVersions))]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  const latest = versions.find((v) => v.channel === 'release') ?? versions[0]
  await updateDoc(doc(socialDb, PROJECTS, projectId), {
    loaders, gameVersions,
    latestVersion: latest ? { id: latest.id, versionNumber: latest.versionNumber, channel: latest.channel } : null,
    updatedAt: serverTimestamp()
  })
}
