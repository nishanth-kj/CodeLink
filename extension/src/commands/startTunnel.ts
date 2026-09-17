import type { AppContext } from "../extension.js";
import { showError, showInfo, showWarning } from "../ui/notifications.js";

export async function startTunnel(ctx: AppContext): Promise<void> {
  const config = ctx.getConfig();
  if (!config.remote.enabled) {
    showWarning("Enable remote access first: 'CodeLink: Enable Remote Access'.");
    return;
  }
  if (!ctx.mcpServer.isRunning()) {
    showWarning("Start the MCP server first: 'CodeLink: Start MCP Server'.");
    return;
  }
  try {
    const url = await ctx.tunnel.start(config.server.port);
    showInfo(`Cloudflare tunnel established: ${url}`);
  } catch (error) {
    showError(`Failed to start the Cloudflare tunnel: ${error instanceof Error ? error.message : String(error)}`);
  }
}
