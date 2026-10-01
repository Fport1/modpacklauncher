// Contenido de varias fuentes con una forma común: búsqueda con filtros,
// categorías, ficha completa, versiones (con fecha, notas y dependencias) e
// instalación. Lo usan Explorar, el explorador para instalar en instancias,
// mundos y servidores.

import { marked } from 'marked'
import {
  getProject as f1Project, listPublished as f1Published, listVersions as f1Versions,
  projectUpdatedMs, versionPublishedMs, licenseUrl as f1LicenseUrl, type Fport1Project
} from './fport1Content'

export type SourceId = 'modrinth' | 'curseforge' | 'fport1' | 'hangar' | 'spigot'
export type ContentKind = 'datapack' | 'plugin' | 'mod' | 'resourcepack' | 'shader' | 'modpack'

export interface SourceResult {
  source: SourceId
  id: string
  title: string
  summary: string
  icon: string | null
  downloads: number
  follows?: number
  author?: string
  pageUrl?: string
  categories: string[]
  /** Plataformas o loaders que declara el proyecto (paper, spigot, fabric…). */
  platforms: string[]
  /** Versiones de Minecraft que dice soportar (puede venir vacío). */
  gameVersions: string[]
  updated?: number
  clientSide?: string
  serverSide?: string
}

export type DepType = 'required' | 'optional' | 'incompatible' | 'embedded'

export interface SourceVersion {
  id: string
  name: string
  number: string
  channel: 'release' | 'beta' | 'alpha'
  gameVersions: string[]
  platforms: string[]
  date: number
  downloads?: number
  changelog?: string
  changelogIsHtml?: boolean
  filename: string
  size?: number
  /** URL directa, o cómo pedirla (CurseForge da la URL aparte). */
  url?: string
  cf?: { modId: number; fileId: number }
  sha1?: string
  /** Si hay que descargarlo a mano desde otra web. */
  externalUrl?: string
  deps: { source: SourceId; id: string; type: DepType }[]
}

export interface SearchContext {
  kind: ContentKind
  minecraft: string
  /** Loader o software del destino: paper, purpur, folia, fabric… ('' si no aplica) */
  loader: string
  /** El destino es un servidor (en Modrinth se buscan mods que funcionen en el servidor). */
  serverSide?: boolean
}

export type SortKey = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'

export interface SearchFilters {
  sort: SortKey
  /** Categorías incluidas (id de la fuente). */
  categories: string[]
  /** Categorías excluidas (solo Modrinth). */
  excluded: string[]
  /** Entorno (solo mods de Modrinth). */
  environment: 'any' | 'client' | 'server'
  /** false = no filtrar por versión de Minecraft ni loader del destino. */
  onlyCompatible: boolean
}

export const DEFAULT_FILTERS: SearchFilters = { sort: 'relevance', categories: [], excluded: [], environment: 'any', onlyCompatible: true }

export interface SourceCategory {
  id: string
  label: string
  /** SVG en línea (Modrinth) o URL de imagen (CurseForge). */
  icon?: string
  iconUrl?: string
  header?: string
  parent?: string
}

export interface ProjectDetail {
  title: string
  summary: string
  icon: string | null
  authors: { name: string; avatar?: string | null; url?: string }[]
  downloads: number
  follows?: number
  created?: number
  updated?: number
  license?: { name: string; url?: string | null }
  links: { label: string; url: string }[]
  categories: string[]
  loaders: string[]
  gameVersions: string[]
  clientSide?: string
  serverSide?: string
  /** HTML ya listo (el Markdown se convierte aquí). */
  body: string
  gallery: { url: string; full?: string; title?: string | null; description?: string | null }[]
  pageUrl?: string
  /** Portada ancha (Fport1) */
  banner?: string | null
  /** Etiquetas libres (Fport1) */
  tags?: string[]
  openSource?: boolean
}

export interface ProjectRef { source: SourceId; id: string; title: string; icon: string | null; summary: string }

export const SOURCE_INFO: Record<SourceId, { label: string; color: string }> = {
  modrinth: { label: 'Modrinth', color: '#1bd96a' },
  curseforge: { label: 'CurseForge', color: '#F16436' },
  fport1: { label: 'Fport1', color: '#a855f7' },
  hangar: { label: 'Hangar', color: '#3b82f6' },
  spigot: { label: 'SpigotMC', color: '#f59e0b' },
}

// ── Compatibilidad ──────────────────────────────────────────────────────────
// Qué plataformas de plugins puede cargar cada software de servidor. Paper y
// derivados cargan plugins de Bukkit y Spigot; Folia solo los preparados para
// Folia; los proxys tienen sus propios plugins.

export const PLUGIN_COMPAT: Record<string, string[]> = {
  folia: ['folia'],
  purpur: ['purpur', 'paper', 'spigot', 'bukkit'],
  pufferfish: ['paper', 'spigot', 'bukkit'],
  paper: ['paper', 'spigot', 'bukkit'],
  spigot: ['spigot', 'bukkit'],
  bukkit: ['bukkit'],
  velocity: ['velocity'],
  bungeecord: ['bungeecord', 'waterfall'],
  waterfall: ['bungeecord', 'waterfall'],
}

