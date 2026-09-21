import * as vscode from "vscode";
import { copyConfig } from "./commands/copyConfig.js";
import { generateToken } from "./commands/generateToken.js";
import { copyIpv6Url, disableIpv6Access, enableIpv6Access } from "./commands/ipv6Access.js";
import { openDashboard } from "./commands/openDashboard.js";
import { disableRemoteAccess, enableRemoteAccess } from "./commands/remoteAccess.js";
import { restartServer } from "./commands/restartServer.js";
import { revokeToken } from "./commands/revokeToken.js";
import { showEndpoint } from "./commands/showEndpoint.js";
import { showStatus } from "./commands/showStatus.js";
import { showTunnelUrl } from "./commands/showTunnelUrl.js";
import { copyTunnelUrl } from "./commands/copyTunnelUrl.js";
import { startServer } from "./commands/startServer.js";
import { startTunnel } from "./commands/startTunnel.js";
import { stopServer } from "./commands/stopServer.js";
import { stopTunnel } from "./commands/stopTunnel.js";
import { loadConfig, onConfigChanged } from "./config/configuration.js";
import type { CodeLinkConfig } from "./config/schema.js";
import { CoreBridge } from "./core/bridge.js";
import { McpServerManager } from "./mcp/server.js";
import { AuthenticationManager } from "./security/authentication.js";
import { PermissionManager } from "./security/permissions.js";
import { SecurityPolicy } from "./security/policy.js";
import { RateLimiter } from "./security/rateLimiter.js";
import { TunnelManager } from "./tunnel/manager.js";
import { DashboardPanel } from "./ui/dashboard.js";
import { SidebarViewProvider } from "./ui/sidebar.js";
import { StatusBarController } from "./ui/statusBar.js";
import { ActivityLog } from "./utils/activityLog.js";
import { ConsoleSink, Logger, type LogLevel, type LogSink } from "./utils/logger.js";

/** Everything a command or UI module needs, assembled once in `activate()`
 * and passed by reference so every consumer always sees live state (in
 * particular, `getConfig()` re-reads VS Code's configuration on every
 * call, so a settings change takes effect without re-wiring anything). */
export interface AppContext {
  extensionContext: vscode.ExtensionContext;
  version: string;
  workspaceRoot: string;
  workspaceName: string;
  logger: Logger;
  bridge: CoreBridge;
  activityLog: ActivityLog;
  mcpServer: McpServerManager;
  permissions: PermissionManager;
  authentication: AuthenticationManager;
  rateLimiter: RateLimiter;
  policy: SecurityPolicy;
  tunnel: TunnelManager;
  statusBar: StatusBarController;
  sidebar?: SidebarViewProvider;
  getConfig: () => CodeLinkConfig;
}

class OutputChannelSink implements LogSink {
  constructor(private readonly channel: vscode.OutputChannel) { }
  write(_level: LogLevel, line: string): void {
    this.channel.appendLine(line);
  }
}

const WELCOME_SHOWN_KEY = "codelink.hasShownWelcome";

