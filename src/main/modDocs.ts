import { app } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import axios from 'axios'
import AdmZip from 'adm-zip'

// Documentación a fondo de los mods para la IA: wikis oficiales, sitios de
// documentación, READMEs y la documentación que algunos mods traen dentro del
// jar (Customizable Player Models trae su wiki entera). Se descarga una vez y
// se guarda en userData/ai-docs/<mod>/, compartida entre instancias; la IA la
// consulta por páginas o buscando dentro (herramienta «documentacion»).

const UA = { 'User-Agent': 'ModpackLauncher (contact@fport1.dev)' }
const MAX_PAGES = 60
const MAX_PAGE_CHARS = 120_000

type Source =
  | { kind: 'github-wiki'; repo: string }
  | { kind: 'github-files'; repo: string; files: string[]; dirs?: string[] }
  | { kind: 'site'; url: string; prefix?: string }

/** Fuentes oficiales conocidas (por id de mod y por slug de Modrinth). Para el resto se usan los enlaces de Modrinth. */
const KNOWN: Record<string, Source[]> = {
  plasmovoice: [{ kind: 'site', url: 'https://plasmovoice.com/docs/' }, { kind: 'github-files', repo: 'plasmoapp/plasmo-voice', files: ['README.md'] }],
  voicechat: [{ kind: 'site', url: 'https://modrepo.de/minecraft/voicechat/wiki' }, { kind: 'github-files', repo: 'henkelmax/simple-voice-chat', files: ['readme.md', 'README.md'] }],
  worldedit: [{ kind: 'site', url: 'https://worldedit.enginehub.org/en/latest/' }],
  worldguard: [{ kind: 'site', url: 'https://worldguard.enginehub.org/en/latest/' }],
  yawp: [{ kind: 'site', url: 'https://z0rdak.github.io/yawp-docs/' }],
  axiom: [{ kind: 'site', url: 'https://axiomdocs.moulberry.com/' }],
  sodium: [{ kind: 'github-wiki', repo: 'CaffeineMC/sodium' }],
  sodium_extra: [{ kind: 'github-wiki', repo: 'FlashyReese/sodium-extra-fabric' }],
  sodiumextra: [{ kind: 'github-wiki', repo: 'FlashyReese/sodium-extra-fabric' }],
  iris: [{ kind: 'github-files', repo: 'IrisShaders/Iris', files: ['README.md'], dirs: ['docs'] }],
  lambdynlights: [{ kind: 'site', url: 'https://lambdaurora.dev/projects/lambdynamiclights/docs/v4/' }],
  nuit: [{ kind: 'github-files', repo: 'FlashyReese/nuit', files: ['README.md'], dirs: ['docs'] }],
  cpm: [{ kind: 'github-wiki', repo: 'tom5454/CustomPlayerModels' }],
  entity_model_features: [{ kind: 'github-files', repo: 'Traben-0/Entity_Model_Features', files: ['FEATURES.md', 'README.md', '.github/README.md'] }],
  entity_texture_features: [{ kind: 'github-files', repo: 'Traben-0/Entity_Texture_Features', files: ['.github/README.md', 'README.md'], dirs: ['.github'] }],
  flashback: [{ kind: 'github-files', repo: 'Moulberry/Flashback', files: ['README.md'] }],
  replaymod: [{ kind: 'site', url: 'https://www.replaymod.com/docs/' }],
  polytone: [{ kind: 'github-wiki', repo: 'MehVahdJukaar/polytone' }],
  watermedia: [{ kind: 'github-wiki', repo: 'WaterMediaTeam/watermedia' }],
  aaa_particles: [{ kind: 'github-files', repo: 'ChloePrime/AAAParticles', files: ['README.md', 'README_en.md'] }],
  aaa_particles_world: [{ kind: 'github-files', repo: 'ChloePrime/AAA-Particles-World', files: ['README.md', 'README_en.md'] }],
}

