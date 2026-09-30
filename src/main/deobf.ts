import fs from 'fs-extra'
import path from 'path'
import axios from 'axios'
import AdmZip from 'adm-zip'
import { getSharedDir } from './instances'

// Nombres ofuscados de Minecraft → nombres reales (los oficiales de Mojang).
//
// Hasta 1.21.11 el jar del juego está ofuscado: las clases se llaman «guu» o
// «fgi$a» y los métodos «a», «b»… En un crash de vanilla o de Forge antiguo
// salen esos nombres; en Fabric salen los intermedios («class_1234»,
// «method_5678», «field_91»). Desde 26.1 Mojang publica el juego sin ofuscar.
//
// Se usan los mapeos oficiales de Mojang (client_mappings del json de la
// versión) y, para Fabric, los intermedios (intermediary): intermedio → ofuscado
// → nombre de Mojang. Se descargan una vez por versión en shared/mappings.

interface Maps {
  obfuscated: boolean
  cls: Map<string, string>                    // ofuscada (con puntos) → real
  fields: Map<string, Map<string, string>>    // clase ofuscada → campo ofuscado → real
  methods: Map<string, Map<string, string>>   // clase ofuscada → «a(Lfzz;)V» → real
  methodsByName: Map<string, Map<string, string[]>> // clase ofuscada → «a» → reales posibles
  inter: Map<string, string>                  // class_/method_/field_N → real
}

const cache = new Map<string, Promise<Maps>>()

async function download(url: string, dest: string): Promise<void> {
  if (await fs.pathExists(dest)) return
  const { data } = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 60_000 })
  await fs.outputFile(dest + '.part', Buffer.from(data))
  await fs.move(dest + '.part', dest, { overwrite: true })
}

const PRIM: Record<string, string> = { byte: 'B', char: 'C', double: 'D', float: 'F', int: 'I', long: 'J', short: 'S', boolean: 'Z', void: 'V' }

function parseMojang(text: string): Omit<Maps, 'obfuscated' | 'inter'> {
  const cls = new Map<string, string>()
  const fields = new Map<string, Map<string, string>>()
  const methods = new Map<string, Map<string, string>>()
  const methodsByName = new Map<string, Map<string, string[]>>()
  const raw: { owner: string; obf: string; name: string; ret: string; args: string[] }[] = []
  let owner = ''
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    if (!line.startsWith(' ')) {
      const m = /^(\S+) -> (\S+):$/.exec(line.trim())
      if (m) { cls.set(m[2], m[1]); owner = m[2]; fields.set(owner, new Map()); methods.set(owner, new Map()); methodsByName.set(owner, new Map()) }
      continue
    }
    // Método: «    12:15:void tick(float,int) -> b»  ·  Campo: «    int size -> a»
    const mm = /^\s+(?:\d+:\d+:)?(\S+) ([\w$<>]+)\(([^)]*)\)(?::\d+:\d+)? -> ([\w$<>]+)$/.exec(line)
    if (mm) { raw.push({ owner, ret: mm[1], name: mm[2], args: mm[3] ? mm[3].split(',') : [], obf: mm[4] }); continue }
    const fm = /^\s+\S+ ([\w$]+) -> ([\w$]+)$/.exec(line)
    if (fm && owner) fields.get(owner)!.set(fm[2], fm[1])
  }
  // Descriptor JVM con los nombres OFUSCADOS (así vienen en los intermedios de Fabric)
  const reverse = new Map<string, string>()
  for (const [o, r] of cls) reverse.set(r, o)
  const jvm = (t: string): string => {
    let arr = ''
    while (t.endsWith('[]')) { arr += '['; t = t.slice(0, -2) }
    return arr + (PRIM[t] ?? `L${(reverse.get(t) ?? t).replace(/\./g, '/')};`)
  }
  for (const r of raw) {
    methods.get(r.owner)?.set(`${r.obf}(${r.args.map(jvm).join('')})${jvm(r.ret)}`, r.name)
    const byName = methodsByName.get(r.owner)
    if (byName) { const l = byName.get(r.obf) ?? []; if (!l.includes(r.name)) l.push(r.name); byName.set(r.obf, l) }
  }
  return { cls, fields, methods, methodsByName }
}

