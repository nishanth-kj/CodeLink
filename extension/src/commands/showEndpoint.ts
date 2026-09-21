import * as vscode from "vscode";
import { clientEndpoint } from "../config/network.js";
import type { AppContext } from "../extension.js";
import { showInfo, showWarning } from "../ui/notifications.js";

export async function showEndpoint(ctx: AppContext): Promise<void> {
  if (!ctx.mcpServer.isRunning()) {
    showWarning("CodeLink is not running. Start it first with 'CodeLink: Start MCP Server'.");
    return;
  }
  const endpoint = clientEndpoint(ctx.getConfig());
  await vscode.env.clipboard.writeText(endpoint);
  showInfo(`MCP endpoint copied to clipboard: ${endpoint}`);
}
