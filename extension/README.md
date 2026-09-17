# CodeLink

Turn your VS Code workspace into a secure, local-first MCP server for external AI clients.

CodeLink does not contain an AI model or an agent loop — it's the bridge between an external MCP client and your VS Code workspace: an MCP server, a security/permission layer, and a native Rust core for filesystem/search/process/Git operations.

## Getting started

1. Open a workspace folder.
2. Run **CodeLink: Start MCP Server** (Command Palette). Nothing runs until you do this — the server is stopped by default.
3. Run **CodeLink: Copy MCP Configuration** and paste the result into your MCP client.
4. Click the **CodeLink** status bar item any time to open the dashboard.

## Security defaults

- Binds to `127.0.0.1` only, unless you explicitly enable remote access.
- Ships on the `developer` profile: read + edit + write, but file delete, terminal access, and Git writes are off.
- Blocks direct access to files that look like secrets (`.env`, private keys, credential files) unless you turn that off.
- Remote access requires a bearer token and is rate-limited; it's a separate, confirmed opt-in, not a side effect of any other setting.

## Learn more

The full documentation — architecture, the complete tool/resource list, every configuration setting, and the remote-access/Cloudflare-tunnel guide — lives in the repository: <https://github.com/nishanth-kj/CodeLink>.

## License

MIT
