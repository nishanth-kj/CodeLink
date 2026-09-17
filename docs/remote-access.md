# Remote access

Read this before enabling remote access. The short version: **a Cloudflare tunnel makes CodeLink reachable — it does not make it secure.** Authentication and the permission profile are what's actually protecting your machine; the tunnel is just a way to get bytes to the server.

## The boundary

```text
Local (default)                    Remote (opt-in)
────────────────                   ───────────────
MCP client                         MCP client
    │ localhost only                   │ internet
    ▼                                  ▼
CodeLink                           Cloudflare Tunnel (optional)
    │                                  │
    ▼                                  ▼
Your machine                       CodeLink
                                        │
                                        ▼
                                    Your machine
```

Locally, the network itself is the boundary — nothing outside your machine can reach `127.0.0.1:32100`. Once you enable remote access, that's no longer true, and CodeLink switches to relying on authentication and rate limiting instead.

## Enabling remote access

Run **CodeLink: Enable Remote Access**. This command, not a raw settings.json edit, is the supported path, because it:

1. Shows a modal confirmation — enabling remote access is not a one-click accident.
2. Generates an access token if one doesn't already exist, and shows it to you exactly once (copy-to-clipboard). The raw token is never logged or displayed again; only its SHA-256 hash is stored (in VS Code's `SecretStorage`).
3. Sets `codelink.remote.enabled` to `true`.

Once enabled:

- The server binds to `codelink.server.host` (still `127.0.0.1` by default — you also need to change that, or use a tunnel, to actually be reachable from elsewhere).
- Every request must carry `Authorization: Bearer <token>`, verified with a constant-time comparison. Missing or wrong tokens get `AUTHENTICATION_REQUIRED` / `AUTHENTICATION_FAILED` (HTTP 401) before the request ever reaches MCP routing.
- Requests are rate-limited: `codelink.rateLimit.requestsPerMinute` per client IP (sliding one-minute window) and `codelink.rateLimit.maxConcurrentRequests` per MCP session.
- The permission profile still applies exactly as it does locally — remote access does not imply `trusted`.

**CodeLink: Disable Remote Access** flips it back off and stops any running tunnel.

## Managing the token

- **CodeLink: Generate Access Token** — creates a new token, invalidating the previous one, shown once.
- **CodeLink: Revoke Access Token** — deletes the stored token hash; every remote request is then rejected until a new one is generated.

The token is 32 random bytes (`crypto.randomBytes`), hex-encoded. Only its hash is ever persisted or compared.

## Cloudflare Tunnel

An optional way to make the local server reachable from outside your network without configuring port forwarding, using a Cloudflare "quick tunnel" (`cloudflared tunnel --url http://127.0.0.1:<port>`) — no Cloudflare account or DNS setup required.

**cloudflared is not bundled** with CodeLink; install it yourself ([Cloudflare's instructions](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)) and either put it on `PATH` or set `codelink.tunnel.cloudflaredPath`.

- **CodeLink: Start Cloudflare Tunnel** — refuses unless `codelink.remote.enabled` is already `true` and the MCP server is running. On success, shows and logs the generated `https://<random>.trycloudflare.com` URL.
- **CodeLink: Show Tunnel URL** — copies the current tunnel URL to the clipboard.
- **CodeLink: Stop Cloudflare Tunnel** — stops it.

The tunnel is never started automatically, and disabling remote access stops it too. A quick tunnel's URL is randomly generated and not guessable, but it is still a public URL for as long as the tunnel runs — anyone with the URL who also has (or brute-forces, subject to the rate limit) a valid token can reach your workspace.

## What remote access does *not* do

- It does not change the security profile. If you're on `readonly`, a remote client is still read-only.
- It does not scan for or protect against a compromised token beyond rate limiting and revocation — treat the token like any other credential.
- It does not add TLS itself; a Cloudflare tunnel terminates TLS at Cloudflare's edge, but a raw `codelink.server.host` exposure (e.g. binding `0.0.0.0` directly, without a tunnel) would be plain HTTP. Prefer the tunnel, or put your own TLS-terminating proxy in front, over binding a non-loopback host directly.
