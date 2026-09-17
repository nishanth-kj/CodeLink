import * as vscode from "vscode";
import type { AppContext } from "../extension.js";
import { DashboardPanel } from "../ui/dashboard.js";
import { showError, showInfo } from "../ui/notifications.js";

export async function startTunnel(ctx: AppContext): Promise<void> {
  const config = ctx.getConfig();
  if (!ctx.mcpServer.isRunning()) {
    if (!ctx.bridge.isRunning()) {
      ctx.bridge.start();
    }
    await ctx.mcpServer.start();
    ctx.statusBar.setState("running");
  }
  try {
    const rawUrl = await ctx.tunnel.start(config.server.port);
    const mcpUrl = rawUrl.endsWith("/") ? `${rawUrl}mcp` : `${rawUrl}/mcp`;
    await vscode.env.clipboard.writeText(mcpUrl);
    ctx.sidebar?.refresh();
    DashboardPanel.refreshIfOpen(ctx);
    showInfo(`Cloudflare tunnel established! MCP URL copied to clipboard: ${mcpUrl}`);
  } catch (error) {
    showError(`Failed to start the Cloudflare tunnel: ${error instanceof Error ? error.message : String(error)}`);
  }
}
