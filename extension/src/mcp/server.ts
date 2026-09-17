import * as http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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
import { buildServerInfo, SERVER_INSTRUCTIONS } from "./capabilities.js";
import { extractBearerToken, httpStatusForErrorCode, isHostHeaderAllowed, MCP_ENDPOINT_PATH } from "./protocol.js";
import { SessionTracker } from "./session.js";
import { createTransport } from "./transport.js";

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

/**
 * Owns the MCP server's HTTP listener end to end: binding (never beyond
 * 127.0.0.1 unless remote access is enabled, regardless of configuration),
 * the connection-level authenticate/rate-limit/Host-header gate that runs
 * before any MCP routing, and registering every tool/resource behind the
 * tool-scoped permission check. See docs/mcp.md for the full pipeline this
 * class and `tools/index.ts` together implement.
 */
export class McpServerManager {
  private httpServer: http.Server | undefined;
  private mcpServer: McpServer | undefined;
  private transport: StreamableHTTPServerTransport | undefined;
  private readonly sessionTracker = new SessionTracker();
  private readonly logger: Logger;

  constructor(private readonly options: McpServerManagerOptions) {
    this.logger = options.logger.child("mcp-server");
  }

  isRunning(): boolean {
    return this.httpServer !== undefined;
  }

  get sessions(): SessionTracker {
    return this.sessionTracker;
  }

  async start(): Promise<McpServerAddress> {
    if (this.httpServer) {
      throw new CodeLinkError(ErrorCodes.SERVER_START_FAILED, "The MCP server is already running.");
    }

    const config = this.options.getConfig();
    const host = effectiveHost(config);
    const port = config.server.port;

    const ctx: ToolContext = {
      workspaceRoot: this.options.workspaceRoot,
      workspaceName: this.options.workspaceName,
      bridge: this.options.bridge,
      getConfig: this.options.getConfig,
      logger: this.logger,
    };

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

    const transport = createTransport(this.sessionTracker);
    await mcpServer.connect(transport);

    const httpServer = http.createServer((req, res) => {
      this.handleRequest(req, res, transport).catch((error: unknown) => {
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
    this.mcpServer = mcpServer;
    this.transport = transport;
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
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await this.transport?.close();
    await this.mcpServer?.close();
    this.mcpServer = undefined;
    this.transport = undefined;
    this.sessionTracker.reset();
    this.logger.info("MCP server stopped");
  }

  async restart(): Promise<McpServerAddress> {
    await this.stop();
    return this.start();
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    transport: StreamableHTTPServerTransport,
  ): Promise<void> {
    const config = this.options.getConfig();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

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

    try {
      await this.options.policy.authorizeConnection({ clientId, bearerToken });
    } catch (error) {
      const code = CodeLinkError.isCodeLinkError(error) ? error.code : ErrorCodes.INTERNAL_ERROR;
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(httpStatusForErrorCode(code), { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code, message } }));
      return;
    }

    await transport.handleRequest(req, res);
  }
}
