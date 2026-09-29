import axios from 'axios'
import fs from 'fs-extra'
import { cfFingerprint, cfPost, CF_GAME_MINECRAFT, CF_LOADER } from './curseforge'

// Identificar archivos que Modrinth no conoce: primero en las creaciones de
// Fport1 (por sha1) y después en CurseForge (por su huella). Así un mod que
// solo está en CurseForge sale con su nombre e icono en vez de como archivo.

export interface ExtraMeta {
  source: 'curseforge' | 'fport1'
  title?: string
  iconUrl?: string | null
  pageUrl?: string
  hasUpdate?: boolean
  clientSide?: string
  serverSide?: string
  /** Para actualizar sin pasar por Modrinth. */
  update?: { kind: 'curseforge'; modId: number; fileId: number } | { kind: 'fport1'; url: string; filename: string }
  cfModId?: number
  cfFileId?: number
  f1ProjectId?: string
  f1VersionId?: string
}

/** path para leer el archivo, o fingerprint ya calculado (servidores remotos). */
export interface FileToIdentify { name: string; path?: string; sha1: string; fingerprint?: number }

// ── Fport1 (Firestore por REST, lectura pública) ──────────────────────────

const FS_PROJECT = 'fport1-social'
const FS_KEY = 'AIzaSyBbQaYFl4a1Z3Mm-klrrJ3tQdRV53Cc77M'
const FS_ROOT = `projects/${FS_PROJECT}/databases/(default)/documents`

type FsValue = { stringValue?: string; integerValue?: string; booleanValue?: boolean; nullValue?: null; arrayValue?: { values?: FsValue[] }; mapValue?: { fields?: Record<string, FsValue> } }

function fsPlain(v: FsValue | undefined): unknown {
  if (!v) return undefined
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('booleanValue' in v) return v.booleanValue
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(fsPlain)
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue?.fields ?? {}).map(([k, x]) => [k, fsPlain(x)]))
  return null
}

async function fsBatchGet(paths: string[]): Promise<Record<string, Record<string, any>>> {
  if (!paths.length) return {}
  const out: Record<string, Record<string, any>> = {}
  try {
    const { data } = await axios.post(`https://firestore.googleapis.com/v1/${FS_ROOT}:batchGet?key=${FS_KEY}`,
      { documents: paths.map((p) => `${FS_ROOT}/${p}`) }, { timeout: 15_000 })
    for (const r of data as { found?: { name: string; fields?: Record<string, FsValue> } }[]) {
      if (!r.found) continue
      const rel = r.found.name.slice(FS_ROOT.length + 1)
      out[rel] = Object.fromEntries(Object.entries(r.found.fields ?? {}).map(([k, v]) => [k, fsPlain(v)]))
    }
  } catch { /* sin reglas o sin red: nada identificado */ }
  return out
}

async function identifyFport1(files: FileToIdentify[], mcVersion: string, loader: string): Promise<Record<string, ExtraMeta>> {
  const idx = await fsBatchGet(files.map((f) => `fport1_files/${f.sha1}`))
  const hits = files.map((f) => ({ f, i: idx[`fport1_files/${f.sha1}`] })).filter((x) => x.i?.projectId)
  if (!hits.length) return {}
  const projects = await fsBatchGet([...new Set(hits.map((h) => `fport1_projects/${h.i.projectId}`))])
  const out: Record<string, ExtraMeta> = {}
  for (const { f, i } of hits) {
    const p = projects[`fport1_projects/${i.projectId}`]
    if (!p) continue
    const latest = p.latestVersion as { id?: string; channel?: string } | null
    let update: ExtraMeta['update']
    if (latest?.id && latest.id !== i.versionId) {
      // La última versión solo cuenta como actualización si sirve para esta instancia
      const v = (await fsBatchGet([`fport1_projects/${i.projectId}/versions/${latest.id}`]))[`fport1_projects/${i.projectId}/versions/${latest.id}`]
      const ok = v && (!mcVersion || (v.gameVersions ?? []).includes(mcVersion)) &&
        (!loader || loader === 'vanilla' || !(v.loaders ?? []).length || (v.loaders ?? []).includes(loader))
      const file = (v?.files ?? [])[0] as { url?: string; filename?: string } | undefined
      if (ok && file?.url && file.filename) update = { kind: 'fport1', url: file.url, filename: file.filename }
    }
    out[f.name] = {
      source: 'fport1', title: p.title, iconUrl: p.iconUrl ?? null, f1ProjectId: i.projectId, f1VersionId: i.versionId,
      clientSide: p.clientSide, serverSide: p.serverSide, hasUpdate: !!update, update
    }
  }
  return out
}

