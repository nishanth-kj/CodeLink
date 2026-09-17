import * as vscode from "vscode";
import type { AppContext } from "../extension.js";
import { showInfo, showWarning } from "../ui/notifications.js";

export async function copyTunnelUrl(ctx: AppContext): Promise<void> {
  const url = ctx.tunnel.getUrl();
  if (!url) {
    showWarning("No Cloudflare tunnel is currently running.");
    return;
  }
  const mcpUrl = url.endsWith("/") ? `${url}mcp` : `${url}/mcp`;
  await vscode.env.clipboard.writeText(mcpUrl);
  showInfo(`Copied tunnel MCP URL to clipboard: ${mcpUrl}`);
}