/** Qué fuentes tienen sentido para este destino. */
export function sourcesFor(ctx: SearchContext): SourceId[] {
  if (ctx.kind !== 'plugin') return ['modrinth', 'curseforge', 'fport1']
  const l = ctx.loader
  const out: SourceId[] = ['modrinth']
  if (['paper', 'purpur', 'pufferfish', 'folia', 'velocity', 'bungeecord', 'waterfall'].includes(l)) out.push('hangar')
  if (['paper', 'purpur', 'pufferfish', 'spigot', 'bukkit', 'bungeecord', 'waterfall'].includes(l)) out.push('spigot')
  if (['paper', 'purpur', 'pufferfish', 'spigot', 'bukkit'].includes(l)) out.push('curseforge')
  out.push('fport1')
  return out
}

const sameMajor = (a: string, b: string): boolean => a.split('.').slice(0, 2).join('.') === b.split('.').slice(0, 2).join('.')

/** 'yes' seguro, 'maybe' probable (misma versión mayor o sin datos), 'no'. */
export function compatibility(ctx: SearchContext, platforms: string[], gameVersions: string[]): 'yes' | 'maybe' | 'no' {
  const plats = platforms.map((p) => p.toLowerCase())
  if (ctx.kind === 'plugin' && plats.length) {
    const accepts = PLUGIN_COMPAT[ctx.loader] ?? [ctx.loader]
    if (!plats.some((p) => accepts.includes(p))) return 'no'
  } else if (ctx.kind === 'mod' && ctx.loader && ctx.loader !== 'vanilla') {
    const known = plats.filter((p) => ['fabric', 'forge', 'neoforge', 'quilt'].includes(p))
    // Quilt carga mods de Fabric
    if (known.length && !known.includes(ctx.loader) && !(ctx.loader === 'quilt' && known.includes('fabric'))) return 'no'
  }
  if (!ctx.minecraft || !gameVersions.length) return 'maybe'
  if (gameVersions.includes(ctx.minecraft)) return 'yes'
  if (gameVersions.some((v) => sameMajor(v, ctx.minecraft))) return 'maybe'
  return 'no'
}

/** La mejor versión para el destino: compatible y estable antes que el resto. */
export function bestVersion(ctx: SearchContext, versions: SourceVersion[], stableOnly = false): SourceVersion | null {
  const pool = stableOnly && versions.some((v) => v.channel === 'release' && compatibility(ctx, v.platforms, v.gameVersions) === 'yes')
    ? versions.filter((v) => v.channel === 'release') : versions
  const score = (v: SourceVersion): number => {
    const c = compatibility(ctx, v.platforms, v.gameVersions)
    return (c === 'yes' ? 20 : c === 'maybe' ? 10 : 0) + (v.channel === 'release' ? 2 : v.channel === 'beta' ? 1 : 0) + (v.url || v.cf ? 1 : 0)
  }
  return [...pool].sort((a, b) => score(b) - score(a) || b.date - a.date)[0] ?? null
}

/** URL descargable de una versión (CurseForge la da aparte; null si no se permite). */
export async function resolveDownloadUrl(v: SourceVersion): Promise<string | null> {
  if (v.url) return v.url
  if (v.cf) return window.api.curseforge.fileUrl(v.cf.modId, v.cf.fileId)
  return null
}

// ── Utilidades ──────────────────────────────────────────────────────────────

const md = (s: string): string => String(marked.parse(s || ''))
const b64 = (s?: string): string => { try { return s ? decodeURIComponent(escape(atob(s))) : '' } catch { return '' } }
const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt']

// ── Modrinth ────────────────────────────────────────────────────────────────

function modrinthType(kind: ContentKind): string { return kind }

function modrinthLoaders(ctx: SearchContext): string {
  if (ctx.kind === 'datapack') return 'datapack'
  if (ctx.kind === 'resourcepack' || ctx.kind === 'shader' || ctx.kind === 'modpack') return ''
  if (ctx.kind === 'plugin') return (PLUGIN_COMPAT[ctx.loader] ?? [ctx.loader]).join(',')
  return ctx.loader === 'vanilla' ? '' : ctx.loader
}

const MR_CAT_TYPE = (kind: ContentKind): string => (kind === 'datapack' ? 'mod' : kind)
const LOADER_TAGS = new Set(['fabric', 'forge', 'neoforge', 'quilt', 'liteloader', 'modloader', 'rift', 'bukkit', 'spigot', 'paper', 'purpur', 'folia', 'sponge', 'velocity', 'bungeecord', 'waterfall', 'datapack', 'iris', 'optifine', 'canvas', 'vanilla', 'minecraft'])

async function modrinthCategories(ctx: SearchContext): Promise<SourceCategory[]> {
  const cats = await window.api.modrinth.getCategories(MR_CAT_TYPE(ctx.kind)) as { name: string; header: string; icon?: string }[]
  return cats.filter((c) => !LOADER_TAGS.has(c.name)).map((c) => ({ id: c.name, label: c.name, icon: c.icon, header: c.header }))
}

