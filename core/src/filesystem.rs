use crate::errors::{CoreError, CoreResult};
use crate::models::FileEntry;
use crate::security::{build_exclude_set, is_excluded, WorkspaceGuard};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::UNIX_EPOCH;

const DEFAULT_MAX_READ_BYTES: u64 = 10 * 1024 * 1024;
const DEFAULT_MAX_WRITE_BYTES: u64 = 10 * 1024 * 1024;
const DEFAULT_LIST_LIMIT: usize = 1000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RootPathParams {
    root: String,
    path: String,
    #[serde(default)]
    max_bytes: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteParams {
    root: String,
    path: String,
    content: String,
    #[serde(default)]
    encoding: Option<String>,
    #[serde(default)]
    max_bytes: Option<u64>,
    #[serde(default)]
    must_not_exist: Option<bool>,
    #[serde(default = "default_true")]
    create_parents: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteParams {
    root: String,
    path: String,
    #[serde(default)]
    recursive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferParams {
    root: String,
    from: String,
    to: String,
    #[serde(default)]
    overwrite: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListParams {
    root: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    glob: Option<String>,
    #[serde(default)]
    max_depth: Option<usize>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    exclude: Vec<String>,
}

fn guard_for(root: &str) -> CoreResult<WorkspaceGuard> {
    WorkspaceGuard::new(root)
}

pub fn read(params: Value) -> CoreResult<Value> {
    let p: RootPathParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = guard_for(&p.root)?;
    let resolved = guard.resolve(&p.path)?;

    let metadata = fs::metadata(&resolved).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => CoreError::file_not_found(&p.path),
        _ => CoreError::from(e),
    })?;
    if metadata.is_dir() {
        return Err(CoreError::is_a_directory(&p.path));
    }

    let limit = p.max_bytes.unwrap_or(DEFAULT_MAX_READ_BYTES);
    if metadata.len() > limit {
        return Err(CoreError::file_too_large(limit));
    }

    let bytes = fs::read(&resolved).map_err(CoreError::from)?;
    let (content, encoding) = match String::from_utf8(bytes.clone()) {
        Ok(text) => (text, "utf8"),
        Err(_) => (
            base64::engine::general_purpose::STANDARD.encode(&bytes),
            "base64",
        ),
    };

    Ok(json!({
        "path": guard.to_relative_display(&resolved),
        "content": content,
        "encoding": encoding,
        "size": bytes.len() as u64,
    }))
}

pub fn write(params: Value) -> CoreResult<Value> {
    let p: WriteParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = guard_for(&p.root)?;
    let resolved = guard.resolve(&p.path)?;

    if p.must_not_exist.unwrap_or(false) && resolved.exists() {
        return Err(CoreError::already_exists(&p.path));
    }
    if resolved.is_dir() {
        return Err(CoreError::is_a_directory(&p.path));
    }

    let bytes: Vec<u8> = match p.encoding.as_deref() {
        Some("base64") => base64::engine::general_purpose::STANDARD
            .decode(&p.content)
            .map_err(|e| CoreError::invalid_argument(format!("Invalid base64 content: {e}")))?,
        _ => p.content.into_bytes(),
    };

    let limit = p.max_bytes.unwrap_or(DEFAULT_MAX_WRITE_BYTES);
    if bytes.len() as u64 > limit {
        return Err(CoreError::file_too_large(limit));
    }

    if let Some(parent) = resolved.parent() {
        if !parent.exists() {
            if p.create_parents {
                fs::create_dir_all(parent).map_err(CoreError::from)?;
            } else {
                return Err(CoreError::invalid_argument(format!(
                    "Parent directory does not exist: {}",
                    guard.to_relative_display(parent)
                )));
            }
        }
    }

    // Write atomically: stage in a sibling temp file, then rename over the
    // target so a crash or concurrent read never observes a partial write.
    let parent = resolved.parent().unwrap_or_else(|| guard.root());
    let mut tmp_path = parent.to_path_buf();
    let tmp_name = format!(
        ".codelink-tmp-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    tmp_path.push(tmp_name);

    let mut file = fs::File::create(&tmp_path).map_err(CoreError::from)?;
    file.write_all(&bytes).map_err(CoreError::from)?;
    file.sync_all().ok();
    drop(file);
    fs::rename(&tmp_path, &resolved).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        CoreError::from(e)
    })?;

    Ok(json!({
        "path": guard.to_relative_display(&resolved),
        "bytesWritten": bytes.len() as u64,
    }))
}

pub fn delete(params: Value) -> CoreResult<Value> {
    let p: DeleteParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = guard_for(&p.root)?;
    let resolved = guard.resolve(&p.path)?;
    guard.guard_against_root_deletion(&resolved)?;

    let metadata = fs::symlink_metadata(&resolved).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => CoreError::file_not_found(&p.path),
        _ => CoreError::from(e),
    })?;

    if metadata.is_dir() {
        if p.recursive {
            fs::remove_dir_all(&resolved).map_err(CoreError::from)?;
        } else {
            fs::remove_dir(&resolved).map_err(CoreError::from)?;
        }
    } else {
        fs::remove_file(&resolved).map_err(CoreError::from)?;
    }

    Ok(json!({ "path": guard.to_relative_display(&resolved), "deleted": true }))
}

