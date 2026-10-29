//! Zips y jars: listar, leer entradas sueltas, descomprimir en varios hilos y crear sin
//! cargarlo todo en memoria (AdmZip, en el launcher, mete el zip entero en la RAM).

use crate::{arg, Ctx, Res};
use base64::Engine;
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

type Archive = ZipArchive<BufReader<File>>;

fn open(path: &str) -> Result<Archive, String> {
    let f = File::open(path).map_err(|e| format!("{path}: {e}"))?;
    ZipArchive::new(BufReader::new(f)).map_err(|e| format!("{path}: no es un zip válido ({e})"))
}

fn b64(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

// ── Leer ─────────────────────────────────────────────────────────────────────

/// Zips abiertos hace poco (el .jar del juego se lee muchas veces seguidas).
fn cache() -> &'static Mutex<HashMap<String, (u128, Arc<Mutex<Archive>>)>> {
    static C: OnceLock<Mutex<HashMap<String, (u128, Arc<Mutex<Archive>>)>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached(path: &str) -> Result<Arc<Mutex<Archive>>, String> {
    let mtime = fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|t| t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0))
        .map_err(|e| format!("{path}: {e}"))?;
    let mut c = cache().lock().unwrap_or_else(|e| e.into_inner());
    if let Some((m, a)) = c.get(path) {
        if *m == mtime {
            return Ok(a.clone());
        }
    }
    if c.len() >= 8 {
        c.clear();
    }
    let a = Arc::new(Mutex::new(open(path)?));
    c.insert(path.to_string(), (mtime, a.clone()));
    Ok(a)
}

#[derive(Deserialize)]
struct ListArgs {
    zip: String,
    #[serde(default)]
    prefix: Option<String>,
}

pub fn list(args: Value) -> Res {
    let a: ListArgs = arg(args)?;
    let arc = cached(&a.zip)?;
    let mut z = arc.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = Vec::with_capacity(z.len());
    for i in 0..z.len() {
        let f = z.by_index_raw(i).map_err(|e| e.to_string())?;
        if let Some(p) = &a.prefix {
            if !f.name().starts_with(p.as_str()) {
                continue;
            }
        }
        out.push(json!({ "name": f.name(), "size": f.size(), "dir": f.is_dir() }));
    }
    Ok(Value::Array(out))
}

#[derive(Deserialize)]
struct ReadArgs {
    zip: String,
    names: Vec<String>,
}

/// {nombre: base64 o null}
pub fn read(args: Value) -> Res {
    let a: ReadArgs = arg(args)?;
    let arc = cached(&a.zip)?;
    let mut z = arc.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = Map::new();
    for n in a.names {
        let v = match z.by_name(&n) {
            Ok(mut f) => {
                let mut buf = Vec::with_capacity(f.size() as usize);
                f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
                Value::String(b64(&buf))
            }
            Err(_) => Value::Null,
        };
        out.insert(n, v);
    }
    Ok(Value::Object(out))
}

#[derive(Deserialize)]
struct JarItem {
    jar: String,
    /// Entradas de esta jar en concreto (además de las comunes)
    #[serde(default)]
    names: Vec<String>,
}

#[derive(Deserialize)]
struct JarsArgs {
    jars: Vec<JarItem>,
    /// Entradas que se buscan en todas
    #[serde(default)]
    names: Vec<String>,
}

/// Muchas jars a la vez (los mods de una instancia): de cada una, las entradas pedidas.
pub fn jars_read(ctx: &Ctx, args: Value) -> Res {
    let a: JarsArgs = arg(args)?;
    let total = a.jars.len() as u64;
    let done = AtomicU64::new(0);
    let out: Vec<Value> = a
        .jars
        .par_iter()
        .map(|item| {
            let jar = &item.jar;
            let r = match open(jar) {
                Err(e) => json!({ "jar": jar, "error": e }),
                Ok(mut z) => {
                    let mut entries = Map::new();
                    for n in a.names.iter().chain(item.names.iter()) {
                        if let Ok(mut f) = z.by_name(n) {
                            let mut buf = Vec::new();
                            if f.read_to_end(&mut buf).is_ok() {
                                entries.insert(n.clone(), Value::String(b64(&buf)));
                            }
                        }
                    }
                    json!({ "jar": jar, "entries": entries })
                }
            };
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            ctx.progress(n, total, jar);
            r
        })
        .collect();
    Ok(Value::Array(out))
}

// ── Descomprimir ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ExtractArgs {
    zip: String,
    dest: String,
    /// Solo lo que empieza por esto (y se le quita el prefijo al escribirlo)
    #[serde(default)]
    strip_prefix: Option<String>,
    /// Entradas que no se tocan si ya existen en el destino (ajustes del jugador…)
    #[serde(default)]
    keep_existing: Vec<String>,
}

