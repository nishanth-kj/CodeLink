import type { AppContext } from "../extension.js";
import { showInfo } from "../ui/notifications.js";

export async function revokeToken(ctx: AppContext): Promise<void> {
  await ctx.authentication.revokeToken();
  ctx.logger.info("The access token was revoked.");
  showInfo("CodeLink access token revoked. Remote clients using the old token will be rejected.");
}