async function modrinthSearch(ctx: SearchContext, q: string, page: number, f: SearchFilters): Promise<SourceResult[]> {
  const type = modrinthType(ctx.kind)
  const env = ctx.kind === 'mod' ? (f.environment !== 'any' ? f.environment : ctx.serverSide ? 'server' : '') : ''
  const res = await window.api.modrinth.search(q, f.onlyCompatible ? ctx.minecraft : '', f.onlyCompatible ? modrinthLoaders(ctx) : (ctx.kind === 'datapack' ? 'datapack' : ''),
    f.categories, env, type, 20, page * 20, f.sort) as {
    hits: { project_id: string; slug: string; title: string; description: string; icon_url: string | null; downloads: number; follows: number; author: string; categories: string[]; display_categories?: string[]; versions: string[]; date_modified: string; client_side: string; server_side: string }[]
  }
  return (res.hits ?? [])
    .filter((h) => !f.excluded.length || !(h.display_categories ?? h.categories).some((c) => f.excluded.includes(c)))
    .map((h) => ({
      source: 'modrinth', id: h.project_id, title: h.title, summary: h.description, icon: h.icon_url, downloads: h.downloads, follows: h.follows,
      author: h.author, pageUrl: `https://modrinth.com/${type}/${h.slug}`,
      categories: (h.display_categories ?? h.categories ?? []).filter((c) => !LOADER_TAGS.has(c)),
      platforms: (h.categories ?? []).filter((c) => LOADER_TAGS.has(c)), gameVersions: h.versions ?? [],
      updated: Date.parse(h.date_modified) || undefined, clientSide: h.client_side, serverSide: h.server_side,
    }))
}

async function modrinthVersions(ctx: SearchContext, id: string): Promise<SourceVersion[]> {
  const vs = await window.api.modrinth.getVersions(id, '', ctx.kind === 'datapack' ? 'datapack' : '') as {
    id: string; name: string; version_number: string; version_type: 'release' | 'beta' | 'alpha'; game_versions: string[]; loaders: string[]; date_published: string; downloads: number; changelog?: string
    files: { url: string; filename: string; primary: boolean; size: number; hashes?: { sha1?: string } }[]
    dependencies?: { project_id?: string; dependency_type: DepType }[]
  }[]
  return vs.filter((v) => v.files.length).map((v) => {
    const f = v.files.find((x) => x.primary) ?? v.files[0]
    return {
      id: v.id, name: v.name || v.version_number, number: v.version_number, channel: v.version_type, gameVersions: v.game_versions, platforms: v.loaders,
      date: Date.parse(v.date_published), downloads: v.downloads, changelog: v.changelog,
      filename: f.filename, size: f.size, url: f.url, sha1: f.hashes?.sha1,
      deps: (v.dependencies ?? []).filter((d) => d.project_id).map((d) => ({ source: 'modrinth' as const, id: d.project_id!, type: d.dependency_type })),
    }
  })
}

async function modrinthDetail(id: string): Promise<ProjectDetail> {
  const [p, members] = await Promise.all([window.api.modrinth.getProject(id), window.api.modrinth.getMembers(id).catch(() => [])])
  const links: ProjectDetail['links'] = []
  if (p.source_url) links.push({ label: 'Código fuente', url: p.source_url })
  if (p.issues_url) links.push({ label: 'Reportar fallos', url: p.issues_url })
  if (p.wiki_url) links.push({ label: 'Wiki', url: p.wiki_url })
  if (p.discord_url) links.push({ label: 'Discord', url: p.discord_url })
  for (const d of p.donation_urls ?? []) links.push({ label: `Donar (${d.platform})`, url: d.url })
  return {
    title: p.title, summary: p.description, icon: p.icon_url ?? null,
    authors: members.map((m) => ({ name: m.username, avatar: m.avatarUrl, url: `https://modrinth.com/user/${m.username}` })),
    downloads: p.downloads ?? 0, follows: p.followers ?? 0,
    created: Date.parse(p.published) || undefined, updated: Date.parse(p.updated) || undefined,
    license: p.license ? { name: p.license.name || p.license.id, url: p.license.url } : undefined,
    links, categories: [...(p.categories ?? []), ...(p.additional_categories ?? [])],
    loaders: p.loaders ?? [], gameVersions: [...(p.game_versions ?? [])].reverse(),
    clientSide: p.client_side, serverSide: p.server_side, body: md(p.body ?? ''),
    gallery: [...(p.gallery ?? [])].sort((a: any, b: any) => Number(b.featured) - Number(a.featured))
      .map((g: any) => ({ url: g.url, full: g.raw_url ?? g.url, title: g.title, description: g.description })),
    pageUrl: `https://modrinth.com/${p.project_type}/${p.slug}`,
  }
}

// ── CurseForge ──────────────────────────────────────────────────────────────

const CF_CLASS: Record<ContentKind, number> = { datapack: 6945, plugin: 5, mod: 6, resourcepack: 12, shader: 6552, modpack: 4471 }
const CF_LOADER_ID: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }
const CF_LOADER_NAME: Record<number, string> = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' }
const CF_SORT: Record<SortKey, number> = { relevance: 2, downloads: 6, follows: 2, newest: 11, updated: 3 }
const CF_REL: Record<number, DepType | null> = { 1: 'embedded', 2: 'optional', 3: 'required', 4: null, 5: 'incompatible', 6: 'embedded' }

