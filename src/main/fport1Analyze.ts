import AdmZip from 'adm-zip'

// Lee el archivo que se va a publicar en «Mis creaciones» y saca lo que hasta
// ahora había que escribir a mano: número de versión, loaders, versiones de
// Minecraft y dependencias.
//
// - .jar de mod: fabric.mod.json / quilt.mod.json / META-INF/neoforge.mods.toml / META-INF/mods.toml
// - .jar de plugin: plugin.yml / paper-plugin.yml / velocity-plugin.json
// - .mrpack: modrinth.index.json
// - .fpack: manifest.json (o el formato con enlace)
// - .zip de resource pack o datapack: pack.mcmeta (pack_format → versiones)
//
// Las versiones de Minecraft salen como un RANGO; el panel lo cruza con la
// lista oficial de versiones para marcar las que entran.

export interface UploadAnalysis {
  versionNumber?: string
  name?: string
  loaders: string[]
  /** Rango tal cual lo declara el archivo (para enseñarlo) */
  minecraftRange?: string
  /** Versiones exactas, cuando el archivo las dice (mrpack, fpack) */
  minecraftExact?: string[]
  /** Formato del pack (resource pack o datapack) y versiones que le corresponden */
  packFormat?: number
  packKind?: 'resource' | 'data'
  /** Dependencias: id del mod (que suele coincidir con su slug de Modrinth) */
  dependencies: { id: string; type: 'required' | 'optional' }[]
  notas: string[]
}

/** Dependencias que no son mods que haya que instalar */
const NOT_DEPS = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt-loader', 'neoforge', 'forge', 'fml', 'javafml'])
/** Ids de mod cuyo proyecto en Modrinth se llama distinto */
const ID_TO_SLUG: Record<string, string> = { fabric: 'fabric-api', 'fabric-api-base': 'fabric-api', quilted_fabric_api: 'qsl', 'cloth-config2': 'cloth-config', cloth_config: 'cloth-config', modmenu: 'modmenu', geckolib: 'geckolib', architectury: 'architectury-api', 'fabric-language-kotlin': 'fabric-language-kotlin' }

const slug = (id: string): string => ID_TO_SLUG[id] ?? id

function addDep(out: UploadAnalysis, id: string, type: 'required' | 'optional'): void {
  const clean = id.trim().toLowerCase()
  if (!clean || NOT_DEPS.has(clean) || clean.startsWith('fabric-') && clean !== 'fabric-api' && clean !== 'fabric-language-kotlin') return
  const s = slug(clean)
  const prev = out.dependencies.find((d) => d.id === s)
  if (prev) { if (type === 'required') prev.type = 'required'; return }
  out.dependencies.push({ id: s, type })
}

