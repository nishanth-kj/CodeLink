# Architecture

## One runtime, one process

CodeLink runs entirely as a TypeScript VS Code extension. `extension/src/` owns everything: the MCP server and transport, the security/permission layer, VS Code API integration (editor, diagnostics, commands, UI), configuration, and the local core — the operating-system-facing work (reading and writing files, walking directories, searching file contents, spawning and tracking child processes, shelling out to `git`).

`tools/filesystem.ts`, `tools/terminal.ts`, and `tools/git.ts` never touch the filesystem or spawn a process directly — every call goes through `CoreBridge`, a single `call(method, params)` chokepoint (`extension/src/core/bridge.ts`) that dispatches in-process to the modules under `extension/src/core/`. Editor and diagnostics tools instead talk to the VS Code API directly, because that state only exists inside the extension host.

> The repository also contains a standalone Rust implementation of the same core, `core/`, kept around but **not used by the extension**. See "The `core/` Rust crate" below.

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
CoreBridge.call(method, params)   VS Code API
   │  (filesystem/search/         (editor, diagnostics,
   │   process/git tools)          workspace metadata)
   ▼
extension/src/core/dispatch.ts
   │  6. WorkspaceGuard re-validates the path (symlink-safe,
   │     defense in depth — never trusts its caller)
   ▼
Real filesystem / process / git operation
   │
   ▼
Result value, or a thrown CodeLinkError
   │
   ▼
MCP CallToolResult (content + isError) ──▶ back up the stack to the client
```

Steps 1–2 happen once per HTTP request, before MCP routing even begins — an unauthenticated or rate-limited request never reaches tool dispatch. Steps 3–5 happen once per tool call, inside the wrapper every registered tool goes through (`bindTool`), so no individual tool can skip them by omission. See [security.md](security.md) for the full pipeline rationale and [mcp.md](mcp.md) for the MCP-specific details.

## The local core (`extension/src/core/`)

There is no separate process and no IPC: `CoreBridge` dispatches a method name straight to a function call in the same Node.js process the rest of the extension runs in. Its modules:

| Module | Responsibility |
| --- | --- |
| `workspaceGuard.ts` | `WorkspaceGuard`: the authoritative path-containment check (traversal, absolute paths, symlink escapes, null bytes) that every other module routes through. |
| `filesystem.ts` | read / write / delete / move / copy / list / exists, with size limits and exclude-glob filtering. |
| `search.ts` | Text search with timeout, cancellation, result limits, and per-file size limits. |
| `process.ts` | Spawns and tracks child processes (used by the terminal tools): output capture with a size cap, a per-process timeout, and environment filtering that drops anything that looks like a credential while preserving `PATH`. |
| `git.ts` | Read-only Git operations, each a fixed `git` argv passed to `execFile` — a client-supplied string is never interpolated into a shell command. |
| `watcher.ts` | An optional recursive file watcher that emits `workspace.fileChanged` notifications alongside normal responses. |
| `glob.ts`, `walk.ts` | A small self-contained glob matcher (`*`, `**`, `?`) and the shared directory walker `filesystem.list` and `search.text` both use. |
| `cancellation.ts`, `dispatch.ts`, `bridge.ts` | Per-request cancellation flags, the method-name-to-handler routing table, and the `call()`/`start()`/`stop()` chokepoint every tool goes through. |

`dispatch.ts` is the only place method names are mapped to handlers, keeping the full surface of what a tool can ask the local core to do visible in one place — the direct equivalent of what `core/src/lib.rs`'s `dispatch()` used to be for the Rust core.

`CoreBridge.call(method, params, timeoutMs?)` generates a request id, races the dispatched call against a timeout, and on timeout marks that id cancelled (checked cooperatively inside `search.text`, the only long-running handler) before rejecting with `REQUEST_TIMEOUT`. It also fans out `workspace.fileChanged` notifications to subscribers via `onNotification()`. `start()`/`stop()`/`isRunning()` remain a real gate — calls made before the first `start()` or after `stop()` are rejected — even though there is no child process to actually start or stop, so a caller that forgets to start it still fails loudly instead of silently succeeding.

Unlike the Rust core (which used the `ignore` crate to walk a directory tree honoring `.gitignore`), the local core's walker only ever applies the explicit `codelink.files.excludePatterns` glob list — it does not read `.gitignore` files. In practice this rarely matters, since the default exclude patterns already cover `.git`, `node_modules`, `target`, `dist`, and `build`.

## MCP transport: why Streamable HTTP, and why a bare `node:http` server

CodeLink uses the MCP spec's Streamable HTTP transport (`StreamableHTTPServerTransport` from the official SDK) rather than stdio, because the whole point is that an *external* client — not a process CodeLink itself spawns — connects to it, optionally from another machine via a tunnel.

The HTTP layer itself is a plain `node:http.Server`, not Express or another framework: the only things it needs to do before handing a request to the SDK's transport are a path check, a Host-header check, and the authenticate/rate-limit gate, and a few dozen lines of `node:http` cover that without adding a dependency.

`StreamableHTTPServerTransport` can complete exactly one `initialize` handshake per instance — it is not designed to multiplex independent client sessions over a single transport object. `McpServerManager` therefore creates one `McpServer` + one transport per session, keyed by the `Mcp-Session-Id` header the transport assigns on `initialize`; see the comment on `McpServerManager` in `extension/src/mcp/server.ts` for the routing details. This matters even for CodeLink's typical single-client use case, because a client that reconnects (a new browser tab, a restarted agent process) is a *new* session as far as the transport is concerned.

## Where things live

See the top-level file tree in the repository for the full layout; the short version:

- `extension/src/mcp/` — the MCP server, transport, session tracking, and shared protocol helpers.
- `extension/src/tools/`, `extension/src/resources/` — one file per tool/resource category, each exporting a plain array built with `defineTool`/`defineResource`.
- `extension/src/security/` — `PermissionManager`, `AuthenticationManager`, `RateLimiter`, `SecurityPolicy`, plus the standalone `pathValidator`/`secretFilter` functions.
- `extension/src/core/` — the local core described above.
- `extension/src/tunnel/` — the optional Cloudflare quick-tunnel.
- `extension/src/ui/`, `extension/src/commands/` — status bar, dashboard, and the Command Palette commands.
- `extension/src/config/` — the typed configuration schema, its VS Code-backed loader, and the hard-coded local-only default.

## The `core/` Rust crate

`core/` is a standalone, self-contained Rust implementation of the same filesystem/search/process/Git core, communicating over a line-delimited JSON protocol on stdio (see its own `README.md` and `core/src/lib.rs`'s `dispatch()`). It predates the TypeScript local core described above and is kept in the repository — buildable and independently tested via `cargo test` — but nothing under `extension/` imports, spawns, or otherwise depends on it. Treat it as a reference implementation, not part of the running extension.
