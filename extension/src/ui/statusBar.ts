import * as vscode from "vscode";

export type StatusBarState = "stopped" | "running" | "remote";

/** The single status bar item required by section 25 of the spec.
 * Clicking it opens the dashboard. */
export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "codelink.openDashboard";
    this.setState("stopped");
    this.item.show();
  }

  setState(state: StatusBarState, detail?: string): void {
    const icon = state === "stopped" ? "$(debug-stop)" : state === "remote" ? "$(globe)" : "$(broadcast)";
    const label = state === "stopped" ? "Stopped" : state === "remote" ? "Remote" : "Running";
    this.item.text = `${icon} CodeLink: ${label}`;
    this.item.tooltip = detail ? `CodeLink — ${label}\n${detail}` : `CodeLink — ${label}`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
