import { app, safeStorage, shell } from 'electron'
import axios, { type AxiosRequestConfig } from 'axios'
import fs from 'fs'
import path from 'path'

// Cuenta de GitHub conectada al launcher, para publicar las creaciones de
// @fport1 en GitHub en vez de en Firebase Storage (las descargas de GitHub
// Releases no cuestan nada; el catálogo sigue en Firestore).
//
// - La clave NUNCA sale del proceso principal: se guarda cifrada con
//   safeStorage en userData/github-auth.bin y la ventana solo ve el usuario.
// - Dos formas de conectar: el flujo de dispositivo de una OAuth App de GitHub
//   (si GITHUB_CLIENT_ID está puesto) o un token personal con permiso «repo».
// - Archivos de cada versión → GitHub Releases. Si el código es abierto, en el
//   repositorio público del proyecto; si es cerrado, en el repositorio público
//   de contenido (CONTENT_REPO), porque los archivos de un repo privado no se
//   pueden descargar sin clave.
// - Imágenes (icono, portada, galería) → CONTENT_REPO, servidas por jsDelivr
//   fijadas al commit, así nunca se quedan en caché con una versión vieja.

/**
 * Client ID de la OAuth App de GitHub (es público: el flujo de dispositivo no
 * usa secreto). Vacío = solo se puede conectar con un token personal.
 * La misma app la usa fport1web para su flujo web (con su secreto en Vercel).
 */
export const GITHUB_CLIENT_ID = ''
/** Repositorio público (de la cuenta conectada) para imágenes y archivos de código cerrado. */
export const CONTENT_REPO = 'fport1-contenido'

// FPORT1_GITHUB_API solo lo usan las pruebas (un GitHub falso en local)
const API = process.env.FPORT1_GITHUB_API || 'https://api.github.com'
const authFile = (): string => path.join(app.getPath('userData'), 'github-auth.bin')

interface Stored { token: string; method: 'device' | 'token'; login: string; name?: string; avatarUrl?: string; scopes: string[] }
let cache: Stored | null | undefined

function load(): Stored | null {
  if (cache !== undefined) return cache
  try {
    const raw = fs.readFileSync(authFile())
    cache = JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')) as Stored
  } catch { cache = null }
  return cache
}

function save(s: Stored | null): void {
  cache = s
  if (!s) { try { fs.unlinkSync(authFile()) } catch { /* no había */ } return }
  const json = JSON.stringify(s)
  fs.writeFileSync(authFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8'))
}

export interface GithubStatus {
  connected: boolean
  login?: string
  name?: string
  avatarUrl?: string
  method?: 'device' | 'token'
  /** Puede crear releases en repos privados y públicos */
  canPrivate?: boolean
  /** Hay OAuth App configurada (botón «Conectar con GitHub») */
  deviceFlow: boolean
}

export function githubStatus(): GithubStatus {
  const s = load()
  if (!s) return { connected: false, deviceFlow: !!GITHUB_CLIENT_ID }
  return { connected: true, login: s.login, name: s.name, avatarUrl: s.avatarUrl, method: s.method, canPrivate: s.scopes.includes('repo'), deviceFlow: !!GITHUB_CLIENT_ID }
}

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ModpackLauncher' }
}

/** Mensaje claro a partir de un error de la API de GitHub. */
function ghError(e: unknown): Error {
  if (axios.isAxiosError(e)) {
    const st = e.response?.status
    const msg = (e.response?.data as { message?: string; errors?: { message?: string }[] } | undefined)
    const detail = msg?.errors?.map((x) => x.message).filter(Boolean).join('; ') || msg?.message || e.message
    if (st === 401) { save(null); return new Error('La conexión con GitHub ya no es válida: vuelve a conectar la cuenta.') }
    if (st === 403 && /rate limit/i.test(detail)) return new Error('GitHub ha limitado las peticiones por ahora. Prueba en unos minutos.')
    if (st === 404) return new Error(`GitHub no encuentra eso (o la cuenta no tiene acceso): ${detail}`)
    return new Error(`GitHub: ${detail}`)
  }
  return e instanceof Error ? e : new Error(String(e))
}