pub fn move_path(params: Value) -> CoreResult<Value> {
    let p: TransferParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = guard_for(&p.root)?;
    let from = guard.resolve(&p.from)?;
    let to = guard.resolve(&p.to)?;
    guard.guard_against_root_deletion(&from)?;

    if !from.exists() {
        return Err(CoreError::file_not_found(&p.from));
    }
    if to.exists() && !p.overwrite {
        return Err(CoreError::already_exists(&p.to));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(CoreError::from)?;
    }
    fs::rename(&from, &to).map_err(CoreError::from)?;

    Ok(json!({
        "from": guard.to_relative_display(&from),
        "to": guard.to_relative_display(&to),
    }))
}

pub fn copy_path(params: Value) -> CoreResult<Value> {
    let p: TransferParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = guard_for(&p.root)?;
    let from = guard.resolve(&p.from)?;
    let to = guard.resolve(&p.to)?;

    if !from.exists() {
        return Err(CoreError::file_not_found(&p.from));
    }
    if to.exists() && !p.overwrite {
        return Err(CoreError::already_exists(&p.to));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(CoreError::from)?;
    }

    if from.is_dir() {
        copy_dir_recursive(&from, &to)?;
    } else {
        fs::copy(&from, &to).map_err(CoreError::from)?;
    }

    Ok(json!({
        "from": guard.to_relative_display(&from),
        "to": guard.to_relative_display(&to),
    }))
}

fn copy_dir_recursive(from: &Path, to: &Path) -> CoreResult<()> {
    fs::create_dir_all(to).map_err(CoreError::from)?;
    for entry in fs::read_dir(from).map_err(CoreError::from)? {
        let entry = entry.map_err(CoreError::from)?;
        let file_type = entry.file_type().map_err(CoreError::from)?;
        let dest = to.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), &dest).map_err(CoreError::from)?;
        }
    }
    Ok(())
}

pub fn exists(params: Value) -> CoreResult<Value> {
    let p: RootPathParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = guard_for(&p.root)?;
    let resolved = guard.resolve(&p.path)?;

    match fs::symlink_metadata(&resolved) {
        Ok(metadata) => Ok(json!({
            "exists": true,
            "isDirectory": metadata.is_dir(),
            "isFile": metadata.is_file(),
            "size": metadata.len(),
        })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(json!({ "exists": false, "isDirectory": false, "isFile": false, "size": 0 }))
        }
        Err(e) => Err(CoreError::from(e)),
    }
}

