// Downloads bedrock-samples entity animations → { mobStem: { animName: anim } }
const https = require('https')
const fs = require('fs')

const API = 'https://api.github.com/repos/Mojang/bedrock-samples/contents/resource_pack/animations'

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

function normalizeAnim(a) {
  const bones = {}
  for (const [bone, ch] of Object.entries(a.bones ?? {})) {
    const e = {}
    if (ch.rotation !== undefined) e.rotation = ch.rotation
    if (ch.position !== undefined) e.position = ch.position
    if (Object.keys(e).length > 0) bones[bone.toLowerCase()] = e
  }
  const out = { bones }
  if (a.loop !== undefined) out.loop = a.loop
  if (a.animation_length !== undefined) out.animation_length = a.animation_length
  return out
}

// Mojang's JSON files contain // and /* */ comments and trailing commas
function parseJsonc(src) {
  let out = ''
  let inStr = false, inLine = false, inBlock = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1]
    if (inLine) { if (c === '\n') { inLine = false; out += c } continue }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++ } continue }
    if (inStr) { out += c; if (c === '\\') { out += n; i++ } else if (c === '"') inStr = false; continue }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === '/' && n === '/') { inLine = true; i++; continue }
    if (c === '/' && n === '*') { inBlock = true; i++; continue }
    out += c
  }
  return JSON.parse(out.replace(/,\s*([}\]])/g, '$1'))
}

// Matches bee.animation.json, wolf.animations.json, enderman.animation.v1.0.json…
const ANIM_FILE = /^(.+?)\.animations?(\.v[\d.]+)?\.json$/

async function main() {
  const listing = JSON.parse(await get(API))
  const files = listing
    .map(f => ({ ...f, m: f.name.match(ANIM_FILE) }))
    .filter(f => f.m && !f.name.startsWith('dressing_room'))
    // legacy .v1.0 first so the modern file overwrites/extends it
    .sort((a, b) => (a.m[2] ? 0 : 1) - (b.m[2] ? 0 : 1))
  console.log('animation files:', files.length)
  const out = {}
  let done = 0
  for (let i = 0; i < files.length; i += 12) {
    await Promise.all(files.slice(i, i + 12).map(async f => {
      try {
        const json = parseJsonc(await get(f.download_url))
        const stem = f.m[1]
        const anims = {}
        for (const [id, a] of Object.entries(json.animations ?? {})) {
          if (!a || typeof a !== 'object' || !a.bones) continue
          // "animation.spider.default_leg_pose" → "default_leg_pose"
          const short = id.replace(/^animation\.[^.]+\./, '').replace(/^animation\./, '')
          const norm = normalizeAnim(a)
          if (Object.keys(norm.bones).length > 0) anims[short] = norm
        }
        if (Object.keys(anims).length > 0) out[stem] = { ...(out[stem] ?? {}), ...anims }
      } catch (e) { console.warn('fail:', f.name, e.message) }
      done++
    }))
    process.stdout.write(`\r${done}/${files.length}`)
  }
  console.log()
  const outPath = process.argv[2]
  fs.writeFileSync(outPath, JSON.stringify(out))
  console.log(`mobs con animaciones: ${Object.keys(out).length} → ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`)
  console.log('spider:', Object.keys(out.spider ?? {}), '| blaze:', Object.keys(out.blaze ?? {}), '| wolf:', Object.keys(out.wolf ?? {}))
}

main().catch(e => { console.error(e); process.exit(1) })
