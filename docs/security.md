# Security

This document explains the security model in depth: what is enforced, where, and why. If you are deciding whether to enable remote access, read [remote-access.md](remote-access.md) as well.

## Threat model

CodeLink's job is to let an external process — an AI agent, potentially one you didn't write — act on your local filesystem, terminal, and Git repository. The default posture assumes that client is **not fully trusted**: it should only be able to do what the active security profile explicitly allows, only inside the workspace, and never see an obvious secret without you turning that on.

Two boundaries matter:

1. **Local, unauthenticated MCP client** (the default): the real access control is the *permission profile*. Anyone who can reach `127.0.0.1:32100` on your machine can call any tool the profile allows — but nothing else can reach that port unless you explicitly enable remote access.
2. **Remote client** (opt-in): the same permission profile applies, plus a bearer token is required and requests are rate-limited. See [remote-access.md](remote-access.md).

## The tool execution pipeline

Every tool call passes through the same sequence of checks, in the same order, regardless of which tool it is. This is deliberate: permission logic lives in exactly one place (`security/policy.ts`, `security/permissions.ts`) rather than being re-implemented per tool, so there is no way for a new tool to accidentally skip a check.

```text
1. MCP transport validates the JSON-RPC envelope and the tool's input schema (Zod)
2. Connection-level gate (once per HTTP request, in mcp/server.ts):
     - Host header allowed? (DNS-rebinding guard)
     - authenticated? (only enforced when remote access is enabled)
     - within the rate limit? (only enforced when remote access is enabled)
3. Tool-level gate (once per tool call, in tools/index.ts's bindTool()):
     - permission check against the active security profile
     - concurrency slot acquired (remote only)
4. Inside the handler, for any path argument:
     - workspace-boundary check (pathValidator.ts, filesystem-free, fast)
     - secret-filename check (secretFilter.ts), unless explicitly allowed
5. Rust re-validates the path itself (WorkspaceGuard, symlink-safe) before
   touching disk — Rust never trusts its caller, even its own extension host
6. Output limits (max read/write bytes, max search results, max terminal
   output) are enforced by codelink-core, not by the TypeScript layer
```

## Path validation

Two independent checks exist, deliberately not merged into one:

- **`security/pathValidator.ts`** runs first, in TypeScript, without touching the filesystem. It normalizes the path, rejects null bytes, and rejects anything that resolves outside the workspace root — catching `../../etc/passwd`-style traversal and absolute paths cheaply, before a request ever reaches Rust.
- **`core/src/security.rs`'s `WorkspaceGuard`** is the authoritative check, because it's the one that can see the real filesystem. It normalizes lexically, then walks up from the target to the longest *existing* ancestor and canonicalizes that ancestor — which is what catches a symlink inside the workspace that points outside it, even for a path that doesn't exist yet (e.g. a file about to be created inside a symlinked directory).

Both checks return the same `PATH_OUTSIDE_WORKSPACE` error code. The Rust check is exercised by unit tests covering `../` traversal, absolute paths (including Windows drive letters and the workspace-root-as-string-prefix edge case, e.g. `/workspace/project` vs `/workspace/project-evil`), and a real symlink escape (on Unix; Windows symlink creation requires elevated privileges in most CI environments, so that specific test is `#[cfg(unix)]`).

## Secret filtering

`security/secretFilter.ts` blocks direct tool access to files that look like secrets by filename pattern — `.env` and its variants, SSH private keys, `.pem`/`.key` files, cloud credential files, `.npmrc`, `.git-credentials`, and similar — unless `codelink.security.allowSecretFileAccess` is turned on. It also has a much softer, non-blocking check for content that looks like a secret assignment (`API_KEY=`, `PASSWORD:`, etc.), used only as a signal, never to redact or reject on its own.

This is explicitly **defense in depth, not a secret scanner**. It catches the common, obvious cases by filename; it does not detect a secret pasted into an otherwise ordinary-looking file, and it is not a substitute for not committing secrets to the repository in the first place.

## Permissions and security profiles

`security/permissions.ts` defines ten permissions (`workspaceRead`, `workspaceSearch`, `editorRead`, `editorWrite`, `fileWrite`, `fileDelete`, `terminal`, `gitRead`, `gitWrite`, `remoteAccess`) and four profiles:

| Permission | readonly | developer (default) | trusted |
| --- | :---: | :---: | :---: |
| workspaceRead / workspaceSearch | ✓ | ✓ | ✓ |
| editorRead / gitRead | ✓ | ✓ | ✓ |
| editorWrite / fileWrite | ✗ | ✓ | ✓ |
| fileDelete | ✗ | ✗ | ✓ |
| terminal | ✗ | ✗ | ✓ |
| gitWrite | ✗ | ✗ | ✓ (no tool uses this yet — see below) |

