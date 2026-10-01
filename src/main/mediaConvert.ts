import { app } from 'electron'
import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs-extra'
import path from 'path'
import zlib from 'zlib'
import axios from 'axios'
import { resolveCommand } from './aiTools'

// Convertir audio, vídeo e imágenes a lo que Minecraft (o sus mods) acepta,
// para cuando alguien le pasa a la IA un .mp3, un .mp4 o un .gif:
// - sonidos → .ogg Vorbis (mono para que suene en una posición del mundo),
//   y registrados en el sounds.json de un resource pack si se quiere;
// - vídeo o gif → textura animada (tira PNG + .png.mcmeta) o .mp4 H.264 para
//   reproductores como WaterMedia;
// - imágenes → .png (opcionalmente a un tamaño).
//
// Usa el ffmpeg del sistema si lo hay; si no, descarga la primera vez el de
// eugeneware/ffmpeg-static (b6.1.1) y comprueba su SHA-256 antes de usarlo.

const FFMPEG_RELEASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1'
/** Huellas publicadas por GitHub para cada binario (.gz) de esa versión */
const FFMPEG_SHA256: Record<string, string> = {
  'win32-x64': '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
  'darwin-arm64': '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
  'darwin-x64': '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106',
  'linux-x64': 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa',
  'linux-arm64': '754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0',
}

let ffmpegPath: Promise<string> | null = null

/** Ruta de ffmpeg lista para usar (lo descarga y verifica la primera vez si no hay uno en el sistema). */
export function ensureFfmpeg(): Promise<string> {
  if (!ffmpegPath) ffmpegPath = findOrDownload().catch((e) => { ffmpegPath = null; throw e })
  return ffmpegPath
}

async function findOrDownload(): Promise<string> {
  const system = await resolveCommand('ffmpeg')
  if (system) return system
  const key = `${process.platform}-${process.arch}`
  const sha = FFMPEG_SHA256[key]
  if (!sha) throw new Error(`No hay ffmpeg preparado para ${key}. Instálalo en el sistema (por ejemplo con el gestor de paquetes) y vuelve a intentarlo.`)
  const dest = path.join(app.getPath('userData'), 'tools', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  if (await fs.pathExists(dest)) return dest
  const { data } = await axios.get<ArrayBuffer>(`${FFMPEG_RELEASE}/ffmpeg-${key}.gz`, { responseType: 'arraybuffer', timeout: 300_000, maxRedirects: 5 })
  const gz = Buffer.from(data)
  const got = crypto.createHash('sha256').update(gz).digest('hex')
  if (got !== sha) throw new Error('El ffmpeg descargado no coincide con su huella publicada: no se usa. Prueba más tarde o instala ffmpeg en el sistema.')
  await fs.outputFile(`${dest}.part`, zlib.gunzipSync(gz), { mode: 0o755 })
  await fs.move(`${dest}.part`, dest, { overwrite: true })
  return dest
}

function run(bin: string, args: string[], timeoutMs = 600_000): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true })
    let stderr = ''
    p.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 400_000) stderr = stderr.slice(-200_000) })
    const t = setTimeout(() => { p.kill(); reject(new Error('La conversión tardó demasiado y se ha cancelado')) }, timeoutMs)
    p.on('error', (e) => { clearTimeout(t); reject(e) })
    p.on('close', (code) => { clearTimeout(t); resolve({ code, stderr }) })
  })
}

export interface MediaInfo {
  archivo: string
  tamanoBytes: number
  duracionSeg: number | null
  audio: { codec: string; hz: number | null; canales: string } | null
  video: { codec: string; ancho: number; alto: number; fps: number | null } | null
  /** Qué hacer con él en Minecraft */
  sugerencia: string
}

