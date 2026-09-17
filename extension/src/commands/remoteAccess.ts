import * as vscode from "vscode";
import type { AppContext } from "../extension.js";
import { confirmDangerousAction, showInfo, showWarning } from "../ui/notifications.js";

const CONFIG_SECTION = "codelink";
const CONFIG_KEY = "remote.enabled";

async function setRemoteEnabled(enabled: boolean): Promise<void> {
  await vscode.workspace.getConfiguration(CONFIG_SECTION).update(CONFIG_KEY, enabled, vscode.ConfigurationTarget.Workspace);
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

  await setRemoteEnabled(true);
  ctx.logger.warn("Remote access enabled.");
  showWarning(
    "Remote access is now enabled. Restart the MCP server for this to take effect, and use " +
      "'CodeLink: Start Cloudflare Tunnel' (or your own port forwarding) to make it reachable.",
  );
}

export async function disableRemoteAccess(ctx: AppContext): Promise<void> {
  await setRemoteEnabled(false);
  ctx.tunnel.stop();
  ctx.logger.info("Remote access disabled.");
  showInfo("Remote access disabled. The server will only accept local connections.");
}
