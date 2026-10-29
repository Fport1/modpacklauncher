//! Limpiar un mundo: quitar los chunks por los que casi no ha pasado nadie (InhabitedTime,
//! el tiempo que ha habido un jugador cerca), como hace MCA Selector. Es lo que más ocupa en
//! los mundos de servidor: chunks que solo se generaron al volar o explorar de lejos.
//!
//! Formato de las regiones (.mca): una cabecera de 4 KiB con dónde está cada uno de los
//! 1024 chunks (sector y número de sectores), otra de 4 KiB con fechas, y los chunks en
//! sectores de 4 KiB: [longitud u32][compresión u8][datos]. Si la compresión lleva el bit
//! 128, el chunk está aparte en c.X.Z.mcc. Las carpetas entities/ y poi/ usan el mismo
//! formato con los mismos números de chunk: se limpian a la vez.
//!
//! Cada región se reescribe compactada en un archivo temporal y se cambia por la original
//! solo al terminar. Lo que no se entiende (comprimido en LZ4, dañado) se deja como está.

use crate::nbt::Reader;
use crate::{arg, Ctx, Res};
use flate2::read::{GzDecoder, ZlibDecoder};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const SECTOR: usize = 4096;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Args {
    world: String,
    /// Se quitan los chunks con menos de esto (en ticks; 20 = 1 segundo). 1 = solo los que nadie ha pisado
    #[serde(default = "one")]
    min_inhabited: i64,
    /// Solo contar lo que se quitaría
    #[serde(default)]
    dry_run: bool,
}
fn one() -> i64 { 1 }

/// Carpetas «region» del mundo, en cualquier dimensión (las de la 26.1 están en dimensions/<ns>/<nombre>/).
fn region_dirs(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth > 5 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if !ft.is_dir() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if matches!(name.as_str(), "fport1-backups" | "datapacks" | "players" | "playerdata" | "advancements" | "stats" | "entities" | "poi") {
            continue;
        }
        if name == "region" {
            out.push(e.path());
        } else {
            region_dirs(&e.path(), depth + 1, out);
        }
    }
}

// ── Leer el InhabitedTime sin convertir todo el chunk ────────────────────────

fn skip(r: &mut Reader, t: u8) -> Result<(), String> {
    match t {
        1 => { r.take(1)?; }
        2 => { r.take(2)?; }
        3 | 5 => { r.take(4)?; }
        4 | 6 => { r.take(8)?; }
        7 => { let n = r.i32()?.max(0) as usize; r.take(n)?; }
        8 => { let n = r.i16()? as u16 as usize; r.take(n)?; }
        9 => {
            let inner = r.u8()?;
            let n = r.i32()?.max(0);
            for _ in 0..n { skip(r, inner)?; }
        }
        10 => loop {
            let ct = r.u8()?;
            if ct == 0 { break; }
            let n = r.i16()? as u16 as usize;
            r.take(n)?;
            skip(r, ct)?;
        },
        11 => { let n = r.i32()?.max(0) as usize; r.take(n * 4)?; }
        12 => { let n = r.i32()?.max(0) as usize; r.take(n * 8)?; }
        _ => return Err("tipo desconocido".into()),
    }
    Ok(())
}

/// InhabitedTime del chunk: en la raíz desde la 1.18, dentro de «Level» antes.
fn inhabited(r: &mut Reader) -> Result<Option<i64>, String> {
    loop {
        let t = r.u8()?;
        if t == 0 {
            return Ok(None);
        }
        let n = r.i16()? as u16 as usize;
        let name = r.take(n)?;
        if t == 4 && name == b"InhabitedTime" {
            return Ok(Some(r.i64()?));
        }
        if t == 10 && name == b"Level" {
            if let Some(v) = inhabited(r)? {
                return Ok(Some(v));
            }
            continue;
        }
        skip(r, t)?;
    }
}

fn chunk_inhabited(data: &[u8], compression: u8) -> Option<i64> {
    let raw = match compression {
        1 => { let mut o = Vec::new(); GzDecoder::new(data).read_to_end(&mut o).ok()?; o }
        2 => { let mut o = Vec::new(); ZlibDecoder::new(data).read_to_end(&mut o).ok()?; o }
        3 => data.to_vec(),
        // LZ4 u otro: no se sabe leer, así que no se toca
        _ => return None,
    };
    let mut r = Reader { b: &raw, p: 0 };
    if r.u8().ok()? != 10 {
        return None;
    }
    let n = r.i16().ok()? as u16 as usize;
    r.take(n).ok()?;
    inhabited(&mut r).ok().flatten()
}