/// Descomprime en varios hilos (cada uno con su propio lector del zip). Las rutas que
/// intentarían salir de la carpeta de destino (../) se saltan.
pub fn extract(ctx: &Ctx, args: Value) -> Res {
    let a: ExtractArgs = arg(args)?;
    let dest = PathBuf::from(&a.dest);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let n = open(&a.zip)?.len();
    let keep: HashSet<&str> = a.keep_existing.iter().map(|s| s.as_str()).collect();
    let threads = rayon::current_num_threads().max(1);
    let chunk = n.div_ceil(threads).max(1);
    let done = AtomicU64::new(0);
    let written = AtomicU64::new(0);
    let skipped = AtomicU64::new(0);
    let unsafe_paths = AtomicU64::new(0);
    let results: Vec<Result<(), String>> = (0..n)
        .step_by(chunk)
        .collect::<Vec<_>>()
        .par_iter()
        .map(|&start| -> Result<(), String> {
            let mut z = open(&a.zip)?;
            for i in start..(start + chunk).min(n) {
                let mut f = z.by_index(i).map_err(|e| e.to_string())?;
                let name = f.name().to_string();
                let c = done.fetch_add(1, Ordering::Relaxed) + 1;
                ctx.progress(c, n as u64, &name);
                let rel = match &a.strip_prefix {
                    Some(p) => match name.strip_prefix(p.as_str()) {
                        Some(r) if !r.is_empty() => r.to_string(),
                        _ => continue,
                    },
                    None => name.clone(),
                };
                let Some(safe) = enclosed(&rel) else {
                    unsafe_paths.fetch_add(1, Ordering::Relaxed);
                    continue;
                };
                let target = dest.join(safe);
                if f.is_dir() {
                    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
                    continue;
                }
                if keep.contains(rel.as_str()) && target.exists() {
                    skipped.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
                if let Some(p) = target.parent() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
                let mut w = BufWriter::new(File::create(&target).map_err(|e| format!("{}: {e}", target.display()))?);
                io::copy(&mut f, &mut w).map_err(|e| format!("{name}: {e}"))?;
                written.fetch_add(1, Ordering::Relaxed);
            }
            Ok(())
        })
        .collect();
    for r in results {
        r?;
    }
    Ok(json!({
        "written": written.load(Ordering::Relaxed),
        "skipped": skipped.load(Ordering::Relaxed),
        "unsafe": unsafe_paths.load(Ordering::Relaxed),
    }))
}

/// Ruta relativa que no se sale de la carpeta (sin "..", sin raíz ni unidad).
fn enclosed(rel: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for part in rel.split(['/', '\\']) {
        match part {
            "" | "." => continue,
            ".." => return None,
            p if p.contains(':') => return None,
            p => out.push(p),
        }
    }
    if out.as_os_str().is_empty() { None } else { Some(out) }
}

// ── Crear ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct FileEntry {
    src: String,
    name: String,
}

#[derive(Deserialize)]
struct DirEntry {
    dir: String,
    /// Carpeta dentro del zip ("" para la raíz)
    #[serde(default)]
    prefix: String,
}

#[derive(Deserialize)]
struct CreateArgs {
    out: String,
    #[serde(default)]
    files: Vec<FileEntry>,
    #[serde(default)]
    dirs: Vec<DirEntry>,
    /// Extensiones que ya van comprimidas y se guardan tal cual (mca, png, jar…)
    #[serde(default)]
    store: Vec<String>,
    /// 1 (rápido) a 9 (pequeño); por defecto 3
    #[serde(default)]
    level: Option<i64>,
    /// Carpetas que no entran (por nombre)
    #[serde(default)]
    exclude: Vec<String>,
}

fn collect(dir: &Path, prefix: &str, exclude: &HashSet<String>, out: &mut Vec<(PathBuf, String)>) -> io::Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name().to_string_lossy().to_string();
        let ft = e.file_type()?;
        if ft.is_symlink() || exclude.contains(&name) {
            continue;
        }
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        if ft.is_dir() {
            collect(&e.path(), &rel, exclude, out)?;
        } else if ft.is_file() && name != "session.lock" {
            out.push((e.path(), rel));
        }
    }
    Ok(())
}

/// Crea un zip leyendo cada archivo por partes: sirve para mundos de varios GB. Lo ya
/// comprimido (regiones, imágenes, jars) se guarda sin volver a comprimir, que es donde se
/// iba casi todo el tiempo. Se escribe en <out>.part y se renombra al final.
pub fn create(ctx: &Ctx, args: Value) -> Res {
    let a: CreateArgs = arg(args)?;
    let exclude: HashSet<String> = a.exclude.into_iter().collect();
    let mut items: Vec<(PathBuf, String)> = a.files.into_iter().map(|f| (PathBuf::from(f.src), f.name)).collect();
    for d in &a.dirs {
        collect(Path::new(&d.dir), d.prefix.trim_matches('/'), &exclude, &mut items).map_err(|e| format!("{}: {e}", d.dir))?;
    }
    let store: HashSet<String> = a.store.iter().map(|s| s.to_lowercase()).collect();
    let part = format!("{}.part", a.out);
    if let Some(p) = Path::new(&a.out).parent() {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    let mut w = ZipWriter::new(BufWriter::new(File::create(&part).map_err(|e| e.to_string())?));
    let total = items.len() as u64;
    let mut bytes = 0u64;
    for (i, (src, name)) in items.iter().enumerate() {
        ctx.progress(i as u64, total, name);
        let size = fs::metadata(src).map(|m| m.len()).unwrap_or(0);
        let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
        let opts = if store.contains(&ext) {
            SimpleFileOptions::default().compression_method(CompressionMethod::Stored)
        } else {
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated).compression_level(Some(a.level.unwrap_or(3)))
        }
        .large_file(size >= 0xFFFF_FFFF)
        .unix_permissions(0o644);
        let mut f = match File::open(src) {
            Ok(f) => BufReader::new(f),
            // Un archivo que el juego tiene abierto o que desapareció: se salta, no se para todo
            Err(_) => continue,
        };
        w.start_file(name.as_str(), opts).map_err(|e| e.to_string())?;
        bytes += io::copy(&mut f, &mut w).map_err(|e| format!("{name}: {e}"))?;
    }
    w.finish().map_err(|e| e.to_string())?;
    ctx.progress(total, total, "");
    fs::rename(&part, &a.out).map_err(|e| e.to_string())?;
    Ok(json!({ "files": total, "bytes": bytes, "size": fs::metadata(&a.out).map(|m| m.len()).unwrap_or(0) }))
}