async function gh<T = any>(method: AxiosRequestConfig['method'], url: string, data?: unknown, extra?: AxiosRequestConfig): Promise<T> {
  const s = load()
  if (!s) throw new Error('Conecta tu cuenta de GitHub en Ajustes › Cuentas.')
  try {
    // `extra` va primero: sus cabeceras se suman a la autorización en vez de sustituirla
    const r = await axios({ timeout: 60_000, ...extra, method, url: url.startsWith('http') ? url : API + url, data, headers: { ...headers(s.token), ...(extra?.headers as Record<string, string> ?? {}) } })
    return r.data as T
  } catch (e) { throw ghError(e) }
}

/** Comprueba una clave y guarda la cuenta. */
async function adopt(token: string, method: Stored['method']): Promise<GithubStatus> {
  let r
  try { r = await axios.get(API + '/user', { headers: headers(token), timeout: 20_000 }) }
  catch (e) { if (axios.isAxiosError(e) && e.response?.status === 401) throw new Error('GitHub no acepta esa clave.'); throw ghError(e) }
  const scopes = String(r.headers['x-oauth-scopes'] ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  // Los tokens «fine-grained» no mandan X-OAuth-Scopes: se aceptan y GitHub dirá si falta algún permiso al usarlos
  const fineGrained = /^github_pat_/.test(token)
  if (!fineGrained && !scopes.includes('repo') && !scopes.includes('public_repo')) throw new Error('A esa clave le falta el permiso «repo» (o «public_repo»). Crea otra con ese permiso marcado.')
  save({ token, method, login: r.data.login, name: r.data.name ?? undefined, avatarUrl: r.data.avatar_url, scopes: fineGrained ? ['repo'] : scopes })
  return githubStatus()
}

export const githubSetToken = (token: string): Promise<GithubStatus> => adopt(token.trim(), 'token')

/** Clave de la cuenta conectada, solo para otros módulos del proceso principal (exportar modpacks). */
export function githubTokenForMain(): string | null { return load()?.token ?? null }
export function githubLogout(): GithubStatus { save(null); return githubStatus() }

// ── Flujo de dispositivo (OAuth App) ────────────────────────────────────────

let device: { code: string; interval: number; expires: number } | null = null

export async function githubDeviceStart(): Promise<{ userCode: string; verificationUri: string; expiresIn: number }> {
  if (!GITHUB_CLIENT_ID) throw new Error('No hay OAuth App de GitHub configurada: conecta con un token personal.')
  const { data } = await axios.post('https://github.com/login/device/code', { client_id: GITHUB_CLIENT_ID, scope: 'repo' }, { headers: { Accept: 'application/json' }, timeout: 20_000 })
  device = { code: data.device_code, interval: Math.max(5, Number(data.interval) || 5), expires: Date.now() + Number(data.expires_in) * 1000 }
  shell.openExternal(data.verification_uri).catch(() => {})
  return { userCode: data.user_code, verificationUri: data.verification_uri, expiresIn: Number(data.expires_in) }
}

/** Espera a que la persona autorice en el navegador (hasta que caduque el código). */
export async function githubDeviceWait(): Promise<GithubStatus> {
  while (device && Date.now() < device.expires) {
    await new Promise((r) => setTimeout(r, device!.interval * 1000))
    if (!device) break
    const { data } = await axios.post('https://github.com/login/oauth/access_token',
      { client_id: GITHUB_CLIENT_ID, device_code: device.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
      { headers: { Accept: 'application/json' }, timeout: 20_000 }).catch(() => ({ data: { error: 'red' } }))
    if (data.access_token) { device = null; return adopt(data.access_token, 'device') }
    if (data.error === 'slow_down') device.interval += 5
    else if (data.error === 'access_denied') { device = null; throw new Error('Has cancelado la conexión en GitHub.') }
    else if (data.error === 'expired_token') break
  }
  device = null
  throw new Error('El código ha caducado. Vuelve a pulsar «Conectar con GitHub».')
}

export function githubDeviceCancel(): void { device = null }

// ── Repositorios ────────────────────────────────────────────────────────────

export interface GithubRepo { fullName: string; private: boolean; description: string; htmlUrl: string; defaultBranch: string; license?: string }

const toRepo = (r: any): GithubRepo => ({ fullName: r.full_name, private: !!r.private, description: r.description ?? '', htmlUrl: r.html_url, defaultBranch: r.default_branch ?? 'main', license: r.license?.spdx_id ?? undefined })

export async function githubRepos(): Promise<{ repos: GithubRepo[]; owners: string[] }> {
  const s = load()
  const [repos, orgs] = await Promise.all([
    gh<any[]>('get', '/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member'),
    gh<any[]>('get', '/user/orgs?per_page=100').catch(() => []),
  ])
  return { repos: repos.map(toRepo), owners: [s!.login, ...orgs.map((o) => o.login)] }
}

export interface RepoInput { owner?: string; name: string; description?: string; private: boolean; license?: string; topics?: string[]; homepage?: string }

/** Plantillas de licencia que GitHub sabe poner al crear el repo. */
const LICENSE_TEMPLATES: Record<string, string> = { MIT: 'mit', 'Apache-2.0': 'apache-2.0', 'GPL-3.0': 'gpl-3.0', 'LGPL-3.0': 'lgpl-3.0', 'MPL-2.0': 'mpl-2.0', 'AGPL-3.0': 'agpl-3.0', Unlicense: 'unlicense', 'BSD-3-Clause': 'bsd-3-clause' }

export async function githubCreateRepo(input: RepoInput): Promise<GithubRepo> {
  const s = load()
  const body = {
    name: input.name, description: input.description?.slice(0, 350), private: input.private, homepage: input.homepage,
    auto_init: true, has_wiki: false, ...(input.license && LICENSE_TEMPLATES[input.license] ? { license_template: LICENSE_TEMPLATES[input.license] } : {}),
  }
  const owner = input.owner && input.owner !== s?.login ? input.owner : null
  const r = await gh('post', owner ? `/orgs/${owner}/repos` : '/user/repos', body)
  if (input.topics?.length) await githubSetTopics(r.full_name, input.topics).catch(() => {})
  return toRepo(r)
}

/** Etiquetas del repo: GitHub solo acepta minúsculas, números y guiones (≤ 50 caracteres, ≤ 20 etiquetas). */
export async function githubSetTopics(repo: string, topics: string[]): Promise<void> {
  const names = [...new Set(topics.map((t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)).filter(Boolean))].slice(0, 20)
  await gh('put', `/repos/${repo}/topics`, { names })
}

export async function githubUpdateRepo(repo: string, patch: { description?: string; homepage?: string; topics?: string[] }): Promise<void> {
  const { topics, ...rest } = patch
  if (Object.keys(rest).length) await gh('patch', `/repos/${repo}`, { ...rest, description: rest.description?.slice(0, 350) })
  if (topics) await githubSetTopics(repo, topics)
}

/** El repositorio de contenido (público), creado la primera vez que hace falta. */
async function contentRepo(): Promise<string> {
  const s = load()
  if (!s) throw new Error('Conecta tu cuenta de GitHub en Ajustes › Cuentas.')
  const full = `${s.login}/${CONTENT_REPO}`
  try { await gh('get', `/repos/${full}`); return full } catch (e) {
    if (!/no encuentra/.test((e as Error).message)) throw e
  }
  await githubCreateRepo({ name: CONTENT_REPO, private: false, description: 'Imágenes y descargas de las creaciones de Fport1 (las publica Modpack Launcher)' })
  return full
}

// ── Releases ────────────────────────────────────────────────────────────────

export interface ReleaseInput {
  /** Repo donde va la release; vacío = el repositorio de contenido */
  repo?: string
  tag: string
  name: string
  body: string
  prerelease: boolean
  file: { name: string; data: ArrayBuffer; contentType?: string }
}

export interface ReleaseResult { repo: string; tag: string; releaseId: number; assetId: number; url: string; htmlUrl: string }

/**
 * Crea (o reutiliza) la release de esa etiqueta y le sube el archivo; si ya
 * tenía uno con el mismo nombre, lo sustituye. Devuelve la URL pública de descarga.
 */
export async function githubPublishRelease(input: ReleaseInput, onProgress?: (f: number) => void): Promise<ReleaseResult> {
  const repo = input.repo || await contentRepo()
  const meta = await gh('get', `/repos/${repo}`)
  if (meta.private) throw new Error(`«${repo}» es privado: sus descargas necesitarían clave. Usa un repo público o el de contenido.`)
  let rel: any = await gh('get', `/repos/${repo}/releases/tags/${encodeURIComponent(input.tag)}`).catch(() => null)
  if (!rel) {
    rel = await gh('post', `/repos/${repo}/releases`, {
      tag_name: input.tag, target_commitish: meta.default_branch, name: input.name, body: input.body.slice(0, 120_000),
      prerelease: input.prerelease, make_latest: input.prerelease ? 'false' : 'true',
    })
  } else {
    rel = await gh('patch', `/repos/${repo}/releases/${rel.id}`, { name: input.name, body: input.body.slice(0, 120_000), prerelease: input.prerelease })
  }
  const old = (rel.assets ?? []).find((a: any) => a.name === input.file.name)
  if (old) await gh('delete', `/repos/${repo}/releases/assets/${old.id}`)
  const uploadUrl = String(rel.upload_url).replace(/\{.*$/, '') + `?name=${encodeURIComponent(input.file.name)}`
  const buf = Buffer.from(input.file.data)
  const asset = await gh('post', uploadUrl, buf, {
    headers: { 'Content-Type': input.file.contentType || 'application/octet-stream', 'Content-Length': String(buf.length) },
    maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 0,
    onUploadProgress: (p) => onProgress?.(p.total ? p.loaded / p.total : 0),
  })
  return { repo, tag: input.tag, releaseId: rel.id, assetId: asset.id, url: asset.browser_download_url, htmlUrl: rel.html_url }
}

/** Borra una release y su etiqueta (los archivos se van con ella). */
export async function githubDeleteRelease(repo: string, releaseId: number, tag: string): Promise<void> {
  await gh('delete', `/repos/${repo}/releases/${releaseId}`).catch((e) => { if (!/no encuentra/.test(e.message)) throw e })
  await gh('delete', `/repos/${repo}/git/refs/tags/${encodeURIComponent(tag)}`).catch(() => {})
}

// ── Imágenes en el repositorio de contenido ─────────────────────────────────

/** Sube una imagen a <cuenta>/fport1-contenido y devuelve su URL de jsDelivr fijada al commit. */
export async function githubPutMedia(filePath: string, data: ArrayBuffer, message: string): Promise<{ url: string; path: string }> {
  const repo = await contentRepo()
  const clean = filePath.replace(/^\/+/, '').split('/').map((p) => encodeURIComponent(p)).join('/')
  const prev = await gh('get', `/repos/${repo}/contents/${clean}`).catch(() => null)
  const r = await gh('put', `/repos/${repo}/contents/${clean}`, { message, content: Buffer.from(data).toString('base64'), ...(prev?.sha ? { sha: prev.sha } : {}) })
  return { url: `https://cdn.jsdelivr.net/gh/${repo}@${r.commit.sha}/${filePath.replace(/^\/+/, '')}`, path: `gh:${repo}:${filePath.replace(/^\/+/, '')}` }
}

/** Borra una imagen subida con githubPutMedia (path «gh:owner/repo:ruta»). */
export async function githubDeleteMedia(ghPath: string, message: string): Promise<void> {
  const m = /^gh:([^:]+):(.+)$/.exec(ghPath)
  if (!m) return
  const clean = m[2].split('/').map((p) => encodeURIComponent(p)).join('/')
  const prev = await gh('get', `/repos/${m[1]}/contents/${clean}`).catch(() => null)
  if (prev?.sha) await gh('delete', `/repos/${m[1]}/contents/${clean}`, { message, sha: prev.sha })
}