// ── Regiones ─────────────────────────────────────────────────────────────────

struct Region {
    data: Vec<u8>,
}

impl Region {
    fn loc(&self, i: usize) -> (usize, usize) {
        let v = u32::from_be_bytes(self.data[i * 4..i * 4 + 4].try_into().unwrap());
        ((v >> 8) as usize, (v & 0xFF) as usize)
    }
    fn present(&self, i: usize) -> bool {
        self.data.len() >= 2 * SECTOR && self.loc(i).0 >= 2
    }
    /// Los bytes del chunk tal como están en el archivo: [longitud][compresión][datos]
    fn raw(&self, i: usize) -> Option<&[u8]> {
        let (off, _) = self.loc(i);
        let pos = off * SECTOR;
        if pos + 5 > self.data.len() {
            return None;
        }
        let len = u32::from_be_bytes(self.data[pos..pos + 4].try_into().unwrap()) as usize;
        if len == 0 || pos + 4 + len > self.data.len() {
            return None;
        }
        Some(&self.data[pos..pos + 4 + len])
    }
}

/// Coordenadas del chunk i de la región r.X.Z.mca
fn chunk_xz(file: &Path, i: usize) -> Option<(i64, i64)> {
    let name = file.file_name()?.to_string_lossy().to_string();
    let parts: Vec<&str> = name.split('.').collect();
    if parts.len() != 4 || parts[0] != "r" { return None; }
    let rx: i64 = parts[1].parse().ok()?;
    let rz: i64 = parts[2].parse().ok()?;
    Some((rx * 32 + (i % 32) as i64, rz * 32 + (i / 32) as i64))
}

/// Reescribe la región sin los chunks de `remove`, compactada. Devuelve el tamaño nuevo (0 si quedó vacía y se borró).
fn rewrite(file: &Path, remove: &[usize]) -> Result<u64, String> {
    let data = fs::read(file).map_err(|e| e.to_string())?;
    let reg = Region { data };
    if reg.data.len() < 2 * SECTOR {
        return Ok(reg.data.len() as u64);
    }
    let mut out = vec![0u8; 2 * SECTOR];
    let mut kept = 0usize;
    for i in 0..1024 {
        if !reg.present(i) {
            continue;
        }
        if remove.contains(&i) {
            // Si estaba en un .mcc aparte, ese archivo sobra
            if let Some(raw) = reg.raw(i) {
                if raw[4] & 0x80 != 0 {
                    if let Some((x, z)) = chunk_xz(file, i) {
                        let _ = fs::remove_file(file.with_file_name(format!("c.{x}.{z}.mcc")));
                    }
                }
            }
            continue;
        }
        let Some(raw) = reg.raw(i) else {
            // Dañado: se copian sus sectores tal cual para no perder nada
            let (off, count) = reg.loc(i);
            let end = ((off + count) * SECTOR).min(reg.data.len());
            let start = (off * SECTOR).min(end);
            let sectors = (end - start).div_ceil(SECTOR).max(1);
            let at = out.len() / SECTOR;
            out.extend_from_slice(&reg.data[start..end]);
            out.resize((at + sectors) * SECTOR, 0);
            write_loc(&mut out, &reg, i, at, sectors);
            kept += 1;
            continue;
        };
        let sectors = raw.len().div_ceil(SECTOR);
        let at = out.len() / SECTOR;
        out.extend_from_slice(raw);
        out.resize((at + sectors) * SECTOR, 0);
        write_loc(&mut out, &reg, i, at, sectors);
        kept += 1;
    }
    if kept == 0 {
        fs::remove_file(file).map_err(|e| e.to_string())?;
        return Ok(0);
    }
    let tmp = file.with_extension("mca.fport1-tmp");
    fs::write(&tmp, &out).map_err(|e| e.to_string())?;
    fs::rename(&tmp, file).map_err(|e| e.to_string())?;
    Ok(out.len() as u64)
}

