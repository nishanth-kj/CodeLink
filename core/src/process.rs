use crate::errors::{CoreError, CoreResult};
use crate::models::ProcessStatus;
use crate::security::WorkspaceGuard;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const WATCHDOG_POLL_MS: u64 = 50;

struct TrackedProcess {
    child: Arc<Mutex<Child>>,
    command: String,
    args: Vec<String>,
    cwd: String,
    started_at_ms: u128,
    stdout_buf: Arc<Mutex<Vec<u8>>>,
    stderr_buf: Arc<Mutex<Vec<u8>>>,
    output_truncated: Arc<AtomicBool>,
    status: Arc<Mutex<ProcessStatus>>,
    exit_code: Arc<Mutex<Option<i32>>>,
}

type Registry = Mutex<HashMap<String, TrackedProcess>>;
static REGISTRY: OnceLock<Registry> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn registry() -> &'static Registry {
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Substrings that mark an environment variable as likely to hold a
/// credential. Matched case-insensitively against the variable name (not
/// its value): this is a name-based allowlist-by-exclusion, not a secret
/// scanner, and callers may still pass a sensitive value explicitly via
/// `params.env` if they really mean to.
const SENSITIVE_ENV_SUBSTRINGS: [&str; 6] = [
    "API_KEY",
    "TOKEN",
    "PASSWORD",
    "SECRET",
    "PRIVATE_KEY",
    "CREDENTIAL",
];

fn is_sensitive_env_key(key: &str) -> bool {
    let upper = key.to_uppercase();
    upper.starts_with("AWS_")
        || SENSITIVE_ENV_SUBSTRINGS
            .iter()
            .any(|needle| upper.contains(needle))
}

/// A spawned process must still be able to resolve `PATH` (or it can't find
/// `git`, `npm`, etc. by name), so `spawn()` does not simply clear the
/// environment; it starts from codelink-core's own inherited environment
/// (itself inherited from the VS Code extension host) and drops anything
/// that looks like a credential, matching the default terminal/process
/// security posture described in docs/security.md.
fn filtered_inherited_env() -> impl Iterator<Item = (String, String)> {
    std::env::vars().filter(|(key, _)| !is_sensitive_env_key(key))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnParams {
    root: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    max_output_bytes: Option<u64>,
}

pub fn spawn(params: Value) -> CoreResult<Value> {
    let p: SpawnParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    if p.command.trim().is_empty() {
        return Err(CoreError::invalid_argument("command must not be empty"));
    }

    let guard = WorkspaceGuard::new(&p.root)?;
    let cwd_resolved = guard.resolve(p.cwd.as_deref().unwrap_or(""))?;
    if !cwd_resolved.is_dir() {
        return Err(CoreError::not_a_directory(p.cwd.unwrap_or_default()));
    }

    let max_output_bytes = p
        .max_output_bytes
        .unwrap_or(DEFAULT_MAX_OUTPUT_BYTES as u64) as usize;

    let mut command = Command::new(&p.command);
    command
        .args(&p.args)
        .current_dir(&cwd_resolved)
        .env_clear()
        .envs(filtered_inherited_env())
        .envs(&p.env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        CoreError::new(
            "PROCESS_SPAWN_FAILED",
            format!("Failed to start '{}': {e}", p.command),
        )
    })?;

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let id = format!("proc-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
    let stdout_buf = Arc::new(Mutex::new(Vec::new()));
    let stderr_buf = Arc::new(Mutex::new(Vec::new()));
    let output_truncated = Arc::new(AtomicBool::new(false));
    let status = Arc::new(Mutex::new(ProcessStatus::Running));
    let exit_code = Arc::new(Mutex::new(None));

    if let Some(pipe) = stdout_pipe {
        spawn_reader_thread(
            pipe,
            stdout_buf.clone(),
            output_truncated.clone(),
            max_output_bytes,
        );
    }
    if let Some(pipe) = stderr_pipe {
        spawn_reader_thread(
            pipe,
            stderr_buf.clone(),
            output_truncated.clone(),
            max_output_bytes,
        );
    }

    let child_arc = Arc::new(Mutex::new(child));
    spawn_watchdog(
        child_arc.clone(),
        status.clone(),
        exit_code.clone(),
        p.timeout_ms,
    );

    registry().lock().unwrap().insert(
        id.clone(),
        TrackedProcess {
            child: child_arc,
            command: p.command.clone(),
            args: p.args.clone(),
            cwd: guard.to_relative_display(&cwd_resolved),
            started_at_ms: now_ms(),
            stdout_buf,
            stderr_buf,
            output_truncated,
            status,
            exit_code,
        },
    );

    Ok(json!({ "id": id, "command": p.command, "args": p.args, "status": "running" }))
}

fn spawn_reader_thread<R: Read + Send + 'static>(
    mut pipe: R,
    buf: Arc<Mutex<Vec<u8>>>,
    truncated: Arc<AtomicBool>,
    max_bytes: usize,
) {
    thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let mut buffer = buf.lock().unwrap();
                    let remaining = max_bytes.saturating_sub(buffer.len());
                    if remaining == 0 {
                        truncated.store(true, Ordering::Relaxed);
                        continue;
                    }
                    let take = remaining.min(n);
                    buffer.extend_from_slice(&chunk[..take]);
                    if take < n {
                        truncated.store(true, Ordering::Relaxed);
                    }
                }
            }
        }
    });
}

