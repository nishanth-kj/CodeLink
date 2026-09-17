import type { AppContext } from "../extension.js";
import { showInfo } from "../ui/notifications.js";

export function showStatus(ctx: AppContext): void {
  const running = ctx.mcpServer.isRunning();
  const config = ctx.getConfig();
  const lines = [
    `Server: ${running ? "Running" : "Stopped"}`,
    `Security profile: ${config.security.profile}`,
    `Remote access: ${config.remote.enabled ? "Enabled" : "Disabled"}`,
    `Tunnel: ${ctx.tunnel.isRunning() ? (ctx.tunnel.getUrl() ?? "starting…") : "Stopped"}`,
  ];
  showInfo(lines.join("  |  "));
}