/** Qué es un archivo multimedia y cómo meterlo en el juego. */
export async function probeMedia(file: string): Promise<MediaInfo> {
  const st = await fs.stat(file).catch(() => null)
  if (!st?.isFile()) throw new Error(`No existe el archivo: ${file}`)
  const bin = await ensureFfmpeg()
  const { stderr } = await run(bin, ['-hide_banner', '-i', file], 60_000)
  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  // Cada formato escribe la línea del stream a su manera: se busca cada dato por separado
  const aLine = /Stream #[^\n]*Audio: [^\n]*/.exec(stderr)?.[0] ?? ''
  const vLine = /Stream #[^\n]*Video: [^\n]*/.exec(stderr)?.[0] ?? ''
  const a = aLine ? /Audio: ([^,\s]+)/.exec(aLine) : null
  const v = vLine ? /Video: ([^,\s]+)/.exec(vLine) : null
  const size = /, (\d{2,5})x(\d{2,5})/.exec(vLine)
  const fps = /, ([\d.]+) (?:fps|tbr)/.exec(vLine)
  const duracionSeg = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null
  const hz = /(\d+) Hz/.exec(aLine)
  const ch = /Hz, ([^,]+)/.exec(aLine)?.[1]?.trim() ?? ''
  const canales = ch === '1 channels' ? 'mono' : ch === '2 channels' ? 'stereo' : ch
  const audio = a ? { codec: a[1], hz: hz ? Number(hz[1]) : null, canales } : null
  const isImage = !!v && /^(png|mjpeg|jpeg|webp|bmp|tiff|gif)$/.test(v[1]) && (!duracionSeg || duracionSeg < 0.2 || v[1] !== 'gif')
  const video = v && size ? { codec: v[1], ancho: Number(size[1]), alto: Number(size[2]), fps: fps ? Number(fps[1]) : null } : null
  const sugerencia = isImage
    ? 'Imagen: para texturas, conviértela a PNG (tipo imagen) con un tamaño potencia de 2 (16, 32, 64…).'
    : video
      ? 'Vídeo: Minecraft no reproduce vídeo. Para algo corto (un cartel, una pantalla) conviértelo en textura animada; para verlo entero con sonido, a .mp4 H.264 para un mod reproductor como WaterMedia.'
      : audio
        ? 'Audio: Minecraft solo carga .ogg (Vorbis). Conviértelo con tipo sonido; en mono suena desde un punto del mundo, en estéreo se oye igual en todas partes (música, menús).'
        : 'No parece audio, vídeo ni imagen que ffmpeg entienda.'
  return { archivo: file, tamanoBytes: st.size, duracionSeg, audio, video: isImage ? null : video, sugerencia: video && isImage ? `${sugerencia} (${video.ancho}×${video.alto})` : sugerencia }
}

export type ConvertKind = 'sonido' | 'textura_animada' | 'imagen' | 'video'

export interface ConvertInput {
  tipo: ConvertKind
  entrada: string
  /** Archivo de salida (relativo a la carpeta base o absoluto dentro de ella) */
  salida: string
  inicio?: number
  duracion?: number
  /** sonido: mono (por defecto) o estéreo */
  estereo?: boolean
  /** sonido: igualar volumen (loudnorm) */
  normalizar?: boolean
  /** textura_animada: lado de cada fotograma en píxeles (por defecto 64) */
  tamano?: number
  /** textura_animada: fotogramas por segundo (se redondea a ticks de Minecraft; por defecto 10) */
  fps?: number
  /** imagen: ancho y alto (opcional); pixelado mantiene los píxeles duros */
  ancho?: number
  alto?: number
  pixelado?: boolean
  /** video: alto máximo (por defecto 720) */
  altoMax?: number
}

const inside = (base: string, p: string): string => {
  const abs = path.resolve(base, p)
  const rel = path.relative(base, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`La salida tiene que estar dentro de ${base}`)
  return abs
}