async function curseCategories(ctx: SearchContext): Promise<SourceCategory[]> {
  const res = await window.api.curseforge.getCategories(CF_CLASS[ctx.kind]) as { data?: { id: number; name: string; iconUrl?: string; parentCategoryId?: number; isClass?: boolean }[] }
  return (res.data ?? []).filter((c) => !c.isClass).map((c) => ({
    id: String(c.id), label: c.name, iconUrl: c.iconUrl,
    parent: c.parentCategoryId && c.parentCategoryId !== CF_CLASS[ctx.kind] ? String(c.parentCategoryId) : undefined,
  }))
}

async function curseSearch(ctx: SearchContext, q: string, page: number, f: SearchFilters): Promise<SourceResult[]> {
  const res = await window.api.curseforge.search({
    query: q, gameVersion: f.onlyCompatible && ctx.minecraft ? ctx.minecraft : undefined, classId: CF_CLASS[ctx.kind],
    sortField: q && f.sort === 'relevance' ? 2 : CF_SORT[f.sort], offset: page * 20,
    modLoaderType: f.onlyCompatible && ctx.kind === 'mod' ? CF_LOADER_ID[ctx.loader] : undefined,
    categoryId: f.categories[0] ? Number(f.categories[0]) : undefined,
  }) as { data?: { id: number; name: string; summary: string; logo?: { thumbnailUrl?: string }; downloadCount: number; thumbsUpCount?: number; authors?: { name: string }[]; links?: { websiteUrl?: string }; dateModified: string; categories?: { name: string }[]; latestFilesIndexes?: { gameVersion: string; modLoader?: number }[] }[] }
  return (res.data ?? []).map((m) => ({
    source: 'curseforge', id: String(m.id), title: m.name, summary: m.summary, icon: m.logo?.thumbnailUrl ?? null, downloads: m.downloadCount, follows: m.thumbsUpCount,
    author: m.authors?.[0]?.name, pageUrl: m.links?.websiteUrl, categories: (m.categories ?? []).map((c) => c.name),
    platforms: ctx.kind === 'plugin' ? ['bukkit'] : [...new Set((m.latestFilesIndexes ?? []).map((i) => CF_LOADER_NAME[i.modLoader ?? 0]).filter(Boolean))],
    gameVersions: [...new Set((m.latestFilesIndexes ?? []).map((i) => i.gameVersion))], updated: Date.parse(m.dateModified) || undefined,
  }))
}

async function curseVersions(ctx: SearchContext, id: string): Promise<SourceVersion[]> {
  const res = await window.api.curseforge.getFiles(Number(id), undefined, undefined) as {
    data?: { id: number; displayName: string; fileName: string; fileLength: number; downloadCount: number; releaseType: number; gameVersions: string[]; fileDate: string; hashes?: { value: string; algo: number }[]; dependencies?: { modId: number; relationType: number }[] }[]
  }
  return (res.data ?? []).map((f) => ({
    id: String(f.id), name: f.displayName, number: f.displayName, channel: f.releaseType === 2 ? 'beta' : f.releaseType === 3 ? 'alpha' : 'release',
    gameVersions: f.gameVersions.filter((v) => /^\d/.test(v)),
    platforms: ctx.kind === 'plugin' ? ['bukkit'] : f.gameVersions.map((v) => v.toLowerCase()).filter((v) => LOADERS.includes(v)),
    date: Date.parse(f.fileDate), downloads: f.downloadCount, changelogIsHtml: true,
    filename: f.fileName, size: f.fileLength, cf: { modId: Number(id), fileId: f.id }, sha1: f.hashes?.find((h) => h.algo === 1)?.value,
    deps: (f.dependencies ?? []).map((d) => ({ source: 'curseforge' as const, id: String(d.modId), type: CF_REL[d.relationType] })).filter((d): d is { source: 'curseforge'; id: string; type: DepType } => !!d.type),
  }))
}

