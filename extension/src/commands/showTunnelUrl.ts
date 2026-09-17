import * as vscode from "vscode";
import type { AppContext } from "../extension.js";
import { showInfo, showWarning } from "../ui/notifications.js";

export async function showTunnelUrl(ctx: AppContext): Promise<void> {
  const url = ctx.tunnel.getUrl();
  if (!url) {
    showWarning("The tunnel is not running.");
    return;
  }
  await vscode.env.clipboard.writeText(url);
  showInfo(`Tunnel URL copied to clipboard: ${url}`);
}
