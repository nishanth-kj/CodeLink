import { isIP } from "node:net";
import { ErrorCodes } from "../utils/errors.js";

export const MCP_ENDPOINT_PATH = "/mcp";

/**
 * Scheme to assume when rebuilding this server's own URL from a request's
 * `Host` header (for the root info page and OAuth discovery documents) and
 * no `X-Forwarded-Proto` says otherwise. The listener itself is plain HTTP,
 * so a client that dialled localhost or a bare IP address — IPv4, or a
 * bracketed IPv6 literal such as `[2001:db8::1]:32100` — is on `http`; only
 * a named host can be a TLS-terminating tunnel or proxy.
 */
export function defaultProtocolForHost(hostHeader: string): "http" | "https" {
  const hostname = hostHeader.startsWith("[")
    ? hostHeader.slice(1, hostHeader.indexOf("]"))
    : (hostHeader.split(":")[0] ?? hostHeader);
  return hostname.toLowerCase() === "localhost" || isIP(hostname) !== 0 ? "http" : "https";
}

/** Maps a CodeLink error code to the HTTP status a client should see when
 * the failure happens before the MCP JSON-RPC layer gets involved (i.e.
 * during the connection-level authenticate/rate-limit gate in
 * `mcp/server.ts`). Tool-level errors are instead reported inside a normal
 * MCP `CallToolResult` with `isError: true`, per the MCP spec. */
export function httpStatusForErrorCode(code: string): number {
  switch (code) {
    case ErrorCodes.AUTHENTICATION_REQUIRED:
    case ErrorCodes.AUTHENTICATION_FAILED:
      return 401;
    case ErrorCodes.RATE_LIMITED:
      return 429;
    case ErrorCodes.REMOTE_ACCESS_DISABLED:
    case ErrorCodes.PERMISSION_DENIED:
      return 403;
    default:
      return 500;
  }
}

/**
 * Basic DNS-rebinding protection: when remote access is disabled, only
 * accept requests whose `Host` header names a loopback address on the
 * configured port. A malicious web page cannot make a browser send an
 * arbitrary `Host` header, so this stops it from reaching the server
 * through the victim's own browser even though the server is bound to
 * 127.0.0.1. When remote access is enabled the user has already opted
 * into broader exposure and authentication is the real gate, so any Host
 * is accepted (a Cloudflare Tunnel, for example, presents its own
 * hostname).
 */
export function isHostHeaderAllowed(
  hostHeader: string | undefined,
  port: number,
  remoteEnabled: boolean,
): boolean {
  if (remoteEnabled) {
    return true;
  }
  if (!hostHeader) {
    return false;
  }
  const lower = hostHeader.toLowerCase();
  if (lower.endsWith(".trycloudflare.com") || lower.includes("trycloudflare.com")) {
    return true;
  }
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  return allowed.has(lower);
}

export function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith("Bearer ")) {
    return undefined;
  }
  const token = value.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}