async function load(mc: string): Promise<Maps> {
  const shared = getSharedDir()
  const vjson = await fs.readJson(path.join(shared, 'versions', mc, `${mc}.json`)).catch(() => null)
  if (!vjson) throw new Error(`No está descargada la versión ${mc}: abre el juego una vez desde el launcher.`)
  const url = vjson.downloads?.client_mappings?.url
  if (!url) return { obfuscated: false, cls: new Map(), fields: new Map(), methods: new Map(), methodsByName: new Map(), inter: new Map() }
  const dir = path.join(shared, 'mappings', mc)
  const mojFile = path.join(dir, 'client.txt')
  await download(url, mojFile)
  const maps = parseMojang(await fs.readFile(mojFile, 'utf8'))
  // Intermedios de Fabric (si existen para esta versión): intermedio → ofuscado → real
  const inter = new Map<string, string>()
  try {
    const jar = path.join(dir, 'intermediary-v2.jar')
    await download(`https://maven.fabricmc.net/net/fabricmc/intermediary/${mc}/intermediary-${mc}-v2.jar`, jar)
    const tiny = new AdmZip(jar).getEntry('mappings/mappings.tiny')?.getData().toString('utf8') ?? ''
    let owner = ''
    for (const line of tiny.split('\n')) {
      const p = line.replace(/\r$/, '').split('\t')
      if (p[0] === 'c') {
        owner = p[1].replace(/\//g, '.')
        const real = maps.cls.get(owner)
        if (real) inter.set(p[2].split('/').pop()!, real)
      } else if (p[1] === 'm') {
        const real = maps.methods.get(owner)?.get(`${p[3]}${p[2]}`)
        if (real) inter.set(p[4], real)
      } else if (p[1] === 'f') {
        const real = maps.fields.get(owner)?.get(p[3])
        if (real) inter.set(p[4], real)
      }
    }
  } catch { /* sin intermedios: solo se traducen los nombres ofuscados */ }
  return { obfuscated: true, ...maps, inter }
}

export function getMappings(mc: string): Promise<Maps> {
  let p = cache.get(mc)
  if (!p) { p = load(mc); cache.set(mc, p); p.catch(() => cache.delete(mc)) }
  return p
}

/** Traduce un texto (crash, log, stack trace) a nombres reales. */
export async function deobfuscateText(mc: string, text: string): Promise<{ ofuscada: boolean; texto: string; cambios: number }> {
  const m = await getMappings(mc)
  if (!m.obfuscated) return { ofuscada: false, texto: text, cambios: 0 }
  let n = 0
  const simple = (real: string): string => real.split('.').pop()!
  // Nombre del archivo fuente en el stack trace: (class_310.java:12) → (Minecraft.java:12)
  let out = text.replace(/\((class_\d+)\.java:/g, (all, id: string) => { const r = m.inter.get(id); if (!r) return all; n++; return `(${simple(r)}.java:` })
  // Fabric: net.minecraft.class_1234 / method_1234 / field_1234 / comp_12
  out = out.replace(/\b(?:net\.minecraft\.)?(class_\d+|method_\d+|field_\d+|comp_\d+)\b/g, (all, id: string) => {
    const real = m.inter.get(id)
    if (!real) return all
    n++
    return real
  })
  // Vanilla ofuscado en stack traces: «at abc.a(SourceFile:12)» o «at abc$d.b(»
  out = out.replace(/\bat ([a-z]{1,4}(?:\$[\w]+)?)\.([\w$<>]+)\(/g, (all, owner: string, meth: string) => {
    const realCls = m.cls.get(owner)
    if (!realCls) return all
    n++
    const names = m.methodsByName.get(owner)?.get(meth) ?? []
    return `at ${realCls}.${names.length ? names.join('|') : meth}(`
  })
  return { ofuscada: true, texto: out, cambios: n }
}

/** Nombre real de una clase ofuscada (o ya real, que se devuelve tal cual). */
export async function realClassName(mc: string, name: string): Promise<string> {
  const m = await getMappings(mc)
  if (!m.obfuscated) return name
  return m.cls.get(name) ?? m.inter.get(name.split('.').pop() ?? '') ?? name
}

/** Busca la clase ofuscada que corresponde a un nombre real (para abrirla en el jar). */
export async function obfuscatedClassName(mc: string, real: string): Promise<string | null> {
  const m = await getMappings(mc)
  if (!m.obfuscated) return real
  for (const [obf, r] of m.cls) if (r === real) return obf
  for (const [obf, r] of m.cls) if (r.endsWith('.' + real)) return obf
  return null
}

/** Nombre real de un campo o método de una clase ofuscada (con su descriptor, si se sabe). */
export async function memberName(mc: string, ownerObf: string, member: string, desc?: string): Promise<string> {
  const m = await getMappings(mc)
  if (desc?.startsWith('(')) {
    const r = m.methods.get(ownerObf)?.get(member + desc)
    if (r) return r
    return m.methodsByName.get(ownerObf)?.get(member)?.join('|') ?? m.inter.get(member) ?? member
  }
  return m.fields.get(ownerObf)?.get(member) ?? m.inter.get(member) ?? member
}
