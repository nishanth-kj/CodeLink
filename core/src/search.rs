use crate::errors::{CoreError, CoreResult};
use crate::security::{build_exclude_set, is_excluded, WorkspaceGuard};
use regex::RegexBuilder;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const DEFAULT_MAX_RESULTS: usize = 100;
const HARD_MAX_RESULTS: usize = 10_000;
const DEFAULT_MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS: u64 = 5_000;
const MAX_LINE_DISPLAY_CHARS: usize = 500;
/// How often (in scanned lines) the deadline/cancellation flag is polled.
/// Checking on every line would make very large files dominate runtime
/// with `Instant::now()` calls; checking too rarely delays cancellation.
const CHECK_EVERY_N_LINES: usize = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchParams {
    root: String,
    query: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    file_pattern: Option<String>,
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    is_regex: bool,
    #[serde(default)]
    max_results: Option<usize>,
    #[serde(default)]
    max_file_size: Option<u64>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    exclude: Vec<String>,
}

pub fn text(params: Value, cancelled: Arc<AtomicBool>) -> CoreResult<Value> {
    let p: SearchParams = serde_json::from_value(params)
        .map_err(|e| CoreError::invalid_argument(format!("Invalid params: {e}")))?;
    if p.query.is_empty() {
        return Err(CoreError::invalid_argument("query must not be empty"));
    }

    let guard = WorkspaceGuard::new(&p.root)?;
    let start = guard.resolve(p.path.as_deref().unwrap_or(""))?;
    if !start.exists() {
        return Err(CoreError::file_not_found(p.path.unwrap_or_default()));
    }

    let exclude_set = build_exclude_set(&p.exclude)?;
    let file_matcher = match &p.file_pattern {
        Some(pattern) => Some(
            globset::Glob::new(pattern)
                .map_err(|e| {
                    CoreError::invalid_argument(format!("Invalid file pattern '{pattern}': {e}"))
                })?
                .compile_matcher(),
        ),
        None => None,
    };
    let regex = if p.is_regex {
        Some(
            RegexBuilder::new(&p.query)
                .case_insensitive(!p.case_sensitive)
                .build()
                .map_err(|e| CoreError::invalid_argument(format!("Invalid regex: {e}")))?,
        )
    } else {
        None
    };
    let needle = if p.case_sensitive {
        p.query.clone()
    } else {
        p.query.to_lowercase()
    };

    let max_results = p
        .max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .min(HARD_MAX_RESULTS);
    let max_file_size = p.max_file_size.unwrap_or(DEFAULT_MAX_FILE_SIZE);
    let deadline =
        Instant::now() + Duration::from_millis(p.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));

    let mut matches = Vec::new();
    let mut truncated = false;
    let mut timed_out = false;

    let walker = ignore::WalkBuilder::new(&start)
        .hidden(false)
        .standard_filters(true)
        .build();

    'walk: for result in walker {
        if cancelled.load(Ordering::Relaxed) {
            return Err(CoreError::cancelled());
        }
        if Instant::now() >= deadline {
            timed_out = true;
            break;
        }

        let entry = match result {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.is_dir() {
            continue;
        }

        let relative_display = guard.to_relative_display(path);
        if is_excluded(&relative_display, &exclude_set) {
            continue;
        }
        if let Some(matcher) = &file_matcher {
            if !matcher.is_match(&relative_display) {
                continue;
            }
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if metadata.len() > max_file_size {
            continue;
        }

        let file = match std::fs::File::open(path) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let reader = BufReader::new(file);
        for (idx, line_result) in reader.lines().enumerate() {
            if idx % CHECK_EVERY_N_LINES == 0 {
                if cancelled.load(Ordering::Relaxed) {
                    return Err(CoreError::cancelled());
                }
                if Instant::now() >= deadline {
                    timed_out = true;
                    break 'walk;
                }
            }
            let line = match line_result {
                Ok(l) => l,
                Err(_) => break, // not valid UTF-8 text; skip the rest of this file
            };

            let found_column = if let Some(re) = &regex {
                re.find(&line).map(|m| m.start())
            } else {
                let haystack = if p.case_sensitive {
                    line.clone()
                } else {
                    line.to_lowercase()
                };
                haystack.find(&needle)
            };

            if let Some(column) = found_column {
                matches.push(json!({
                    "file": relative_display,
                    "line": (idx + 1) as u64,
                    "column": (column + 1) as u64,
                    "lineText": truncate_line(&line),
                }));
                if matches.len() >= max_results {
                    truncated = true;
                    break 'walk;
                }
            }
        }
    }

    Ok(json!({ "matches": matches, "truncated": truncated, "timedOut": timed_out }))
}

fn truncate_line(line: &str) -> String {
    if line.chars().count() > MAX_LINE_DISPLAY_CHARS {
        let mut truncated: String = line.chars().take(MAX_LINE_DISPLAY_CHARS).collect();
        truncated.push('\u{2026}');
        truncated
    } else {
        line.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_cancel() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }

    #[test]
    fn finds_literal_match() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("a.ts"),
            "const secretValue = 1;\nother line",
        )
        .unwrap();
        let result = text(
            json!({ "root": dir.path().to_string_lossy(), "query": "secretValue" }),
            no_cancel(),
        )
        .unwrap();
        let matches = result["matches"].as_array().unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["line"], 1);
    }

    #[test]
    fn case_insensitive_by_default() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "HELLO world").unwrap();
        let result = text(
            json!({ "root": dir.path().to_string_lossy(), "query": "hello" }),
            no_cancel(),
        )
        .unwrap();
        assert_eq!(result["matches"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn respects_max_results() {
        let dir = tempfile::tempdir().unwrap();
        let content: String = (0..10).map(|_| "needle\n").collect();
        std::fs::write(dir.path().join("a.txt"), content).unwrap();
        let result = text(
            json!({ "root": dir.path().to_string_lossy(), "query": "needle", "maxResults": 3 }),
            no_cancel(),
        )
        .unwrap();
        assert_eq!(result["matches"].as_array().unwrap().len(), 3);
        assert_eq!(result["truncated"], true);
    }

    #[test]
    fn cancellation_stops_search() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "needle").unwrap();
        let flag = Arc::new(AtomicBool::new(true));
        let err = text(
            json!({ "root": dir.path().to_string_lossy(), "query": "needle" }),
            flag,
        )
        .unwrap_err();
        assert_eq!(err.code, "REQUEST_CANCELLED");
    }

    #[test]
    fn rejects_empty_query() {
        let dir = tempfile::tempdir().unwrap();
        let err = text(
            json!({ "root": dir.path().to_string_lossy(), "query": "" }),
            no_cancel(),
        )
        .unwrap_err();
        assert_eq!(err.code, "INVALID_ARGUMENT");
    }
}
