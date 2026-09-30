import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import AdmZip from 'adm-zip'
import axios from 'axios'
import { getInstance, getInstanceGameDir, getSharedDir, listMods, listResourcepacks, listShaderpacks, listWorlds } from './instances'
import { getInstalledModsMeta, type InstalledModMeta } from './modrinth'
import { cfGet, cfPost } from './curseforge'
import { listWorldDatapacks } from './worldDatapacks'
import { buildRegistry, packFormats, worldInfo } from './gameKnowledge'
import { SKILLS } from './aiSkills'
import type { Instance, ModFile } from '../shared/types'
import { BRIDGE_FILE, MCP_SCRIPT_FILE } from './aiBridge'
import { MCP_SCRIPT } from './aiMcpScript'

// «Preparar para IA»: deja en la carpeta del juego de una instancia todo lo que
// una IA (Claude Code, Codex, Gemini, Copilot, Cursor…) necesita para trabajar
// en el modpack sin inventarse cosas: versión y loader exactos, formato de
// datapacks y resource packs, qué hace cada mod (descripción, wiki, fallos,
// comandos, configs, dependencias e incompatibilidades) y los ids de bloques e
// ítems que añade cada mod. Además, instrucciones y habilidades (skills) de
// Claude Code para datapacks, configs y resource packs.

const MR = 'https://api.modrinth.com/v2'
const MR_HEADERS = { 'User-Agent': 'ModpackLauncher/1.9 (contact@fport1.dev)' }
const MAX_BODY = 18_000

export interface AiContextStatus { exists: boolean; generatedAt?: number; mods?: number; stale?: boolean }

const slug = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'mod'

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
    .replace(/<h(\d)[^>]*>/gi, (_, n) => '\n' + '#'.repeat(Math.min(6, Number(n) + 1)) + ' ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim()
}

const clip = (s: string, n = MAX_BODY): string => (s.length > n ? s.slice(0, n) + '\n\n…(recortado; el resto en la página del proyecto)' : s)

/** Lo que el jar dice de sí mismo: versión, ids de bloques/ítems, lang de comandos. */
function jarFacts(jarPath: string): { version?: string; namespaces: string[]; items: string[]; blocks: string[]; commandKeys: string[]; hasData: boolean } {
  const out = { version: undefined as string | undefined, namespaces: [] as string[], items: [] as string[], blocks: [] as string[], commandKeys: [] as string[], hasData: false }
  try {
    const zip = new AdmZip(jarPath)
    const names = zip.getEntries().map((e) => e.entryName)
    const fabric = zip.getEntry('fabric.mod.json')
    if (fabric) out.version = JSON.parse(fabric.getData().toString('utf8')).version
    const toml = zip.getEntry('META-INF/neoforge.mods.toml') ?? zip.getEntry('META-INF/mods.toml')
    if (!out.version && toml) {
      const v = toml.getData().toString('utf8').match(/^\s*version\s*=\s*["']([^"']+)["']/m)?.[1]
      if (v && !v.includes('${')) out.version = v
    }
    const ns = new Set<string>()
    for (const n of names) {
      let m = /^assets\/([^/]+)\/models\/item\/([^/]+)\.json$/.exec(n)
      if (m) { ns.add(m[1]); out.items.push(`${m[1]}:${m[2]}`); continue }
      m = /^assets\/([^/]+)\/blockstates\/([^/]+)\.json$/.exec(n)
      if (m) { ns.add(m[1]); out.blocks.push(`${m[1]}:${m[2]}`); continue }
      if (/^data\/[^/]+\//.test(n)) out.hasData = true
    }
    out.namespaces = [...ns].filter((x) => x !== 'minecraft')
    const lang = names.find((n) => /^assets\/[^/]+\/lang\/en_us\.json$/.test(n))
    if (lang) {
      try {
        const keys = Object.keys(JSON.parse(zip.getEntry(lang)!.getData().toString('utf8')))
        out.commandKeys = keys.filter((k) => /command/i.test(k)).slice(0, 60)
      } catch { /* lang en otro formato */ }
    }
  } catch { /* jar ilegible */ }
  return out
}

interface ModDoc {
  file: ModFile
  meta?: InstalledModMeta
  title: string
  summary?: string
  body?: string
  links: { label: string; url: string }[]
  source?: string
  clientSide?: string
  serverSide?: string
  incompatible: string[]
  categories: string[]
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) await fn(items[next++]) }))
}