const placeholder = (v: unknown): boolean => typeof v !== 'string' || !v.trim() || /\$\{/.test(v)

function readJson(zip: AdmZip, name: string): any {
  const e = zip.getEntry(name)
  if (!e) return null
  try { return JSON.parse(e.getData().toString('utf8').replace(/^﻿/, '')) } catch { return null }
}

const text = (zip: AdmZip, name: string): string | null => zip.getEntry(name)?.getData().toString('utf8') ?? null

/**
 * TOML mínimo para mods.toml: tablas [[mods]] y [[dependencies.x]] con
 * claves simples (cadenas, booleanos). Basta para lo que hace falta aquí.
 */
function parseModsToml(src: string): { mods: Record<string, string>[]; deps: Record<string, string>[] } {
  const mods: Record<string, string>[] = []
  const deps: Record<string, string>[] = []
  let cur: Record<string, string> | null = null
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#')) continue
    const table = /^\[\[\s*([\w.]+)\s*\]\]$/.exec(line)
    if (table) {
      cur = {}
      if (table[1] === 'mods') mods.push(cur)
      else if (table[1].startsWith('dependencies')) { cur.__owner = table[1].split('.')[1] ?? ''; deps.push(cur) }
      else cur = null
      continue
    }
    if (/^\[/.test(line)) { cur = null; continue }
    const kv = /^([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(line)
    if (kv && cur) cur[kv[1]] = kv[2] ?? kv[3] ?? kv[4]
  }
  return { mods, deps }
}

/** pack_format → versiones (releases). Hasta 1.21.8; lo más nuevo se deja sin marcar. */
const RESOURCE_FORMATS: Record<number, string[]> = {
  4: ['1.13', '1.13.1', '1.13.2', '1.14', '1.14.1', '1.14.2', '1.14.3', '1.14.4'], 5: ['1.15', '1.15.1', '1.15.2', '1.16', '1.16.1'], 6: ['1.16.2', '1.16.3', '1.16.4', '1.16.5'],
  7: ['1.17', '1.17.1'], 8: ['1.18', '1.18.1', '1.18.2'], 9: ['1.19', '1.19.1', '1.19.2'], 12: ['1.19.3'], 13: ['1.19.4'], 15: ['1.20', '1.20.1'], 18: ['1.20.2'],
  22: ['1.20.3', '1.20.4'], 32: ['1.20.5', '1.20.6'], 34: ['1.21', '1.21.1'], 42: ['1.21.2', '1.21.3'], 46: ['1.21.4'], 55: ['1.21.5'], 63: ['1.21.6'], 64: ['1.21.7', '1.21.8'],
}
const DATA_FORMATS: Record<number, string[]> = {
  4: ['1.13', '1.13.1', '1.13.2', '1.14', '1.14.1', '1.14.2', '1.14.3', '1.14.4'], 5: ['1.15', '1.15.1', '1.15.2', '1.16', '1.16.1'], 6: ['1.16.2', '1.16.3', '1.16.4', '1.16.5'],
  7: ['1.17', '1.17.1'], 8: ['1.18', '1.18.1'], 9: ['1.18.2'], 10: ['1.19', '1.19.1', '1.19.2', '1.19.3'], 12: ['1.19.4'], 15: ['1.20', '1.20.1'], 18: ['1.20.2'],
  26: ['1.20.3', '1.20.4'], 41: ['1.20.5', '1.20.6'], 48: ['1.21', '1.21.1'], 57: ['1.21.2', '1.21.3'], 61: ['1.21.4'], 71: ['1.21.5'], 80: ['1.21.6'], 81: ['1.21.7', '1.21.8'],
}

/** Versiones que corresponden a un formato (o a un rango de formatos de supported_formats). */
export function versionsForPackFormat(kind: 'resource' | 'data', min: number, max = min): string[] {
  const table = kind === 'resource' ? RESOURCE_FORMATS : DATA_FORMATS
  return Object.entries(table).filter(([f]) => Number(f) >= min && Number(f) <= max).flatMap(([, v]) => v)
}

export function analyzeUpload(fileName: string, data: ArrayBuffer): UploadAnalysis {
  const out: UploadAnalysis = { loaders: [], dependencies: [], notas: [] }
  const lower = fileName.toLowerCase()
  const buf = Buffer.from(data)
  // .fpack con enlace (JSON pequeño, no zip)
  if (lower.endsWith('.fpack') && buf[0] === 0x7b) {
    out.notas.push('Es un .fpack con enlace: las versiones salen del modpack al que apunta.')
    return out
  }
  let zip: AdmZip
  try { zip = new AdmZip(buf) } catch { out.notas.push('No se pudo abrir el archivo (no parece un zip/jar).'); return out }

  // ── Mods ──
  const fabric = readJson(zip, 'fabric.mod.json')
  const quilt = readJson(zip, 'quilt.mod.json')
  if (fabric) {
    out.loaders.push('fabric')
    if (!placeholder(fabric.version)) out.versionNumber = fabric.version
    if (typeof fabric.name === 'string') out.name = fabric.name
    const mc = fabric.depends?.minecraft
    if (mc) out.minecraftRange = Array.isArray(mc) ? mc.join(' || ') : String(mc)
    for (const id of Object.keys(fabric.depends ?? {})) addDep(out, id, 'required')
    for (const id of [...Object.keys(fabric.recommends ?? {}), ...Object.keys(fabric.suggests ?? {})]) addDep(out, id, 'optional')
  }
  if (quilt) {
    out.loaders.push('quilt')
    const q = quilt.quilt_loader ?? {}
    if (!out.versionNumber && !placeholder(q.version)) out.versionNumber = q.version
    for (const d of q.depends ?? []) {
      const id = typeof d === 'string' ? d : d?.id
      if (id === 'minecraft' && typeof d === 'object' && d.versions) out.minecraftRange ??= Array.isArray(d.versions) ? d.versions.join(' || ') : String(d.versions)
      if (id) addDep(out, id, typeof d === 'object' && d.optional ? 'optional' : 'required')
    }
  }
  for (const [file, loader] of [['META-INF/neoforge.mods.toml', 'neoforge'], ['META-INF/mods.toml', 'forge']] as const) {
    const src = text(zip, file)
    if (!src) continue
    out.loaders.push(loader)
    const { mods, deps } = parseModsToml(src)
    const main = mods[0] ?? {}
    let version = main.version
    if (placeholder(version)) version = /Implementation-Version:\s*(\S+)/.exec(text(zip, 'META-INF/MANIFEST.MF') ?? '')?.[1] ?? ''
    if (!out.versionNumber && version && !placeholder(version)) out.versionNumber = version
    if (!out.name && main.displayName) out.name = main.displayName
    const ownMods = new Set(mods.map((m) => m.modId))
    for (const d of deps) {
      if (d.__owner && !ownMods.has(d.__owner)) continue
      if (d.modId === 'minecraft' && d.versionRange) out.minecraftRange ??= d.versionRange
      // NeoForge: type = required|optional|incompatible|discouraged; Forge antiguo: mandatory = true|false
      const type = d.type ? d.type.toLowerCase() : d.mandatory === 'false' ? 'optional' : 'required'
      if (type === 'required' || type === 'optional') addDep(out, d.modId ?? '', type)
    }
  }

  // ── Plugins ──
  const pluginYml = text(zip, 'paper-plugin.yml') ?? text(zip, 'plugin.yml')
  if (pluginYml) {
    const get = (k: string): string | undefined => new RegExp(`^${k}:\\s*['"]?([^'"\\n]+)`, 'm').exec(pluginYml)?.[1]?.trim()
    const list = (k: string): string[] => {
      const inline = new RegExp(`^${k}:\\s*\\[([^\\]]*)\\]`, 'm').exec(pluginYml)?.[1]
      if (inline !== undefined) return inline.split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean)
      const block = new RegExp(`^${k}:\\s*\\n((?:\\s+-\\s*.+\\n?)+)`, 'm').exec(pluginYml)?.[1]
      return block ? block.split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim().replace(/['"]/g, '')).filter(Boolean) : []
    }
    out.loaders.push(text(zip, 'paper-plugin.yml') ? 'paper' : 'spigot')
    if (!out.loaders.includes('paper')) out.loaders.push('paper')
    const v = get('version'); if (v && !placeholder(v)) out.versionNumber ??= v
    out.name ??= get('name')
    const api = get('api-version')
    if (api) out.minecraftRange = `>=${api}`
    for (const d of list('depend')) addDep(out, d, 'required')
    for (const d of list('softdepend')) addDep(out, d, 'optional')
  }
  const velocity = readJson(zip, 'velocity-plugin.json')
  if (velocity) {
    out.loaders.push('velocity')
    if (!placeholder(velocity.version)) out.versionNumber ??= velocity.version
    for (const d of velocity.dependencies ?? []) addDep(out, d.id, d.optional ? 'optional' : 'required')
  }

  // ── Modpacks ──
  const mrIndex = readJson(zip, 'modrinth.index.json')
  if (mrIndex) {
    const deps = mrIndex.dependencies ?? {}
    if (deps.minecraft) out.minecraftExact = [String(deps.minecraft)]
    for (const [k, l] of [['fabric-loader', 'fabric'], ['quilt-loader', 'quilt'], ['neoforge', 'neoforge'], ['forge', 'forge']]) if (deps[k]) out.loaders.push(l)
    if (!out.loaders.length) out.loaders.push('vanilla')
    if (!placeholder(mrIndex.versionId)) out.versionNumber ??= mrIndex.versionId
    out.name ??= mrIndex.name
  }
  const fpack = lower.endsWith('.fpack') ? readJson(zip, 'manifest.json') : null
  if (fpack) {
    if (fpack.minecraft) out.minecraftExact = [String(fpack.minecraft)]
    if (fpack.modloader) out.loaders.push(String(fpack.modloader))
    if (!placeholder(fpack.version)) out.versionNumber ??= fpack.version
    out.name ??= fpack.name
  }

  // ── Resource packs y datapacks ──
  const mcmeta = readJson(zip, 'pack.mcmeta')
  if (mcmeta?.pack && !fabric && !quilt && !out.loaders.includes('neoforge') && !out.loaders.includes('forge')) {
    const hasData = zip.getEntries().some((e) => /^data\//.test(e.entryName))
    const kind: 'resource' | 'data' = hasData ? 'data' : 'resource'
    const f = Number(mcmeta.pack.pack_format)
    const sf = mcmeta.pack.supported_formats
    const range = Array.isArray(sf) ? [Number(sf[0]), Number(sf[1])] : sf && typeof sf === 'object' ? [Number(sf.min_inclusive), Number(sf.max_inclusive)] : typeof sf === 'number' ? [sf, sf] : null
    // 1.21.9+ usa min_format / max_format
    const minF = Number(mcmeta.pack.min_format ?? range?.[0] ?? f)
    const maxF = Number(mcmeta.pack.max_format ?? range?.[1] ?? f)
    if (Number.isFinite(minF)) {
      out.packFormat = f || minF
      out.packKind = kind
      out.minecraftExact = versionsForPackFormat(kind, minF, Number.isFinite(maxF) ? maxF : minF)
      if (!out.minecraftExact.length) out.notas.push(`pack_format ${out.packFormat}: versión demasiado nueva para la tabla del launcher; marca las versiones a mano.`)
    }
  }
  const shaders = zip.getEntries().some((e) => /^shaders\//.test(e.entryName))
  if (shaders && !out.loaders.length) { out.loaders.push('iris', 'optifine'); out.notas.push('Shader: el archivo no dice versiones de Minecraft; suelen valer para muchas.') }

  out.loaders = [...new Set(out.loaders)]
  return out
}

// ── Rangos de versiones ─────────────────────────────────────────────────────

const parts = (v: string): number[] => v.split(/[.-]/).map((x) => parseInt(x, 10)).map((n) => (Number.isFinite(n) ? n : 0))
export function cmpMc(a: string, b: string): number {
  const x = parts(a), y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/** ¿Entra la versión en el rango? Acepta el formato de Fabric (>=1.21 <1.22, ~1.21.1, 1.21.x, ||) y el de Maven de Forge ([1.21.1,1.22)). */
export function inMcRange(version: string, range: string): boolean {
  const r = range.trim()
  if (!r || r === '*') return true
  // Maven: [a,b) (a,b] [a,) ... varios separados por comas fuera de corchetes
  if (/^[[(]/.test(r)) {
    const groups = r.match(/[[(][^\])]*[\])]/g) ?? []
    return groups.some((g) => {
      const [lo, hi] = g.slice(1, -1).split(',').map((s) => s.trim())
      const loOk = !lo || (g[0] === '[' ? cmpMc(version, lo) >= 0 : cmpMc(version, lo) > 0)
      if (hi === undefined) return cmpMc(version, lo) === 0 // [1.21.1] = exacta
      const hiOk = !hi || (g.endsWith(']') ? cmpMc(version, hi) <= 0 : cmpMc(version, hi) < 0)
      return loOk && hiOk
    })
  }
  return r.split('||').some((alt) => alt.trim().split(/\s+/).filter(Boolean).every((tok) => {
    const m = /^(>=|<=|>|<|=|~|\^)?(.+)$/.exec(tok)
    if (!m) return false
    const op = m[1] ?? '', v = m[2]
    if (/x|\*/i.test(v)) { const pre = v.replace(/\.?[x*].*$/i, ''); return version === pre || version.startsWith(pre + '.') }
    const c = cmpMc(version, v)
    if (op === '>=') return c >= 0
    if (op === '<=') return c <= 0
    if (op === '>') return c > 0
    if (op === '<') return c < 0
    if (op === '~') { const p = parts(v); return c >= 0 && parts(version)[0] === p[0] && parts(version)[1] === p[1] }
    if (op === '^') return c >= 0 && parts(version)[0] === parts(v)[0]
    return c === 0
  }))
}
