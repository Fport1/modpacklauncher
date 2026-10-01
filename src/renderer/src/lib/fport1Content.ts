// Fuente «Fport1» de Explorar: creaciones publicadas por @fport1 para que
// cualquiera las instale desde el launcher, al estilo de Modrinth.
//
// Firestore (el catálogo, igual para el launcher y fport1web):
//   fport1_projects/{projectId}                 ficha del proyecto
//   fport1_projects/{projectId}/versions/{vid}  cada versión (release/beta/alpha)
// Archivos, según `hosting` del proyecto:
//   'github'  → versiones en GitHub Releases e imágenes en el repo público de
//               contenido servidas por jsDelivr (no cuesta nada descargarlas).
//               `path` es «gh-release:owner/repo:releaseId:tag» o «gh:owner/repo:ruta».
//   'storage' → Firebase Storage fport1/projects/{projectId}/... (los antiguos).
//
// Lectura pública solo de lo publicado; escribir solo @fport1 (reglas en
// fport1web). El formato está documentado para la web en docs/prompt-web-creaciones.md.

import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, increment, orderBy, query, serverTimestamp,
  setDoc, updateDoc, where, type Timestamp
} from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref as sRef, uploadBytesResumable } from 'firebase/storage'
import { socialDb, socialStorage } from './firebase'

export type Fport1Type = 'modpack' | 'mod' | 'resourcepack' | 'datapack' | 'shader' | 'plugin'
export type Channel = 'release' | 'beta' | 'alpha'

export interface Fport1File {
  url: string; path: string; filename: string; size: number; sha1: string; primary: boolean
  host?: 'github' | 'storage'
  /** Release de GitHub donde está el archivo */
  github?: { repo: string; tag: string; releaseId: number; assetId: number; htmlUrl: string }
}

/** Imagen de la galería (en la descripción se puede poner donde se quiera con ![título](url)). */
export interface Fport1Image { url: string; path: string; title?: string; description?: string }

export type Fport1Hosting = 'github' | 'storage'

/** Licencia: SPDX (MIT, GPL-3.0…), «ARR» (todos los derechos reservados) o «custom» con su URL. */
export interface Fport1License { id: string; name: string; url?: string }

export interface Fport1Links { source?: string; issues?: string; wiki?: string; discord?: string; website?: string; donate?: string }

/**
 * Dónde está en GitHub.
 * - sourceRepo: repo del código (puede ser privado si el código es cerrado).
 * - releasesRepo: repo PÚBLICO donde se publican las versiones; vacío = el repo de contenido.
 */
export interface Fport1Github { sourceRepo?: string; sourcePrivate?: boolean; releasesRepo?: string }

export interface Fport1Project {
  id: string
  title: string
  slug: string
  summary: string
  /** Markdown. Las imágenes van con ![título](url) donde se quieran ver. */
  description: string
  type: Fport1Type
  iconUrl: string | null
  iconPath?: string
  /** Portada ancha que se ve arriba de la ficha */
  bannerUrl?: string | null
  bannerPath?: string
  gallery: Fport1Image[]
  /** Categorías fijas (las de Explorar) */
  categories: string[]
  /** Etiquetas libres */
  tags: string[]
  license?: Fport1License | null
  openSource?: boolean
  links?: Fport1Links
  hosting?: Fport1Hosting
  github?: Fport1Github | null
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
    iconPath: d.iconPath ?? undefined,
    bannerUrl: d.bannerUrl ?? null,
    bannerPath: d.bannerPath ?? undefined,
    gallery: Array.isArray(d.gallery) ? d.gallery : [],
    categories: Array.isArray(d.categories) ? d.categories : [],
    tags: Array.isArray(d.tags) ? d.tags : [],
    license: d.license ?? null,
    openSource: d.openSource ?? undefined,
    links: d.links ?? {},
    hosting: d.hosting ?? 'storage',
    github: d.github ?? null,
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

/** Firestore no acepta `undefined`: se quitan los campos opcionales vacíos (también dentro de mapas). */
function noUndefined<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype ? noUndefined(v as Record<string, unknown>) : v
  }
  return out as T
}

export async function createProject(input: ProjectInput): Promise<string> {
  const ref = await addDoc(collection(socialDb, PROJECTS), noUndefined({
    ...input, loaders: [], gameVersions: [], downloads: 0, latestVersion: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }))
  return ref.id
}

export async function updateProject(id: string, patch: Partial<ProjectInput>): Promise<void> {
  await updateDoc(doc(socialDb, PROJECTS, id), noUndefined({ ...patch, updatedAt: serverTimestamp() }))
}

/**
 * Sube una imagen del proyecto (icono, portada o galería) donde toque según el
 * alojamiento: GitHub (repo de contenido, servida por jsDelivr) o Storage.
 */
