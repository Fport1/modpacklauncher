import axios from 'axios'

// Firestore de fport1social por REST, sin iniciar sesión: solo llega a lo que
// las reglas de fport1web dejan a cualquiera (catálogo publicado, estadísticas
// anónimas, lecciones de la IA…). La clave es la pública de la app web.

const FS_PROJECT = 'fport1-social'
export const FS_KEY = 'AIzaSyBbQaYFl4a1Z3Mm-klrrJ3tQdRV53Cc77M'
export const FS_ROOT = `projects/${FS_PROJECT}/databases/(default)/documents`
const BASE = `https://firestore.googleapis.com/v1/${FS_ROOT}`

export type FsValue = {
  stringValue?: string; integerValue?: string; doubleValue?: number; booleanValue?: boolean; nullValue?: null
  timestampValue?: string; arrayValue?: { values?: FsValue[] }; mapValue?: { fields?: Record<string, FsValue> }
}

export function fsPlain(v: FsValue | undefined): unknown {
  if (!v) return undefined
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('timestampValue' in v) return v.timestampValue
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(fsPlain)
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue?.fields ?? {}).map(([k, x]) => [k, fsPlain(x)]))
  return null
}

/** Valor JS → valor de Firestore (enteros como integerValue). */
export function fsValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (v instanceof Date) return { timestampValue: v.toISOString() }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fsValue(x)])) } }
}

const docFields = (fields?: Record<string, FsValue>): Record<string, any> =>
  Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, fsPlain(v)]))

export async function fsBatchGet(paths: string[]): Promise<Record<string, Record<string, any>>> {
  if (!paths.length) return {}
  const out: Record<string, Record<string, any>> = {}
  try {
    const { data } = await axios.post(`${BASE}:batchGet?key=${FS_KEY}`, { documents: paths.map((p) => `${FS_ROOT}/${p}`) }, { timeout: 15_000 })
    for (const r of data as { found?: { name: string; fields?: Record<string, FsValue> } }[]) {
      if (r.found) out[r.found.name.slice(FS_ROOT.length + 1)] = docFields(r.found.fields)
    }
  } catch { /* sin reglas o sin red: nada */ }
  return out
}

export interface FsFilter { field: string; op: 'EQUAL' | 'ARRAY_CONTAINS_ANY' | 'IN' | 'GREATER_THAN_OR_EQUAL'; value: FsValue }

/** Consulta de una colección (runQuery). parent = '' para la raíz o la ruta de un documento. */
export async function fsRunQuery(parent: string, collectionId: string, filters: FsFilter[] = [], opts: { limit?: number; orderBy?: { field: string; desc?: boolean } } = {}): Promise<{ id: string; data: Record<string, any> }[]> {
  const structuredQuery: Record<string, unknown> = { from: [{ collectionId }] }
  const ff = filters.map((f) => ({ fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: f.value } }))
  if (ff.length === 1) structuredQuery.where = ff[0]
  else if (ff.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters: ff } }
  if (opts.orderBy) structuredQuery.orderBy = [{ field: { fieldPath: opts.orderBy.field }, direction: opts.orderBy.desc ? 'DESCENDING' : 'ASCENDING' }]
  if (opts.limit) structuredQuery.limit = opts.limit
  const { data } = await axios.post(`${BASE}${parent ? '/' + parent : ''}:runQuery?key=${FS_KEY}`, { structuredQuery }, { timeout: 15_000 })
  return (data as { document?: { name: string; fields?: Record<string, FsValue> } }[])
    .filter((r) => r.document)
    .map((r) => ({ id: r.document!.name.split('/').pop()!, data: docFields(r.document!.fields) }))
}

export interface FsWrite {
  path: string
  /** Campos que se fijan tal cual. */
  set?: Record<string, unknown>
  /** Campos que se suman (increment). */
  inc?: Record<string, number>
  /** Campos que toman la hora del servidor. */
  now?: string[]
  /** Solo si el documento aún no existe (para crear sin pisar). */
  mustNotExist?: boolean
}

/** Escribe varios documentos a la vez (upsert con sumas atómicas). */
export async function fsCommit(writes: FsWrite[]): Promise<void> {
  const body = {
    writes: writes.map((w) => {
      const fields = Object.fromEntries(Object.entries(w.set ?? {}).map(([k, v]) => [k, fsValue(v)]))
      const transforms = [
        ...Object.entries(w.inc ?? {}).map(([k, n]) => ({ fieldPath: k, increment: fsValue(n) })),
        ...(w.now ?? []).map((k) => ({ fieldPath: k, setToServerValue: 'REQUEST_TIME' })),
      ]
      return {
        update: { name: `${FS_ROOT}/${w.path}`, fields },
        updateMask: { fieldPaths: Object.keys(fields).map((k) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `\`${k}\``)) },
        ...(transforms.length ? { updateTransforms: transforms } : {}),
        ...(w.mustNotExist ? { currentDocument: { exists: false } } : {}),
      }
    }),
  }
  await axios.post(`${BASE}:commit?key=${FS_KEY}`, body, { timeout: 15_000 })
}
