import * as vscode from "vscode";
import { effectiveHost } from "../config/defaults.js";
import { localEndpoint } from "../config/network.js";
import type { AppContext } from "../extension.js";
import { confirmDangerousAction, showInfo, showWarning } from "../ui/notifications.js";

const CONFIG_SECTION = "codelink";

function workspaceConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/** Re-binds a running server so a changed `effectiveHost` takes effect. */
export async function restartServerIfRunning(ctx: AppContext): Promise<void> {
  if (!ctx.mcpServer.isRunning()) {
    return;
  }
  await ctx.mcpServer.restart();
  ctx.statusBar.setState(
    ctx.getConfig().remote.enabled ? "remote" : "running",
    localEndpoint(ctx.getConfig()),
  );
}

/** The one place `codelink.remote.enabled` is written. Turning remote access
 * off also clears `codelink.remote.ipv6` — otherwise switching remote access
 * back on later would silently re-open the IPv6 listener — and re-binds a
 * running server: until it restarts it would keep listening on the wider
 * address while authentication (which is tied to remote access) is off. */
export async function setRemoteEnabled(ctx: AppContext, enabled: boolean): Promise<void> {
  const boundHostBefore = effectiveHost(ctx.getConfig());
  await workspaceConfig().update("remote.enabled", enabled, vscode.ConfigurationTarget.Workspace);
  if (enabled) {
    return;
  }
  await workspaceConfig().update("remote.ipv6", false, vscode.ConfigurationTarget.Workspace);
  if (boundHostBefore !== effectiveHost(ctx.getConfig())) {
    await restartServerIfRunning(ctx);
  }
}

/** Makes sure an access token exists, then turns remote access on. Callers
 * are responsible for confirming with the user first. */
export async function ensureRemoteEnabled(ctx: AppContext): Promise<void> {
  if (!(await ctx.authentication.hasToken())) {
    const token = await ctx.authentication.generateToken();
    const choice = await vscode.window.showInformationMessage(
      "Remote access requires an access token. A new one was generated and will only be shown once — copy it now.",
      "Copy to Clipboard",
    );
    if (choice === "Copy to Clipboard") {
      await vscode.env.clipboard.writeText(token);
    }
  }

  await setRemoteEnabled(ctx, true);
  ctx.logger.warn("Remote access enabled.");
}

/** Remote access is opt-in and requires explicit confirmation (sections 3
 * and 21): this is the only path that can turn codelink.remote.enabled on,
 * and it makes sure a token exists before doing so. */
export async function enableRemoteAccess(ctx: AppContext): Promise<void> {
  const confirmed = await confirmDangerousAction(
    "Enabling remote access allows authenticated connections from outside this machine, once a tunnel or port " +
      "forward makes the server reachable. A bearer token will be required for every request. Continue?",
    "Enable Remote Access",
  );
  if (!confirmed) {
    return;
  }

  await ensureRemoteEnabled(ctx);
  showWarning(
    "Remote access is now enabled. Restart the MCP server for this to take effect, and use " +
      "'CodeLink: Start Cloudflare Tunnel', 'CodeLink: Enable Direct IPv6 Access' (or your own port forwarding) " +
      "to make it reachable.",
  );
}

export async function disableRemoteAccess(ctx: AppContext): Promise<void> {
  await setRemoteEnabled(ctx, false);
  ctx.tunnel.stop();
  ctx.logger.info("Remote access disabled.");
  showInfo("Remote access disabled. The server will only accept local connections.");
}