async function curseDetail(id: string): Promise<ProjectDetail> {
  const [m, desc] = await Promise.all([
    window.api.curseforge.getMod(Number(id)).then((r) => r.data),
    window.api.curseforge.getModDescription(Number(id)).then((r) => r.data as string).catch(() => ''),
  ])
  const links: ProjectDetail['links'] = []
  if (m.links?.sourceUrl) links.push({ label: 'Código fuente', url: m.links.sourceUrl })
  if (m.links?.issuesUrl) links.push({ label: 'Reportar fallos', url: m.links.issuesUrl })
  if (m.links?.wikiUrl) links.push({ label: 'Wiki', url: m.links.wikiUrl })
  const idx = (m.latestFilesIndexes ?? []) as { gameVersion: string; modLoader?: number }[]
  return {
    title: m.name, summary: m.summary, icon: m.logo?.thumbnailUrl ?? null,
    authors: (m.authors ?? []).map((a: any) => ({ name: a.name, url: a.url })),
    downloads: m.downloadCount ?? 0, follows: m.thumbsUpCount,
    created: Date.parse(m.dateCreated) || undefined, updated: Date.parse(m.dateModified) || undefined,
    links, categories: (m.categories ?? []).map((c: any) => c.name),
    loaders: [...new Set(idx.map((i) => CF_LOADER_NAME[i.modLoader ?? 0]).filter(Boolean))],
    gameVersions: [...new Set(idx.map((i) => i.gameVersion))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
    body: desc,
    gallery: (m.screenshots ?? []).map((s: any) => ({ url: s.thumbnailUrl ?? s.url, full: s.url, title: s.title, description: s.description })),
    pageUrl: m.links?.websiteUrl,
  }
}

// ── Fport1 ──────────────────────────────────────────────────────────────────

let f1Cache: { at: number; list: Fport1Project[] } | null = null
async function fport1All(): Promise<Fport1Project[]> {
  if (f1Cache && Date.now() - f1Cache.at < 60_000) return f1Cache.list
  const list = await f1Published().catch(() => [] as Fport1Project[])
  f1Cache = { at: Date.now(), list }
  return list
}

async function fport1Categories(ctx: SearchContext): Promise<SourceCategory[]> {
  const cats = [...new Set((await fport1All()).filter((p) => (p.type as string) === ctx.kind).flatMap((p) => p.categories))].sort()
  return cats.map((c) => ({ id: c, label: c }))
}

async function fport1Search(ctx: SearchContext, q: string, page: number, f: SearchFilters): Promise<SourceResult[]> {
  if (page > 0) return []
  const s = q.trim().toLowerCase()
  const list = (await fport1All()).filter((p) =>
    (p.type as string) === ctx.kind &&
    (!s || p.title.toLowerCase().includes(s) || p.summary.toLowerCase().includes(s)) &&
    (!f.categories.length || f.categories.every((c) => p.categories.includes(c))) &&
    (!f.onlyCompatible || compatibility(ctx, p.loaders, p.gameVersions) !== 'no'))
  const sorted = [...list].sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || (
    f.sort === 'updated' || f.sort === 'newest' ? projectUpdatedMs(b) - projectUpdatedMs(a) : f.sort === 'relevance' && s ? 0 : b.downloads - a.downloads))
  return sorted.map((p) => ({
    source: 'fport1', id: p.id, title: p.title, summary: p.summary, icon: p.iconUrl, downloads: p.downloads, author: 'Fport1',
    categories: p.categories, platforms: p.loaders, gameVersions: p.gameVersions, updated: projectUpdatedMs(p) || undefined,
    clientSide: p.clientSide, serverSide: p.serverSide,
  }))
}

async function fport1VersionList(id: string): Promise<SourceVersion[]> {
  return (await f1Versions(id)).filter((v) => v.files.length).map((v) => ({
    id: v.id, name: v.name || v.versionNumber, number: v.versionNumber, channel: v.channel, gameVersions: v.gameVersions, platforms: v.loaders,
    date: versionPublishedMs(v), downloads: v.downloads, changelog: v.changelog,
    filename: v.files[0].filename, size: v.files[0].size, url: v.files[0].url, sha1: v.files[0].sha1,
    deps: v.dependencies.map((d) => ({ source: d.source as SourceId, id: d.projectId, type: d.type })),
  }))
}

const F1_LINKS: [keyof NonNullable<Fport1Project['links']>, string][] = [
  ['source', 'Código fuente'], ['issues', 'Reportar errores'], ['wiki', 'Wiki'], ['discord', 'Discord'], ['website', 'Página web'], ['donate', 'Donaciones'],
]

async function fport1Detail(id: string): Promise<ProjectDetail> {
  const p = await f1Project(id)
  if (!p) throw new Error('Proyecto no encontrado')
  return {
    title: p.title, summary: p.summary, icon: p.iconUrl, authors: [{ name: 'Fport1' }],
    downloads: p.downloads, created: p.createdAt?.toMillis?.(), updated: projectUpdatedMs(p) || undefined,
    links: F1_LINKS.flatMap(([k, label]) => (p.links?.[k] && (k !== 'source' || p.openSource) ? [{ label, url: p.links[k]! }] : [])),
    license: p.license ? { name: p.license.name || p.license.id, url: f1LicenseUrl(p.license) } : undefined,
    categories: p.categories, loaders: p.loaders, gameVersions: p.gameVersions,
    clientSide: p.clientSide, serverSide: p.serverSide, body: md(p.description),
    gallery: p.gallery.map((g) => ({ url: g.url, full: g.url, title: g.title, description: g.description })),
    banner: p.bannerUrl ?? null, tags: p.tags, openSource: p.openSource,
  }
}

// ── Hangar (PaperMC) ────────────────────────────────────────────────────────

const HANGAR_CATS = [
  ['admin_tools', 'Administración'], ['chat', 'Chat'], ['dev_tools', 'Herramientas de desarrollo'], ['economy', 'Economía'],
  ['gameplay', 'Jugabilidad'], ['games', 'Minijuegos'], ['protection', 'Protección'], ['role_playing', 'Rol'],
  ['world_management', 'Gestión de mundos'], ['misc', 'Otros'],
]
const HANGAR_SORT: Record<SortKey, string> = { relevance: '-stars', downloads: '-downloads', follows: '-stars', newest: '-newest', updated: '-updated' }

