//! Abrir un archivo de región (.mca) desde el launcher: qué chunks tiene y cómo es cada uno,
//! leer el NBT de uno, guardarlo editado y borrar chunks sueltos. Es la base del editor de
//! mundos (fase 1 de docs/editor-mundos.md).

use crate::nbt::{decode, Reader};
use crate::region::{chunk_xz, rewrite, skip, Region};
use crate::{arg, Res};
use base64::Engine;
use flate2::read::{GzDecoder, ZlibDecoder};
use flate2::write::{GzEncoder, ZlibEncoder};
use flate2::Compression;
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const SECTOR: usize = 4096;
/// Más que esto no cabe en la región (255 sectores): va aparte, en c.X.Z.mcc
const MAX_INLINE: usize = 255 * SECTOR;

#[derive(Deserialize)]
struct FileArgs {
    file: String,
}

#[derive(Default)]
struct Info {
    data_version: Option<i32>,
    status: Option<String>,
    inhabited: Option<i64>,
    last_update: Option<i64>,
}

/// Datos básicos del chunk sin convertirlo entero (en la raíz desde la 1.18; antes, en «Level»).
fn scan(r: &mut Reader, info: &mut Info, depth: u32) -> Result<(), String> {
    loop {
        let t = r.u8()?;
        if t == 0 {
            return Ok(());
        }
        let n = r.i16()? as u16 as usize;
        let name = r.take(n)?.to_vec();
        match (t, name.as_slice()) {
            (3, b"DataVersion") => info.data_version = Some(r.i32()?),
            (8, b"Status") => info.status = Some(r.string()?),
            (4, b"InhabitedTime") => info.inhabited = Some(r.i64()?),
            (4, b"LastUpdate") => info.last_update = Some(r.i64()?),
            (10, b"Level") if depth == 0 => scan(r, info, 1)?,
            _ => skip(r, t)?,
        }
    }
}

fn decompress(data: &[u8], compression: u8) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    match compression {
        1 => { GzDecoder::new(data).read_to_end(&mut out).map_err(|e| e.to_string())?; }
        2 => { ZlibDecoder::new(data).read_to_end(&mut out).map_err(|e| e.to_string())?; }
        3 => out.extend_from_slice(data),
        4 => return Err("Chunk comprimido con LZ4: todavía no se puede abrir.".into()),
        c => return Err(format!("compresión desconocida ({c})")),
    }
    Ok(out)
}

/// El NBT del chunk i (sin comprimir) y su compresión.
fn chunk_nbt(file: &Path, reg: &Region, i: usize) -> Result<(Vec<u8>, u8), String> {
    let raw = reg.raw(i).ok_or("Ese chunk no existe o está dañado.")?;
    let comp = raw[4];
    if comp & 0x80 != 0 {
        let (x, z) = chunk_xz(file, i).ok_or("nombre de región raro")?;
        let ext = fs::read(file.with_file_name(format!("c.{x}.{z}.mcc"))).map_err(|e| e.to_string())?;
        return Ok((decompress(&ext, comp & 0x7F)?, comp & 0x7F));
    }
    Ok((decompress(&raw[5..], comp)?, comp))
}

/// Los chunks de la región: dónde están, cuánto ocupan y lo básico de cada uno.
pub fn list(args: Value) -> Res {
    let a: FileArgs = arg(args)?;
    let file = PathBuf::from(&a.file);
    let data = fs::read(&file).map_err(|e| e.to_string())?;
    let reg = Region { data };
    let mut out = Vec::new();
    for i in 0..1024usize {
        if !reg.present(i) {
            continue;
        }
        let (x, z) = chunk_xz(&file, i).unwrap_or(((i % 32) as i64, (i / 32) as i64));
        let (_, sectors) = reg.loc(i);
        let ts = u32::from_be_bytes(reg.data[SECTOR + i * 4..SECTOR + i * 4 + 4].try_into().unwrap());
        let mut info = Info::default();
        let mut error = None;
        let mut compression = 0u8;
        let mut external = false;
        match reg.raw(i) {
            None => error = Some("dañado".to_string()),
            Some(raw) => {
                compression = raw[4] & 0x7F;
                external = raw[4] & 0x80 != 0;
                match chunk_nbt(&file, &reg, i) {
                    Ok((nbt, _)) => {
                        let mut r = Reader { b: &nbt, p: 0 };
                        let ok = r.u8().ok() == Some(10) && r.string().is_ok();
                        if !ok || scan(&mut r, &mut info, 0).is_err() {
                            error = Some("NBT no válido".into());
                        }
                    }
                    Err(e) => error = Some(e),
                }
            }
        }
        out.push(json!({
            "index": i, "x": x, "z": z, "sectors": sectors, "bytes": sectors * SECTOR, "timestamp": ts,
            "compression": compression, "external": external,
            "dataVersion": info.data_version, "status": info.status, "inhabited": info.inhabited, "lastUpdate": info.last_update,
            "error": error,
        }));
    }
    Ok(json!({ "size": reg.data.len(), "chunks": out }))
}