fn write_loc(out: &mut [u8], reg: &Region, i: usize, at: usize, sectors: usize) {
    let v = ((at as u32) << 8) | (sectors.min(255) as u32);
    out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    // La fecha de cada chunk se conserva
    out[SECTOR + i * 4..SECTOR + i * 4 + 4].copy_from_slice(&reg.data[SECTOR + i * 4..SECTOR + i * 4 + 4]);
}

#[derive(Default, Clone)]
struct Stats {
    regions: u64,
    chunks: u64,
    remove: u64,
    unknown: u64,
    bytes_before: u64,
    bytes_after: u64,
}

pub fn prune(ctx: &Ctx, args: Value) -> Res {
    let a: Args = arg(args)?;
    let world = PathBuf::from(&a.world);
    if !world.join("level.dat").exists() {
        return Err("Esa carpeta no es un mundo (no tiene level.dat).".into());
    }
    let mut dirs = Vec::new();
    region_dirs(&world, 0, &mut dirs);
    let mut files: Vec<PathBuf> = Vec::new();
    for d in &dirs {
        if let Ok(rd) = fs::read_dir(d) {
            files.extend(rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "mca")));
        }
    }
    let total = files.len() as u64;
    let done = AtomicU64::new(0);
    let results: Vec<(PathBuf, Stats)> = files
        .par_iter()
        .map(|file| {
            let mut st = Stats { regions: 1, ..Default::default() };
            let sibling = |kind: &str| file.parent().and_then(|p| p.parent()).map(|d| d.join(kind).join(file.file_name().unwrap()));
            let siblings: Vec<PathBuf> = ["entities", "poi"].iter().filter_map(|k| sibling(k)).filter(|p| p.exists()).collect();
            let size = |p: &Path| fs::metadata(p).map(|m| m.len()).unwrap_or(0);
            st.bytes_before = size(file) + siblings.iter().map(|p| size(p)).sum::<u64>();
            let mut remove = Vec::new();
            if let Ok(data) = fs::read(file) {
                let reg = Region { data };
                for i in 0..1024 {
                    if !reg.present(i) { continue; }
                    st.chunks += 1;
                    let value = reg.raw(i).and_then(|raw| {
                        let comp = raw[4];
                        if comp & 0x80 != 0 {
                            let (x, z) = chunk_xz(file, i)?;
                            let ext = fs::read(file.with_file_name(format!("c.{x}.{z}.mcc"))).ok()?;
                            chunk_inhabited(&ext, comp & 0x7F)
                        } else {
                            chunk_inhabited(&raw[5..], comp)
                        }
                    });
                    match value {
                        Some(t) if t < a.min_inhabited => remove.push(i),
                        Some(_) => {}
                        None => st.unknown += 1,
                    }
                }
            }
            st.remove = remove.len() as u64;
            if a.dry_run || remove.is_empty() {
                // Estimación: lo que se quita ocupa más o menos lo mismo que la media de sus chunks
                st.bytes_after = if st.chunks > 0 { st.bytes_before - st.bytes_before * st.remove / st.chunks } else { st.bytes_before };
            } else {
                let mut after = rewrite(file, &remove).unwrap_or_else(|_| size(file));
                for s in &siblings {
                    after += rewrite(s, &remove).unwrap_or_else(|_| size(s));
                }
                st.bytes_after = after;
            }
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            ctx.progress(n, total, &file.file_name().unwrap().to_string_lossy());
            (file.clone(), st)
        })
        .collect();

    // Por dimensión (la carpeta que contiene region/)
    let mut by_dim: BTreeMap<String, Stats> = BTreeMap::new();
    for (file, st) in results {
        let dim = file
            .parent()
            .and_then(|p| p.parent())
            .and_then(|d| d.strip_prefix(&world).ok())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let e = by_dim.entry(if dim.is_empty() { ".".into() } else { dim }).or_default();
        e.regions += st.regions;
        e.chunks += st.chunks;
        e.remove += st.remove;
        e.unknown += st.unknown;
        e.bytes_before += st.bytes_before;
        e.bytes_after += st.bytes_after;
    }
    let dims: Vec<Value> = by_dim
        .into_iter()
        .map(|(dim, s)| json!({ "dim": dim, "regions": s.regions, "chunks": s.chunks, "remove": s.remove, "unknown": s.unknown, "bytesBefore": s.bytes_before, "bytesAfter": s.bytes_after }))
        .collect();
    Ok(json!({ "dryRun": a.dry_run, "dims": dims }))
}
