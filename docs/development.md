# Development

## Prerequisites

- Node.js 20+ and npm
- Git (used both as CodeLink's own VCS and by the read-only Git tools at runtime)
- Optional: a Rust toolchain (`cargo`, `rustc`) — only needed if you're working on the standalone, unused `core/` crate (see [architecture.md](architecture.md#the-core-rust-crate)); the extension itself does not need it
- Optional: [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), only needed to exercise the tunnel commands

## Setup

```bash
git clone https://github.com/nishanth-kj/CodeLink
cd CodeLink
npm install --prefix extension   # extension/ is a standalone npm project, not a workspace
```

Or, to install dependencies and compile in one step from the repo root:

```bash
npm run build:local              # npm install --prefix extension, then tsc → extension/out
```

## Running from source

Open the repository root in VS Code and use the **Run CodeLink Extension** launch configuration (`.vscode/launch.json`), which runs `extension: watch` (`tsc -w`) first and launches an Extension Development Host with this repo (or any folder you open in that host) as the workspace. The "CodeLink is installed…" first-run notice appears once; the server itself stays stopped until you run **CodeLink: Start MCP Server**.

## Test layout

Tests are split by what they need to run:

| Location | Runner | What it covers |
| --- | --- | --- |
| `tests/security/*.test.ts` | `vitest` (via `extension/vitest.config.ts`) | Pure-logic unit tests for the security layer — no `vscode`, no real process. |
| `tests/mcp/*.test.ts` | `vitest` | Pure-logic unit tests for MCP-layer helpers (HTTP status mapping, Host-header/bearer-token parsing). |
| `tests/integration/*.test.ts` | `vitest` | Full end-to-end tests: a real MCP client (the SDK's own `Client`) talking over real HTTP to a real `McpServerManager`, exercising the real local core (`extension/src/core/`) — real filesystem, a real spawned process, and the real `git` binary. |
| `extension/test/suite/*.test.ts` | `@vscode/test-electron` + Mocha | Tests needing the real VS Code API (`vscode.*`), run inside an actual extension host — see below. |

Run everything together with `npm test` from the repo root (type-checks `tests/` against `extension/src`, then runs vitest), or individually: `npm run typecheck:tests`, `npm run test:extension` (vitest only), or `npx vitest run` directly from `extension/`. Note that vitest transpiles test files without type-checking them (esbuild, transpile-only) — `npm run typecheck:tests` is what actually catches a type error in `tests/**/*.ts`, since it runs `tsc --noEmit` against that directory using the extension's real source types.

The unused `core/` Rust crate keeps its own test suite (`core/src/**/*.rs` `#[cfg(test)]` modules and `core/tests/ipc_integration.rs`, both run via `cargo test` or `npm run test:core`) if you're working on it, but nothing there runs as part of `npm test` verifying the extension.

`typecheck:tests` first runs `scripts/link-test-node-modules.mjs`, which creates `tests/node_modules` as a symlink to `extension/node_modules` (a Windows junction, needing no elevated privileges, or a plain symlink on POSIX) if it doesn't already exist. `tests/**/*.ts` imports `vitest` and `@modelcontextprotocol/sdk` directly, and since `tests/` isn't part of the `extension/` npm project, those packages otherwise aren't reachable from a plain ancestor-directory walk — real resolution through the symlink (rather than a tsconfig `paths` override) is what's needed, since `paths` bypasses a package's `exports` map and breaks on subpath imports like `@modelcontextprotocol/sdk/client/index.js`.

### Why `tests/integration` can load `vscode`-importing modules without a real extension host

Several `tools/*.ts` files statically `import * as vscode from "vscode"`, and `mcp/server.ts` imports all of them. Since `vscode` doesn't exist as an installed package outside a real extension host, `extension/vitest.config.ts` aliases the bare specifier `vscode` to `tests/integration/vscodeStub.ts`, a minimal stand-in that only needs to exist, not behave correctly — the integration suite only ever calls tools backed by the local core (filesystem, terminal, git), never the VS-Code-API-backed ones. If you add an integration test that needs a real `vscode.*` call to succeed, extend the stub rather than reaching for the real API in that suite; genuine VS Code API coverage belongs in `extension/test/`.

### `extension/test/` (real extension host)

```bash
cd extension
npm run build          # compile src/
npm run build:test     # compile test/ → out-test/
node ./out-test/runExtensionTests.js
```

(or `npm run test:vscode` runs all three in sequence). This downloads a copy of VS Code into `extension/.vscode-test/` on first run via `@vscode/test-electron`, launches it with a fixture workspace (`extension/test/fixtures/workspace`), activates the real extension, and runs a Mocha suite against the real `vscode` API — checking every command is registered and that start/stop/status run without throwing.

**Known limitation**: this suite requires genuine network access to VS Code's update servers to download a real, complete VS Code build. In at least one sandboxed CI-like environment this project was developed in, that download produced an archive missing `resources/app` (VS Code's actual application code) and the suite could not run — that is an environment/network limitation, not a defect in the test code, which follows `@vscode/test-electron`'s documented pattern and compiles cleanly. If you hit something similar, check that whatever network path your environment uses to reach `update.code.visualstudio.com` returns a real installable build.

## Linting and formatting

```bash
npm run lint      # eslint (extension/src)
```

`extension/eslint.config.js` only covers `extension/src` (and `extension/test`) — ESLint 9's flat-config "base path" restriction blocks linting `../tests` from that config location, so the root-level `tests/` directory currently relies on `tsc`/`vitest` catching issues at type-check/runtime rather than ESLint.

If you're also working on the unused `core/` Rust crate, it keeps its own formatting/linting commands: `npm run fmt:core`, `npm run fmt:core:check`, `npm run lint:core` (or `cargo fmt`/`cargo clippy` from `core/` directly).

## Versioning

The project version lives in one place: the **`.version`** file at the repo root. To release a new version, change it there and let the script copy it everywhere:

```bash
npm run version:set -- 0.4.0   # writes .version, then updates every file below
npm run version:check          # fails if any file differs from .version
npm run version:sync           # re-copies .version after you edit it by hand
```

`npm`, the VS Code manifest and Cargo can't read another file, so each keeps a literal copy, which `scripts/version.mjs` maintains: `package.json`, `extension/package.json`, `extension/package-lock.json` (both entries), `core/Cargo.toml`, and the `codelink-core` entry in `core/Cargo.lock`. Only the version text is rewritten, so formatting and line endings are untouched. Never edit those copies by hand.

Everything else reads the version at runtime instead of hardcoding it: the extension takes it from its own manifest (`context.extension.packageJSON.version`), and the dashboard, sidebar and MCP server info all use that value.

Drift is caught in three places: `npm test`, `npm run package` (a `prepackage` hook), and the packaging workflow, which also checks that a `v*` release tag matches `.version` before anything is published. To stop tracking another file, add or remove its entry in `TARGETS` at the top of `scripts/version.mjs`.

## Packaging

```bash
npm run build     # tsc (from the repo root; delegates to extension/)
npm run package   # vsce package -o codelink.vsix (from the repo root; delegates to extension/)
```

Or, from a fresh clone, `npm run package:local` installs dependencies, compiles, and packages in one step.

This produces `codelink.vsix` in the repo root (a few MB — `extension/`'s compiled output, `LICENSE`, `README.md`, and its production `node_modules`; no `--no-dependencies` flag, since `@modelcontextprotocol/sdk` and `zod` are real runtime dependencies, not bundled via esbuild). The extension has no native binary to bundle: the local core is plain TypeScript compiled alongside everything else, so the same `.vsix` runs unmodified on every platform VS Code supports.

**`extension/` is a standalone npm project, not an npm workspace**, specifically because of how `vsce package` discovers files: it runs `npm list --production --parseable --depth=99999` from the package directory to find dependency folders to include, and in a workspaces monorepo that walk resolves the workspace root itself as a "dependency" — which made `vsce` try to glob the *entire repository* into the VSIX, and then fail outright on a path that climbed outside the accepted package root. If you're tempted to reintroduce `"workspaces": ["extension"]` in the root `package.json` for convenience, check that `vsce package` still produces a small, sane VSIX afterward (`vsce ls --tree` from `extension/` shows exactly what would be included).

## Common gotchas

- If `npm install` reports a version that doesn't exist for some dependency, double check with `npm view <pkg> version` — the versions pinned in `extension/package.json` were deliberately chosen (sometimes an older major than "latest") where a newer major's behavior wasn't verifiable at the time this was written; don't blindly bump without checking the changelog.
- On Windows, prefer PowerShell over Git Bash for anything that spawns a GUI process (e.g. `@vscode/test-electron`) — Git Bash's MSYS path translation can corrupt arguments passed to native Windows executables.
