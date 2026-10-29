//! NBT de Java (big-endian): leerlo con la MISMA forma que prismarine-nbt, que es lo que usa
//! el launcher ({type, value}, los long como [alto, bajo]…), para poder cambiar uno por otro.
//! Lo que no es Java (Bedrock, little-endian) devuelve error y el launcher usa prismarine.

use crate::{arg, Res};
use flate2::read::{GzDecoder, ZlibDecoder};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Map, Number, Value};
use std::io::Read;

pub fn decompress(data: &[u8]) -> Result<(Vec<u8>, &'static str), String> {
    if data.len() >= 2 && data[0] == 0x1f && data[1] == 0x8b {
        let mut out = Vec::new();
        GzDecoder::new(data).read_to_end(&mut out).map_err(|e| e.to_string())?;
        return Ok((out, "gzip"));
    }
    if data.len() >= 2 && data[0] == 0x78 && ((data[0] as u16) << 8 | data[1] as u16) % 31 == 0 {
        let mut out = Vec::new();
        ZlibDecoder::new(data).read_to_end(&mut out).map_err(|e| e.to_string())?;
        return Ok((out, "zlib"));
    }
    Ok((data.to_vec(), "none"))
}

pub struct Reader<'a> {
    pub b: &'a [u8],
    pub p: usize,
}

impl<'a> Reader<'a> {
    pub fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.p + n > self.b.len() {
            return Err("NBT cortado".into());
        }
        let s = &self.b[self.p..self.p + n];
        self.p += n;
        Ok(s)
    }
    pub fn u8(&mut self) -> Result<u8, String> { Ok(self.take(1)?[0]) }
    pub fn i16(&mut self) -> Result<i16, String> { Ok(i16::from_be_bytes(self.take(2)?.try_into().unwrap())) }
    pub fn i32(&mut self) -> Result<i32, String> { Ok(i32::from_be_bytes(self.take(4)?.try_into().unwrap())) }
    pub fn i64(&mut self) -> Result<i64, String> { Ok(i64::from_be_bytes(self.take(8)?.try_into().unwrap())) }
    pub fn string(&mut self) -> Result<String, String> {
        let n = self.i16()? as u16 as usize;
        Ok(String::from_utf8_lossy(self.take(n)?).into_owned())
    }
    fn len(&mut self) -> Result<usize, String> {
        let n = self.i32()?;
        if n < 0 || n as usize > self.b.len() {
            return Err("longitud no válida".into());
        }
        Ok(n as usize)
    }
}

const NAMES: [&str; 13] = ["end", "byte", "short", "int", "long", "float", "double", "byteArray", "string", "list", "compound", "intArray", "longArray"];

fn type_name(t: u8) -> Result<&'static str, String> {
    NAMES.get(t as usize).copied().ok_or_else(|| format!("tipo NBT desconocido {t}"))
}

fn long(v: i64) -> Value {
    // prismarine-nbt: [parte alta, parte baja] como enteros con signo de 32 bits
    json!([(v >> 32) as i32, v as i32])
}

fn float(v: f64) -> Result<Value, String> {
    Number::from_f64(v).map(Value::Number).ok_or_else(|| "NaN o infinito en el NBT".to_string())
}

/// El valor de una etiqueta de tipo `t` (sin nombre).
fn payload(r: &mut Reader, t: u8, depth: u32) -> Result<Value, String> {
    if depth > 512 {
        return Err("NBT demasiado anidado".into());
    }
    Ok(match t {
        1 => json!(r.u8()? as i8),
        2 => json!(r.i16()?),
        3 => json!(r.i32()?),
        4 => long(r.i64()?),
        5 => float(f32::from_be_bytes(r.take(4)?.try_into().unwrap()) as f64)?,
        6 => float(f64::from_be_bytes(r.take(8)?.try_into().unwrap()))?,
        7 => {
            let n = r.len()?;
            Value::Array(r.take(n)?.iter().map(|&x| json!(x as i8)).collect())
        }
        8 => Value::String(r.string()?),
        9 => {
            let inner = r.u8()?;
            let n = r.i32()?.max(0) as usize;
            let mut items = Vec::with_capacity(n.min(1 << 16));
            for _ in 0..n {
                // En una lista cada elemento lleva solo su valor (las listas de listas, su {type, value})
                items.push(payload(r, inner, depth + 1)?);
            }
            json!({ "type": type_name(inner)?, "value": items })
        }
        10 => {
            let mut m = Map::new();
            loop {
                let ct = r.u8()?;
                if ct == 0 {
                    break;
                }
                let name = r.string()?;
                let v = payload(r, ct, depth + 1)?;
                m.insert(name, json!({ "type": type_name(ct)?, "value": v }));
            }
            Value::Object(m)
        }
        11 => {
            let n = r.len()?;
            let mut out = Vec::with_capacity(n.min(1 << 16));
            for _ in 0..n {
                out.push(json!(r.i32()?));
            }
            Value::Array(out)
        }
        12 => {
            let n = r.len()?;
            let mut out = Vec::with_capacity(n.min(1 << 16));
            for _ in 0..n {
                out.push(long(r.i64()?));
            }
            Value::Array(out)
        }
        other => return Err(format!("tipo NBT desconocido {other}")),
    })
}

/// El documento entero, como el NbtDocument del launcher.
pub fn decode(data: &[u8]) -> Result<Value, String> {
    let (raw, compression) = decompress(data)?;
    let mut r = Reader { b: &raw, p: 0 };
    let t = r.u8()?;
    if t != 10 {
        return Err("la raíz no es un compound".into());
    }
    let name = r.string()?;
    let value = payload(&mut r, 10, 0)?;
    if r.p != raw.len() {
        return Err("sobran datos al final (¿Bedrock?)".into());
    }
    Ok(json!({ "root": { "type": "compound", "name": name, "value": value }, "format": "big", "compression": compression }))
}

#[derive(Deserialize)]
struct FilesArgs {
    files: Vec<String>,
}

/// Varios archivos a la vez: [{doc} o {error}] en el mismo orden.
pub fn decode_files(args: Value) -> Res {
    let a: FilesArgs = arg(args)?;
    Ok(Value::Array(
        a.files
            .par_iter()
            .map(|f| match std::fs::read(f).map_err(|e| e.to_string()).and_then(|d| decode(&d)) {
                Ok(doc) => json!({ "doc": doc }),
                Err(e) => json!({ "error": e }),
            })
            .collect(),
    ))
}

/// El último nombre que guardan Paper/Spigot en el jugador (bukkit.lastKnownName), de muchos a la vez.
pub fn player_names(args: Value) -> Res {
    let a: FilesArgs = arg(args)?;
    Ok(Value::Array(
        a.files
            .par_iter()
            .map(|f| {
                let name = std::fs::read(f)
                    .ok()
                    .and_then(|d| decode(&d).ok())
                    .and_then(|doc| doc["root"]["value"]["bukkit"]["value"]["lastKnownName"]["value"].as_str().map(|s| s.to_string()));
                json!(name)
            })
            .collect(),
    ))
}
