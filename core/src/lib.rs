pub mod errors;
pub mod filesystem;
pub mod git;
pub mod models;
pub mod process;
pub mod protocol;
pub mod search;
pub mod security;
pub mod watcher;

use errors::{CoreError, CoreResult};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Tracks in-flight cancellable requests (currently only `search.text`) so a
/// `system.cancel` request from TypeScript can stop a long-running search
/// without waiting for its timeout to elapse.
#[derive(Default)]
pub struct Cancellation {
    flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Cancellation {
    pub fn register(&self, request_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.flags
            .lock()
            .unwrap()
            .insert(request_id.to_string(), flag.clone());
        flag
    }

    pub fn unregister(&self, request_id: &str) {
        self.flags.lock().unwrap().remove(request_id);
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        match self.flags.lock().unwrap().get(request_id) {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }
}

/// Routes a decoded IPC request to the appropriate module. This is the only
/// place method names are mapped to handlers, keeping the dispatch table
/// (and therefore the full surface of what TypeScript can ask Rust to do)
/// visible in one place.
pub fn dispatch(
    method: &str,
    params: Value,
    request_id: &str,
    cancellation: &Cancellation,
) -> CoreResult<Value> {
    match method {
        "system.ping" => Ok(json!({ "pong": true, "version": env!("CARGO_PKG_VERSION") })),
        "system.cancel" => {
            let target = params
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| CoreError::invalid_argument("id is required"))?;
            Ok(json!({ "cancelled": cancellation.cancel(target) }))
        }

        "filesystem.read" => filesystem::read(params),
        "filesystem.write" => filesystem::write(params),
        "filesystem.delete" => filesystem::delete(params),
        "filesystem.move" => filesystem::move_path(params),
        "filesystem.copy" => filesystem::copy_path(params),
        "filesystem.list" => filesystem::list(params),
        "filesystem.exists" => filesystem::exists(params),

        "search.text" => {
            let flag = cancellation.register(request_id);
            let result = search::text(params, flag);
            cancellation.unregister(request_id);
            result
        }

        "process.spawn" => process::spawn(params),
        "process.output" => process::output(params),
        "process.kill" => process::kill(params),
        "process.list" => process::list(params),

        "git.status" => git::status(params),
        "git.diff" => git::diff(params),
        "git.log" => git::log(params),
        "git.branches" => git::branches(params),
        "git.show" => git::show(params),
        "git.remote" => git::remote(params),

        "watcher.start" => watcher::start(params),
        "watcher.stop" => watcher::stop(params),

        other => Err(CoreError::method_not_found(other)),
    }
}
