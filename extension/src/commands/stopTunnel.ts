import type { AppContext } from "../extension.js";
import { showInfo } from "../ui/notifications.js";

export function stopTunnel(ctx: AppContext): void {
  ctx.tunnel.stop();
  showInfo("Cloudflare tunnel stopped.");
}
