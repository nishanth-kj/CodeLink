import * as vscode from "vscode";
import type { AppContext } from "../extension.js";
import { showInfo, showWarning } from "../ui/notifications.js";

export async function showEndpoint(ctx: AppContext): Promise<void> {
  if (!ctx.mcpServer.isRunning()) {
    showWarning("CodeLink is not running. Start it first with 'CodeLink: Start MCP Server'.");
    return;
  }
  const config = ctx.getConfig();
  const host = config.remote.enabled ? config.server.host : "127.0.0.1";
  const endpoint = `http://${host}:${config.server.port}/mcp`;
  await vscode.env.clipboard.writeText(endpoint);
  showInfo(`MCP endpoint copied to clipboard: ${endpoint}`);
}
