import { ipv6Endpoints, localEndpoint } from "../config/network.js";
import type { AppContext } from "../extension.js";
import { showError, showInfo } from "../ui/notifications.js";

export async function startServer(ctx: AppContext): Promise<void> {
  try {
    if (!ctx.bridge.isRunning()) {
      ctx.bridge.start();
    }
    await ctx.mcpServer.start();
    const config = ctx.getConfig();
    const local = localEndpoint(config);
    ctx.statusBar.setState(config.remote.enabled ? "remote" : "running", local);
    ctx.sidebar?.refresh();
    const [ipv6] = ipv6Endpoints(config);
    showInfo(`CodeLink is running at ${local}${ipv6 ? ` (direct IPv6: ${ipv6.url})` : ""}`);
  } catch (error) {
    showError(`Failed to start CodeLink: ${error instanceof Error ? error.message : String(error)}`);
  }
}