// ── CurseForge ──────────────────────────────────────────────────────────────

// huella → { modId, fileId }, por ruta+tamaño+fecha para no releer archivos
const fpCache = new Map<string, number>()

async function fingerprintOf(file: string): Promise<number | null> {
  try {
    const st = await fs.stat(file)
    if (st.size > 300 * 1024 * 1024) return null
    const key = `${file}|${st.size}|${Math.round(st.mtimeMs)}`
    const hit = fpCache.get(key)
    if (hit !== undefined) return hit
    const fp = cfFingerprint(await fs.readFile(file))
    fpCache.set(key, fp)
    return fp
  } catch { return null }
}

interface CfMod {
  id: number; name: string; logo?: { thumbnailUrl?: string }; links?: { websiteUrl?: string }
  latestFilesIndexes?: { gameVersion: string; fileId: number; modLoader?: number; releaseType?: number }[]
}

async function identifyCurseForge(files: FileToIdentify[], mcVersion: string, loader: string): Promise<Record<string, ExtraMeta>> {
  const fps: { f: FileToIdentify; fp: number }[] = []
  for (const f of files) {
    const fp = f.fingerprint ?? (f.path ? await fingerprintOf(f.path) : null)
    if (fp !== null) fps.push({ f, fp })
  }
  if (!fps.length) return {}
  let matches: { id: number; file: { id: number; fileFingerprint: number } }[] = []
  try {
    const r = await cfPost<{ data?: { exactMatches?: typeof matches } }>(`/v1/fingerprints/${CF_GAME_MINECRAFT}`, { fingerprints: fps.map((x) => x.fp) })
    matches = r.data?.exactMatches ?? []
  } catch { return {} }
  if (!matches.length) return {}

  const mods = new Map<number, CfMod>()
  try {
    const r = await cfPost<{ data?: CfMod[] }>('/v1/mods', { modIds: [...new Set(matches.map((m) => m.id))] })
    for (const m of r.data ?? []) mods.set(m.id, m)
  } catch { /* sin detalles: al menos se sabe que es de CurseForge */ }

  const loaderId = CF_LOADER[loader]
  const out: Record<string, ExtraMeta> = {}
  for (const m of matches) {
    const f = fps.find((x) => x.fp === m.file.fileFingerprint)?.f
    if (!f) continue
    const mod = mods.get(m.id)
    // La más nueva publicada para esta versión (y loader, si es un mod)
    const candidates = (mod?.latestFilesIndexes ?? []).filter((ix) =>
      (!mcVersion || ix.gameVersion === mcVersion) && (!loaderId || !ix.modLoader || ix.modLoader === loaderId))
    const newest = candidates.sort((a, b) => b.fileId - a.fileId)[0]
    const update = newest && newest.fileId > m.file.id ? { kind: 'curseforge' as const, modId: m.id, fileId: newest.fileId } : undefined
    out[f.name] = {
      source: 'curseforge', title: mod?.name, iconUrl: mod?.logo?.thumbnailUrl ?? null, pageUrl: mod?.links?.websiteUrl,
      cfModId: m.id, cfFileId: m.file.id, hasUpdate: !!update, update
    }
  }
  return out
}

/** Busca en Fport1 y luego en CurseForge los archivos que Modrinth no reconoció. */
export async function identifyExtra(files: FileToIdentify[], mcVersion: string, loader: string): Promise<Record<string, ExtraMeta>> {
  if (!files.length) return {}
  const f1 = await identifyFport1(files, mcVersion, loader)
  const rest = files.filter((f) => !f1[f.name])
  const cf = await identifyCurseForge(rest, mcVersion, loader)
  return { ...f1, ...cf }
}

