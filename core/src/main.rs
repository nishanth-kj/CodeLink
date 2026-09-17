use codelink_core::errors::CoreError;
use codelink_core::protocol::{write_line, Request, Response, MAX_MESSAGE_BYTES};
use codelink_core::{dispatch, Cancellation};
use std::io::{self, BufRead};
use std::sync::Arc;
use std::thread;

/// stdout is reserved for protocol messages; every diagnostic goes to
/// stderr instead, formatted for a human (or the TypeScript log forwarder)
/// rather than as another JSON stream.
fn log(level: &str, message: &str) {
    eprintln!("[codelink-core] [{level}] {message}");
}

fn main() {
    log(
        "info",
        &format!("codelink-core v{} starting", env!("CARGO_PKG_VERSION")),
    );

    let cancellation = Arc::new(Cancellation::default());
    let stdin = io::stdin();
    let mut handles: Vec<thread::JoinHandle<()>> = Vec::new();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                log(
                    "error",
                    &format!("Failed to read stdin, shutting down: {e}"),
                );
                break;
            }
        };

        if line.trim().is_empty() {
            continue;
        }
        if line.len() > MAX_MESSAGE_BYTES {
            log("error", "Rejected message exceeding the maximum size limit");
            continue;
        }

        let cancellation = cancellation.clone();
        handles.push(thread::spawn(move || handle_line(&line, &cancellation)));
        handles.retain(|h| !h.is_finished());
    }

    for handle in handles {
        let _ = handle.join();
    }
    log("info", "codelink-core exiting: stdin closed");
}

fn handle_line(line: &str, cancellation: &Cancellation) {
    let request: Request = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => {
            log("error", &format!("Malformed JSON request: {e}"));
            let response = Response::err(
                "unknown",
                CoreError::invalid_argument(format!("Malformed JSON request: {e}")),
            );
            write_line(&response.to_line());
            return;
        }
    };

    let result = dispatch(&request.method, request.params, &request.id, cancellation);
    let response = match result {
        Ok(value) => Response::ok(request.id, value),
        Err(error) => {
            log("debug", &format!("{} failed: {error}", request.method));
            Response::err(request.id, error)
        }
    };
    write_line(&response.to_line());
}
