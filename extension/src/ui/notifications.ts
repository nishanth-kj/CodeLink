import * as vscode from "vscode";

export function showInfo(message: string): void {
  void vscode.window.showInformationMessage(message);
}

export function showWarning(message: string): void {
  void vscode.window.showWarningMessage(message);
}

export function showError(message: string): void {
  void vscode.window.showErrorMessage(message);
}

/** Every dangerous/escalating operation (enabling remote access, switching
 * to the trusted profile) must ask first — section 3's "explicit
 * terminal/destructive-operation permission" principle applied to the UI. */
export async function confirmDangerousAction(message: string, confirmLabel: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(message, { modal: true }, confirmLabel);
  return choice === confirmLabel;
}
