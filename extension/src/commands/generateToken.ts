import * as vscode from "vscode";
import type { AppContext } from "../extension.js";
import { showInfo } from "../ui/notifications.js";

/** The generated token is shown exactly once, via this command's own
 * result — it is never written to the log, the status bar, or any other
 * persisted location; only its SHA-256 hash is stored. */
export async function generateToken(ctx: AppContext): Promise<void> {
  const token = await ctx.authentication.generateToken();
  ctx.logger.info("A new access token was generated.");
  const choice = await vscode.window.showInformationMessage(
    "A new CodeLink access token was generated. It will only be shown once — copy it now.",
    "Copy to Clipboard",
  );
  if (choice === "Copy to Clipboard") {
    await vscode.env.clipboard.writeText(token);
    showInfo("Access token copied to clipboard. Store it securely; it will not be shown again.");
  }
}