async function collectModDocs(inst: Instance, mods: ModFile[]): Promise<ModDoc[]> {
  const meta = await getInstalledModsMeta(inst.id, inst.minecraft, inst.modloader).catch(() => ({} as Record<string, InstalledModMeta>))
  const docs: ModDoc[] = mods.map((f) => ({
    file: f, meta: meta[f.filename], title: meta[f.filename]?.title || f.meta?.name || f.filename.replace(/\.jar(\.disabled)?$/, ''),
    links: [], incompatible: [], categories: [],
  }))

  // Modrinth: fichas en bloque + dependencias incompatibles de la versión instalada
  const mrIds = [...new Set(docs.map((d) => d.meta?.source === 'modrinth' ? d.meta.projectId : undefined).filter((x): x is string => !!x))]
  if (mrIds.length) {
    try {
      const { data } = await axios.get(`${MR}/projects`, { params: { ids: JSON.stringify(mrIds) }, headers: MR_HEADERS, timeout: 30_000 })
      const byId = new Map((data as any[]).map((p) => [p.id, p]))
      for (const d of docs) {
        const p = d.meta?.projectId ? byId.get(d.meta.projectId) : undefined
        if (!p) continue
        d.title = p.title; d.summary = p.description; d.body = p.body; d.source = 'Modrinth'
        d.clientSide = p.client_side; d.serverSide = p.server_side; d.categories = p.categories ?? []
        d.links.push({ label: 'Modrinth', url: `https://modrinth.com/${p.project_type}/${p.slug}` })
        if (p.wiki_url) d.links.push({ label: 'Wiki', url: p.wiki_url })
        if (p.issues_url) d.links.push({ label: 'Problemas conocidos / reportar fallos', url: p.issues_url })
        if (p.source_url) d.links.push({ label: 'Código fuente', url: p.source_url })
        if (p.discord_url) d.links.push({ label: 'Discord', url: p.discord_url })
      }
      const verIds = docs.map((d) => d.meta?.installedVersionId).filter((x): x is string => !!x)
      if (verIds.length) {
        const { data: vers } = await axios.get(`${MR}/versions`, { params: { ids: JSON.stringify(verIds) }, headers: MR_HEADERS, timeout: 30_000 })
        const incompatIds = new Set<string>()
        for (const v of vers as any[]) for (const dep of v.dependencies ?? []) if (dep.dependency_type === 'incompatible' && dep.project_id) incompatIds.add(dep.project_id)
        const names = new Map<string, string>()
        if (incompatIds.size) {
          const { data: ps } = await axios.get(`${MR}/projects`, { params: { ids: JSON.stringify([...incompatIds]) }, headers: MR_HEADERS, timeout: 30_000 })
          for (const p of ps as any[]) names.set(p.id, p.title)
        }
        for (const v of vers as any[]) {
          const d = docs.find((x) => x.meta?.installedVersionId === v.id)
          if (d) d.incompatible = (v.dependencies ?? []).filter((x: any) => x.dependency_type === 'incompatible' && x.project_id).map((x: any) => names.get(x.project_id) ?? x.project_id)
        }
      }
    } catch { /* sin red: lo que se sepa del jar */ }
  }

  // CurseForge: fichas en bloque y descripción de cada uno
  const cfIds = [...new Set(docs.map((d) => d.meta?.source === 'curseforge' ? d.meta.cfModId : undefined).filter((x): x is number => !!x))]
  if (cfIds.length) {
    try {
      const res = await cfPost<{ data?: any[] }>('/v1/mods', { modIds: cfIds })
      const byId = new Map((res.data ?? []).map((m) => [m.id, m]))
      await pool(docs.filter((d) => d.meta?.cfModId && byId.has(d.meta.cfModId)), 4, async (d) => {
        const m = byId.get(d.meta!.cfModId!)
        d.title = m.name; d.summary = m.summary; d.source = 'CurseForge'; d.categories = (m.categories ?? []).map((c: any) => c.name)
        if (m.links?.websiteUrl) d.links.push({ label: 'CurseForge', url: m.links.websiteUrl })
        if (m.links?.wikiUrl) d.links.push({ label: 'Wiki', url: m.links.wikiUrl })
        if (m.links?.issuesUrl) d.links.push({ label: 'Problemas conocidos / reportar fallos', url: m.links.issuesUrl })
        if (m.links?.sourceUrl) d.links.push({ label: 'Código fuente', url: m.links.sourceUrl })
        try { d.body = htmlToText((await cfGet<{ data: string }>(`/v1/mods/${m.id}/description`)).data) } catch { /* sin descripción */ }
      })
    } catch { /* sin red */ }
  }
  for (const d of docs) if (d.meta?.source === 'fport1') d.source = 'Fport1'
  return docs
}

