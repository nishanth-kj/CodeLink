import { randomBytes } from "node:crypto";
import type * as http from "node:http";
import type { Logger } from "../utils/logger.js";

export class OAuthServer {
  private readonly codes = new Map<string, { token: string; expiresAt: number }>();
  private readonly validTokens = new Set<string>();

  constructor(private readonly logger: Logger) {}

  isOAuthRequest(pathname: string): boolean {
    return (
      pathname.includes("oauth-authorization-server") ||
      pathname.includes("openid-configuration") ||
      pathname.startsWith("/oauth/") ||
      pathname.startsWith("/mcp/oauth/")
    );
  }

  isOAuthToken(token: string | undefined): boolean {
    if (!token) return false;
    return this.validTokens.has(token) || token.startsWith("codelink_oauth_") || token.startsWith("codelink_token_");
  }

  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse, hostUrl: string): Promise<void> {
    const url = new URL(req.url ?? "/", hostUrl);
    // Normalize path (handle /mcp/.well-known as well as /.well-known)
    let pathname = url.pathname;
    if (pathname.startsWith("/mcp/")) {
      pathname = pathname.slice(4);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. OAuth / OIDC Discovery endpoint
    if (
      pathname === "/.well-known/oauth-authorization-server" ||
      pathname === "/.well-known/openid-configuration" ||
      pathname.endsWith("oauth-authorization-server") ||
      pathname.endsWith("openid-configuration")
    ) {
      const baseUrl = hostUrl.replace(/\/$/, "");
      const metadata = {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        registration_endpoint: `${baseUrl}/oauth/register`,
        userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
        code_challenge_methods_supported: ["S256", "plain"],
        scopes_supported: ["mcp", "read", "write"],
      };

      this.logger.info("Served OAuth discovery metadata", { metadata });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(metadata, null, 2));
      return;
    }

    // 2. Dynamic Client Registration
    if (pathname === "/oauth/register") {
      const clientId = `codelink-client-${randomBytes(6).toString("hex")}`;
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          client_id: clientId,
          client_name: "Claude CodeLink Client",
          redirect_uris: [url.searchParams.get("redirect_uri") ?? "*"],
        }),
      );
      return;
    }

    // 3. Authorization Endpoint
    if (pathname === "/oauth/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state") ?? "";
      const code = randomBytes(16).toString("hex");
      const token = `codelink_oauth_${randomBytes(24).toString("hex")}`;

      this.codes.set(code, { token, expiresAt: Date.now() + 5 * 60 * 1000 });
      this.validTokens.add(token);

      if (redirectUri) {
        const redirectTarget = new URL(redirectUri);
        redirectTarget.searchParams.set("code", code);
        if (state) {
          redirectTarget.searchParams.set("state", state);
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authorize CodeLink</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; max-width: 420px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h2 { margin-top: 0; color: #38bdf8; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.5; }
    a.btn { display: inline-block; background: #38bdf8; color: #0f172a; font-weight: 600; padding: 10px 24px; border-radius: 6px; text-decoration: none; margin-top: 16px; }
  </style>
  <meta http-equiv="refresh" content="1;url=${redirectTarget.toString()}">
</head>
<body>
  <div class="card">
    <h2>CodeLink MCP Authorization</h2>
    <p>Connecting your AI client to your VS Code workspace...</p>
    <p><small>Redirecting automatically in 1 second...</small></p>
    <a class="btn" href="${redirectTarget.toString()}">Continue</a>
  </div>
</body>
</html>`);
        return;
      }

      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "missing_redirect_uri" }));
      return;
    }

    // 4. Token Endpoint
    if (pathname === "/oauth/token") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        let code = "";
        try {
          const parsed = JSON.parse(body);
          code = parsed.code ?? "";
        } catch {
          const params = new URLSearchParams(body);
          code = params.get("code") ?? "";
        }

        const entry = this.codes.get(code);
        const accessToken = entry ? entry.token : `codelink_token_${randomBytes(24).toString("hex")}`;
        this.validTokens.add(accessToken);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: 86400 * 30,
            refresh_token: `codelink_refresh_${randomBytes(16).toString("hex")}`,
            scope: "mcp",
          }),
        );
      });
      return;
    }

    // 5. Userinfo Endpoint
    if (pathname === "/oauth/userinfo") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          sub: "codelink-user",
          name: "CodeLink Workspace",
        }),
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  }
}
