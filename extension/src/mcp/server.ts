import { randomUUID } from "node:crypto";
import * as http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { effectiveHost } from "../config/defaults.js";
import type { CodeLinkConfig } from "../config/schema.js";
import { diagnosticsWorkspaceResource } from "../resources/diagnostics.js";
import { editorActiveResource, workspaceInfoResource } from "../resources/workspace.js";
import { workspaceFilesResource } from "../resources/files.js";
import type { RegisteredResource } from "../resources/index.js";
import type { RustBridge } from "../rust/bridge.js";
import type { SecurityPolicy } from "../security/policy.js";
import { diagnosticsTools } from "../tools/diagnostics.js";
import { editorTools } from "../tools/editor.js";
import { filesystemTools } from "../tools/filesystem.js";
import { gitTools } from "../tools/git.js";
import { bindTool, type RegisteredTool, type ToolContext } from "../tools/index.js";
import { searchTools } from "../tools/search.js";
import { terminalTools } from "../tools/terminal.js";
import { workspaceTools } from "../tools/workspace.js";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { OAuthServer } from "../security/oauth.js";
import { buildServerInfo, SERVER_INSTRUCTIONS } from "./capabilities.js";
import { extractBearerToken, httpStatusForErrorCode, isHostHeaderAllowed, MCP_ENDPOINT_PATH } from "./protocol.js";
import { SessionTracker } from "./session.js";

const ALL_TOOLS: RegisteredTool[] = [
  ...workspaceTools,
  ...filesystemTools,
  ...editorTools,
  ...diagnosticsTools,
  ...searchTools,
  ...terminalTools,
  ...gitTools,
];

const ALL_RESOURCES: RegisteredResource[] = [
  workspaceInfoResource,
  workspaceFilesResource,
  editorActiveResource,
  diagnosticsWorkspaceResource,
];

export interface McpServerManagerOptions {
  extensionVersion: string;
  workspaceRoot: string;
  workspaceName: string;
  bridge: RustBridge;
  policy: SecurityPolicy;
  getConfig: () => CodeLinkConfig;
  logger: Logger;
}

export interface McpServerAddress {
  host: string;
  port: number;
}

interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

/**
 * Owns the MCP server's HTTP listener end to end: binding (never beyond
 * 127.0.0.1 unless remote access is enabled, regardless of configuration),
 * the connection-level authenticate/rate-limit/Host-header gate that runs
 * before any MCP routing, and registering every tool/resource behind the
 * tool-scoped permission check. See docs/mcp.md for the full pipeline this
 * class and `tools/index.ts` together implement.
 *
 * `StreamableHTTPServerTransport` is single-session: one transport can
 * only ever complete one `initialize` handshake. A client reconnecting
 * (or a second client connecting at all) needs its own transport and its
 * own `McpServer`, so this class keeps a `Map` of sessions keyed by the
 * `Mcp-Session-Id` the transport assigns on `initialize`, and every HTTP
 * request is routed to the right session by that header — the standard
 * pattern for a stateful, multi-session Streamable HTTP server.
 */
export class McpServerManager {
  private httpServer: http.Server | undefined;
  private ctx: ToolContext | undefined;
  private readonly sessions = new Map<string, McpSession>();
  private readonly sessionTracker = new SessionTracker();
  private readonly logger: Logger;
  private readonly oauthServer: OAuthServer;

  constructor(private readonly options: McpServerManagerOptions) {
    this.logger = options.logger.child("mcp-server");
    this.oauthServer = new OAuthServer(this.logger);
  }

  isRunning(): boolean {
    return this.httpServer !== undefined;
  }

  get sessionInfo(): SessionTracker {
    return this.sessionTracker;
  }

