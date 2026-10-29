//! Comprobar muchos archivos a la vez: si existen, su tamaño y (si se pide) su hash.
//! Es lo que hace el launcher con los miles de assets y librerías al abrir o reparar el juego.

use crate::{arg, Ctx, Res};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use sha2::Sha256;
use std::fs::File;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Deserialize)]
struct Item {
    path: String,
    /// "sha1" o "sha256"; sin él solo se mira si existe y su tamaño
    #[serde(default)]
    algo: Option<String>,
}

#[derive(Deserialize)]
struct Args {
    files: Vec<Item>,
}

fn digest<D: Digest>(path: &str) -> std::io::Result<String> {
    let mut f = File::open(path)?;
    let mut h = D::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// Para cada archivo: {exists, size, hash?}, en el mismo orden.
pub fn run(ctx: &Ctx, args: Value) -> Res {
    let a: Args = arg(args)?;
    let total = a.files.len() as u64;
    let done = AtomicU64::new(0);
    let out: Vec<Value> = a
        .files
        .par_iter()
        .map(|it| {
            let r = match std::fs::metadata(&it.path) {
                Err(_) => json!({ "exists": false, "size": 0 }),
                Ok(m) => {
                    let hash = match it.algo.as_deref() {
                        Some("sha1") => digest::<Sha1>(&it.path).ok(),
                        Some("sha256") => digest::<Sha256>(&it.path).ok(),
                        _ => None,
                    };
                    json!({ "exists": true, "size": m.len(), "hash": hash })
                }
            };
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            ctx.progress(n, total, &it.path);
            r
        })
        .collect();
    Ok(Value::Array(out))
}
