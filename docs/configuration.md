# Configuration

All settings live under the `codelink.*` prefix in VS Code settings (workspace or user). Defaults are also defined in code at `extension/src/config/defaults.ts`, used wherever a value hasn't been set.

## Server

| Setting | Default | Description |
| --- | --- | --- |
| `codelink.server.enabled` | `false` | Start the MCP server automatically when the workspace opens. The server is always stopped on first install. |
| `codelink.server.host` | `"127.0.0.1"` | Bind address. **Only takes effect when `codelink.remote.enabled` is `true`** — otherwise CodeLink always binds `127.0.0.1`, regardless of this setting. Ignored in favour of `::` when `codelink.remote.ipv6` is on. See [remote-access.md](remote-access.md). |
| `codelink.server.port` | `32100` | TCP port. |
| `codelink.server.transport` | `"streamable-http"` | Fixed; no other value is currently supported. |

## Security

| Setting | Default | Description |
| --- | --- | --- |
| `codelink.security.profile` | `"developer"` | `readonly` \| `developer` \| `trusted` \| `custom`. See [security.md](security.md#permissions-and-security-profiles). |
| `codelink.security.allowFileWrite` | `true` | Only read when `profile` is `custom`. |
| `codelink.security.allowFileDelete` | `false` | Only read when `profile` is `custom`. |
| `codelink.security.allowEditorWrite` | `true` | Only read when `profile` is `custom`. |
| `codelink.security.allowTerminal` | `false` | Only read when `profile` is `custom`. |
| `codelink.security.allowGitWrite` | `false` | Only read when `profile` is `custom`. Has no effect yet — no Git write tool exists. |
| `codelink.security.allowSecretFileAccess` | `false` | Allow tools to read files that look like secrets (`.env`, private keys, credential files). Applies regardless of profile. |

## Remote access

| Setting | Default | Description |
| --- | --- | --- |
| `codelink.remote.enabled` | `false` | Enables authenticated non-loopback access. See [remote-access.md](remote-access.md) — don't just flip this in settings.json; use **CodeLink: Enable Remote Access**, which also makes sure a token exists. |
| `codelink.remote.ipv6` | `false` | Listen on every IPv6 interface (`::`, dual-stack) so clients can connect directly to `http://[<ipv6-address>]:<port>/mcp` without a tunnel. Overrides `codelink.server.host`. **Only takes effect when `codelink.remote.enabled` is `true`.** Prefer **CodeLink: Enable Direct IPv6 Access**, which asks for confirmation first. See [remote-access.md](remote-access.md#direct-ipv6-access). |

## Files

| Setting | Default | Description |
| --- | --- | --- |
| `codelink.files.excludePatterns` | `["**/.git/**", "**/node_modules/**", "**/target/**", "**/dist/**", "**/build/**", "**/.env", "**/.env.*"]` | Glob patterns excluded from listings, search, and (as directories) pruned from traversal entirely. |
| `codelink.files.maxReadBytes` | `10485760` (10 MiB) | Per-call override via a tool's `maxBytes` argument still can't exceed what the server allows to be configured here as the default. |
| `codelink.files.maxWriteBytes` | `10485760` (10 MiB) | |

## Search

| Setting | Default | Description |
| --- | --- | --- |
| `codelink.search.maxResults` | `100` | Matches per search call. |
| `codelink.search.maxFileSize` | `10485760` (10 MiB) | Files larger than this are skipped, not searched. |
| `codelink.search.timeoutMs` | `5000` | Maximum time a single search may run. |

## Terminal

| Setting | Default | Description |
| --- | --- | --- |
| `codelink.terminal.timeoutMs` | `30000` | Maximum time a `terminal_run` command may execute before being killed. |
| `codelink.terminal.maxOutputBytes` | `1048576` (1 MiB) | Captured stdout+stderr cap per process. |

## Rate limiting

Only enforced when `codelink.remote.enabled` is `true`.

| Setting | Default | Description |
| --- | --- | --- |
| `codelink.rateLimit.requestsPerMinute` | `120` | Sliding one-minute window, per client IP. |
| `codelink.rateLimit.maxConcurrentRequests` | `8` | Concurrent tool calls, per MCP session. |

## Logging

| Setting | Default | Description |
| --- | --- | --- |
| `codelink.logging.level` | `"info"` | `error` \| `warn` \| `info` \| `debug`. Applies to the "CodeLink" output channel. |

## Tunnel

| Setting | Default | Description |
| --- | --- | --- |
| `codelink.tunnel.cloudflaredPath` | `""` | Path to the `cloudflared` executable. Empty searches `PATH`. See [remote-access.md](remote-access.md#cloudflare-tunnel). |
