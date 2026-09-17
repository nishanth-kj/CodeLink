use crate::errors::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, Write};
use std::sync::{Mutex, OnceLock};

/// Maximum size, in bytes, of a single line read from stdin. Guards against a
/// misbehaving or compromised client sending an unbounded line and exhausting
/// memory before a JSON parse is even attempted.
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    pub id: String,
    pub method: String,
    #[serde(default = "default_params")]
    pub params: Value,
}

fn default_params() -> Value {
    Value::Null
}

#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum Response {
    Success {
        id: String,
        success: bool,
        result: Value,
    },
    Failure {
        id: String,
        success: bool,
        error: CoreError,
    },
}

impl Response {
    pub fn ok(id: impl Into<String>, result: Value) -> Self {
        Response::Success {
            id: id.into(),
            success: true,
            result,
        }
    }

    pub fn err(id: impl Into<String>, error: CoreError) -> Self {
        Response::Failure {
            id: id.into(),
            success: false,
            error,
        }
    }

    pub fn to_line(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|e| {
            format!(
                "{{\"id\":\"unknown\",\"success\":false,\"error\":{{\"code\":\"SERIALIZATION_ERROR\",\"message\":{:?}}}}}",
                e.to_string()
            )
        })
    }
}

impl Notification {
    pub fn to_line(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

/// stdout is reserved exclusively for protocol messages (responses and
/// notifications), one JSON object per line. All diagnostic/log output
/// must go to stderr instead (see `main.rs`). A single mutex serializes
/// writes so concurrent request-handling threads never interleave lines.
static STDOUT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub fn write_line(line: &str) {
    let lock = STDOUT_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut stdout = io::stdout();
    let _ = writeln!(stdout, "{line}");
    let _ = stdout.flush();
}
