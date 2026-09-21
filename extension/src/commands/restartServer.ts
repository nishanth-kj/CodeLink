import { localEndpoint } from "../config/network.js";
import type { AppContext } from "../extension.js";
import { showError, showInfo } from "../ui/notifications.js";

export async function restartServer(ctx: AppContext): Promise<void> {
  try {
    await ctx.bridge.restart();
    await ctx.mcpServer.restart();
    const config = ctx.getConfig();
    ctx.statusBar.setState(config.remote.enabled ? "remote" : "running", localEndpoint(config));
    ctx.sidebar?.refresh();
    showInfo("CodeLink MCP server restarted.");
  } catch (error) {
    showError(`Failed to restart CodeLink: ${error instanceof Error ? error.message : String(error)}`);
  }
}