pub fn list(params: Value) -> CoreResult<Value> {
    let p: ListParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = guard_for(&p.root)?;
    let start = guard.resolve(p.path.as_deref().unwrap_or(""))?;
    if !start.exists() {
        return Err(CoreError::file_not_found(p.path.unwrap_or_default()));
    }

    let exclude_set = build_exclude_set(&p.exclude)?;
    let glob_matcher = match &p.glob {
        Some(pattern) => Some(
            globset::Glob::new(pattern)
                .map_err(|e| CoreError::invalid_argument(format!("Invalid glob '{pattern}': {e}")))?
                .compile_matcher(),
        ),
        None => None,
    };

    let limit = p.limit.unwrap_or(DEFAULT_LIST_LIMIT);
    let mut builder = ignore::WalkBuilder::new(&start);
    builder.hidden(false).standard_filters(false);
    if let Some(depth) = p.max_depth {
        builder.max_depth(Some(depth));
    }

    // Prune excluded directories from the walk itself (not just the output):
    // an excluded directory like `node_modules` is checked as if it had a
    // child (`node_modules/probe`) so a pattern of the form `**/dir/**`
    // excludes the directory entry too, and the walker never descends into
    // it, which matters for directories that can be very large.
    let filter_guard = guard.clone();
    let filter_exclude_set = exclude_set.clone();
    let filter_start = start.clone();
    builder.filter_entry(move |entry| {
        let path = entry.path();
        if path == filter_start {
            return true;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let relative_display = filter_guard.to_relative_display(path);
        let check_path = if is_dir {
            format!("{relative_display}/probe")
        } else {
            relative_display
        };
        !is_excluded(&check_path, &filter_exclude_set)
    });

    let mut entries = Vec::new();
    let mut truncated = false;
    for result in builder.build() {
        let entry = match result {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if path == start {
            continue;
        }
        let relative_display = guard.to_relative_display(path);
        if let Some(matcher) = &glob_matcher {
            if !matcher.is_match(&relative_display) {
                continue;
            }
        }

        if entries.len() >= limit {
            truncated = true;
            break;
        }

        let metadata = entry.metadata().ok();
        entries.push(FileEntry {
            path: relative_display,
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            is_symlink: entry.path_is_symlink(),
            size: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
            modified_ms: metadata
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis()),
        });
    }

    Ok(json!({ "entries": entries, "truncated": truncated }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn root_json(dir: &Path) -> String {
        dir.to_string_lossy().to_string()
    }

    #[test]
    fn write_then_read_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let root = root_json(dir.path());
        write(json!({ "root": root, "path": "a.txt", "content": "hello" })).unwrap();
        let result = read(json!({ "root": root, "path": "a.txt" })).unwrap();
        assert_eq!(result["content"], "hello");
        assert_eq!(result["encoding"], "utf8");
    }

    #[test]
    fn read_rejects_oversized_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = root_json(dir.path());
        write(json!({ "root": root, "path": "big.txt", "content": "0123456789" })).unwrap();
        let err = read(json!({ "root": root, "path": "big.txt", "maxBytes": 5 })).unwrap_err();
        assert_eq!(err.code, "FILE_TOO_LARGE");
    }

    #[test]
    fn write_respects_max_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let root = root_json(dir.path());
        let err = write(json!({
            "root": root,
            "path": "a.txt",
            "content": "hello world",
            "maxBytes": 2
        }))
        .unwrap_err();
        assert_eq!(err.code, "FILE_TOO_LARGE");
    }

    #[test]
    fn read_rejects_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let root = root_json(dir.path());
        let err = read(json!({ "root": root, "path": "../../etc/passwd" })).unwrap_err();
        assert_eq!(err.code, "PATH_OUTSIDE_WORKSPACE");
    }

    #[test]
    fn delete_refuses_workspace_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = root_json(dir.path());
        let err = delete(json!({ "root": root, "path": "." })).unwrap_err();
        assert_eq!(err.code, "INVALID_ARGUMENT");
    }

    #[test]
    fn create_fails_when_must_not_exist_and_present() {
        let dir = tempfile::tempdir().unwrap();
        let root = root_json(dir.path());
        write(json!({ "root": root, "path": "a.txt", "content": "1" })).unwrap();
        let err = write(json!({
            "root": root,
            "path": "a.txt",
            "content": "2",
            "mustNotExist": true
        }))
        .unwrap_err();
        assert_eq!(err.code, "ALREADY_EXISTS");
    }

    #[test]
    fn list_respects_exclude_patterns() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("node_modules")).unwrap();
        std::fs::write(dir.path().join("node_modules/pkg.js"), "x").unwrap();
        std::fs::write(dir.path().join("app.ts"), "x").unwrap();
        let root = root_json(dir.path());
        let result = list(json!({
            "root": root,
            "exclude": ["**/node_modules/**"]
        }))
        .unwrap();
        let entries = result["entries"].as_array().unwrap();
        assert!(entries.iter().any(|e| e["path"] == "app.ts"));
        assert!(!entries
            .iter()
            .any(|e| e["path"].as_str().unwrap().contains("node_modules")));
    }
}