// Slug de Modrinth o nombre habitual → id del mod (para usar las fuentes conocidas aunque no esté instalado)
const ALIASES: Record<string, string> = {
  'plasmo-voice': 'plasmovoice', 'simple-voice-chat': 'voicechat', 'custom-player-models': 'cpm', 'customizable-player-models': 'cpm',
  'entity-model-features': 'entity_model_features', 'emf': 'entity_model_features', 'entitytexturefeatures': 'entity_texture_features',
  'entity-texture-features': 'entity_texture_features', 'etf': 'entity_texture_features', 'lambdynamiclights': 'lambdynlights',
  'aaa-particles': 'aaa_particles', 'aaa-particles-world': 'aaa_particles_world', 'sodium-extra': 'sodium_extra', 'fabricskyboxes': 'nuit',
  'yet-another-world-protector': 'yawp', 'iris-shaders': 'iris',
}
export const canonicalMod = (m: string): string => ALIASES[m.toLowerCase()] ?? m.toLowerCase()

export interface DocPage { title: string; file: string; url: string; source: string }
interface DocIndex { mod: string; fetchedAt: number; pages: DocPage[]; notes: string[] }

const root = (): string => path.join(app.getPath('userData'), 'ai-docs')
const slugify = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'pagina'

/** HTML → texto con estructura (títulos, listas, código), sin menús ni scripts. */
export function htmlToDoc(html: string): { title: string; text: string } {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim()
    .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  let body = /<main[\s\S]*?>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? /<article[\s\S]*?>([\s\S]*?)<\/article>/i.exec(html)?.[1] ?? html
  body = body
    .replace(/<(script|style|nav|header|footer|aside|svg|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => '\n```\n' + c.replace(/<[^>]+>/g, '') + '\n```\n')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => '`' + c.replace(/<[^>]+>/g, '') + '`')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Number(n))} ${t.replace(/<[^>]+>/g, '').trim()}\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|table|ul|ol|section|dd|dt)>/gi, '\n')
    .replace(/<t[dh][^>]*>/gi, ' | ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => { const txt = t.replace(/<[^>]+>/g, '').trim(); return txt && /^https?:/.test(href) ? `${txt} (${href})` : txt })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { title, text: body }
}

async function get(url: string): Promise<string | null> {
  try {
    const { data, headers } = await axios.get<string>(url, { headers: UA, timeout: 20_000, responseType: 'text', maxContentLength: 5_000_000 })
    if (String(headers['content-type'] ?? '').includes('application/octet-stream')) return null
    return typeof data === 'string' ? data : JSON.stringify(data)
  } catch { return null }
}

async function fetchGithubWiki(repo: string, add: (p: Omit<DocPage, 'file'>, text: string) => Promise<void>): Promise<void> {
  const list = await get(`https://github.com/${repo}/wiki/_pages`) ?? await get(`https://github.com/${repo}/wiki`)
  const pages = new Set<string>(['Home'])
  if (list) for (const m of list.matchAll(new RegExp(`href="/${repo.replace('/', '\\/')}/wiki/([^"#?]+)"`, 'g'))) if (!m[1].startsWith('_')) pages.add(decodeURIComponent(m[1]))
  for (const page of [...pages].slice(0, MAX_PAGES)) {
    const md = await get(`https://raw.githubusercontent.com/wiki/${repo}/${encodeURIComponent(page)}.md`)
    if (md && !/^404: Not Found/.test(md)) await add({ title: page.replace(/-/g, ' '), url: `https://github.com/${repo}/wiki/${page}`, source: 'wiki de GitHub' }, md)
  }
}

async function fetchGithubFiles(repo: string, files: string[], dirs: string[] = [], add: (p: Omit<DocPage, 'file'>, text: string) => Promise<void>): Promise<void> {
  const seen = new Set<string>()
  for (const f of files) {
    const md = await get(`https://raw.githubusercontent.com/${repo}/HEAD/${f}`)
    if (md && !/^404: Not Found/.test(md) && !seen.has(md.slice(0, 200))) { seen.add(md.slice(0, 200)); await add({ title: f, url: `https://github.com/${repo}/blob/HEAD/${f}`, source: 'repositorio de GitHub' }, md) }
  }
  for (const d of dirs) {
    try {
      const { data } = await axios.get(`https://api.github.com/repos/${repo}/contents/${d}`, { headers: UA, timeout: 15_000 })
      for (const item of (data as { name: string; path: string; type: string }[]).filter((x) => x.type === 'file' && /\.md$/i.test(x.name)).slice(0, 30)) {
        if (files.includes(item.path)) continue
        const md = await get(`https://raw.githubusercontent.com/${repo}/HEAD/${item.path}`)
        if (md) await add({ title: item.path, url: `https://github.com/${repo}/blob/HEAD/${item.path}`, source: 'repositorio de GitHub' }, md)
      }
    } catch { /* límite de la API de GitHub o carpeta inexistente */ }
  }
}

