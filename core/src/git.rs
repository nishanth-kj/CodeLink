use crate::errors::{CoreError, CoreResult};
use crate::security::WorkspaceGuard;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;
use std::process::Command;

/// CodeLink never forwards a client-supplied command string to a shell.
/// Every Git operation below builds a fixed, known argv shape; the only
/// client-controlled inputs are path and revision *values*, which are
/// validated and passed as discrete arguments (never concatenated into a
/// shell string), so there is no command or argument injection surface.
fn run_git(root: &Path, args: &[&str]) -> CoreResult<(String, String, i32)> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| CoreError::new("GIT_NOT_AVAILABLE", format!("Failed to run git: {e}")))?;
    Ok((
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
        output.status.code().unwrap_or(-1),
    ))
}

fn ensure_success(stdout: String, stderr: String, code: i32) -> CoreResult<String> {
    if code != 0 {
        let message = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        return Err(CoreError::git_command_failed(message));
    }
    Ok(stdout)
}

fn validate_revision(rev: &str) -> CoreResult<()> {
    if rev.trim().is_empty() {
        return Err(CoreError::invalid_argument("rev must not be empty"));
    }
    if rev.starts_with('-') {
        return Err(CoreError::invalid_argument(
            "Revision must not start with '-'",
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct RootParams {
    root: String,
}

pub fn status(params: Value) -> CoreResult<Value> {
    let p: RootParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = WorkspaceGuard::new(&p.root)?;
    let (out, err, code) = run_git(guard.root(), &["status", "--porcelain=v1", "--branch"])?;
    let out = ensure_success(out, err, code)?;

    let ahead_re = Regex::new(r"ahead (\d+)").unwrap();
    let behind_re = Regex::new(r"behind (\d+)").unwrap();

    let mut branch: Option<String> = None;
    let mut upstream: Option<String> = None;
    let mut ahead: i64 = 0;
    let mut behind: i64 = 0;
    let mut files = Vec::new();

    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            let branch_part = rest.split(" [").next().unwrap_or(rest);
            if let Some((local, remote)) = branch_part.split_once("...") {
                branch = Some(local.to_string());
                upstream = Some(remote.to_string());
            } else {
                branch = Some(branch_part.to_string());
            }
            if let Some(caps) = ahead_re.captures(rest) {
                ahead = caps[1].parse().unwrap_or(0);
            }
            if let Some(caps) = behind_re.captures(rest) {
                behind = caps[1].parse().unwrap_or(0);
            }
        } else if line.len() >= 3 {
            files.push(json!({
                "path": line[3..],
                "indexStatus": &line[0..1],
                "worktreeStatus": &line[1..2],
            }));
        }
    }

    Ok(json!({
        "branch": branch,
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
        "files": files,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiffParams {
    root: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    staged: bool,
}

pub fn diff(params: Value) -> CoreResult<Value> {
    let p: DiffParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = WorkspaceGuard::new(&p.root)?;

    let mut args: Vec<String> = vec!["diff".to_string()];
    if p.staged {
        args.push("--staged".to_string());
    }
    if let Some(path) = &p.path {
        let resolved = guard.resolve(path)?;
        args.push("--".to_string());
        args.push(guard.to_relative_display(&resolved));
    }

    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let (out, err, code) = run_git(guard.root(), &args_ref)?;
    let out = ensure_success(out, err, code)?;
    Ok(json!({ "diff": out }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogParams {
    root: String,
    #[serde(default)]
    max_count: Option<u32>,
    #[serde(default)]
    path: Option<String>,
}

const RECORD_SEP: &str = "\u{1e}";
const FIELD_SEP: &str = "\u{1f}";

pub fn log(params: Value) -> CoreResult<Value> {
    let p: LogParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = WorkspaceGuard::new(&p.root)?;
    let max_count = p.max_count.unwrap_or(20).clamp(1, 200);

    let mut args: Vec<String> = vec![
        "log".to_string(),
        format!("-{max_count}"),
        format!(
            "--pretty=format:%H{FIELD_SEP}%an{FIELD_SEP}%ae{FIELD_SEP}%aI{FIELD_SEP}%s{RECORD_SEP}"
        ),
    ];
    if let Some(path) = &p.path {
        let resolved = guard.resolve(path)?;
        args.push("--".to_string());
        args.push(guard.to_relative_display(&resolved));
    }

    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let (out, err, code) = run_git(guard.root(), &args_ref)?;
    let out = ensure_success(out, err, code)?;

    let commits: Vec<Value> = out
        .split(RECORD_SEP)
        .map(str::trim)
        .filter(|record| !record.is_empty())
        .map(|record| {
            let parts: Vec<&str> = record.trim_start_matches('\n').split(FIELD_SEP).collect();
            json!({
                "hash": parts.first().copied().unwrap_or(""),
                "author": parts.get(1).copied().unwrap_or(""),
                "email": parts.get(2).copied().unwrap_or(""),
                "date": parts.get(3).copied().unwrap_or(""),
                "message": parts.get(4).copied().unwrap_or(""),
            })
        })
        .collect();

    Ok(json!({ "commits": commits }))
}

pub fn branches(params: Value) -> CoreResult<Value> {
    let p: RootParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = WorkspaceGuard::new(&p.root)?;
    let (out, err, code) = run_git(
        guard.root(),
        &[
            "branch",
            "-a",
            "--format=%(refname:short)\t%(HEAD)\t%(upstream:short)",
        ],
    )?;
    let out = ensure_success(out, err, code)?;

    let branches: Vec<Value> = out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            let upstream = parts.get(2).copied().unwrap_or("");
            json!({
                "name": parts.first().copied().unwrap_or(""),
                "current": parts.get(1).copied() == Some("*"),
                "upstream": if upstream.is_empty() { Value::Null } else { Value::String(upstream.to_string()) },
            })
        })
        .collect();

    Ok(json!({ "branches": branches }))
}

#[derive(Debug, Deserialize)]
struct ShowParams {
    root: String,
    rev: String,
    #[serde(default)]
    path: Option<String>,
}

pub fn show(params: Value) -> CoreResult<Value> {
    let p: ShowParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    validate_revision(&p.rev)?;
    let guard = WorkspaceGuard::new(&p.root)?;

    let target = match &p.path {
        Some(path) => {
            let resolved = guard.resolve(path)?;
            format!("{}:{}", p.rev, guard.to_relative_display(&resolved))
        }
        None => p.rev.clone(),
    };

    let (out, err, code) = run_git(guard.root(), &["show", "--no-color", &target])?;
    let out = ensure_success(out, err, code)?;
    Ok(json!({ "content": out }))
}

pub fn remote(params: Value) -> CoreResult<Value> {
    let p: RootParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    let guard = WorkspaceGuard::new(&p.root)?;
    let (out, err, code) = run_git(guard.root(), &["remote", "-v"])?;
    let out = ensure_success(out, err, code)?;

    let mut seen = HashSet::new();
    let mut remotes = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 && seen.insert(parts[0].to_string()) {
            remotes.push(json!({ "name": parts[0], "url": parts[1] }));
        }
    }
    Ok(json!({ "remotes": remotes }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;

    fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| {
            StdCommand::new("git")
                .args(args)
                .current_dir(dir.path())
                .output()
                .expect("git available in test environment")
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "test@example.com"]);
        run(&["config", "user.name", "Test"]);
        std::fs::write(dir.path().join("a.txt"), "hello").unwrap();
        run(&["add", "."]);
        run(&["commit", "-q", "-m", "initial"]);
        dir
    }

    #[test]
    fn status_reports_clean_tree() {
        let dir = init_repo();
        let result = status(json!({ "root": dir.path().to_string_lossy() })).unwrap();
        assert_eq!(result["files"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn status_reports_untracked_file() {
        let dir = init_repo();
        std::fs::write(dir.path().join("b.txt"), "new").unwrap();
        let result = status(json!({ "root": dir.path().to_string_lossy() })).unwrap();
        assert_eq!(result["files"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn log_returns_initial_commit() {
        let dir = init_repo();
        let result = log(json!({ "root": dir.path().to_string_lossy() })).unwrap();
        let commits = result["commits"].as_array().unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0]["message"], "initial");
    }

    #[test]
    fn show_rejects_flag_like_revision() {
        let dir = init_repo();
        let err = show(json!({ "root": dir.path().to_string_lossy(), "rev": "--upload-pack=x" }))
            .unwrap_err();
        assert_eq!(err.code, "INVALID_ARGUMENT");
    }

    #[test]
    fn diff_rejects_path_outside_workspace() {
        let dir = init_repo();
        let err = diff(json!({ "root": dir.path().to_string_lossy(), "path": "../outside.txt" }))
            .unwrap_err();
        assert_eq!(err.code, "PATH_OUTSIDE_WORKSPACE");
    }
}
