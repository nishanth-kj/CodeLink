import type { AppContext } from "../extension.js";
import { showError, showInfo } from "../ui/notifications.js";

export async function stopServer(ctx: AppContext): Promise<void> {
  try {
    await ctx.mcpServer.stop();
    await ctx.bridge.stop();
    ctx.tunnel.stop();
    ctx.statusBar.setState("stopped");
    showInfo("CodeLink MCP server stopped.");
  } catch (error) {
    showError(`Failed to stop CodeLink cleanly: ${error instanceof Error ? error.message : String(error)}`);
  }
}