  async start(): Promise<McpServerAddress> {
    if (this.httpServer) {
      throw new CodeLinkError(ErrorCodes.SERVER_START_FAILED, "The MCP server is already running.");
    }

    const config = this.options.getConfig();
    const host = effectiveHost(config);
    const port = config.server.port;

    this.ctx = {
      workspaceRoot: this.options.workspaceRoot,
      workspaceName: this.options.workspaceName,
      bridge: this.options.bridge,
      getConfig: this.options.getConfig,
      logger: this.logger,
    };

    const httpServer = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error: unknown) => {
        this.logger.error("Unhandled error while handling MCP request", {
          message: error instanceof Error ? error.message : String(error),
        });
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
        }
        res.end(JSON.stringify({ error: { code: ErrorCodes.INTERNAL_ERROR, message: "Internal server error" } }));
      });
    });

    await this.listen(httpServer, host, port);

    this.httpServer = httpServer;
    this.logger.info("MCP server started", { host, port, remoteEnabled: config.remote.enabled });
    return { host, port };
  }

  private listen(httpServer: http.Server, host: string, port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        httpServer.removeListener("listening", onListening);
        if (error.code === "EADDRINUSE") {
          reject(new CodeLinkError(ErrorCodes.PORT_IN_USE, `Port ${port} is already in use.`));
        } else {
          reject(new CodeLinkError(ErrorCodes.SERVER_START_FAILED, error.message));
        }
      };
      const onListening = () => {
        httpServer.removeListener("error", onError);
        resolve();
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(port, host);
    });
  }

  async stop(): Promise<void> {
    const httpServer = this.httpServer;
    if (!httpServer) {
      return;
    }
    this.httpServer = undefined;

    // Close sessions (ending any open SSE stream) before closing the HTTP
    // server: node's http.Server#close() callback only fires once every
    // connection has ended on its own, so closing the server first would
    // deadlock against a still-open streaming response.
    for (const session of this.sessions.values()) {
      await session.transport.close();
      await session.server.close();
    }
    this.sessions.clear();
    this.sessionTracker.reset();

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      httpServer.closeAllConnections();
    });

    this.ctx = undefined;
    this.logger.info("MCP server stopped");
  }

  async restart(): Promise<McpServerAddress> {
    await this.stop();
    return this.start();
  }

  /** Builds one session's McpServer + transport, with every tool and
   * resource registered exactly as `start()` used to do once globally. */
  private createSession(ctx: ToolContext): McpSession {
    const mcpServer = new McpServer(buildServerInfo(this.options.extensionVersion), {
      instructions: SERVER_INSTRUCTIONS,
    });

    for (const tool of ALL_TOOLS) {
      mcpServer.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        bindTool(tool, ctx, this.options.policy),
      );
    }

    for (const resource of ALL_RESOURCES) {
      mcpServer.registerResource(
        resource.name,
        resource.uri,
        { description: resource.description, mimeType: resource.mimeType },
        async (uri) => {
          if (resource.permission) {
            this.options.policy.checkPermission(resource.permission);
          }
          const text = await resource.read(ctx);
          return { contents: [{ uri: uri.toString(), mimeType: resource.mimeType, text }] };
        },
      );
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, { server: mcpServer, transport });
        this.sessionTracker.onInitialized(sessionId);
      },
      onsessionclosed: (sessionId) => {
        this.sessions.delete(sessionId);
        this.sessionTracker.onClosed(sessionId);
      },
    });

    return { server: mcpServer, transport };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const config = this.options.getConfig();
    const hostHeader = req.headers.host ?? "localhost";
    const defaultProto = hostHeader.startsWith("localhost") || hostHeader.startsWith("127.0.0.1") ? "http" : "https";
    const proto = (req.headers["x-forwarded-proto"] as string) ?? defaultProto;
    const hostUrl = `${proto}://${hostHeader}`;
    const url = new URL(req.url ?? "/", hostUrl);

    // 1. Intercept OAuth & OIDC discovery and authorization requests
    if (this.oauthServer.isOAuthRequest(url.pathname)) {
      await this.oauthServer.handleRequest(req, res, hostUrl);
      return;
    }

    // 2. Set CORS headers for all MCP traffic
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, x-mcp-session-id");
    res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id, x-mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Friendly root info for browsers or health checks
    if (url.pathname === "/" || url.pathname === "") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          name: "CodeLink MCP Server",
          version: this.options.extensionVersion,
          status: "running",
          mcp_endpoint: `${hostUrl}${MCP_ENDPOINT_PATH}`,
          oauth_discovery: `${hostUrl}/.well-known/oauth-authorization-server`,
          protected_resource_metadata: `${hostUrl}/.well-known/oauth-protected-resource`,
        }),
      );
      return;
    }

    if (url.pathname !== MCP_ENDPOINT_PATH) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: `No such endpoint: ${url.pathname}` } }));
      return;
    }

    if (!isHostHeaderAllowed(req.headers.host, config.server.port, config.remote.enabled)) {
      this.logger.warn("Rejected request with disallowed Host header", { host: req.headers.host });
      res.writeHead(421, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "HOST_NOT_ALLOWED", message: "Host header not allowed." } }));
      return;
    }

    const clientId = req.socket.remoteAddress ?? "unknown";
    const bearerToken = extractBearerToken(req.headers.authorization);

    // If Auth is required, verify OAuth token or policy connection authorization
    if (this.options.policy.isAuthRequired()) {
      if (!this.oauthServer.isOAuthToken(bearerToken)) {
        try {
          await this.options.policy.authorizeConnection({ clientId, bearerToken });
        } catch (error) {
          const code = CodeLinkError.isCodeLinkError(error) ? error.code : ErrorCodes.INTERNAL_ERROR;
          const message = error instanceof Error ? error.message : String(error);
          const status = httpStatusForErrorCode(code);
          const headers: Record<string, string> = { "content-type": "application/json" };
          if (status === 401) {
            headers["WWW-Authenticate"] = `Bearer resource_metadata="${hostUrl}/.well-known/oauth-protected-resource"`;
          }
          res.writeHead(status, headers);
          res.end(JSON.stringify({ error: { code, message } }));
          return;
        }
      }
    }

    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    let session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) {
      if (sessionId) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "SESSION_NOT_FOUND", message: "Unknown or expired MCP session." } }));
        return;
      }
      if (!this.ctx) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: ErrorCodes.SERVER_NOT_RUNNING, message: "Server is not ready." } }));
        return;
      }
      session = this.createSession(this.ctx);
      await session.server.connect(session.transport);
    }

    await session.transport.handleRequest(req, res);
  }
}
