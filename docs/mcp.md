# MCP server

CodeLink implements the [Model Context Protocol](https://modelcontextprotocol.io) using the official `@modelcontextprotocol/sdk`, over the Streamable HTTP transport.

## Endpoint

```text
http://127.0.0.1:<port>/mcp        (default port: 32100)
```

The path is fixed at `/mcp`; anything else returns `404`. The host is `127.0.0.1` unless `codelink.remote.enabled` is `true`, in which case it's `codelink.server.host` — see [remote-access.md](remote-access.md).

## Supported methods

Standard MCP JSON-RPC methods, handled by the SDK's `McpServer`:

- `initialize`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`

CodeLink does not add any non-standard methods; an MCP client library that already speaks Streamable HTTP needs no CodeLink-specific handling.

## Sessions

The transport is stateful: the first request (`initialize`) gets back an `Mcp-Session-Id` response header, which the client must send on every subsequent request. `StreamableHTTPServerTransport` (from the SDK) can only complete one `initialize` per instance, so `McpServerManager` creates a fresh `McpServer` + transport pair per session and routes each incoming request to the right one by that header — see [architecture.md](architecture.md#mcp-transport-why-streamable-http-and-why-a-bare-nodehttp-server) for why.

## The tool execution pipeline

Described in full in [security.md](security.md#the-tool-execution-pipeline). In short: connection-level auth/rate-limiting happens once per HTTP request, before MCP routing; permission checks happen once per tool call; path/secret checks happen inside the tool, for each path argument it receives.

## Tool result shape

Every tool returns a standard MCP `CallToolResult`: `{ content: [{ type: "text", text: "..." }], isError?: boolean }`. On success, `text` is a JSON-encoded string of the tool's structured result (e.g. `{"path": "src/app.ts", "content": "...", "size": 512}`) — CodeLink does not replace a real result with a human-readable summary string. On failure, `text` is `{"code": "...", "message": "..."}` and `isError` is `true`.

## Resources

Four fixed-URI resources, each gated by the same permission a corresponding tool would use:

| URI | Description | Permission |
|---|---|---|
| `workspace://info` | Name, root path, folders, OS, active editor | `workspaceRead` |
| `workspace://files` | Top-level directory listing | `workspaceRead` |
| `editor://active` | Active editor's path, language, and content | `editorRead` |
| `diagnostics://workspace` | All current diagnostics | `workspaceRead` |

See [tools.md](tools.md) for the full tool list.

## Error codes

A tool failure's `content[0].text` is `{"code": "<CODE>", "message": "..."}`. A connection-level failure (rejected before MCP routing) is instead a plain HTTP error response with the same `{"error": {"code", "message"}}` shape, at a status code from this mapping (`mcp/protocol.ts::httpStatusForErrorCode`):

| Code | HTTP status (connection-level) | Meaning |
|---|:---:|---|
| `AUTHENTICATION_REQUIRED` | 401 | Remote access is on and no bearer token was sent |
| `AUTHENTICATION_FAILED` | 401 | Remote access is on and the token didn't match |
| `RATE_LIMITED` | 429 | Sliding-window or concurrency limit exceeded (remote only) |
| `PERMISSION_DENIED`, `REMOTE_ACCESS_DISABLED` | 403 | (tool-level errors use this mapping only if they somehow occur at the connection layer; in practice these are tool-level and returned as a normal `CallToolResult`) |
| anything else | 500 | Unexpected connection-level failure |

Tool-level codes (returned inside a normal `CallToolResult`, not as an HTTP error): `PERMISSION_DENIED`, `PATH_OUTSIDE_WORKSPACE`, `FILE_NOT_FOUND`, `FILE_TOO_LARGE`, `FILE_WRITE_DISABLED`, `FILE_DELETE_DISABLED`, `TERMINAL_DISABLED`, `TERMINAL_TIMEOUT`, `PROCESS_NOT_FOUND`, `GIT_WRITE_DISABLED`, `INVALID_ARGUMENT`, `REQUEST_TIMEOUT`, `SECRET_ACCESS_DENIED`, `ALREADY_EXISTS`, `NOT_A_DIRECTORY`, `IS_A_DIRECTORY`, `RUST_CORE_UNAVAILABLE`, `RUST_CORE_CRASHED`, `GIT_COMMAND_FAILED`, `INTERNAL_ERROR`. The full set is defined in `extension/src/utils/errors.ts`.

None of these expose a stack trace or internal file paths beyond the workspace-relative path already in the request.

## Connecting a client

Any MCP client that supports Streamable HTTP works. Example configuration (also produced by **CodeLink: Copy MCP Configuration**):

```json
{
  "mcpServers": {
    "codelink": {
      "url": "http://127.0.0.1:32100/mcp"
    }
  }
}
```

With remote access and a token configured, the same shape gains a header:

```json
{
  "mcpServers": {
    "codelink": {
      "url": "https://your-tunnel-or-host/mcp",
      "headers": { "Authorization": "Bearer <your-token>" }
    }
  }
}
```