fn spawn_watchdog(
    child: Arc<Mutex<Child>>,
    status: Arc<Mutex<ProcessStatus>>,
    exit_code: Arc<Mutex<Option<i32>>>,
    timeout_ms: Option<u64>,
) {
    thread::spawn(move || {
        let deadline = timeout_ms.map(|ms| Instant::now() + Duration::from_millis(ms));
        loop {
            {
                let mut guard = child.lock().unwrap();
                match guard.try_wait() {
                    Ok(Some(exit_status)) => {
                        *exit_code.lock().unwrap() = exit_status.code();
                        *status.lock().unwrap() = ProcessStatus::Exited;
                        return;
                    }
                    Ok(None) => {}
                    Err(_) => {
                        *status.lock().unwrap() = ProcessStatus::Exited;
                        return;
                    }
                }
            }
            if let Some(dl) = deadline {
                if Instant::now() >= dl {
                    let mut guard = child.lock().unwrap();
                    let _ = guard.kill();
                    let _ = guard.wait();
                    *status.lock().unwrap() = ProcessStatus::TimedOut;
                    return;
                }
            }
            thread::sleep(Duration::from_millis(WATCHDOG_POLL_MS));
        }
    });
}

#[derive(Debug, Deserialize)]
struct IdParams {
    id: String,
}

pub fn output(params: Value) -> CoreResult<Value> {
    let p: IdParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let reg = registry().lock().unwrap();
    let proc = reg
        .get(&p.id)
        .ok_or_else(|| CoreError::process_not_found(&p.id))?;

    let stdout = String::from_utf8_lossy(&proc.stdout_buf.lock().unwrap()).to_string();
    let stderr = String::from_utf8_lossy(&proc.stderr_buf.lock().unwrap()).to_string();
    let status = *proc.status.lock().unwrap();
    let exit_code = *proc.exit_code.lock().unwrap();

    Ok(json!({
        "id": p.id,
        "stdout": stdout,
        "stderr": stderr,
        "status": status.as_str(),
        "exitCode": exit_code,
        "truncated": proc.output_truncated.load(Ordering::Relaxed),
    }))
}

