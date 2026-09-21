import * as vscode from "vscode";
import { clientEndpoint } from "../config/network.js";
import type { AppContext } from "../extension.js";
import { showInfo } from "../ui/notifications.js";

/** Generates the snippet documented in the README for an MCP client's
 * configuration file. Never embeds an actual token value — the user pastes
 * their own generated token in, and is told exactly where to put it. */
export async function copyConfig(ctx: AppContext): Promise<void> {
  const config = ctx.getConfig();
  const url = clientEndpoint(config);
  const hasToken = await ctx.authentication.hasToken();
  const needsAuth = config.remote.enabled && hasToken;

  const mcpConfig = {
    mcpServers: {
      codelink: needsAuth ? { url, headers: { Authorization: "Bearer <YOUR_ACCESS_TOKEN>" } } : { url },
    },
  };

  await vscode.env.clipboard.writeText(JSON.stringify(mcpConfig, null, 2));
  showInfo(
    needsAuth
      ? "MCP configuration copied to clipboard. Replace <YOUR_ACCESS_TOKEN> with your generated access token."
      : "MCP configuration copied to clipboard.",
  );
}
