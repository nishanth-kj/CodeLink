import type { AppContext } from "../extension.js";
import { showError, showInfo } from "../ui/notifications.js";

export async function startServer(ctx: AppContext): Promise<void> {
  try {
    if (!ctx.bridge.isRunning()) {
      ctx.bridge.start();
    }
    const { host, port } = await ctx.mcpServer.start();
    ctx.statusBar.setState(ctx.getConfig().remote.enabled ? "remote" : "running", `http://${host}:${port}/mcp`);
    showInfo(`CodeLink is running at http://${host}:${port}/mcp`);
  } catch (error) {
    showError(`Failed to start CodeLink: ${error instanceof Error ? error.message : String(error)}`);
  }
}