`custom` reads the individual `codelink.security.allow*` settings instead of a preset. In every profile, `remoteAccess` is derived directly from `codelink.remote.enabled` — it is never implied by a profile, so switching to `trusted` can never silently turn on remote exposure.

A denied call returns a specific error code where one exists (`FILE_WRITE_DISABLED`, `FILE_DELETE_DISABLED`, `TERMINAL_DISABLED`, `GIT_WRITE_DISABLED`, `REMOTE_ACCESS_DISABLED`) and the generic `PERMISSION_DENIED` otherwise — never a silent no-op and never an omission from `tools/list` (the tool is always listed; calling it is what's denied).

### Why there's no `git_commit`, `git_push`, etc

Section 16 of the original design intentionally scoped Git support to read-only tools first (`git_status`, `git_diff`, `git_log`, `git_branches`, `git_show`, `git_remote`). `gitWrite` exists as a permission for when write tools are added later; until then, there is simply no tool that could exercise it, which is a stronger guarantee than "a tool exists but checks a flag."

## Terminal and process safety

Terminal access (`terminal_create`/`terminal_run`/`terminal_output`/`terminal_kill`/`terminal_list`) is off by default in every profile except `trusted`. When enabled:

- Every spawned process's environment starts from `codelink-core`'s own inherited environment (so `PATH` still resolves `git`, `npm`, etc.) with any variable whose name contains `API_KEY`, `TOKEN`, `PASSWORD`, `SECRET`, `PRIVATE_KEY`, `CREDENTIAL`, or that starts with `AWS_`, stripped out — see `core/src/process.rs`'s `is_sensitive_env_key`. Explicit overrides passed by the caller still win.
- `codelink.terminal.timeoutMs` bounds how long a process may run before a watchdog thread kills it (reported as status `"timedout"`).
- `codelink.terminal.maxOutputBytes` caps captured stdout/stderr; output beyond the cap is dropped and the result is marked `truncated: true` rather than growing unbounded.
- Every process is tracked (id, command, args, cwd, start time, status, exit code) via `terminal_list`.

A client never supplies a raw shell command string; `command` and `args` are passed straight to `std::process::Command`, never through a shell.

## Resource limits

Enforced in `codelink-core`, not just documented as intentions:

| Limit | Setting | Enforced in |
| --- | --- | --- |
| Max file read size | `codelink.files.maxReadBytes` | `filesystem::read` → `FILE_TOO_LARGE` |
| Max file write size | `codelink.files.maxWriteBytes` | `filesystem::write` → `FILE_TOO_LARGE` |
| Max search results | `codelink.search.maxResults` | `search::text` (`truncated: true` past the cap) |
| Max file size searched | `codelink.search.maxFileSize` | `search::text` (file skipped, not searched) |
| Search timeout | `codelink.search.timeoutMs` | `search::text` (`timedOut: true`, cancellable mid-scan) |
| Terminal output cap | `codelink.terminal.maxOutputBytes` | `process::spawn`'s reader threads |
| Terminal timeout | `codelink.terminal.timeoutMs` | `process::spawn`'s watchdog thread |
| Max IPC message size | fixed, 64 MiB | `core/src/protocol.rs::MAX_MESSAGE_BYTES` |

## Rate limiting

`security/rateLimiter.ts` implements a sliding one-minute window (`codelink.rateLimit.requestsPerMinute`) plus a concurrency cap (`codelink.rateLimit.maxConcurrentRequests`), keyed per client. It is only applied **when remote access is enabled** — a single local developer session isn't the threat model this defends against, and applying it there would just add friction. The connection-level check uses the client's IP address as the key (available on every HTTP request, even before an MCP session exists); the tool-level concurrency check uses the MCP session ID.

## Logging

Structured logs go through `utils/logger.ts` to the "CodeLink" output channel. Anything under a key matching `/token|password|secret|authorization|credential/i` is redacted before a log line is written, as defense in depth — but the real guarantee is that the raw access token is never passed to the logger at all; see `commands/generateToken.ts`, which only ever hands the raw token to the clipboard, once, via its own return value.

## Known limitations

- Secret filtering is filename-pattern based, not content-scanning; see above.
- `git.rs`'s shelled-out commands run without an explicit timeout (unlike terminal-tool processes) — a hung `git` process (e.g. blocked on a credential prompt) would block that one IPC request's thread, not the whole server, since each request runs on its own OS thread, but it would not be automatically killed.
- Rate limiting is in-memory and per-process; it resets on server restart and does not persist across the extension being reloaded.
