//! fport1-native: los trabajos pesados de ModpackLauncher en un proceso aparte.
//!
//! El launcher (Electron) lo arranca una vez y le manda peticiones, una por línea de JSON
//! por la entrada estándar:
//!   {"id": 1, "cmd": "hash", "args": {...}}
//! y recibe, una por línea por la salida estándar:
//!   {"id": 1, "progress": {"done": 10, "total": 100, "msg": "..."}}   (cero o más)
//!   {"id": 1, "ok": true, "result": ...}  o  {"id": 1, "ok": false, "error": "..."}
//!
//! Cada petición va en su propio hilo, así que se pueden hacer varias a la vez. Si algo
//! falla aquí (incluso un pánico), el launcher recibe el error y lo hace en JavaScript como
//! siempre: este programa solo acelera, nunca es imprescindible.

mod hash;
mod nbt;
mod region;
mod walk;
mod zips;

use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Deserialize)]
struct Request {
    id: u64,
    cmd: String,
    #[serde(default)]
    args: Value,
}

/// Lo que cada trabajo necesita para avisar de su avance.
pub struct Ctx {
    id: u64,
    out: Arc<Mutex<io::Stdout>>,
    last: Mutex<Instant>,
}

impl Ctx {
    fn send(&self, v: &Value) {
        let mut out = self.out.lock().unwrap_or_else(|e| e.into_inner());
        let _ = writeln!(out, "{v}");
        let _ = out.flush();
    }

    /// Avance, como mucho unas diez veces por segundo (el último siempre sale).
    pub fn progress(&self, done: u64, total: u64, msg: &str) {
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        if done < total && last.elapsed() < Duration::from_millis(100) {
            return;
        }
        *last = Instant::now();
        drop(last);
        self.send(&json!({ "id": self.id, "progress": { "done": done, "total": total, "msg": msg } }));
    }
}

pub type Res = Result<Value, String>;

pub fn arg<T: for<'de> Deserialize<'de>>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("argumentos no válidos: {e}"))
}

fn dispatch(ctx: &Ctx, cmd: &str, args: Value) -> Res {
    match cmd {
        "ping" => Ok(json!({ "version": env!("CARGO_PKG_VERSION"), "threads": rayon::current_num_threads() })),
        "hash" => hash::run(ctx, args),
        "zip-list" => zips::list(args),
        "zip-read" => zips::read(args),
        "zip-extract" => zips::extract(ctx, args),
        "zip-create" => zips::create(ctx, args),
        "jars-read" => zips::jars_read(ctx, args),
        "nbt-decode" => nbt::decode_files(args),
        "player-names" => nbt::player_names(args),
        "walk" => walk::run(ctx, args),
        "world-prune" => region::prune(ctx, args),
        other => Err(format!("orden desconocida: {other}")),
    }
}

fn main() {
    let out = Arc::new(Mutex::new(io::stdout()));
    let stdin = io::stdin();
    let mut jobs = Vec::new();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let req: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let mut o = out.lock().unwrap_or_else(|e| e.into_inner());
                let _ = writeln!(o, "{}", json!({ "id": 0, "ok": false, "error": format!("petición no válida: {e}") }));
                continue;
            }
        };
        let out = out.clone();
        jobs.push(std::thread::spawn(move || {
            let ctx = Ctx { id: req.id, out, last: Mutex::new(Instant::now() - Duration::from_secs(1)) };
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| dispatch(&ctx, &req.cmd, req.args)))
                .unwrap_or_else(|p| {
                    let msg = p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()));
                    Err(format!("fallo interno: {}", msg.unwrap_or_default()))
                });
            let v = match res {
                Ok(result) => json!({ "id": req.id, "ok": true, "result": result }),
                Err(error) => json!({ "id": req.id, "ok": false, "error": error }),
            };
            ctx.send(&v);
        }));
        jobs.retain(|j| !j.is_finished());
    }
    // Sin más peticiones (el launcher se cerró): se terminan las que estaban en marcha
    for j in jobs {
        let _ = j.join();
    }
}
