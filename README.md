# CodeLink

CodeLink turns a local VS Code workspace into a secure, local-first **Model Context Protocol (MCP)** server, so an external MCP-compatible AI client can read, search, edit, and (optionally) run commands in your project — under permissions you control.

CodeLink is infrastructure, not an agent: it does not contain a model, a prompt, or an agent loop. It is the bridge between an external AI client and your local VS Code environment.

```text
External AI / MCP Client
          │
          │  MCP over Streamable HTTP
          ▼
   CodeLink (VS Code extension, TypeScript)
     MCP server · security & permissions · VS Code API
     local core: filesystem · search · processes · Git
          │
          ▼
     Your local workspace
```

## Features

- **MCP server over Streamable HTTP**, built on the official `@modelcontextprotocol/sdk`, exposing tools and resources for workspace discovery, file I/O, editor state, diagnostics, search, terminal processes, and read-only Git.
- **A pure TypeScript local core** (`extension/src/core/`) does every filesystem, search, process, and Git operation in-process, behind the same `call(method, params)` chokepoint every tool goes through. See [docs/architecture.md](docs/architecture.md).
- **Local-first and safe by default**: the server binds to `127.0.0.1` only, starts stopped, and ships with file delete, terminal access, and Git writes all disabled until you turn them on.
- **Centralized security**: every tool call passes through path validation, secret-file filtering, and a permission check before it touches your workspace — see [docs/security.md](docs/security.md).
- **Four security profiles** (`readonly`, `developer`, `trusted`, `custom`) so you can match the permission surface to how much you trust the client on the other end.
- **Optional remote access** behind bearer-token authentication and rate limiting, plus an optional Cloudflare quick-tunnel — both off until you explicitly enable them.
- **A dashboard and status bar item** for at-a-glance status, and a full set of Command Palette commands.

## Repository layout

```text
CodeLink/
├── extension/     VS Code extension (TypeScript) — MCP server, security, UI, commands,
│                  and the local core (filesystem, search, processes, Git)
├── core/          Standalone Rust implementation of the same core, kept in the repo but
│                  not used by the extension (see docs/architecture.md)
├── tests/         Cross-cutting unit/integration tests (security, mcp, integration)
├── docs/          Design documentation (linked below)
└── .vscode/       Dev-time launch/task configuration
```

## Installation

CodeLink is not yet published to the VS Code Marketplace; install it from a built `.vsix`:

```bash
git clone https://github.com/nishanth-kj/CodeLink
cd CodeLink
npm install --prefix extension   # extension/ is a standalone npm project
npm run build                    # compiles the extension to extension/out
npm run package                  # produces codelink.vsix in the repo root
```

Then in VS Code: **Extensions → ⋯ → Install from VSIX…** and select `codelink.vsix`.

See [docs/development.md](docs/development.md) for the full development setup, including running the extension from source in the Extension Development Host.

## Quickstart

1. Open a workspace folder in VS Code with CodeLink installed.
2. Run **CodeLink: Start MCP Server** from the Command Palette. The server starts on `http://127.0.0.1:32100/mcp` (stopped by default — nothing runs until you do this).
3. Run **CodeLink: Copy MCP Configuration** to copy a ready-to-paste client config:

   ```json
   {
     "mcpServers": {
       "codelink": {
         "url": "http://127.0.0.1:32100/mcp"
       }
     }
   }
   ```

4. Paste that into your MCP client's configuration and connect.
5. Click the **CodeLink** status bar item (bottom right) to open the dashboard at any time.

## Security model

By default, CodeLink is as boring and safe as possible:

| Capability | Default |
| --- | --- |
| Server bind address | `127.0.0.1` only |
| Remote access | Disabled |
| Security profile | `developer` (read + edit + write, no delete/terminal/Git-write) |
| File delete | Disabled |
| Terminal | Disabled |
| Git write operations | Not implemented (no tool exists to invoke them) |
| Secret file access (`.env`, keys, credentials) | Blocked |

Full details, including the path-validation and secret-filtering design, live in [docs/security.md](docs/security.md). Remote access and the optional Cloudflare tunnel are covered in [docs/remote-access.md](docs/remote-access.md) — read that before enabling either.

## Documentation

- [docs/architecture.md](docs/architecture.md) — how the extension, its local core, and MCP fit together, and why.
- [docs/security.md](docs/security.md) — the security model in depth: permissions, path validation, secret filtering, rate limiting.
- [docs/mcp.md](docs/mcp.md) — the MCP server: transport, protocol methods, the tool execution pipeline, error codes.
- [docs/tools.md](docs/tools.md) — every MCP tool and resource, its inputs, its permission, and its execution layer.
- [docs/configuration.md](docs/configuration.md) — every `codelink.*` VS Code setting.
- [docs/remote-access.md](docs/remote-access.md) — authentication, enabling remote access, and the Cloudflare tunnel.
- [docs/development.md](docs/development.md) — building, testing, linting, running from source, and packaging.

## Development

```bash
npm install --prefix extension   # extension/ is a standalone npm project, not a workspace
npm run build               # tsc (extension/)
npm test                    # extension unit/integration tests (vitest)
npm run lint                # eslint (extension/)
npm run package             # vsce package → codelink.vsix
```

The untouched, unused `core/` Rust crate still has its own commands (`npm run build:core`, `npm run test:core`, `npm run lint:core`, `npm run fmt:core`, or `cargo build`/`cargo test`/`cargo fmt`/`cargo clippy` from `core/` directly) if you want to keep working on it, but nothing under `extension/` depends on its output anymore.

See [docs/development.md](docs/development.md) for the Extension Development Host workflow, the test layout, and known environment limitations (in particular, the `extension/test/` real-VS-Code-API suite requires `@vscode/test-electron` to download an actual VS Code build).

## Contributing

Issues and pull requests are welcome. Please run `npm test` and `npm run lint` before submitting, and add tests for behavioral changes — particularly anything touching the security layer.

## License

[MIT](LICENSE)
