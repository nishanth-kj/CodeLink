//! End-to-end tests that exercise the real `codelink-core` binary over its
//! stdio JSON-IPC protocol, the same way the TypeScript bridge does.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};

fn spawn_core() -> (Child, ChildStdin, BufReader<std::process::ChildStdout>) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_codelink-core"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn codelink-core");
    let stdin = child.stdin.take().unwrap();
    let stdout = BufReader::new(child.stdout.take().unwrap());
    (child, stdin, stdout)
}

fn send(stdin: &mut ChildStdin, json: &str) {
    writeln!(stdin, "{json}").unwrap();
}

fn recv(reader: &mut BufReader<std::process::ChildStdout>) -> serde_json::Value {
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .expect("failed to read response line");
    serde_json::from_str(&line).unwrap_or_else(|e| panic!("invalid JSON line '{line}': {e}"))
}

fn json_path(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "\\\\")
}

#[test]
fn ping_roundtrip() {
    let (mut child, mut stdin, mut stdout) = spawn_core();
    send(
        &mut stdin,
        r#"{"id":"1","method":"system.ping","params":{}}"#,
    );
    let response = recv(&mut stdout);
    assert_eq!(response["id"], "1");
    assert_eq!(response["success"], true);
    assert_eq!(response["result"]["pong"], true);
    drop(stdin);
    let _ = child.wait();
}

#[test]
fn unknown_method_returns_structured_error() {
    let (mut child, mut stdin, mut stdout) = spawn_core();
    send(
        &mut stdin,
        r#"{"id":"2","method":"nonsense.method","params":{}}"#,
    );
    let response = recv(&mut stdout);
    assert_eq!(response["success"], false);
    assert_eq!(response["error"]["code"], "METHOD_NOT_FOUND");
    drop(stdin);
    let _ = child.wait();
}

#[test]
fn malformed_json_does_not_crash_the_process() {
    let (mut child, mut stdin, mut stdout) = spawn_core();
    send(&mut stdin, "{ not valid json");
    let response = recv(&mut stdout);
    assert_eq!(response["success"], false);

    send(
        &mut stdin,
        r#"{"id":"after","method":"system.ping","params":{}}"#,
    );
    let response = recv(&mut stdout);
    assert_eq!(response["id"], "after");
    assert_eq!(response["success"], true);
    drop(stdin);
    let _ = child.wait();
}

#[test]
fn filesystem_write_read_and_traversal_rejection() {
    let dir = tempfile::tempdir().unwrap();
    let root = json_path(dir.path());
    let (mut child, mut stdin, mut stdout) = spawn_core();

    send(
        &mut stdin,
        &format!(
            r#"{{"id":"w1","method":"filesystem.write","params":{{"root":"{root}","path":"a.txt","content":"hello"}}}}"#
        ),
    );
    let response = recv(&mut stdout);
    assert_eq!(response["success"], true);

    send(
        &mut stdin,
        &format!(
            r#"{{"id":"r1","method":"filesystem.read","params":{{"root":"{root}","path":"a.txt"}}}}"#
        ),
    );
    let response = recv(&mut stdout);
    assert_eq!(response["result"]["content"], "hello");

    send(
        &mut stdin,
        &format!(
            r#"{{"id":"r2","method":"filesystem.read","params":{{"root":"{root}","path":"../outside.txt"}}}}"#
        ),
    );
    let response = recv(&mut stdout);
    assert_eq!(response["success"], false);
    assert_eq!(response["error"]["code"], "PATH_OUTSIDE_WORKSPACE");

    drop(stdin);
    let _ = child.wait();
}

#[test]
fn concurrent_requests_each_receive_their_own_response() {
    let dir = tempfile::tempdir().unwrap();
    let root = json_path(dir.path());
    let (mut child, mut stdin, mut stdout) = spawn_core();

    for i in 0..5 {
        send(
            &mut stdin,
            &format!(
                r#"{{"id":"c{i}","method":"filesystem.write","params":{{"root":"{root}","path":"f{i}.txt","content":"v{i}"}}}}"#
            ),
        );
    }

    let mut ids: Vec<String> = Vec::new();
    for _ in 0..5 {
        let response = recv(&mut stdout);
        assert_eq!(response["success"], true);
        ids.push(response["id"].as_str().unwrap().to_string());
    }
    ids.sort();
    assert_eq!(ids, vec!["c0", "c1", "c2", "c3", "c4"]);

    drop(stdin);
    let _ = child.wait();
}
