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