function configFilesFor(configDir: string, ids: string[]): string[] {
  try {
    const all = walk(configDir).map((f) => path.relative(configDir, f).replace(/\\/g, '/'))
    const keys = ids.map((i) => i.toLowerCase().replace(/[-_]/g, ''))
    return all.filter((f) => keys.some((k) => k.length >= 3 && f.toLowerCase().replace(/[-_]/g, '').includes(k))).slice(0, 30)
  } catch { return [] }
}

function walk(dir: string, depth = 0): string[] {
  if (depth > 4 || !fs.existsSync(dir)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(full, depth + 1))
    else out.push(full)
  }
  return out
}

function toolsSection(): string {
  return `## Herramientas del launcher (servidor MCP «modpack-launcher»)
Todo lo que hagas sobre esta instancia pasa por Modpack Launcher: el usuario ve cada acción en el launcher. Tu herramienta de IA te pedirá permiso para las que cambian algo; si el usuario lo deniega, respétalo y no intentes hacerlo por otra vía (moviendo archivos a mano, abriendo el juego por fuera…).

En Claude Code, Codex, Gemini CLI, Grok CLI, Cursor o VS Code las herramientas se cargan solas desde la configuración MCP de esta carpeta; en otras IAs usa la orden \`launcher\` de esta carpeta (\`launcher ayuda\`, \`launcher lanzar_juego\`, \`launcher listar_contenido tipo=mod\`…). Necesitan el launcher abierto.

- \`lanzar_juego\` — abre el juego desde el launcher y espera: devuelve si llegó al menú, crasheó o se cerró, con errores y crash report
- \`cerrar_juego\`, \`estado_juego\`, \`leer_log\`, \`crashes\`
- \`listar_contenido\` — mods (con ids, dependencias, fuente y proyecto), resource packs, shaders o datapacks de un mundo
- \`activar\`, \`quitar\` (a \`.ai/papelera\`), \`restaurar\` — para cualquier tipo (\`tipo\` = mod, resourcepack, shader, datapack)
- \`buscar\`, \`versiones\`, \`instalar\` (con \`reemplaza\` para cambiar de versión) — Modrinth y CurseForge
- \`copiar_archivo\` — el jar de un mod que estés programando o un pack .zip
- \`enlazar_proyecto\` — enlaza la carpeta de un proyecto de datapack, resource pack o shader para editar y recargar en el juego
- \`listar_archivos\`, \`leer_archivo\`, \`escribir_archivo\` — \`leer_archivo\` entiende cualquier formato: texto, JSON, NBT/.dat (en SNBT), regiones .mca, .zip/.jar/.rar (y lo de dentro), clases Java, modelos (Java, GeckoLib, Blockbench, OBJ) y esquemáticas (.nbt, .schem, .schematic, .litematic); \`escribir_archivo\` guarda copia en \`.ai/copias\`
- \`editar_nbt\` — cambia un valor de un NBT (level.dat, playerdata, estructuras) por su camino
- \`desofuscar\`, \`ver_clase\` — nombres reales en crashes y logs de versiones ofuscadas (hasta 1.21.11), y campos/métodos de cualquier clase del juego o de un mod
- \`registro\` — todo lo que existe en esta instancia (vanilla de esta versión + mods + datapacks): ítems, bloques, entidades, biomas, dimensiones, estructuras, recetas, loot tables, encantamientos, tags, texturas, modelos, sonidos, reglas…
- \`ver_recurso\` — el archivo real de cualquiera de ellos (JSON de un bioma o receta, modelo, textura, shader) para usarlo de base
- \`mundo\`, \`regla_mundo\`, \`copiar_mundo\` — cómo es un mundo (dimensiones, generación, reglas, estadísticas del jugador), cambiar reglas y hacer una copia para experimentar
- \`crear_proyecto\`, \`validar_pack\` — esqueleto correcto para esta versión (datapack, resource pack, shader, mod) y revisión antes de probar
- \`lecciones\` (por tipo y tema), \`anotar_leccion\`, \`valorar_leccion\` — lo aprendido aquí y por otros jugadores: crashes, configs, compatibilidad, construcción, mundo, rendimiento y mecánicas; lo que funciona sube y lo que falla baja
- \`experiencia_comunidad\` — cómo se comporta el juego con un mod en las partidas de otros jugadores (crashes, carga, lag, mods con los que se usa, dimensiones, mobs)
`
}

