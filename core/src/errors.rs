use serde::Serialize;
use std::fmt;

/// Structured error returned to the TypeScript side over the IPC boundary.
///
/// The `code` values intentionally overlap with the MCP-facing error codes
/// documented in `docs/mcp.md` so a Rust error can be forwarded to an MCP
/// client with minimal translation.
#[derive(Debug, Clone, Serialize)]
pub struct CoreError {
    pub code: &'static str,
    pub message: String,
}

impl CoreError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new("INVALID_ARGUMENT", message)
    }

    pub fn path_outside_workspace(path: impl Into<String>) -> Self {
        Self::new(
            "PATH_OUTSIDE_WORKSPACE",
            format!(
                "The requested path is outside the workspace: {}",
                path.into()
            ),
        )
    }

    pub fn file_not_found(path: impl Into<String>) -> Self {
        Self::new("FILE_NOT_FOUND", format!("File not found: {}", path.into()))
    }

    pub fn file_too_large(limit: u64) -> Self {
        Self::new(
            "FILE_TOO_LARGE",
            format!("File exceeds the configured limit of {limit} bytes"),
        )
    }

    pub fn already_exists(path: impl Into<String>) -> Self {
        Self::new("ALREADY_EXISTS", format!("Already exists: {}", path.into()))
    }

    pub fn not_a_directory(path: impl Into<String>) -> Self {
        Self::new(
            "NOT_A_DIRECTORY",
            format!("Not a directory: {}", path.into()),
        )
    }

    pub fn is_a_directory(path: impl Into<String>) -> Self {
        Self::new("IS_A_DIRECTORY", format!("Is a directory: {}", path.into()))
    }

    pub fn process_not_found(id: impl Into<String>) -> Self {
        Self::new(
            "PROCESS_NOT_FOUND",
            format!("Unknown process id: {}", id.into()),
        )
    }

    pub fn process_timeout() -> Self {
        Self::new(
            "TERMINAL_TIMEOUT",
            "The process exceeded its allotted timeout".to_string(),
        )
    }

    pub fn git_command_failed(message: impl Into<String>) -> Self {
        Self::new("GIT_COMMAND_FAILED", message)
    }

    pub fn method_not_found(method: impl Into<String>) -> Self {
        Self::new(
            "METHOD_NOT_FOUND",
            format!("Unknown method: {}", method.into()),
        )
    }

    pub fn cancelled() -> Self {
        Self::new("REQUEST_CANCELLED", "The request was cancelled".to_string())
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("INTERNAL_ERROR", message)
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CoreError {}

impl From<std::io::Error> for CoreError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::NotFound => CoreError::new("FILE_NOT_FOUND", err.to_string()),
            std::io::ErrorKind::PermissionDenied => {
                CoreError::new("OS_PERMISSION_DENIED", err.to_string())
            }
            std::io::ErrorKind::AlreadyExists => CoreError::new("ALREADY_EXISTS", err.to_string()),
            _ => CoreError::new("IO_ERROR", err.to_string()),
        }
    }
}

pub type CoreResult<T> = Result<T, CoreError>;