/** Convierte un archivo. `base` es la carpeta donde puede escribir (la del juego o la del launcher). */
export async function convertMedia(base: string, input: ConvertInput): Promise<Record<string, unknown>> {
  const src = path.resolve(input.entrada)
  if (!(await fs.pathExists(src))) throw new Error(`No existe el archivo: ${input.entrada}`)
  const ext = { sonido: '.ogg', textura_animada: '.png', imagen: '.png', video: '.mp4' }[input.tipo]
  if (!ext) throw new Error('tipo tiene que ser sonido, textura_animada, imagen o video')
  let out = inside(base, input.salida)
  if (path.extname(out).toLowerCase() !== ext) out = out.replace(/\.[^./\\]+$/, '') + ext
  await fs.ensureDir(path.dirname(out))
  const bin = await ensureFfmpeg()
  const trim = [...(input.inicio ? ['-ss', String(input.inicio)] : []), ...(input.duracion ? ['-t', String(input.duracion)] : [])]
  const result: Record<string, unknown> = { salida: out }

  if (input.tipo === 'sonido') {
    const af = input.normalizar ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11'] : []
    const r = await run(bin, ['-hide_banner', '-y', ...trim, '-i', src, '-vn', '-map_metadata', '-1', '-ac', input.estereo ? '2' : '1', '-ar', '44100', ...af, '-c:a', 'libvorbis', '-q:a', '5', out])
    if (r.code !== 0) throw new Error(`ffmpeg no pudo convertir el audio: ${lastLines(r.stderr)}`)
    result.nota = input.estereo
      ? 'Estéreo: Minecraft lo reproduce sin posición (bien para música o menús, no para un sonido que sale de un bloque).'
      : 'Mono: suena desde su posición en el mundo.'
  } else if (input.tipo === 'textura_animada') {
    const size = clampInt(input.tamano ?? 64, 8, 512)
    // Minecraft cuenta en ticks (20 por segundo): el fps real es 20 / frametime
    const frametime = Math.max(1, Math.round(20 / (input.fps ?? 10)))
    const fps = 20 / frametime
    const info = await probeMedia(src).catch(() => null)
    const seconds = input.duracion ?? info?.duracionSeg ?? 5
    // Una tira muy alta no cabe en el atlas de texturas: como mucho 16384 px
    const maxFrames = Math.max(1, Math.floor(16384 / size))
    const frames = clampInt(Math.ceil(seconds * fps), 1, maxFrames)
    const vf = `fps=${fps},scale=${size}:${size}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,tile=1x${frames}`
    const r = await run(bin, ['-hide_banner', '-y', ...trim, '-i', src, '-vf', vf, '-frames:v', '1', '-an', out])
    if (r.code !== 0) throw new Error(`ffmpeg no pudo crear la textura: ${lastLines(r.stderr)}`)
    await fs.writeJson(`${out}.mcmeta`, { animation: { frametime } }, { spaces: 2 })
    Object.assign(result, {
      mcmeta: `${out}.mcmeta`, fotogramas: frames, frametime, fpsReal: fps, ladoPx: size,
      nota: `${frames} fotogramas de ${size}×${size} en vertical; el .png.mcmeta hace que Minecraft los anime (frametime ${frametime} = ${fps} fps). Ponlo en assets/<namespace>/textures/block|item/… de un resource pack.${Math.ceil(seconds * fps) > maxFrames ? ` Se recortó a ${frames} fotogramas para que quepa en el atlas: usa duracion o menos fps.` : ''}`,
    })
  } else if (input.tipo === 'imagen') {
    const scale = input.ancho || input.alto ? ['-vf', `scale=${input.ancho ?? -1}:${input.alto ?? -1}:flags=${input.pixelado ? 'neighbor' : 'lanczos'}`] : []
    const r = await run(bin, ['-hide_banner', '-y', '-i', src, '-frames:v', '1', ...scale, out])
    if (r.code !== 0) throw new Error(`ffmpeg no pudo convertir la imagen: ${lastLines(r.stderr)}`)
  } else {
    const h = clampInt(input.altoMax ?? 720, 144, 2160)
    const r = await run(bin, ['-hide_banner', '-y', ...trim, '-i', src, '-vf', `scale=-2:'min(${h},ih)'`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out])
    if (r.code !== 0) throw new Error(`ffmpeg no pudo convertir el vídeo: ${lastLines(r.stderr)}`)
    result.nota = 'MP4 H.264 + AAC, lo que mejor leen los reproductores de vídeo de mods (WaterMedia y los que lo usan). Minecraft vanilla no reproduce vídeo.'
  }
  result.tamanoBytes = (await fs.stat(out)).size
  return result
}

/**
 * Registra un .ogg en el sounds.json de un resource pack: el evento
 * «namespace:evento» suena con /playsound o desde un mod o datapack.
 */
export async function registerSound(packDir: string, namespace: string, event: string, soundPath: string, opts: { subtitle?: string; stream?: boolean }): Promise<Record<string, unknown>> {
  const file = path.join(packDir, 'assets', namespace, 'sounds.json')
  const json = (await fs.readJson(file).catch(() => ({}))) as Record<string, { sounds: unknown[]; subtitle?: string; replace?: boolean }>
  const name = `${namespace}:${soundPath.replace(/\\/g, '/').replace(/\.ogg$/, '')}`
  const entry = json[event] ?? { sounds: [] }
  entry.sounds = [...entry.sounds.filter((s) => (typeof s === 'string' ? s : (s as { name: string }).name) !== name), opts.stream ? { name, stream: true } : name]
  if (opts.subtitle) entry.subtitle = opts.subtitle
  json[event] = entry
  await fs.outputJson(file, json, { spaces: 2 })
  return { soundsJson: file, evento: `${namespace}:${event}`, probar: `/playsound ${namespace}:${event} master @s` }
}

const clampInt = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.round(v)))
const lastLines = (s: string): string => s.trim().split(/\r?\n/).slice(-4).join(' | ')