const LOADER_NAME: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', vanilla: 'Vanilla' }

function agentsMd(inst: Instance, fmt: { resource?: number; data?: number; java?: number }, docs: ModDoc[]): string {
  const loader = `${LOADER_NAME[inst.modloader] ?? inst.modloader}${inst.modloaderVersion ? ` ${inst.modloaderVersion}` : ''}`
  return `# ${inst.name} — contexto del modpack

> Generado por Modpack Launcher by Fport1. Se regenera desde el launcher (detalle de la instancia › «Preparar para IA»); no lo edites a mano: tus notas van en \`NOTAS.md\`.

## Datos que no se pueden cambiar ni suponer
- **Minecraft ${inst.minecraft}** (Java Edition)
- **Loader: ${loader}**${inst.modloader === 'vanilla' ? ' — sin mods, solo datapacks y resource packs' : ''}
${fmt.data ? `- **pack_format de datapacks: ${fmt.data}**` : '- pack_format de datapacks: aún no se conoce (abre el juego una vez desde el launcher y vuelve a preparar); mientras, consúltalo en la wiki para esta versión exacta'}
${fmt.resource ? `- **pack_format de resource packs: ${fmt.resource}**` : ''}
${fmt.java ? `- Java ${fmt.java}` : ''}
- ${docs.length} mods instalados (lista en \`.ai/mods.md\`, ficha de cada uno en \`.ai/mods/\`)

## Reglas para la IA
1. Todo lo que propongas tiene que funcionar en **Minecraft ${inst.minecraft} con ${LOADER_NAME[inst.modloader] ?? inst.modloader}**. No sugieras mods, APIs, sintaxis de comandos ni formatos de otras versiones o de otro loader. Si no estás seguro de que algo exista en esta versión, dilo y compruébalo antes.
2. Antes de usar un id (bloque, ítem, entidad, bioma, dimensión, receta, tag…) búscalo con la herramienta \`registro\`, y antes de escribir un JSON mira uno real de esta versión con \`ver_recurso\`. No inventes ids ni formatos: cambian entre versiones.
3. Antes de recomendar un mod nuevo, mira \`.ai/mods.md\` por si ya está, y revisa las incompatibilidades de cada ficha.
4. Los datapacks van en \`saves/<mundo>/datapacks/\` (se activan/desactivan desde el launcher o con \`/datapack\`) y usan el pack_format de arriba. Se recargan en el juego con \`/reload\`.
5. Los resource packs van en \`resourcepacks/\`, los shaders en \`shaderpacks/\` y las configuraciones de mods en \`config/\` (algunas se generan al abrir el juego por primera vez; mira \`.ai/mods/<mod>.md\` › «Archivos de configuración»).
6. Para tocar mods, packs o configs usa las herramientas del launcher (abajo) en vez de editar o mover archivos por tu cuenta: así el usuario lo ve en el launcher, se respetan sus permisos y todo se puede deshacer.
7. Antes de diagnosticar un fallo usa \`lecciones\` (las de este modpack y las de la comunidad); al arreglar algo, anótalo con \`anotar_leccion\`, y si usaste una lección de la comunidad, valórala con \`valorar_leccion\`.
8. Responde en el idioma de quien te escribe.

${toolsSection()}
## Mapa de la carpeta
- \`mods/\` — mods (.jar; los terminados en .disabled están desactivados)
- \`config/\` — configuración de mods
- \`saves/\` — mundos (${'`'}.ai/worlds.md${'`'} dice qué datapacks tiene cada uno)
- \`resourcepacks/\`, \`shaderpacks/\`
- \`logs/latest.log\`, \`crash-reports/\` — para diagnosticar fallos
- \`.ai/\` — contexto generado por el launcher (fichas de mods, mundos, packs)
- \`.claude/skills/\` — habilidades para Claude Code: arreglar crashes, rendimiento, construir (datapacks, mundos y worldgen, esquemáticas, mobs, mecánicas, resource packs, modelos, shaders, mods) y configs
- \`.ai/lecciones.md\` — lo aprendido en arreglos anteriores (lo mantiene la IA)
- \`.ai/papelera/\` — mods quitados por la IA (se pueden restaurar)
- \`.ai/proyectos/\` — proyectos creados con crear_proyecto; \`.ai/extraidos/\` — recursos sacados del juego con ver_recurso
`
}