function hangarPlatform(loader: string): string {
  if (loader === 'velocity') return 'VELOCITY'
  if (loader === 'bungeecord' || loader === 'waterfall') return 'WATERFALL'
  return 'PAPER'
}

async function hangarSearch(ctx: SearchContext, q: string, page: number, f: SearchFilters): Promise<SourceResult[]> {
  const platform = hangarPlatform(ctx.loader)
  const params = new URLSearchParams({ limit: '20', offset: String(page * 20), sort: HANGAR_SORT[f.sort], platform })
  if (q) params.set('q', q)
  if (f.onlyCompatible && ctx.minecraft) params.set('version', ctx.minecraft)
  if (f.categories[0]) params.set('category', f.categories[0])
  const res = await window.api.content.getJson(`https://hangar.papermc.io/api/v1/projects?${params}`) as {
    result?: { name: string; namespace: { owner: string; slug: string }; description: string; avatarUrl?: string; stats?: { downloads: number; stars: number }; category?: string; lastUpdated: string; supportedPlatforms?: Record<string, string[]> }[]
  }
  return (res.result ?? []).map((p) => ({
    source: 'hangar', id: p.namespace.slug, title: p.name, summary: p.description, icon: p.avatarUrl ?? null,
    downloads: p.stats?.downloads ?? 0, follows: p.stats?.stars, author: p.namespace.owner,
    pageUrl: `https://hangar.papermc.io/${p.namespace.owner}/${p.namespace.slug}`,
    categories: p.category ? [HANGAR_CATS.find(([k]) => k === p.category)?.[1] ?? p.category] : [],
    platforms: Object.keys(p.supportedPlatforms ?? { [platform]: [] }).map((x) => x.toLowerCase()),
    gameVersions: p.supportedPlatforms?.[platform] ?? [], updated: Date.parse(p.lastUpdated) || undefined,
  }))
}

async function hangarVersions(ctx: SearchContext, slug: string): Promise<SourceVersion[]> {
  const platform = hangarPlatform(ctx.loader)
  const res = await window.api.content.getJson(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(slug)}/versions?limit=50`) as {
    result?: { name: string; createdAt: string; description?: string; channel?: { name: string }; stats?: { totalDownloads?: number }
      downloads: Record<string, { fileInfo?: { name: string; sizeBytes?: number } | null; downloadUrl?: string | null; externalUrl?: string | null }>
      platformDependencies?: Record<string, string[]>
      pluginDependencies?: Record<string, { name: string; required: boolean; projectId?: number | null }[]> }[]
  }
  const channel = (n = ''): SourceVersion['channel'] => (/release/i.test(n) ? 'release' : /alpha/i.test(n) ? 'alpha' : n ? 'beta' : 'release')
  return (res.result ?? []).map((v) => {
    const plat = v.downloads[platform] ? platform : Object.keys(v.downloads)[0]
    const d = v.downloads[plat]
    return {
      id: v.name, name: v.name, number: v.name, channel: channel(v.channel?.name), gameVersions: v.platformDependencies?.[plat] ?? [],
      platforms: Object.keys(v.downloads).map((x) => x.toLowerCase()), date: Date.parse(v.createdAt), downloads: v.stats?.totalDownloads,
      changelog: v.description, filename: d?.fileInfo?.name ?? `${slug}-${v.name}.jar`, size: d?.fileInfo?.sizeBytes,
      url: d?.downloadUrl ?? undefined, externalUrl: d?.downloadUrl ? undefined : d?.externalUrl ?? undefined,
      deps: (v.pluginDependencies?.[plat] ?? []).map((x) => ({ source: 'hangar' as const, id: x.name, type: x.required ? 'required' as const : 'optional' as const })),
    }
  })
}

async function hangarDetail(slug: string): Promise<ProjectDetail> {
  const [p, page] = await Promise.all([
    window.api.content.getJson(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(slug)}`),
    window.api.content.getJson(`https://hangar.papermc.io/api/v1/pages/main/${encodeURIComponent(slug)}`).catch(() => ''),
  ])
  const links: ProjectDetail['links'] = []
  for (const group of p.settings?.links ?? []) for (const l of group.links ?? []) if (l.url) links.push({ label: l.name, url: l.url })
  const plats = p.supportedPlatforms ?? {}
  return {
    title: p.name, summary: p.description, icon: p.avatarUrl ?? null, authors: [{ name: p.namespace?.owner, url: `https://hangar.papermc.io/${p.namespace?.owner}` }],
    downloads: p.stats?.downloads ?? 0, follows: p.stats?.stars, created: Date.parse(p.createdAt) || undefined, updated: Date.parse(p.lastUpdated) || undefined,
    license: p.settings?.license?.name ? { name: p.settings.license.name, url: p.settings.license.url } : undefined,
    links, categories: [HANGAR_CATS.find(([k]) => k === p.category)?.[1] ?? p.category].filter(Boolean),
    loaders: Object.keys(plats).map((x) => x.toLowerCase()), gameVersions: [...new Set(Object.values(plats).flat() as string[])].reverse(),
    body: md(typeof page === 'string' ? page : ''), gallery: [],
    pageUrl: `https://hangar.papermc.io/${p.namespace?.owner}/${p.namespace?.slug}`,
  }
}

