use serde::Serialize;

/// A single filesystem entry returned by directory listings and search.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified_ms: Option<u128>,
}

/// Lifecycle status of a tracked child process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProcessStatus {
    Running,
    Exited,
    Killed,
    TimedOut,
}

impl ProcessStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProcessStatus::Running => "running",
            ProcessStatus::Exited => "exited",
            ProcessStatus::Killed => "killed",
            ProcessStatus::TimedOut => "timedout",
        }
    }
}