let appContext: AppContext | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("CodeLink");
  context.subscriptions.push(outputChannel);

  const sink: LogSink = process.env.NODE_ENV === "test" ? new ConsoleSink() : new OutputChannelSink(outputChannel);
  const logger = new Logger(sink);
  const getConfig = (): CodeLinkConfig => loadConfig();
  logger.setLevel(getConfig().logging.level);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    logger.warn("Activated with no workspace folder open; CodeLink commands will be unavailable until one is.");
    void vscode.window.showWarningMessage("CodeLink requires an open workspace folder.");
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const workspaceName = workspaceFolder.name;

  const version = (context.extension.packageJSON as { version?: string }).version ?? "0.0.0";

  const bridge = new CoreBridge({
    logger,
    extensionVersion: version,
  });
  const activityLog = new ActivityLog();
  const permissions = new PermissionManager(getConfig);
  const authentication = new AuthenticationManager(context.secrets);
  const rateLimiter = new RateLimiter(
    getConfig().rateLimit.requestsPerMinute,
    getConfig().rateLimit.maxConcurrentRequests,
  );
  const policy = new SecurityPolicy(permissions, authentication, rateLimiter, getConfig, logger);
  const tunnel = new TunnelManager(getConfig, logger, context.extensionPath);
  const statusBar = new StatusBarController();
  const mcpServer = new McpServerManager({
    extensionVersion: version,
    workspaceRoot,
    workspaceName,
    bridge,
    activityLog,
    policy,
    getConfig,
    logger,
  });

  const ctx: AppContext = {
    extensionContext: context,
    version,
    workspaceRoot,
    workspaceName,
    logger,
    bridge,
    activityLog,
    mcpServer,
    permissions,
    authentication,
    rateLimiter,
    policy,
    tunnel,
    statusBar,
    getConfig,
  };
  appContext = ctx;

  const sidebarProvider = new SidebarViewProvider(ctx);
  ctx.sidebar = sidebarProvider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider),
  );

  context.subscriptions.push(statusBar);
  context.subscriptions.push(
    onConfigChanged(() => {
      const config = getConfig();
      logger.setLevel(config.logging.level);
      rateLimiter.updateLimits(config.rateLimit.requestsPerMinute, config.rateLimit.maxConcurrentRequests);
      DashboardPanel.refreshIfOpen(ctx);
      sidebarProvider.refresh();
    }),
  );

  // Refresh the dashboard/sidebar's Activity section as tool calls happen,
  // coalesced to one refresh per tick rather than one per entry — a client
  // polling terminal_output can record several entries within a single
  // event-loop turn.
  let activityRefreshQueued = false;
  const unsubscribeActivity = activityLog.onEntry(() => {
    if (activityRefreshQueued) {
      return;
    }
    activityRefreshQueued = true;
    setImmediate(() => {
      activityRefreshQueued = false;
      DashboardPanel.refreshIfOpen(ctx);
      sidebarProvider.refresh();
    });
  });
  context.subscriptions.push({ dispose: unsubscribeActivity });

  const register = (id: string, handler: () => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  register("codelink.startServer", () => startServer(ctx));
  register("codelink.stopServer", () => stopServer(ctx));
  register("codelink.restartServer", () => restartServer(ctx));
  register("codelink.showStatus", () => showStatus(ctx));
  register("codelink.showEndpoint", () => showEndpoint(ctx));
  register("codelink.copyConfig", () => copyConfig(ctx));
  register("codelink.generateToken", () => generateToken(ctx));
  register("codelink.revokeToken", () => revokeToken(ctx));
  register("codelink.enableRemoteAccess", () => enableRemoteAccess(ctx));
  register("codelink.disableRemoteAccess", () => disableRemoteAccess(ctx));
  register("codelink.startTunnel", () => startTunnel(ctx));
  register("codelink.stopTunnel", () => stopTunnel(ctx));
  register("codelink.showTunnelUrl", () => showTunnelUrl(ctx));
  register("codelink.copyTunnelUrl", () => copyTunnelUrl(ctx));
  register("codelink.enableIpv6Access", () => enableIpv6Access(ctx));
  register("codelink.disableIpv6Access", () => disableIpv6Access(ctx));
  register("codelink.copyIpv6Url", () => copyIpv6Url(ctx));
  register("codelink.openDashboard", () => openDashboard(ctx));

  await maybeShowFirstRunNotification(context);

  if (getConfig().server.enabled) {
    await startServer(ctx);
  }

  logger.info("CodeLink activated.", { workspace: workspaceName });
}

export async function deactivate(): Promise<void> {
  if (!appContext) {
    return;
  }
  appContext.tunnel.stop();
  await appContext.mcpServer.stop();
  await appContext.bridge.stop();
  appContext = undefined;
}

async function maybeShowFirstRunNotification(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(WELCOME_SHOWN_KEY)) {
    return;
  }
  await context.globalState.update(WELCOME_SHOWN_KEY, true);
  const choice = await vscode.window.showInformationMessage(
    "CodeLink is installed. Your workspace can be exposed to MCP clients through a local server. " +
    "The server is currently stopped. Review security settings before enabling remote access.",
    "Open CodeLink",
  );
  if (choice === "Open CodeLink" && appContext) {
    openDashboard(appContext);
  }
}