function modsIndexMd(docs: ModDoc[]): string {
  const rows = docs
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((d) => {
      return `| ${d.title} | ${d.file.enabled ? 'sí' : 'no'} | ${d.source ?? 'archivo'} | ${d.file.meta?.modIds?.join(', ') ?? ''} | [ficha](mods/${slug(d.title)}.md) |`
    })
  return `# Mods instalados (${docs.length})

| Mod | Activo | Fuente | Id | Ficha |
|---|---|---|---|---|
${rows.join('\n')}
`
}

function modDocMd(d: ModDoc, facts: ReturnType<typeof jarFacts>, configs: string[], allDocs: ModDoc[]): string {
  const ids = d.file.meta?.modIds
  const requires = d.file.meta?.requires
  const requiredBy = allDocs.filter((x) => (x.file.meta?.requires ?? []).some((r: string) => ids?.includes(r))).map((x) => x.title)
  const lines = [
    `# ${d.title}`,
    '',
    d.summary ? `> ${d.summary}` : '',
    '',
    `- Archivo: \`mods/${d.file.filename}\`${d.file.enabled ? '' : ' (desactivado)'}`,
    facts.version ? `- Versión instalada: ${facts.version}` : '',
    ids?.length ? `- Id de mod: ${ids.join(', ')}` : '',
    d.source ? `- Fuente: ${d.source}` : '- Fuente: archivo sin identificar (no está en Modrinth, CurseForge ni Fport1)',
    d.clientSide ? `- Cliente: ${d.clientSide} · Servidor: ${d.serverSide}` : '',
    d.categories.length ? `- Categorías: ${d.categories.join(', ')}` : '',
    '',
    d.links.length ? '## Enlaces (wiki, fallos, código)\n' + d.links.map((l) => `- [${l.label}](${l.url})`).join('\n') : '',
    '',
    '## Dependencias',
    `- Necesita: ${requires?.length ? requires.join(', ') : 'nada más'}`,
    `- Lo necesitan: ${requiredBy.length ? requiredBy.join(', ') : 'ningún otro mod'}`,
    d.incompatible.length ? `- **Incompatible con:** ${d.incompatible.join(', ')}` : '',
    '',
    configs.length ? '## Archivos de configuración\n' + configs.map((c) => `- \`config/${c}\``).join('\n') : '## Archivos de configuración\n- Ninguno encontrado todavía (puede que se cree al abrir el juego)',
    '',
    '## Contenido del jar',
    facts.namespaces.length ? `- Espacios de nombres: ${facts.namespaces.join(', ')}` : '',
    facts.hasData ? '- Incluye datos (recetas, loot tables, tags) que se pueden modificar con un datapack' : '',
    facts.items.length ? `- Ítems (${facts.items.length}): ${facts.items.slice(0, 200).join(', ')}${facts.items.length > 200 ? '…' : ''}` : '',
    facts.blocks.length ? `- Bloques (${facts.blocks.length}): ${facts.blocks.slice(0, 200).join(', ')}${facts.blocks.length > 200 ? '…' : ''}` : '',
    facts.commandKeys.length ? `- Textos relacionados con comandos (pistas de sus comandos): ${facts.commandKeys.join(', ')}` : '',
    '',
    d.body ? '## Descripción del autor (comandos, configuración, uso)\n\n' + clip(d.body) : '',
  ]
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n') + '\n'
}


// Las de solo lectura se permiten sin preguntar; las que cambian algo no se
// listan, así que la IA pide permiso para cada una con su propio aviso (en
// Claude Code, «Sí» o «Sí, y no volver a preguntar»).
const READ_TOOLS = ['estado_juego', 'leer_log', 'crashes', 'listar_contenido', 'buscar', 'versiones', 'listar_archivos', 'leer_archivo', 'lecciones', 'anotar_leccion', 'valorar_leccion', 'registro', 'ver_recurso', 'mundo', 'validar_pack', 'experiencia_comunidad', 'desofuscar', 'ver_clase']

async function mergeJson(file: string, update: (cur: any) => any): Promise<void> {
  const cur = await fs.readJson(file).catch(() => ({}))
  await fs.outputFile(file, JSON.stringify(update(cur && typeof cur === 'object' ? cur : {}), null, 2) + '\n')
}