pub fn kill(params: Value) -> CoreResult<Value> {
    let p: IdParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let reg = registry().lock().unwrap();
    let proc = reg
        .get(&p.id)
        .ok_or_else(|| CoreError::process_not_found(&p.id))?;

    let already_finished = matches!(
        *proc.status.lock().unwrap(),
        ProcessStatus::Exited | ProcessStatus::TimedOut
    );
    if !already_finished {
        let mut child = proc.child.lock().unwrap();
        child.kill().map_err(CoreError::from)?;
        let _ = child.wait();
        *proc.status.lock().unwrap() = ProcessStatus::Killed;
    }

    Ok(json!({ "id": p.id, "status": proc.status.lock().unwrap().as_str() }))
}

pub fn list(_params: Value) -> CoreResult<Value> {
    let reg = registry().lock().unwrap();
    let processes: Vec<Value> = reg
        .iter()
        .map(|(id, proc)| {
            json!({
                "id": id,
                "command": proc.command,
                "args": proc.args,
                "cwd": proc.cwd,
                "startedAtMs": proc.started_at_ms,
                "status": proc.status.lock().unwrap().as_str(),
                "exitCode": *proc.exit_code.lock().unwrap(),
            })
        })
        .collect();
    Ok(json!({ "processes": processes }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn detects_sensitive_env_keys() {
        assert!(is_sensitive_env_key("OPENAI_API_KEY"));
        assert!(is_sensitive_env_key("GITHUB_TOKEN"));
        assert!(is_sensitive_env_key("AWS_SECRET_ACCESS_KEY"));
        assert!(is_sensitive_env_key("aws_access_key_id"));
        assert!(is_sensitive_env_key("DB_PASSWORD"));
        assert!(!is_sensitive_env_key("PATH"));
        assert!(!is_sensitive_env_key("HOME"));
        assert!(!is_sensitive_env_key("LANG"));
    }

    fn wait_for_exit(id: &str, timeout: Duration) -> Value {
        let deadline = Instant::now() + timeout;
        loop {
            let result = output(json!({ "id": id })).unwrap();
            if result["status"] != "running" || Instant::now() >= deadline {
                return result;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn spawned_process_inherits_path_but_not_sensitive_vars() {
        // SAFETY: this test does not run concurrently with other tests that
        // read/write the process environment (cargo test runs each test in
        // its own thread, but nothing else in this crate touches env vars).
        unsafe {
            std::env::set_var("CODELINK_TEST_SECRET_TOKEN", "should-not-appear");
        }

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let (command, args) = if cfg!(windows) {
            ("cmd".to_string(), vec!["/C".to_string(), "set".to_string()])
        } else {
            ("env".to_string(), Vec::<String>::new())
        };

        let spawn_result =
            spawn(json!({ "root": root, "command": command, "args": args })).unwrap();
        let id = spawn_result["id"].as_str().unwrap().to_string();
        let result = wait_for_exit(&id, Duration::from_secs(5));

        let stdout = result["stdout"].as_str().unwrap_or("");
        assert!(
            !stdout.contains("CODELINK_TEST_SECRET_TOKEN"),
            "sensitive var leaked into child env: {stdout}"
        );
        assert!(
            result["status"] == "exited",
            "expected process to exit, got {result:?}"
        );

        unsafe {
            std::env::remove_var("CODELINK_TEST_SECRET_TOKEN");
        }
    }

    #[test]
    fn output_reports_unknown_process() {
        let err = output(json!({ "id": "does-not-exist" })).unwrap_err();
        assert_eq!(err.code, "PROCESS_NOT_FOUND");
    }

    #[test]
    fn timeout_kills_a_long_running_process() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let (command, args) = if cfg!(windows) {
            (
                "ping".to_string(),
                vec!["-n".to_string(), "30".to_string(), "127.0.0.1".to_string()],
            )
        } else {
            ("sleep".to_string(), vec!["30".to_string()])
        };

        let spawn_result = spawn(json!({
            "root": root,
            "command": command,
            "args": args,
            "timeoutMs": 200,
        }))
        .unwrap();
        let id = spawn_result["id"].as_str().unwrap().to_string();

        let result = wait_for_exit(&id, Duration::from_secs(5));
        assert_eq!(result["status"], "timedout");
    }
}