#[derive(Deserialize)]
struct ChunkArgs {
    file: String,
    index: usize,
}

/// El NBT de un chunk con la misma forma que los .dat (para el editor de siempre).
pub fn read(args: Value) -> Res {
    let a: ChunkArgs = arg(args)?;
    let file = PathBuf::from(&a.file);
    let reg = Region { data: fs::read(&file).map_err(|e| e.to_string())? };
    let (nbt, comp) = chunk_nbt(&file, &reg, a.index)?;
    let mut doc = decode(&nbt)?;
    // decode() dice "none" porque ya va descomprimido: se apunta cómo estaba en la región
    doc["regionCompression"] = json!(comp);
    Ok(doc)
}

#[derive(Deserialize)]
struct WriteArgs {
    file: String,
    index: usize,
    /// NBT sin comprimir, en base64 (lo codifica el launcher igual que los .dat)
    data: String,
    /// 1 gzip, 2 zlib (lo normal), 3 sin comprimir
    #[serde(default = "zlib")]
    compression: u8,
}
fn zlib() -> u8 { 2 }

/// Guarda un chunk editado: se comprime como estaba y se reescribe la región.
pub fn write(args: Value) -> Res {
    let a: WriteArgs = arg(args)?;
    if a.index >= 1024 {
        return Err("índice de chunk no válido".into());
    }
    let file = PathBuf::from(&a.file);
    let nbt = base64::engine::general_purpose::STANDARD.decode(a.data.as_bytes()).map_err(|e| e.to_string())?;
    // Que lo que se va a guardar se pueda volver a leer
    decode(&nbt).map_err(|e| format!("El NBT editado no es válido: {e}"))?;
    let comp = if matches!(a.compression, 1..=3) { a.compression } else { 2 };
    let packed = match comp {
        1 => { let mut e = GzEncoder::new(Vec::new(), Compression::default()); e.write_all(&nbt).map_err(|e| e.to_string())?; e.finish().map_err(|e| e.to_string())? }
        2 => { let mut e = ZlibEncoder::new(Vec::new(), Compression::default()); e.write_all(&nbt).map_err(|e| e.to_string())?; e.finish().map_err(|e| e.to_string())? }
        _ => nbt.clone(),
    };
    let (x, z) = chunk_xz(&file, a.index).ok_or("nombre de región raro")?;
    let mcc = file.with_file_name(format!("c.{x}.{z}.mcc"));
    let mut bytes = Vec::with_capacity(packed.len() + 5);
    if packed.len() + 5 > MAX_INLINE {
        // Demasiado grande para la región: el juego lo guarda aparte
        fs::write(&mcc, &packed).map_err(|e| e.to_string())?;
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.push(comp | 0x80);
    } else {
        let _ = fs::remove_file(&mcc);
        bytes.extend_from_slice(&((packed.len() + 1) as u32).to_be_bytes());
        bytes.push(comp);
        bytes.extend_from_slice(&packed);
    }
    let size = rewrite(&file, &[], Some((a.index, &bytes)))?;
    Ok(json!({ "size": size }))
}

#[derive(Deserialize)]
struct DeleteArgs {
    file: String,
    indices: Vec<usize>,
}

/// Borra chunks sueltos (y los mismos en entities/ y poi/). El juego los vuelve a generar.
pub fn delete(args: Value) -> Res {
    let a: DeleteArgs = arg(args)?;
    let file = PathBuf::from(&a.file);
    let mut size = rewrite(&file, &a.indices, None)?;
    if let (Some(dim), Some(name)) = (file.parent().and_then(|p| p.parent()), file.file_name()) {
        for kind in ["entities", "poi"] {
            let s = dim.join(kind).join(name);
            if s.exists() {
                size += rewrite(&s, &a.indices, None)?;
            }
        }
    }
    Ok(json!({ "size": size }))
}
