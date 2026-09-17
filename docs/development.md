# Development

## Prerequisites

- Node.js 20+ and npm
- A Rust toolchain (`cargo`, `rustc`) — install via [rustup](https://rustup.rs/)
- Git (used both as CodeLink's own VCS and by the read-only Git tools at runtime)
- Optional: [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), only needed to exercise the tunnel commands

## Setup

```bash
git clone https://github.com/nishanth-kj/CodeLink
cd CodeLink
npm install                # installs extension/'s deps (npm workspaces; run from the repo root)
cargo build --manifest-path core/Cargo.toml
```

`RustBridge` (`extension/src/rust/bridge.ts`) locates the Rust binary by checking, in order: `extension/bin/<platform>-<arch>/codelink-core[.exe]` (a packaged install), then `core/target/release/codelink-core[.exe]`, then `core/target/debug/codelink-core[.exe]`. A `cargo build` (debug) is enough for local development; use `--release` before packaging.

## Running from source

Open the repository root in VS Code and use the **Run CodeLink Extension** launch configuration (`.vscode/launch.json`), which runs `extension: watch` (`tsc -w`) first and launches an Extension Development Host with this repo (or any folder you open in that host) as the workspace. The "CodeLink is installed…" first-run notice appears once; the server itself stays stopped until you run **CodeLink: Start MCP Server**.

## Test layout

Tests are split by what they need to run:

| Location | Runner | What it covers |
|---|---|---|
| `core/src/**/*.rs` (`#[cfg(test)]`) | `cargo test` | Unit tests for each Rust module — path security, filesystem, search, process, Git. |
| `core/tests/ipc_integration.rs` | `cargo test` | End-to-end tests against the real compiled `codelink-core` binary over its actual stdio protocol. |
| `tests/security/*.test.ts` | `vitest` (via `extension/vitest.config.ts`) | Pure-logic unit tests for the security layer — no `vscode`, no real process. |
| `tests/mcp/*.test.ts` | `vitest` | Pure-logic unit tests for MCP-layer helpers (HTTP status mapping, Host-header/bearer-token parsing). |
| `tests/integration/*.test.ts` | `vitest` | Full end-to-end tests: a real MCP client (the SDK's own `Client`) talking over real HTTP to a real `McpServerManager` backed by the real `codelink-core` binary. |
| `extension/test/suite/*.test.ts` | `@vscode/test-electron` + Mocha | Tests needing the real VS Code API (`vscode.*`), run inside an actual extension host — see below. |

Run everything together with `npm test` from the repo root (type-checks `tests/` against `extension/src`, then runs vitest, then `cargo test`), or individually: `npm run typecheck:tests`, `npm run test:extension` (vitest only), `npm run test:core` (cargo only), or `cargo test` / `npx vitest run` directly from `core/` / `extension/`. Note that vitest transpiles test files without type-checking them (esbuild, transpile-only) — `npm run typecheck:tests` is what actually catches a type error in `tests/**/*.ts`, since it runs `tsc --noEmit` against that directory using the extension's real source types.

### Why `tests/integration` can load `vscode`-importing modules without a real extension host

Several `tools/*.ts` files statically `import * as vscode from "vscode"`, and `mcp/server.ts` imports all of them. Since `vscode` doesn't exist as an installed package outside a real extension host, `extension/vitest.config.ts` aliases the bare specifier `vscode` to `tests/integration/vscodeStub.ts`, a minimal stand-in that only needs to exist, not behave correctly — the integration suite only ever calls tools that talk to `codelink-core` directly (filesystem, terminal, git), never the VS-Code-API-backed ones. If you add an integration test that needs a real `vscode.*` call to succeed, extend the stub rather than reaching for the real API in that suite; genuine VS Code API coverage belongs in `extension/test/`.

### `extension/test/` (real extension host)

```bash
cd extension
npm run build          # compile src/
npm run build:test     # compile test/ → out-test/
node ./out-test/runExtensionTests.js
```

(or `npm run test:vscode` runs all three in sequence). This downloads a copy of VS Code into `extension/.vscode-test/` on first run via `@vscode/test-electron`, launches it with a fixture workspace (`extension/test/fixtures/workspace`), activates the real extension, and runs a Mocha suite against the real `vscode` API — checking every command is registered and that start/stop/status run against the real Rust core without throwing.

**Known limitation**: this suite requires genuine network access to VS Code's update servers to download a real, complete VS Code build. In at least one sandboxed CI-like environment this project was developed in, that download produced an archive missing `resources/app` (VS Code's actual application code) and the suite could not run — that is an environment/network limitation, not a defect in the test code, which follows `@vscode/test-electron`'s documented pattern and compiles cleanly. If you hit something similar, check that whatever network path your environment uses to reach `update.code.visualstudio.com` returns a real installable build.

## Linting and formatting

```bash
npm run lint                                             # eslint (extension/src)
cargo fmt --manifest-path core/Cargo.toml                 # apply formatting
cargo fmt --manifest-path core/Cargo.toml -- --check      # check only
cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings
```

`extension/eslint.config.js` only covers `extension/src` (and `extension/test`) — ESLint 9's flat-config "base path" restriction blocks linting `../tests` from that config location, so the root-level `tests/` directory currently relies on `tsc`/`vitest` catching issues at type-check/runtime rather than ESLint.

## Packaging

```bash
npm run build:core --workspace-root      # or: cargo build --release --manifest-path core/Cargo.toml
npm run build                            # tsc, from repo root or extension/
cd extension && npm run package          # vsce package -o ../codelink.vsix
```

`vsce package` bundles `extension/`'s compiled output and its production `node_modules` (no `--no-dependencies` flag — `@modelcontextprotocol/sdk` and `zod` are real runtime dependencies, not bundled via esbuild). It does **not** currently bundle a Rust binary into the `.vsix` automatically; see "Cross-platform binaries" below.

## Cross-platform binaries

`resolveCoreBinaryPath` (`extension/src/utils/platform.ts`) looks for a packaged binary at `extension/bin/<platform>-<arch>/codelink-core[.exe]` before falling back to the Cargo output paths. To ship a binary for a given platform inside the `.vsix`, cross-compile (or build natively on each target) and place the result there before running `vsce package`, e.g.:

```text
extension/bin/win32-x64/codelink-core.exe
extension/bin/linux-x64/codelink-core
extension/bin/darwin-x64/codelink-core
extension/bin/darwin-arm64/codelink-core
```

This repository does not include a CI workflow that automates that cross-compilation; set one up (e.g. a GitHub Actions matrix building each target with `cargo build --release`) before publishing a multi-platform `.vsix`. Until then, a locally packaged `.vsix` only works on the platform it was built on, using the `core/target/release` fallback path.

## Common gotchas

- If `npm install` reports a version that doesn't exist for some dependency, double check with `npm view <pkg> version` — the versions pinned in `extension/package.json` were deliberately chosen (sometimes an older major than "latest") where a newer major's behavior wasn't verifiable at the time this was written; don't blindly bump without checking the changelog.
- On Windows, prefer PowerShell over Git Bash for anything that spawns a GUI process (e.g. `@vscode/test-electron`) — Git Bash's MSYS path translation can corrupt arguments passed to native Windows executables.
- If `cargo test` for `process::tests::spawned_process_inherits_path_but_not_sensitive_vars` or similar fails intermittently, check that nothing else in your shell environment happens to set a variable matching the sensitive-name patterns with a value the test doesn't expect.