// ── SpigotMC (Spiget) ───────────────────────────────────────────────────────

interface SpigetResource {
  id: number; name: string; tag: string; downloads: number; testedVersions?: string[]; external?: boolean; premium?: boolean; likes?: number
  icon?: { url?: string; data?: string }; file?: { type?: string; externalUrl?: string; size?: number; sizeUnit?: string }; updateDate?: number; releaseDate?: number
  version?: { id: number }; author?: { id: number }; description?: string; sourceCodeLink?: string; donationLink?: string; category?: { id: number }
}
const SPIGET_SORT: Record<SortKey, string> = { relevance: '-downloads', downloads: '-downloads', follows: '-likes', newest: '-releaseDate', updated: '-updateDate' }
const spigetIcon = (r: SpigetResource): string | null =>
  r.icon?.data ? `data:image/png;base64,${r.icon.data}` : r.icon?.url ? `https://www.spigotmc.org/${r.icon.url}` : null
let spigetCats: SourceCategory[] | null = null

async function spigotCategories(): Promise<SourceCategory[]> {
  if (spigetCats) return spigetCats
  const cats = await window.api.content.getJson('https://api.spiget.org/v2/categories?size=100') as { id: number; name: string }[]
  spigetCats = cats.map((c) => ({ id: String(c.id), label: c.name }))
  return spigetCats
}

async function spigotSearch(_ctx: SearchContext, q: string, page: number, f: SearchFilters): Promise<SourceResult[]> {
  const fields = 'id,name,tag,icon,downloads,testedVersions,external,file,premium,updateDate,likes,category'
  const base = `size=20&page=${page + 1}&sort=${SPIGET_SORT[f.sort]}&fields=${fields}`
  const url = q ? `https://api.spiget.org/v2/search/resources/${encodeURIComponent(q)}?${base}`
    : f.categories[0] ? `https://api.spiget.org/v2/categories/${f.categories[0]}/resources?${base}`
    : `https://api.spiget.org/v2/resources/free?${base}`
  const res = await window.api.content.getJson(url).catch(() => []) as SpigetResource[]
  const catName = (id?: number): string[] => { const c = spigetCats?.find((x) => x.id === String(id)); return c ? [c.label] : [] }
  return (Array.isArray(res) ? res : []).filter((r) => !r.premium).map((r) => ({
    source: 'spigot', id: String(r.id), title: r.name, summary: r.tag, icon: spigetIcon(r), downloads: r.downloads, follows: r.likes,
    pageUrl: `https://www.spigotmc.org/resources/${r.id}/`, categories: catName(r.category?.id),
    platforms: ['spigot', 'bukkit'], gameVersions: r.testedVersions ?? [], updated: r.updateDate ? r.updateDate * 1000 : undefined,
  }))
}

async function spigotVersions(id: string): Promise<SourceVersion[]> {
  const [r, list, updates] = await Promise.all([
    window.api.content.getJson(`https://api.spiget.org/v2/resources/${id}?fields=id,name,testedVersions,external,file,version,updateDate`) as Promise<SpigetResource>,
    window.api.content.getJson(`https://api.spiget.org/v2/resources/${id}/versions?size=30&sort=-releaseDate`).catch(() => []) as Promise<{ id: number; name: string; releaseDate: number; downloads: number }[]>,
    window.api.content.getJson(`https://api.spiget.org/v2/resources/${id}/updates?size=30&sort=-date`).catch(() => []) as Promise<{ title: string; description: string; date: number }[]>,
  ])
  const external = r.external || r.file?.type === 'external'
  // Spiget solo sirve la última versión; las anteriores se enseñan pero hay que bajarlas de su web
  return (list.length ? list : [{ id: r.version?.id ?? 0, name: 'Última', releaseDate: r.updateDate ?? 0, downloads: 0 }]).map((v, i) => {
    const note = updates.find((u) => Math.abs(u.date - v.releaseDate) < 3600)
    const latest = i === 0
    return {
      id: String(v.id), name: v.name, number: v.name, channel: 'release' as const, gameVersions: r.testedVersions ?? [], platforms: ['spigot', 'bukkit'],
      date: v.releaseDate * 1000, downloads: v.downloads, changelog: note ? b64(note.description) : undefined, changelogIsHtml: true,
      filename: `${r.name.replace(/[^\w.-]+/g, '_')}-${v.name.replace(/[^\w.-]+/g, '_')}.jar`,
      url: latest && !external ? `https://api.spiget.org/v2/resources/${id}/download` : undefined,
      externalUrl: latest && !external ? undefined : (external && r.file?.externalUrl) || `https://www.spigotmc.org/resources/${id}/history`,
      deps: [],
    }
  })
}

