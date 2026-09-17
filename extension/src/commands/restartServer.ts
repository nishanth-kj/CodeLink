import type { AppContext } from "../extension.js";
import { showError, showInfo } from "../ui/notifications.js";

export async function restartServer(ctx: AppContext): Promise<void> {
  try {
    await ctx.bridge.restart();
    const { host, port } = await ctx.mcpServer.restart();
    ctx.statusBar.setState(ctx.getConfig().remote.enabled ? "remote" : "running", `http://${host}:${port}/mcp`);
    ctx.sidebar?.refresh();
    showInfo("CodeLink MCP server restarted.");
  } catch (error) {
    showError(`Failed to restart CodeLink: ${error instanceof Error ? error.message : String(error)}`);
  }
}
