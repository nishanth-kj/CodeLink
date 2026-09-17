import { randomBytes } from "node:crypto";
import type * as http from "node:http";
import type { Logger } from "../utils/logger.js";

export class OAuthServer {
  private readonly codes = new Map<string, { token: string; expiresAt: number }>();
  private readonly validTokens = new Set<string>();

  constructor(private readonly logger: Logger) {}

  isOAuthRequest(pathname: string): boolean {
    const p = pathname.toLowerCase();
    return (
      p.includes("oauth-protected-resource") ||
      p.includes("oauth-authorization-server") ||
      p.includes("openid-configuration") ||
      p.includes("/oauth/") ||
      p.endsWith("/oauth")
    );
  }

  isOAuthToken(token: string | undefined): boolean {
    if (!token) return false;
    return this.validTokens.has(token) || token.startsWith("codelink_oauth_") || token.startsWith("codelink_token_");
  }

  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse, hostUrl: string): Promise<void> {
    const url = new URL(req.url ?? "/", hostUrl);
    const p = url.pathname.toLowerCase();
    const baseUrl = hostUrl.replace(/\/$/, "");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, x-mcp-session-id");
    res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id, x-mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Protected Resource Metadata (RFC 9728)
    // Used by Claude and modern MCP clients to discover authorization servers for this resource
    if (p.includes("oauth-protected-resource")) {
      const metadata = {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"],
        scopes_supported: ["mcp", "read", "write"],
        resource_documentation: `${baseUrl}/mcp`,
      };

      this.logger.info("Served OAuth protected resource metadata", { metadata });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
      res.end(JSON.stringify(metadata, null, 2));
      return;
    }

    // 2. Authorization Server Metadata (RFC 8414) & OpenID Connect Discovery
    if (p.includes("oauth-authorization-server") || p.includes("openid-configuration")) {
      const metadata = {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        registration_endpoint: `${baseUrl}/oauth/register`,
        userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
        code_challenge_methods_supported: ["S256", "plain"],
        scopes_supported: ["mcp", "read", "write"],
      };

      this.logger.info("Served OAuth authorization server metadata", { metadata });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
      res.end(JSON.stringify(metadata, null, 2));
      return;
    }

    // 3. Dynamic Client Registration (RFC 7591)
    if (p.endsWith("/oauth/register") || p.includes("/oauth/register")) {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        let clientName = "Claude CodeLink Client";
        let redirectUris: string[] = [];
        try {
          if (body) {
            const parsed = JSON.parse(body);
            if (parsed.client_name) clientName = parsed.client_name;
            if (Array.isArray(parsed.redirect_uris)) redirectUris = parsed.redirect_uris;
          }
        } catch {
          // ignore malformed body
        }

        const clientId = `codelink-client-${randomBytes(8).toString("hex")}`;
        const clientSecret = `codelink-secret-${randomBytes(16).toString("hex")}`;
        const fallbackUri = url.searchParams.get("redirect_uri");
        if (fallbackUri && redirectUris.length === 0) {
          redirectUris.push(fallbackUri);
        }

        this.logger.info("Registered OAuth client", { clientId, clientName, redirectUris });

        res.writeHead(201, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Pragma": "no-cache",
        });
        res.end(
          JSON.stringify(
            {
              client_id: clientId,
              client_secret: clientSecret,
              client_id_issued_at: Math.floor(Date.now() / 1000),
              client_secret_expires_at: 0,
              client_name: clientName,
              redirect_uris: redirectUris.length > 0 ? redirectUris : ["*"],
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
            },
            null,
            2,
          ),
        );
      });
      return;
    }

    // 4. Authorization Endpoint (/oauth/authorize)
    if (p.endsWith("/oauth/authorize") || p.includes("/oauth/authorize")) {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state") ?? "";
      const code = randomBytes(16).toString("hex");
      const token = `codelink_oauth_${randomBytes(24).toString("hex")}`;

      this.codes.set(code, { token, expiresAt: Date.now() + 10 * 60 * 1000 });
      this.validTokens.add(token);

      if (redirectUri) {
        let redirectTarget: URL;
        try {
          redirectTarget = new URL(redirectUri);
        } catch {
          redirectTarget = new URL(redirectUri, hostUrl);
        }
        redirectTarget.searchParams.set("code", code);
        if (state) {
          redirectTarget.searchParams.set("state", state);
        }
        const targetUrl = redirectTarget.toString();

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Authorize CodeLink MCP</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${targetUrl}">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 32px;
      max-width: 440px;
      text-align: center;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    h2 { margin-top: 0; color: #38bdf8; font-size: 20px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.5; }
    a.btn {
      display: inline-block;
      background: #38bdf8;
      color: #0f172a;
      font-weight: 600;
      padding: 10px 24px;
      border-radius: 6px;
      text-decoration: none;
      margin-top: 18px;
      transition: background 0.2s;
    }
    a.btn:hover { background: #7dd3fc; }
  </style>
  <script>
    setTimeout(function() {
      window.location.href = ${JSON.stringify(targetUrl)};
    }, 100);
  </script>
</head>
<body>
  <div class="card">
    <h2>CodeLink MCP Authorization</h2>
    <p>Authorizing connection to workspace...</p>
    <p><small style="opacity: 0.7;">Redirecting automatically...</small></p>
    <a class="btn" href="${targetUrl}">Continue</a>
  </div>
</body>
</html>`);
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html>
<head><title>CodeLink OAuth</title></head>
<body style="font-family: sans-serif; background: #0f172a; color: white; padding: 40px;">
  <h2>CodeLink MCP OAuth Provider Active</h2>
  <p>OAuth Authorization Endpoint is ready.</p>
</body>
</html>`);
      return;
    }

    // 5. Token Endpoint (/oauth/token)
    if (p.endsWith("/oauth/token") || p.includes("/oauth/token")) {
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
        const accessToken = entry ? entry.token : `codelink_oauth_${randomBytes(24).toString("hex")}`;
        this.validTokens.add(accessToken);

        this.logger.info("Issued OAuth access token");

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Pragma": "no-cache",
        });
        res.end(
          JSON.stringify(
            {
              access_token: accessToken,
              token_type: "Bearer",
              expires_in: 86400 * 30,
              refresh_token: `codelink_refresh_${randomBytes(16).toString("hex")}`,
              scope: "mcp",
            },
            null,
            2,
          ),
        );
      });
      return;
    }

    // 6. Userinfo Endpoint (/oauth/userinfo)
    if (p.endsWith("/oauth/userinfo") || p.includes("/oauth/userinfo")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          sub: "codelink-user",
          name: "CodeLink Workspace",
          preferred_username: "codelink",
        }),
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  }
}

