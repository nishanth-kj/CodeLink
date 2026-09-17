# codelink-core

The native system layer for [CodeLink](../README.md): filesystem, search, process execution, and read-only Git, spoken over a line-delimited JSON protocol on stdio. See [../docs/architecture.md](../docs/architecture.md) for how this fits into the whole system and why it's a separate binary rather than TypeScript-native modules.

## Building

```bash
cargo build              # debug, used automatically by the extension in development
cargo build --release    # release, used when packaging the extension
```

The extension locates the built binary automatically (`../extension/src/utils/platform.ts`): a packaged install looks under `extension/bin/<platform>-<arch>/`, and a development checkout falls back to this crate's own `target/release` then `target/debug`.

## Testing

```bash
cargo test                                    # unit tests (in each src/*.rs) + integration tests (tests/)
cargo fmt -- --check                          # formatting
cargo clippy --all-targets -- -D warnings     # lints
```

`tests/ipc_integration.rs` spawns the actual compiled binary and talks to it over real stdio, the same way the TypeScript bridge does — not just unit tests of individual functions.

## Modules

| Module | Responsibility |
|---|---|
| `security.rs` | `WorkspaceGuard` — the path-containment check every other module routes through. |
| `filesystem.rs` | read / write / delete / move / copy / list / exists. |
| `search.rs` | Text search with timeout, cancellation, and size/result limits. |
| `process.rs` | Spawns and tracks child processes for the terminal tools. |
| `git.rs` | Read-only Git operations via a fixed `git` argv. |
| `watcher.rs` | Recursive file watcher, emits change notifications on stdout. |
| `protocol.rs` | The wire format and the stdout writer. |
| `errors.rs` | The structured `CoreError` type shared across every module. |
| `models.rs` | Small shared response types (`FileEntry`, `ProcessStatus`). |
| `lib.rs` | `dispatch()` — the one place IPC method names map to handlers. |
| `main.rs` | The stdin read loop: one thread per request, structured logging to stderr. |

No module in this crate imports or knows about VS Code; anything that needs the VS Code API lives in `../extension` instead.
