use crate::errors::{CoreError, CoreResult};
use crate::protocol::{write_line, Notification};
use crate::security::WorkspaceGuard;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::mpsc::channel;
use std::sync::{Mutex, OnceLock};
use std::thread;

/// A live filesystem watch. Dropping the `RecommendedWatcher` stops it, so
/// `stop()` simply removes the handle from the registry.
struct WatchHandle {
    _watcher: RecommendedWatcher,
}

type Watchers = Mutex<HashMap<String, WatchHandle>>;
static WATCHERS: OnceLock<Watchers> = OnceLock::new();

fn watchers() -> &'static Watchers {
    WATCHERS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Deserialize)]
struct StartParams {
    root: String,
    #[serde(default)]
    id: Option<String>,
}

fn classify(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "created",
        EventKind::Modify(_) => "modified",
        EventKind::Remove(_) => "removed",
        _ => "other",
    }
}

pub fn start(params: Value) -> CoreResult<Value> {
    let p: StartParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = WorkspaceGuard::new(&p.root)?;
    let watch_id = p.id.unwrap_or_else(|| "default".to_string());
    let watch_root = guard.root().to_path_buf();

    let (tx, rx) = channel();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(tx)
        .map_err(|e| CoreError::internal(format!("Failed to create watcher: {e}")))?;
    watcher
        .watch(&watch_root, RecursiveMode::Recursive)
        .map_err(|e| {
            CoreError::internal(format!("Failed to watch '{}': {e}", watch_root.display()))
        })?;

    let watch_id_for_thread = watch_id.clone();
    let display_guard = WorkspaceGuard::new(&watch_root)?;
    thread::spawn(move || {
        for event in rx.into_iter().flatten() {
            let kind = classify(&event.kind);
            for path in event.paths {
                let relative = display_guard.to_relative_display(&path);
                let notification = Notification {
                    method: "workspace.fileChanged".to_string(),
                    params: json!({ "watchId": watch_id_for_thread, "path": relative, "kind": kind }),
                };
                write_line(&notification.to_line());
            }
        }
    });

    watchers()
        .lock()
        .unwrap()
        .insert(watch_id.clone(), WatchHandle { _watcher: watcher });
    Ok(json!({ "watchId": watch_id, "status": "watching" }))
}

#[derive(Debug, Deserialize)]
struct StopParams {
    #[serde(default)]
    id: Option<String>,
}

pub fn stop(params: Value) -> CoreResult<Value> {
    let p: StopParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let watch_id = p.id.unwrap_or_else(|| "default".to_string());
    let removed = watchers().lock().unwrap().remove(&watch_id).is_some();
    Ok(json!({ "watchId": watch_id, "stopped": removed }))
}
