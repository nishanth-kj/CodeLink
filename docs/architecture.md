# Architecture

## Why two languages

CodeLink is deliberately split across two runtimes, each doing the part it is suited for:

- **TypeScript** (`extension/`) owns everything that has to run inside the VS Code extension host: the MCP server and transport, the security/permission layer, VS Code API integration (editor, diagnostics, commands, UI), configuration, and the Rust process's lifecycle.
- **Rust** (`core/`) owns the operating-system-facing work: reading and writing files, walking directories, searching file contents, spawning and tracking child processes, and shelling out to `git`. None of this needs the VS Code API, and doing it in Rust means workspace-boundary and symlink-escape checks happen in a language built for exactly that kind of correctness, with a real test suite around it.

Neither side re-implements the other's job. `tools/filesystem.ts`, `tools/terminal.ts`, and `tools/git.ts` never touch the filesystem or spawn a process directly — every call goes through `RustBridge`. Conversely, nothing in `core/` knows what a `vscode.TextEditor` is; editor and diagnostics tools talk to the VS Code API directly in TypeScript, because that state only exists inside the extension host.

## End-to-end request flow

```text
MCP Client
    │  HTTP POST /mcp (JSON-RPC)
    ▼
node:http server (extension/src/mcp/server.ts)
    │  1. path check, Host-header check (DNS-rebinding guard)
    │  2. SecurityPolicy.authorizeConnection() — bearer auth + rate limit
    │     (both no-ops unless codelink.remote.enabled)
    ▼
StreamableHTTPServerTransport → McpServer (per session)
    │  MCP protocol framing, JSON-RPC routing, input schema validation
    ▼
bindTool() wrapper (extension/src/tools/index.ts)
    │  3. SecurityPolicy.checkPermission() — is this tool allowed
    │     under the active security profile?
    │  4. concurrency slot (remote only)
    ▼
Tool handler (extension/src/tools/*.ts)
    │  5. checkFileAccess() — workspace-boundary + secret-filename
    │     check on any path argument
    ▼
   ┌───────────────┴───────────────┐
   ▼                               ▼
RustBridge.call(method, params)   VS Code API
   │  (filesystem/search/         (editor, diagnostics,
   │   process/git tools)          workspace metadata)
   ▼
codelink-core over JSON IPC (stdio)
   │  6. WorkspaceGuard re-validates the path (symlink-safe,
   │     defense in depth — never trusts its caller)
   ▼
Real filesystem / process / git operation
   │
   ▼
Structured {success, result} or {success, error} response
   │
   ▼
MCP CallToolResult (content + isError) ──▶ back up the stack to the client
```

Steps 1–2 happen once per HTTP request, before MCP routing even begins — an unauthenticated or rate-limited request never reaches tool dispatch. Steps 3–5 happen once per tool call, inside the wrapper every registered tool goes through (`bindTool`), so no individual tool can skip them by omission. See [security.md](security.md) for the full pipeline rationale and [mcp.md](mcp.md) for the MCP-specific details.

## The Rust core (`core/`)

`codelink-core` is a single binary, `codelink-core[.exe]`, built by `cargo build --release`. It has no network listener and no CLI arguments; it is spawned by the extension as a child process and speaks a small JSON protocol over its stdin/stdout (see below). Its modules:

| Module | Responsibility |
| --- | --- |
| `security.rs` | `WorkspaceGuard`: the authoritative path-containment check (traversal, absolute paths, symlink escapes, null bytes) that every other module routes through. |
| `filesystem.rs` | read / write / delete / move / copy / list / exists, with size limits and exclude-glob filtering. |
| `search.rs` | Text search with timeout, cancellation, result limits, and per-file size limits. |
| `process.rs` | Spawns and tracks child processes (used by the terminal tools): output capture with a size cap, a watchdog thread enforcing timeouts, and environment filtering that drops anything that looks like a credential while preserving `PATH`. |
| `git.rs` | Read-only Git operations, each a fixed `git` argv — a client-supplied string is never interpolated into a shell command. |
| `watcher.rs` | An optional recursive file watcher that emits `workspace.fileChanged` notifications on stdout alongside normal responses. |
| `protocol.rs` | The wire format (`Request`/`Response`/`Notification`) and the single mutex-guarded stdout writer that keeps concurrent responses from interleaving. |

## The JSON IPC protocol

One JSON object per line, in both directions. stdout is reserved exclusively for protocol messages; every Rust-side log line goes to stderr instead (the extension forwards it at `debug` level).

Request (TypeScript → Rust):

```json
{ "id": "a1b2c3", "method": "filesystem.read", "params": { "root": "/workspace", "path": "src/app.ts" } }
```

Success response:

```json
{ "id": "a1b2c3", "success": true, "result": { "path": "src/app.ts", "content": "...", "encoding": "utf8", "size": 512 } }
```

Error response:

```json
{ "id": "a1b2c3", "success": false, "error": { "code": "PATH_OUTSIDE_WORKSPACE", "message": "..." } }
```

Notification (Rust → TypeScript, no `id`, currently only the file watcher):

```json
{ "method": "workspace.fileChanged", "params": { "watchId": "default", "path": "src/app.ts", "kind": "modified" } }
```

`extension/src/rust/process.ts` owns the child process (spawn, line-buffered stdout parsing, stderr forwarding, exit handling); `extension/src/rust/bridge.ts` layers request/response correlation, per-request timeouts with best-effort cancellation (`system.cancel`), and notification fan-out on top of it. Every filesystem/search/process/git tool calls `RustBridge.call(method, params)` rather than talking to the child process directly.

## MCP transport: why Streamable HTTP, and why a bare `node:http` server

CodeLink uses the MCP spec's Streamable HTTP transport (`StreamableHTTPServerTransport` from the official SDK) rather than stdio, because the whole point is that an *external* client — not a process CodeLink itself spawns — connects to it, optionally from another machine via a tunnel.

The HTTP layer itself is a plain `node:http.Server`, not Express or another framework: the only things it needs to do before handing a request to the SDK's transport are a path check, a Host-header check, and the authenticate/rate-limit gate, and a few dozen lines of `node:http` cover that without adding a dependency.

`StreamableHTTPServerTransport` can complete exactly one `initialize` handshake per instance — it is not designed to multiplex independent client sessions over a single transport object. `McpServerManager` therefore creates one `McpServer` + one transport per session, keyed by the `Mcp-Session-Id` header the transport assigns on `initialize`; see the comment on `McpServerManager` in `extension/src/mcp/server.ts` for the routing details. This matters even for CodeLink's typical single-client use case, because a client that reconnects (a new browser tab, a restarted agent process) is a *new* session as far as the transport is concerned.

## Where things live

See the top-level file tree in the repository for the full layout; the short version:

- `extension/src/mcp/` — the MCP server, transport, session tracking, and shared protocol helpers.
- `extension/src/tools/`, `extension/src/resources/` — one file per tool/resource category, each exporting a plain array built with `defineTool`/`defineResource`.
- `extension/src/security/` — `PermissionManager`, `AuthenticationManager`, `RateLimiter`, `SecurityPolicy`, plus the standalone `pathValidator`/`secretFilter` functions.
- `extension/src/rust/` — the IPC bridge described above.
- `extension/src/tunnel/` — the optional Cloudflare quick-tunnel.
- `extension/src/ui/`, `extension/src/commands/` — status bar, dashboard, and the Command Palette commands.
- `extension/src/config/` — the typed configuration schema, its VS Code-backed loader, and the hard-coded local-only default.
