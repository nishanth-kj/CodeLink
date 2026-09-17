# Tools and resources

Every tool is defined with `defineTool()` in `extension/src/tools/*.ts` and registered in `extension/src/mcp/server.ts`. "Execution layer" is either **Rust** (via `RustBridge.call()`, ending up in `core/src/*.rs`) or **VS Code API** (calling `vscode.*` directly) — see [architecture.md](architecture.md) for why the split exists.

## Workspace (`tools/workspace.ts`)

| Tool | Permission | Layer | Input | Notes |
|---|---|---|---|---|
| `workspace_info` | `workspaceRead` | VS Code | — | Name, root path, folders, host OS, active editor. Never returns environment variables. |
| `workspace_folders` | `workspaceRead` | VS Code | — | The workspace's configured folders. |
| `workspace_files` | `workspaceRead` | Rust | `path?`, `glob?`, `maxDepth?`, `limit?` | Directory listing honoring `codelink.files.excludePatterns`. |
| `workspace_search` | `workspaceSearch` | Rust | `query`, `path?`, `filePattern?`, `caseSensitive?`, `isRegex?`, `maxResults?` | Text search across the workspace. |

## Filesystem (`tools/filesystem.ts`)

All paths are workspace-relative and pass through `checkFileAccess` (boundary + secret-filename check) before reaching Rust.

| Tool | Permission | Input |
|---|---|---|
| `file_read` | `workspaceRead` | `path`, `maxBytes?` |
| `file_write` | `fileWrite` | `path`, `content`, `createParents?` (overwrites or creates) |
| `file_create` | `fileWrite` | `path`, `content?` (fails if the file already exists) |
| `file_delete` | `fileDelete` | `path`, `recursive?` |
| `file_move` | `fileWrite` | `from`, `to`, `overwrite?` |
| `file_copy` | `fileWrite` | `from`, `to`, `overwrite?` |
| `file_list` | `workspaceRead` | `path?`, `maxDepth?`, `limit?` |
| `file_exists` | `workspaceRead` | `path` |

All execute on the Rust core (`filesystem.rs`).

## Editor (`tools/editor.ts`)

Execution layer: VS Code API. Read/selection tools need `editorRead`; write/insert/replace need `editorWrite`; open/close (viewing, not content mutation) use `editorRead`.

| Tool | Permission | Input | Notes |
|---|---|---|---|
| `editor_active_file` | `editorRead` | — | Path, language, cursor position, selection text of the active editor. |
| `editor_read` | `editorRead` | `path?` | Reads the active editor, or a specific open/openable document. |
| `editor_selection` | `editorRead` | — | Current selection's text and range. |
| `editor_write` | `editorWrite` | `content`, `path?` | Replaces the whole document. **Does not save to disk** — modifies the in-memory buffer only. |
| `editor_insert` | `editorWrite` | `text`, `line`, `column`, `path?` | 1-based line/column. |
| `editor_replace` | `editorWrite` | `text`, `startLine`, `startColumn`, `endLine`, `endColumn`, `path?` | |
| `editor_open` | `editorRead` | `path`, `preview?` | Opens a workspace file in an editor tab. |
| `editor_close` | `editorRead` | `path` | Closes the tab for that file, if open. |

## Diagnostics (`tools/diagnostics.ts`)

Execution layer: VS Code API (`vscode.languages.getDiagnostics`).

| Tool | Permission | Input |
|---|---|---|
| `diagnostics_get` | `workspaceRead` | — |
| `diagnostics_file` | `workspaceRead` | `path` |

Each diagnostic returns `{ file, severity, message, source, code, range: { startLine, startColumn, endLine, endColumn } }` (1-based positions).

## Search (`tools/search.ts`)

| Tool | Permission | Layer | Input |
|---|---|---|---|
| `file_search` | `workspaceSearch` | Rust | `pattern` (glob), `limit?` |
| `symbol_search` | `workspaceSearch` | VS Code | `query` — uses `vscode.executeWorkspaceSymbolProvider` |

(`workspace_search`, the text-content search, is listed under Workspace above.)

## Terminal (`tools/terminal.ts`)

Execution layer: Rust (`process.rs`), via a lightweight TypeScript-side session concept. All require the `terminal` permission (off by default in every profile except `trusted`).

| Tool | Input | Notes |
|---|---|---|
| `terminal_create` | `cwd?` | Returns a `terminalId`; just remembers a working directory. |
| `terminal_run` | `terminalId`, `command`, `args?` | Returns immediately with a process `id`; does not block for the command's duration. |
| `terminal_output` | `processId` | Poll for accumulated stdout/stderr, status, exit code, truncation flag. |
| `terminal_kill` | `processId` | Terminates a running process. |
| `terminal_list` | — | Lists every tracked process, running or finished. |

See [security.md](security.md#terminal-and-process-safety) for environment filtering, timeouts, and output caps.

## Git (`tools/git.ts`)

Execution layer: Rust (`git.rs`), shelling out to the system `git` binary with a fixed argv. All require `gitRead` (present in every profile, including `readonly`).

| Tool | Input |
|---|---|
| `git_status` | — |
| `git_diff` | `path?`, `staged?` |
| `git_log` | `maxCount?` (default 20, max 200), `path?` |
| `git_branches` | — |
| `git_show` | `rev`, `path?` |
| `git_remote` | — |

Git write operations (commit, push, reset, checkout, branch deletion, remote changes) are not implemented; see [security.md](security.md#why-theres-no-git_commit-git_push-etc).

## Resources

See [mcp.md](mcp.md#resources) for the four fixed-URI resources (`workspace://info`, `workspace://files`, `editor://active`, `diagnostics://workspace`).

## Adding a new tool

1. Add it to the relevant `tools/*.ts` file (or a new one, for a new category) using `defineTool()` — this gives you full type inference on `args` from the Zod `inputSchema` you declare.
2. Pick the narrowest existing permission that fits, or add a new one to `PermissionKey` in `security/permissions.ts` (and to each profile's definition) if none fits.
3. If the tool touches the filesystem, call `checkFileAccess()` on every path argument before calling `ctx.bridge.call()`.
4. If the tool needs new Rust functionality, add a method to the relevant `core/src/*.rs` module and a case in `core/src/lib.rs`'s `dispatch()` — never add filesystem/process/Git logic directly in TypeScript.
5. Add the tool's array to `ALL_TOOLS` in `mcp/server.ts` if it's a new file.
6. Add tests: a Rust unit test for new core logic, and either a `tests/security` test (pure logic) or a `tests/integration` test (through the real MCP client) for the tool itself.
