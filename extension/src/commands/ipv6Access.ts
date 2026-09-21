import * as vscode from "vscode";
import { bindsAllIpv6, ipv6Endpoints, localEndpoint } from "../config/network.js";
import type { AppContext } from "../extension.js";
import { DashboardPanel } from "../ui/dashboard.js";
import { showError, showInfo, showWarning } from "../ui/notifications.js";
import { ensureRemoteEnabled, restartServerIfRunning } from "./remoteAccess.js";

const REQUIRE_AUTH_AND_ENABLE = "Require Auth & Enable";
const ENABLE_WITHOUT_AUTH = "Enable Without Auth";
const ENABLE = "Enable Direct IPv6";

const LOCAL_ONLY_NOTE = " (local network only — no public IPv6 address found)";

function refreshUi(ctx: AppContext): void {
  ctx.sidebar?.refresh();
  DashboardPanel.refreshIfOpen(ctx);
}

/** Starts the server, or re-binds it when it is already running, so the
 * listener matches the current `codelink.remote.*` settings. */
async function applyBinding(ctx: AppContext): Promise<void> {
  if (ctx.mcpServer.isRunning()) {
    await restartServerIfRunning(ctx);
    return;
  }
  if (!ctx.bridge.isRunning()) {
    ctx.bridge.start();
  }
  await ctx.mcpServer.start();
  ctx.statusBar.setState("remote", localEndpoint(ctx.getConfig()));
}

/** Exposes the server on every IPv6 interface so other machines can connect
 * straight to `http://[<ipv6-address>]:<port>/mcp` — no tunnel involved. A
 * global IPv6 address is normally reachable from the whole internet (there is
 * no NAT in front of it), so this always asks first, and offers to turn
 * authentication on when it is currently off. */
export async function enableIpv6Access(ctx: AppContext): Promise<void> {
  const config = ctx.getConfig();
  // The UI keeps the policy override and the setting in sync, so either being
  // true means requests will be authenticated once remote access is on.
  const authRequired = ctx.policy.isAuthRequired() || config.security.requireAuth;

  const message =
    `Direct IPv6 access lets anyone who can reach this machine's IPv6 address on port ${config.server.port} ` +
    "connect to CodeLink — global IPv6 addresses are usually reachable from the whole internet, with plain " +
    "HTTP and no tunnel in front. They can use every tool your permission profile allows (" +
    `${config.security.profile}). ` +
    (authRequired
      ? "Requests will require your access token."
      : "Authentication is currently OFF, so no token would be needed.");
  const choice = authRequired
    ? await vscode.window.showWarningMessage(message, { modal: true }, ENABLE)
    : await vscode.window.showWarningMessage(message, { modal: true }, REQUIRE_AUTH_AND_ENABLE, ENABLE_WITHOUT_AUTH);
  if (!choice) {
    return;
  }

  try {
    if (choice === REQUIRE_AUTH_AND_ENABLE) {
      ctx.policy.setAuthRequired(true);
      await vscode.workspace
        .getConfiguration("codelink")
        .update("security.requireAuth", true, vscode.ConfigurationTarget.Workspace);
    }
    await ensureRemoteEnabled(ctx);
    await vscode.workspace
      .getConfiguration("codelink")
      .update("remote.ipv6", true, vscode.ConfigurationTarget.Workspace);
    await applyBinding(ctx);
  } catch (error) {
    showError(`Failed to enable direct IPv6 access: ${error instanceof Error ? error.message : String(error)}`);
    refreshUi(ctx);
    return;
  }

  ctx.logger.warn("Direct IPv6 access enabled.", { port: ctx.getConfig().server.port });
  refreshUi(ctx);

  const [primary] = ipv6Endpoints(ctx.getConfig());
  if (!primary) {
    showWarning(
      "Direct IPv6 access is on, but this machine has no IPv6 address other hosts can reach. " +
        "Check that your network provides IPv6, then run 'CodeLink: Copy IPv6 Endpoint URL'.",
    );
    return;
  }
  await vscode.env.clipboard.writeText(primary.url);
  showInfo(
    `Direct IPv6 access enabled. MCP URL copied to clipboard: ${primary.url}` +
      `${primary.scope === "unique-local" ? LOCAL_ONLY_NOTE : ""}. ` +
      `If it can't be reached, allow inbound TCP port ${ctx.getConfig().server.port} in your firewall and router.`,
  );
}

export async function disableIpv6Access(ctx: AppContext): Promise<void> {
  try {
    await vscode.workspace
      .getConfiguration("codelink")
      .update("remote.ipv6", false, vscode.ConfigurationTarget.Workspace);
    await restartServerIfRunning(ctx);
  } catch (error) {
    showError(`Failed to disable direct IPv6 access: ${error instanceof Error ? error.message : String(error)}`);
    refreshUi(ctx);
    return;
  }
  ctx.logger.info("Direct IPv6 access disabled.");
  refreshUi(ctx);
  showInfo("Direct IPv6 access disabled.");
}

export async function copyIpv6Url(ctx: AppContext): Promise<void> {
  const config = ctx.getConfig();
  if (!bindsAllIpv6(config)) {
    showWarning("Direct IPv6 access is off. Run 'CodeLink: Enable Direct IPv6 Access' first.");
    return;
  }
  const [primary] = ipv6Endpoints(config);
  if (!primary) {
    showWarning("No IPv6 address that other hosts can reach was found on this machine.");
    return;
  }
  await vscode.env.clipboard.writeText(primary.url);
  showInfo(`Copied IPv6 MCP URL to clipboard: ${primary.url}${primary.scope === "unique-local" ? LOCAL_ONLY_NOTE : ""}`);
}