async function spigotDetail(id: string): Promise<ProjectDetail> {
  const r = await window.api.content.getJson(`https://api.spiget.org/v2/resources/${id}`) as SpigetResource
  const author = r.author?.id ? await window.api.content.getJson(`https://api.spiget.org/v2/authors/${r.author.id}`).catch(() => null) as { name?: string } | null : null
  const links: ProjectDetail['links'] = []
  if (r.sourceCodeLink) links.push({ label: 'Código fuente', url: r.sourceCodeLink })
  if (r.donationLink) links.push({ label: 'Donar', url: r.donationLink })
  return {
    title: r.name, summary: r.tag, icon: spigetIcon(r),
    authors: author?.name ? [{ name: author.name, url: `https://www.spigotmc.org/members/${r.author!.id}/` }] : [],
    downloads: r.downloads, follows: r.likes, created: r.releaseDate ? r.releaseDate * 1000 : undefined, updated: r.updateDate ? r.updateDate * 1000 : undefined,
    links, categories: [], loaders: ['spigot', 'bukkit'], gameVersions: [...(r.testedVersions ?? [])].reverse(),
    body: b64(r.description), gallery: [], pageUrl: `https://www.spigotmc.org/resources/${id}/`,
  }
}

// ── Puntos de entrada ───────────────────────────────────────────────────────

export async function searchSource(source: SourceId, ctx: SearchContext, q: string, page = 0, filters: SearchFilters = DEFAULT_FILTERS): Promise<SourceResult[]> {
  switch (source) {
    case 'modrinth': return modrinthSearch(ctx, q, page, filters)
    case 'curseforge': return curseSearch(ctx, q, page, filters)
    case 'fport1': return fport1Search(ctx, q, page, filters)
    case 'hangar': return hangarSearch(ctx, q, page, filters)
    case 'spigot': return spigotSearch(ctx, q, page, filters)
  }
}

export async function sourceCategories(source: SourceId, ctx: SearchContext): Promise<SourceCategory[]> {
  switch (source) {
    case 'modrinth': return modrinthCategories(ctx)
    case 'curseforge': return curseCategories(ctx)
    case 'fport1': return fport1Categories(ctx)
    case 'hangar': return HANGAR_CATS.map(([id, label]) => ({ id, label }))
    case 'spigot': return spigotCategories()
  }
}

export async function sourceVersions(source: SourceId, ctx: SearchContext, id: string): Promise<SourceVersion[]> {
  const list = await (source === 'modrinth' ? modrinthVersions(ctx, id)
    : source === 'curseforge' ? curseVersions(ctx, id)
    : source === 'fport1' ? fport1VersionList(id)
    : source === 'hangar' ? hangarVersions(ctx, id)
    : spigotVersions(id))
  return list.sort((a, b) => b.date - a.date)
}

export async function sourceDetail(source: SourceId, id: string): Promise<ProjectDetail> {
  switch (source) {
    case 'modrinth': return modrinthDetail(id)
    case 'curseforge': return curseDetail(id)
    case 'fport1': return fport1Detail(id)
    case 'hangar': return hangarDetail(id)
    case 'spigot': return spigotDetail(id)
  }
}

/** Notas de una versión de CurseForge (van aparte). */
export async function versionChangelog(source: SourceId, v: SourceVersion): Promise<string> {
  if (source === 'curseforge' && v.cf) return window.api.curseforge.fileChangelog(v.cf.modId, v.cf.fileId).catch(() => '')
  return v.changelog ?? ''
}

/** Nombre, icono y resumen de dependencias, por «fuente:id». */
export async function resolveRefs(deps: { source: SourceId; id: string }[]): Promise<Record<string, ProjectRef & { downloads?: number }>> {
  const out: Record<string, ProjectRef & { downloads?: number }> = {}
  const of = (s: SourceId): string[] => [...new Set(deps.filter((d) => d.source === s).map((d) => d.id))]
  await Promise.all([
    of('modrinth').length ? window.api.modrinth.getProjects(of('modrinth')).then((ps: any[]) => {
      for (const p of ps) {
        const ref = { source: 'modrinth' as const, id: p.id, title: p.title, icon: p.icon_url ?? null, summary: p.description ?? '', downloads: p.downloads }
        out[`modrinth:${p.id}`] = ref
        if (p.slug) out[`modrinth:${p.slug}`] = ref
      }
    }).catch(() => {}) : null,
    of('curseforge').length ? window.api.curseforge.getMods(of('curseforge').map(Number).filter(Boolean)).then((ms: any[]) => {
      for (const m of ms) out[`curseforge:${m.id}`] = { source: 'curseforge', id: String(m.id), title: m.name, icon: m.logo?.thumbnailUrl ?? null, summary: m.summary ?? '', downloads: m.downloadCount }
    }).catch(() => {}) : null,
    ...of('fport1').map((id) => f1Project(id).then((p) => {
      if (p) out[`fport1:${id}`] = { source: 'fport1', id, title: p.title, icon: p.iconUrl, summary: p.summary, downloads: p.downloads }
    }).catch(() => {})),
    ...of('hangar').map((name) => window.api.content.getJson(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(name)}`).then((p: any) => {
      out[`hangar:${name}`] = { source: 'hangar', id: p.namespace?.slug ?? name, title: p.name, icon: p.avatarUrl ?? null, summary: p.description ?? '', downloads: p.stats?.downloads }
    }).catch(() => {})),
  ])
  return out
}
