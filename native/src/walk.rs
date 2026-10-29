//! El árbol de tamaños de una carpeta (Ajustes → Almacenamiento), recorriendo las
//! subcarpetas en paralelo. Misma forma que el árbol de storage.ts:
//! {name, rel, bytes, isDir, children}, con los hijos de mayor a menor.

use crate::{arg, Ctx, Res};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

#[derive(Deserialize)]
struct Args {
    root: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    hidden: Vec<String>,
}

struct State<'a> {
    bytes: AtomicU64,
    files: AtomicU64,
    hidden: &'a [String],
}

fn walk(abs: &Path, rel: &str, name: &str, st: &State) -> (u64, Value) {
    let mut entries: Vec<_> = fs::read_dir(abs).map(|r| r.filter_map(|e| e.ok()).collect()).unwrap_or_default();
    entries.retain(|e| !st.hidden.iter().any(|h| *h == e.file_name().to_string_lossy()));
    let mut children: Vec<(u64, Value)> = entries
        .par_iter()
        .filter_map(|e| {
            // Los enlaces simbólicos no se siguen: el runtime de Java trae varios apuntando dentro de sí mismo
            let ft = e.file_type().ok()?;
            if ft.is_symlink() {
                return None;
            }
            let n = e.file_name().to_string_lossy().into_owned();
            let child_rel = if rel.is_empty() { n.clone() } else { format!("{rel}/{n}") };
            if ft.is_dir() {
                Some(walk(&e.path(), &child_rel, &n, st))
            } else if ft.is_file() {
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                st.bytes.fetch_add(size, Ordering::Relaxed);
                st.files.fetch_add(1, Ordering::Relaxed);
                Some((size, json!({ "name": n, "rel": child_rel, "bytes": size, "isDir": false, "children": [] })))
            } else {
                None
            }
        })
        .collect();
    children.sort_by(|a, b| b.0.cmp(&a.0));
    let total: u64 = children.iter().map(|c| c.0).sum();
    let kids: Vec<Value> = children.into_iter().map(|c| c.1).collect();
    (total, json!({ "name": name, "rel": rel, "bytes": total, "isDir": true, "children": kids }))
}

pub fn run(ctx: &Ctx, args: Value) -> Res {
    let a: Args = arg(args)?;
    let st = State { bytes: AtomicU64::new(0), files: AtomicU64::new(0), hidden: &a.hidden };
    let finished = AtomicBool::new(false);
    let tree = std::thread::scope(|s| {
        // Avance en vivo mientras se recorre (el total no se sabe hasta el final)
        s.spawn(|| {
            while !finished.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(120));
                ctx.progress(st.files.load(Ordering::Relaxed), u64::MAX, &st.bytes.load(Ordering::Relaxed).to_string());
            }
        });
        let (_, tree) = walk(Path::new(&a.root), "", a.name.as_deref().unwrap_or(""), &st);
        finished.store(true, Ordering::Relaxed);
        tree
    });
    Ok(json!({ "tree": tree, "bytes": st.bytes.load(Ordering::Relaxed), "files": st.files.load(Ordering::Relaxed) }))
}