/** Conecta la carpeta del juego con el launcher para cada IA (MCP, permisos y la orden «launcher»). */
export async function writeToolConfigs(inst: Instance, gameDir: string): Promise<void> {
  const script = MCP_SCRIPT_FILE()
  const env = { ELECTRON_RUN_AS_NODE: '1', MODPACK_BRIDGE: BRIDGE_FILE(), MODPACK_INSTANCE: inst.id }
  const server = { command: process.execPath, args: [script], env }
  const withServer = (cur: any, key = 'mcpServers', extra: Record<string, unknown> = {}): any => ({ ...cur, [key]: { ...(cur[key] ?? {}), 'modpack-launcher': { ...extra, ...server } } })
  await fs.outputFile(script, MCP_SCRIPT)

  await mergeJson(path.join(gameDir, '.mcp.json'), (c) => withServer(c))                       // Claude Code
  await mergeJson(path.join(gameDir, '.cursor', 'mcp.json'), (c) => withServer(c))             // Cursor
  await mergeJson(path.join(gameDir, '.gemini', 'settings.json'), (c) => withServer(c))        // Gemini CLI
  await mergeJson(path.join(gameDir, '.vscode', 'mcp.json'), (c) => withServer(c, 'servers', { type: 'stdio' })) // Copilot en VS Code
  await mergeJson(path.join(gameDir, '.grok', 'settings.json'), (c) => withServer(c, 'mcpServers', { name: 'modpack-launcher', transport: 'stdio' })) // Grok CLI
  // Codex usa TOML: bloque propio que se reemplaza entero
  const codexFile = path.join(gameDir, '.codex', 'config.toml')
  const q = (v: string): string => JSON.stringify(v)
  const block = ['# >>> modpack-launcher', '[mcp_servers.modpack-launcher]', `command = ${q(process.execPath)}`, `args = [${q(script)}]`,
    `env = { ELECTRON_RUN_AS_NODE = "1", MODPACK_BRIDGE = ${q(env.MODPACK_BRIDGE)}, MODPACK_INSTANCE = ${q(inst.id)} }`, '# <<< modpack-launcher'].join('\n')
  const codexCur = (await fs.readFile(codexFile, 'utf8').catch(() => '')).replace(/# >>> modpack-launcher[\s\S]*?# <<< modpack-launcher\n?/, '')
  await fs.outputFile(codexFile, `${codexCur.trimEnd()}${codexCur.trim() ? '\n\n' : ''}${block}\n`)

  // Permisos de Claude Code: leer sin preguntar; cambiar, preguntando
  const mcp = (t: string): string => `mcp__modpack-launcher__${t}`
  await mergeJson(path.join(gameDir, '.claude', 'settings.json'), (c) => {
    const keep = (list: unknown): string[] => (Array.isArray(list) ? list : []).filter((x: string) => !x.startsWith('mcp__modpack-launcher__'))
    const allow = [...keep(c.permissions?.allow), ...READ_TOOLS.map(mcp)]
    const ask = keep(c.permissions?.ask)
    const deny = keep(c.permissions?.deny)
    return { ...c, enabledMcpjsonServers: [...new Set([...(c.enabledMcpjsonServers ?? []), 'modpack-launcher'])], permissions: { ...(c.permissions ?? {}), allow, ask, deny } }
  })

  // Orden «launcher» para IAs sin MCP (o para el propio usuario)
  await fs.writeFile(path.join(gameDir, 'launcher.cmd'),
    `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\nset MODPACK_BRIDGE=${env.MODPACK_BRIDGE}\r\nset MODPACK_INSTANCE=${inst.id}\r\n"${process.execPath}" "${script}" %*\r\n`)
  await fs.writeFile(path.join(gameDir, 'launcher'),
    `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 MODPACK_BRIDGE='${env.MODPACK_BRIDGE}' MODPACK_INSTANCE='${inst.id}' exec '${process.execPath}' '${script}' "$@"\n`, { mode: 0o755 })

  // Habilidades: se reescriben siempre para que sigan al launcher cuando se actualiza
  for (const [name, content] of Object.entries(SKILLS)) await fs.outputFile(path.join(gameDir, '.claude', 'skills', name, 'SKILL.md'), content)

  const lessons = path.join(gameDir, '.ai', 'lecciones.md')
  if (!(await fs.pathExists(lessons))) {
    await fs.outputFile(lessons, '# Lecciones aprendidas\n\nLo que la IA ha ido descubriendo al arreglar crashes y problemas de este modpack. Se lee antes de diagnosticar; se amplía con la herramienta anotar_leccion. El launcher no borra este archivo.\n')
  }
}

/** Qué hay en el juego de esta instancia: cuánto de cada cosa y lo que añaden los mods. */
async function gameMd(inst: Instance): Promise<string> {
  const { reg, vanilla } = await buildRegistry(inst)
  const kinds: [string, string[]][] = [
    ['Biomas', ['worldgen/biome']], ['Dimensiones', ['dimension']], ['Tipos de dimensión', ['dimension_type']], ['Estructuras', ['worldgen/structure']],
    ['Entidades', ['lang:entity']], ['Efectos', ['lang:effect']], ['Encantamientos', ['enchantment', 'lang:enchantment']],
    ['Bloques', ['assets:blockstates']], ['Ítems', ['assets:items', 'assets:models/item']], ['Recetas', ['recipe']], ['Loot tables', ['loot_table']],
  ]
  const lines = [`# Contenido del juego — Minecraft ${inst.minecraft} (${inst.modloader})`, '',
    vanilla ? '' : '> Falta el jar de esta versión: abre el juego una vez desde el launcher y vuelve a preparar para tener también lo vanilla.',
    'Todo esto se consulta completo, con ids exactos y nombres, con la herramienta `registro`, y el archivo real de cada cosa con `ver_recurso`.', '']
  for (const [label, types] of kinds) {
    const ids = [...new Set(types.flatMap((t) => (reg[t] ?? []).map((e) => e.id)))]
    const modded = ids.filter((id) => !id.startsWith('minecraft:'))
    lines.push(`## ${label}: ${ids.length}${modded.length ? ` (${modded.length} de mods)` : ''}`)
    if (modded.length && modded.length <= 120) lines.push(modded.join(', '))
    else if (modded.length) {
      const byNs: Record<string, number> = {}
      for (const id of modded) { const ns = id.split(':')[0]; byNs[ns] = (byNs[ns] ?? 0) + 1 }
      lines.push(Object.entries(byNs).map(([ns, n]) => `${ns}: ${n}`).join(', '))
    }
    lines.push('')
  }
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n')
}

async function stateHash(gameDir: string): Promise<string> {
  const mods = await fs.readdir(path.join(gameDir, 'mods')).catch(() => [] as string[])
  return crypto.createHash('sha1').update(mods.sort().join('|')).digest('hex')
}

export async function aiContextStatus(instanceId: string): Promise<AiContextStatus> {
  const gameDir = await getInstanceGameDir(instanceId)
  const state = await fs.readJson(path.join(gameDir, '.ai', 'state.json')).catch(() => null) as { generatedAt: number; hash: string; mods: number } | null
  if (!state) return { exists: false }
  return { exists: true, generatedAt: state.generatedAt, mods: state.mods, stale: state.hash !== await stateHash(gameDir) }
}

export async function prepareAiContext(instanceId: string, onProgress?: (msg: string) => void): Promise<AiContextStatus> {
  const inst = await getInstance(instanceId)
  if (!inst) throw new Error('Instancia no encontrada')
  const gameDir = await getInstanceGameDir(instanceId)
  const aiDir = path.join(gameDir, '.ai')
  await fs.ensureDir(path.join(aiDir, 'mods'))

  onProgress?.('Leyendo mods…')
  const mods = await listMods(instanceId)
  const fmt = await packFormats(inst.minecraft)
  onProgress?.('Consultando Modrinth y CurseForge…')
  const docs = await collectModDocs(inst, mods)

  onProgress?.('Escribiendo fichas de mods…')
  await fs.emptyDir(path.join(aiDir, 'mods'))
  const used = new Set<string>()
  for (const d of docs) {
    let name = slug(d.title)
    while (used.has(name)) name += '-2'
    used.add(name)
    const facts = jarFacts(path.join(gameDir, 'mods', d.file.filename))
    const ids = d.file.meta?.modIds ?? []
    await fs.writeFile(path.join(aiDir, 'mods', `${name}.md`), modDocMd(d, facts, configFilesFor(path.join(gameDir, 'config'), ids), docs))
  }
  await fs.writeFile(path.join(aiDir, 'mods.md'), modsIndexMd(docs))

  onProgress?.('Mundos y packs…')
  const worlds = await listWorlds(instanceId).catch(() => [])
  const worldLines: string[] = [`# Mundos (${worlds.length})`, '']
  for (const w of worlds) {
    const packs = await listWorldDatapacks(instanceId, w.name).catch(() => [])
    worldLines.push(`## ${w.name}`, `- Carpeta: \`saves/${w.name}/\``,
      `- Datapacks: ${packs.filter((p) => !p.builtIn).map((p) => `${p.filename}${p.enabled ? '' : ' (desactivado)'}`).join(', ') || 'ninguno'}`,
      `- Integrados activos: ${packs.filter((p) => p.builtIn && p.enabled).map((p) => p.id).join(', ') || 'vanilla'}`)
    const info = await worldInfo(inst, w.name).catch(() => null) as Record<string, any> | null
    if (info) {
      const dims = Object.entries(info.regionesExploradasPorDimension ?? {}).filter(([, n]) => (n as number) > 0).map(([d, n]) => `${d} (${n} regiones)`)
      worldLines.push(`- ${info.modo}, ${info.dificultad}${info.hardcore ? ', hardcore' : ''}${info.trucos ? ', con trucos' : ''} · versión ${info.version ?? '?'} · día ${info.tiempo?.dia ?? 0}`,
        `- Dimensiones definidas: ${Object.keys(info.dimensiones ?? {}).join(', ') || 'las de vanilla'}`,
        `- Exploradas: ${dims.join(', ') || 'ninguna todavía'}`,
        `- ${info.estadisticas?.minutosJugados ?? 0} min jugados, ${info.estadisticas?.muertes ?? 0} muertes · más matados: ${Object.keys(info.estadisticas?.mobsMatados ?? {}).slice(0, 6).join(', ') || '—'}`)
    }
    worldLines.push('', 'Detalle completo (reglas, generación de cada dimensión, estadísticas): herramienta \`mundo\`.', '')
  }
  await fs.writeFile(path.join(aiDir, 'worlds.md'), worldLines.join('\n'))

  onProgress?.('Contenido del juego…')
  await fs.writeFile(path.join(aiDir, 'juego.md'), await gameMd(inst))
  const rps = await listResourcepacks(instanceId).catch(() => [])
  const shaders = await listShaderpacks(instanceId).catch(() => [])
  await fs.writeFile(path.join(aiDir, 'packs.md'), `# Resource packs (${rps.length})\n\n${rps.map((r) => `- ${r.meta?.name || r.filename}${r.enabled ? '' : ' (desactivado)'}`).join('\n') || '- Ninguno'}\n\n# Shaders (${shaders.length})\n\n${shaders.map((r) => `- ${r.filename}`).join('\n') || '- Ninguno'}\n`)

  onProgress?.('Instrucciones para las IAs…')
  const agents = agentsMd(inst, fmt, docs).replace(/\n{3,}/g, '\n\n')
  await fs.writeFile(path.join(gameDir, 'AGENTS.md'), agents)
  // Cada herramienta busca su archivo; todos apuntan al mismo contenido
  await fs.writeFile(path.join(gameDir, 'CLAUDE.md'), '@AGENTS.md\n@NOTAS.md\n@.ai/lecciones.md\n\nUsa las habilidades de `.claude/skills/` (arreglar-crash, diagnostico, rendimiento, desarrollo, datapack, mundo, esquematicas, mobs, mecanicas, resourcepack, modelos, shader, mod, configs) cuando la tarea encaje, y las herramientas del servidor MCP `modpack-launcher` para lanzar el juego y cambiar mods.\n')
  await fs.writeFile(path.join(gameDir, 'GEMINI.md'), '@AGENTS.md\n')
  await fs.ensureDir(path.join(gameDir, '.github'))
  await fs.writeFile(path.join(gameDir, '.github', 'copilot-instructions.md'), agents)
  await fs.ensureDir(path.join(gameDir, '.cursor', 'rules'))
  await fs.writeFile(path.join(gameDir, '.cursor', 'rules', 'modpack.mdc'), `---\ndescription: Contexto del modpack (versión, loader, mods)\nalwaysApply: true\n---\n\n${agents}`)
  if (!(await fs.pathExists(path.join(gameDir, 'NOTAS.md')))) {
    await fs.writeFile(path.join(gameDir, 'NOTAS.md'), '# Notas del modpack\n\nEscribe aquí lo que quieras que la IA sepa y el launcher no puede saber (objetivos, estilo, reglas del servidor…). El launcher no toca este archivo.\n')
  }

  onProgress?.('Conectando con el launcher (MCP)…')
  await writeToolConfigs(inst, gameDir)

  const status = { generatedAt: Date.now(), hash: await stateHash(gameDir), mods: docs.length }
  await fs.writeJson(path.join(aiDir, 'state.json'), status)
  return { exists: true, generatedAt: status.generatedAt, mods: status.mods, stale: false }
}