/** Sitio de documentación: la portada y las páginas que enlaza dentro de la misma sección. */
async function fetchSite(start: string, prefix: string | undefined, add: (p: Omit<DocPage, 'file'>, text: string) => Promise<void>): Promise<void> {
  const base = new URL(start)
  const scope = prefix ?? base.pathname.replace(/[^/]*$/, '')
  const queue = [base.href]
  const seen = new Set<string>()
  // Sitios VitePress: el menú se pinta con JavaScript, pero la lista de páginas va en __VP_HASH_MAP__
  const first = await get(base.href)
  const vp = first && /__VP_HASH_MAP__=JSON\.parse\("(.*?)"\)/.exec(first)
  if (vp) {
    try {
      const keys = Object.keys(JSON.parse(JSON.parse(`"${vp[1]}"`)) as Record<string, string>)
      const want = scope.replace(/^\/|\/$/g, '').replace(/\//g, '_')
      for (const k of keys) {
        if (want && !k.startsWith(want)) continue
        const p = '/' + k.replace(/\.md$/, '').replace(/_/g, '/').replace(/(^|\/)index$/, '$1')
        queue.push(new URL(p, base).href)
      }
    } catch { /* formato distinto: se rastrean los enlaces */ }
  }
  while (queue.length && seen.size < MAX_PAGES) {
    const url = queue.shift()!
    if (seen.has(url)) continue
    seen.add(url)
    const html = (url === base.href && first) ? first : await get(url) ?? (!/\.html$|\/$/.test(url) ? await get(url + '.html') : null)
    if (!html) continue
    const doc = htmlToDoc(html)
    if (doc.text.length > 200) await add({ title: doc.title || url, url, source: base.host }, doc.text)
    for (const m of html.matchAll(/href="([^"#]+)"/g)) {
      try {
        const u = new URL(m[1], url)
        u.hash = ''; u.search = ''
        // Fuera: páginas especiales de wikis (cambios recientes, historial, usuarios…)
        if (/Special:|Especial:|Recent_?changes|Talk:|User:|Usuario:|action=|oldid=|\/history/i.test(decodeURIComponent(u.pathname + m[1]))) continue
        if (u.host === base.host && (u.pathname.startsWith(scope) || (u.pathname + '/').startsWith(scope)) && !/\.(png|jpe?g|gif|svg|css|js|zip|jar|pdf|ico|webp|mp4)$/i.test(u.pathname) && !seen.has(u.href)) queue.push(u.href)
      } catch { /* enlace raro */ }
    }
  }
}

/** Documentación que trae el propio jar (wikis, READMEs, instrucciones). */
export function jarDocs(jarPath: string): { name: string; text: string }[] {
  try {
    const zip = new AdmZip(jarPath)
    return zip.getEntries()
      .filter((e) => !e.isDirectory && /\.(md|txt)$/i.test(e.entryName) && /(^|\/)(wiki|docs?|documentation|guide|manual)\/|(^|\/)(readme|instructions|usage|features|commands)[^/]*\.(md|txt)$/i.test(e.entryName) && !/\/locale\/|LICENSE|NOTICE|CHANGELOG/i.test(e.entryName))
      .slice(0, 80)
      .map((e) => ({ name: e.entryName, text: e.getData().toString('utf8') }))
  } catch { return [] }
}

/** Descarga (o reutiliza) la documentación de un mod. `links`: enlaces de Modrinth (wiki, código). */
export async function ensureDocs(mod: string, opts: { jar?: string; links?: { wiki?: string; source?: string }; body?: string; refresh?: boolean } = {}): Promise<DocIndex> {
  const dir = path.join(root(), slugify(mod))
  const idxFile = path.join(dir, 'index.json')
  const cached = await fs.readJson(idxFile).catch(() => null) as DocIndex | null
  if (cached && !opts.refresh && Date.now() - cached.fetchedAt < 14 * 86_400_000 && cached.pages.length) return cached
  await fs.emptyDir(dir)
  const pages: DocPage[] = []
  const notes: string[] = []
  const add = async (p: Omit<DocPage, 'file'>, text: string): Promise<void> => {
    if (pages.length >= MAX_PAGES * 2) return
    let file = slugify(p.title)
    while (pages.some((x) => x.file === file + '.md')) file += '-2'
    await fs.outputFile(path.join(dir, file + '.md'), `# ${p.title}\nFuente: ${p.url}\n\n${text.slice(0, MAX_PAGE_CHARS)}`)
    pages.push({ ...p, file: file + '.md' })
  }
  // 1) Lo que trae el jar
  if (opts.jar) for (const d of jarDocs(opts.jar)) await add({ title: d.name.replace(/^.*\/(wiki\/pages\/)?/, '').replace(/\.(md|txt)$/i, ''), url: `jar:${d.name}`, source: 'dentro del jar' }, d.text)
  // 2) Fuentes oficiales conocidas o 3) los enlaces de Modrinth
  const sources: Source[] = [...(KNOWN[mod] ?? KNOWN[mod.replace(/-/g, '_')] ?? [])]
  if (!sources.length && opts.links) {
    const gw = /github\.com\/([^/]+\/[^/]+)\/wiki/.exec(opts.links.wiki ?? '')
    const gr = /github\.com\/([^/]+\/[^/#?]+)/.exec(opts.links.wiki ?? '') ?? /github\.com\/([^/]+\/[^/#?]+)/.exec(opts.links.source ?? '')
    if (gw) sources.push({ kind: 'github-wiki', repo: gw[1] })
    else if (opts.links.wiki && !/github\.com/.test(opts.links.wiki)) sources.push({ kind: 'site', url: opts.links.wiki })
    if (gr) sources.push({ kind: 'github-files', repo: gr[1].replace(/\.git$/, ''), files: ['README.md', '.github/README.md', 'readme.md'], dirs: ['docs', 'wiki'] })
  }
  for (const s of sources) {
    try {
      if (s.kind === 'github-wiki') await fetchGithubWiki(s.repo, add)
      else if (s.kind === 'github-files') await fetchGithubFiles(s.repo, s.files, s.dirs, add)
      else await fetchSite(s.url, s.prefix, add)
    } catch (e) { notes.push(`No se pudo leer ${JSON.stringify(s)}: ${e instanceof Error ? e.message : e}`) }
  }
  // 4) Si no hay nada más, la descripción de su página (Modrinth/CurseForge)
  if (opts.body && pages.length < 2) await add({ title: 'Descripción del autor', url: 'modrinth/curseforge', source: 'página del mod' }, opts.body)
  if (!pages.length) notes.push('Este mod no tiene documentación pública que se pueda descargar; usa su ficha en .ai/mods/ y sus configs.')
  const idx: DocIndex = { mod, fetchedAt: Date.now(), pages, notes }
  await fs.outputJson(idxFile, idx, { spaces: 1 })
  return idx
}

/** Contenido de una página (por título o archivo). */
export async function readDocPage(mod: string, page: string): Promise<string | null> {
  const dir = path.join(root(), slugify(mod))
  const idx = await fs.readJson(path.join(dir, 'index.json')).catch(() => null) as DocIndex | null
  if (!idx) return null
  const q = page.toLowerCase()
  const hit = idx.pages.find((p) => p.file === page || p.title.toLowerCase() === q) ?? idx.pages.find((p) => p.title.toLowerCase().includes(q) || p.file.includes(slugify(page)))
  if (!hit) return null
  return fs.readFile(path.join(dir, hit.file), 'utf8')
}

/** Busca un texto en toda la documentación de un mod y devuelve fragmentos con contexto. */
export async function searchDocs(mod: string, query: string, max = 12): Promise<{ pagina: string; fragmento: string }[]> {
  const dir = path.join(root(), slugify(mod))
  const idx = await fs.readJson(path.join(dir, 'index.json')).catch(() => null) as DocIndex | null
  if (!idx) return []
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1)
  const out: { pagina: string; fragmento: string; score: number }[] = []
  for (const p of idx.pages) {
    const text = await fs.readFile(path.join(dir, p.file), 'utf8').catch(() => '')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      const low = line.toLowerCase()
      const score = terms.filter((t) => low.includes(t)).length
      if (score && score >= Math.min(2, terms.length)) out.push({ pagina: p.title, fragmento: lines.slice(Math.max(0, i - 3), i + 6).join('\n').slice(0, 900), score })
    })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max).map(({ score: _s, ...r }) => r)
}

export function knownDocMods(): string[] { return Object.keys(KNOWN) }
