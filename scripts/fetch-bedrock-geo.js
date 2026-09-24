// Downloads Mojang bedrock-samples entity geometry and merges it into one
// dataset for the launcher: { name: { texW, texH, bones } }
const https = require('https')
const fs = require('fs')

const RAW = 'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/models'
const API_TREE = 'https://api.github.com/repos/Mojang/bedrock-samples/contents/resource_pack/models/entity'

function getOnce(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ModpackLauncher' } }, res => {
      if (res.statusCode !== 200) { reject(new Error(`${res.statusCode} ${url}`)); res.resume(); return }
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

async function get(url, retries = 3) {
  for (let i = 0; ; i++) {
    try { return await getOnce(url) } catch (e) {
      if (i >= retries) throw e
      await new Promise(r => setTimeout(r, 800 * (i + 1)))
    }
  }
}

const SKIP = /^(.*armor|chalkboard|agent$|npc$|v1$)/

function shortName(id) {
  // "geometry.pig.v1.8" → pig ; "geometry.villager_v2" → villager_v2
  let n = id.replace(/^geometry\./, '')
  n = n.replace(/\.v\d+(\.\d+)*$/, '')
  return n.replace(/\./g, '_')
}

function normalizeBones(bones) {
  return (bones ?? []).map(b => ({
    name: b.name,
    parent: b.parent,
    pivot: b.pivot,
    // rot propagates to children (skeleton); bindRot poses only the bone itself
    rot: b.rotation,
    bindRot: b.bind_pose_rotation,
    mirror: b.mirror,
    cubes: (b.cubes ?? []).map(c => ({
      origin: c.origin, size: c.size, uv: c.uv,
      inflate: c.inflate, mirror: c.mirror,
      pivot: c.pivot, rotation: c.rotation,
    })),
  }))
}

function extract(json, out, sourceName) {
  if (Array.isArray(json['minecraft:geometry'])) {
    for (const g of json['minecraft:geometry']) {
      const id = g.description?.identifier ?? `geometry.${sourceName}`
      const name = shortName(id)
      if (SKIP.test(name)) continue
      out[name] = {
        texW: g.description?.texture_width ?? 64,
        texH: g.description?.texture_height ?? 32,
        bones: normalizeBones(g.bones),
      }
    }
    return
  }
  for (const [key, g] of Object.entries(json)) {
    if (!key.startsWith('geometry.') || typeof g !== 'object') continue
    const [base, parentId] = key.split(':')
    const name = shortName(base)
    if (SKIP.test(name)) continue
    if (parentId) {
      // Inherited geometry (e.g. geometry.sheep:geometry.sheep.sheared) — resolve later
      pendingInherits.push({ name, parent: shortName(parentId), g })
      continue
    }
    if (!g.bones) continue
    out[name] = {
      texW: g.texturewidth ?? 64,
      texH: g.textureheight ?? 32,
      bones: normalizeBones(g.bones),
    }
  }
}

const pendingInherits = []

function resolveInherits(out) {
  // Child entries often redeclare bones as stubs (name only) just to tweak the
  // pose — merge field-by-field, keeping the parent's cubes/pivot when missing.
  const mergeBone = (bb, ob) => ({
    name: ob.name,
    parent: ob.parent ?? bb?.parent,
    pivot: ob.pivot ?? bb?.pivot,
    rot: ob.rot ?? bb?.rot,
    bindRot: ob.bindRot ?? bb?.bindRot,
    mirror: ob.mirror ?? bb?.mirror,
    cubes: (ob.cubes && ob.cubes.length > 0 ? ob.cubes : bb?.cubes) ?? [],
  })
  // Multiple passes so chains (A:B, B:C) resolve
  for (let pass = 0; pass < 3; pass++) {
    for (const { name, parent, g } of pendingInherits) {
      const base = out[parent]
      if (!base) continue
      const own = normalizeBones(g.bones ?? [])
      const byName = new Map(own.map(b => [b.name, b]))
      const bones = base.bones.map(bb => (byName.has(bb.name) ? mergeBone(bb, byName.get(bb.name)) : bb))
      for (const ob of own) {
        if (!base.bones.some(bb => bb.name === ob.name)) bones.push(mergeBone(undefined, ob))
      }
      out[name] = {
        texW: g.texturewidth ?? base.texW,
        texH: g.textureheight ?? base.texH,
        bones,
      }
    }
  }
}

async function main() {
  const out = {}

  // Legacy combined file first (entity/*.geo.json overrides it)
  extract(JSON.parse(await get(`${RAW}/mobs.json`)), out, 'mobs')

  const listing = JSON.parse(await get(API_TREE))
  const files = listing.filter(f => f.name.endsWith('.geo.json') && !SKIP.test(f.name.replace('.geo.json', '')))
  console.log(`legacy geometries: ${Object.keys(out).length}; entity files: ${files.length}`)

  let done = 0
  for (let i = 0; i < files.length; i += 12) {
    await Promise.all(files.slice(i, i + 12).map(async f => {
      try {
        extract(JSON.parse(await get(f.download_url)), out, f.name.replace('.geo.json', ''))
      } catch (e) { console.warn('fail:', f.name, e.message) }
      done++
    }))
    process.stdout.write(`\r${done}/${files.length}`)
  }
  console.log()

  resolveInherits(out)

  const outPath = process.argv[2]
  fs.writeFileSync(outPath, JSON.stringify(out))
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0)
  console.log(`geometries: ${Object.keys(out).length} → ${outPath} (${kb} KB)`)
  console.log('sample keys:', Object.keys(out).filter(k => /villager|horse|ghast|spider|cow|warden|armadillo/.test(k)).join(', '))
}

main().catch(e => { console.error(e); process.exit(1) })