export async function uploadImage(project: Pick<Fport1Project, 'id' | 'hosting' | 'slug'>, kind: 'icon' | 'banner' | 'gallery', file: File): Promise<{ url: string; path: string }> {
  const name = `${kind}-${Date.now()}-${cleanName(file.name)}`
  if (project.hosting === 'github') {
    return window.api.github.putMedia(`media/${project.slug || project.id}/${name}`, await file.arrayBuffer(), `${project.slug}: ${kind}`)
  }
  const path = kind === 'gallery' ? `fport1/projects/${project.id}/gallery/${name}` : `fport1/projects/${project.id}/${kind}`
  return { url: await uploadFile(path, file, file.type), path }
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

/** Borra un archivo esté donde esté (Storage, imagen de GitHub o release de GitHub). */
export async function removeFile(path: string): Promise<void> {
  if (!path) return
  const rel = /^gh-release:([^:]+):(\d+):(.+)$/.exec(path)
  if (rel) { await window.api.github.deleteRelease(rel[1], Number(rel[2]), rel[3]).catch(() => {}); return }
  if (path.startsWith('gh:')) { await window.api.github.deleteMedia(path, 'Borrar imagen').catch(() => {}); return }
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

/** Etiqueta de la release: «v1.2.0» en el repo propio, «slug-v1.2.0» en el de contenido (compartido). */
export function releaseTag(project: Pick<Fport1Project, 'slug' | 'github'>, versionNumber: string): string {
  const v = versionNumber.trim().replace(/\s+/g, '-')
  return project.github?.releasesRepo ? `v${v}` : `${project.slug}-v${v}`
}

/** Sube el archivo y crea la versión; actualiza loaders/versiones del proyecto. */
export async function publishVersion(project: Fport1Project, input: VersionInput, file: File, onProgress?: (f: number) => void): Promise<string> {
  const vref = doc(collection(socialDb, PROJECTS, project.id, 'versions'))
  const filename = cleanName(file.name)
  const sha1 = await sha1Of(file)
  let entry: Fport1File
  if (project.hosting === 'github') {
    const off = window.api.github.onProgress((f) => onProgress?.(f))
    try {
      const r = await window.api.github.publishRelease({
        repo: project.github?.releasesRepo || undefined,
        tag: releaseTag(project, input.versionNumber),
        name: `${project.title} ${input.name && input.name !== input.versionNumber ? `${input.name} (${input.versionNumber})` : input.versionNumber}`,
        body: `${input.changelog || ''}\n\n---\nMinecraft ${input.gameVersions.join(', ')}${input.loaders.length ? ` · ${input.loaders.join(', ')}` : ''}\n\nPublicado con Modpack Launcher by Fport1.`.trim(),
        prerelease: input.channel !== 'release',
        file: { name: filename, data: await file.arrayBuffer(), contentType: file.type || 'application/octet-stream' },
      })
      entry = {
        url: r.url, path: `gh-release:${r.repo}:${r.releaseId}:${r.tag}`, filename, size: file.size, sha1, primary: true,
        host: 'github', github: { repo: r.repo, tag: r.tag, releaseId: r.releaseId, assetId: r.assetId, htmlUrl: r.htmlUrl },
      }
    } finally { off() }
  } else {
    const path = `fport1/projects/${project.id}/versions/${vref.id}/${filename}`
    const url = await uploadFile(path, file, file.type || 'application/octet-stream', onProgress)
    entry = { url, path, filename, size: file.size, sha1, primary: true, host: 'storage' }
  }
  await setDoc(vref, { ...input, files: [entry], downloads: 0, publishedAt: serverTimestamp() })
  await refreshProjectMeta(project.id)
  return vref.id
}

export async function updateVersion(projectId: string, versionId: string, patch: Partial<VersionInput>): Promise<void> {
  await updateDoc(doc(socialDb, PROJECTS, projectId, 'versions', versionId), patch)
  await refreshProjectMeta(projectId)
}

export async function deleteVersion(projectId: string, v: Fport1Version): Promise<void> {
  for (const f of v.files) {
    await removeFile(f.path)
  }
  await deleteDoc(doc(socialDb, PROJECTS, projectId, 'versions', v.id))
  await refreshProjectMeta(projectId)
}

export async function deleteProject(p: Fport1Project): Promise<void> {
  const versions = await listVersions(p.id).catch(() => [])
  for (const v of versions) await deleteVersion(p.id, v).catch(() => {})
  for (const g of p.gallery) await removeFile(g.path)
  if (p.iconUrl) await removeFile(p.iconPath ?? `fport1/projects/${p.id}/icon`)
  if (p.bannerPath) await removeFile(p.bannerPath)
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

/** Página de cada licencia conocida (para el enlace de la ficha). */
export function licenseUrl(l: Fport1License | null | undefined): string | undefined {
  if (!l) return undefined
  if (l.url) return l.url
  if (l.id === 'ARR' || l.id === 'custom') return undefined
  if (l.id.startsWith('CC')) {
    const m = /^CC-(BY(?:-[A-Z]{2})*)-(\d\.\d)$/.exec(l.id)
    if (l.id === 'CC0-1.0') return 'https://creativecommons.org/publicdomain/zero/1.0/'
    return m ? `https://creativecommons.org/licenses/${m[1].toLowerCase()}/${m[2]}/` : undefined
  }
  return `https://choosealicense.com/licenses/${l.id.toLowerCase()}/`
}
