import * as vscode from "vscode";
import type { AppContext } from "../extension.js";

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "codelink.sidebarView";
  private view?: vscode.WebviewView;

  constructor(private ctx: AppContext) {}

  updateContext(ctx: AppContext): void {
    this.ctx = ctx;
    this.refresh();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this.renderHtml();

    webviewView.webview.onDidReceiveMessage((message: { command?: string }) => {
      void this.handleMessage(message.command);
    });
  }

  refresh(): void {
    if (this.view) {
      this.view.webview.html = this.renderHtml();
    }
  }

  private async handleMessage(command: string | undefined): Promise<void> {
    const commandMap: Record<string, string> = {
      start: "codelink.startServer",
      stop: "codelink.stopServer",
      restart: "codelink.restartServer",
      generateToken: "codelink.generateToken",
      copyConfig: "codelink.copyConfig",
      startTunnel: "codelink.startTunnel",
      stopTunnel: "codelink.stopTunnel",
      copyTunnelUrl: "codelink.copyTunnelUrl",
      openDashboard: "codelink.openDashboard",
    };
    if (command === "toggleRemote") {
      const id = this.ctx.getConfig().remote.enabled ? "codelink.disableRemoteAccess" : "codelink.enableRemoteAccess";
      await vscode.commands.executeCommand(id);
    } else if (command && commandMap[command]) {
      await vscode.commands.executeCommand(commandMap[command]);
    }
    this.refresh();
  }

  private renderHtml(): string {
    const config = this.ctx.getConfig();
    const running = this.ctx.mcpServer.isRunning();
    const permissions = this.ctx.permissions.snapshot();
    const host = config.remote.enabled ? config.server.host : "127.0.0.1";
    const endpoint = running ? `http://${host}:${config.server.port}/mcp` : null;
    const tunnelRunning = this.ctx.tunnel.isRunning();
    const tunnelUrl = this.ctx.tunnel.getUrl();

    const escapeHtml = (value: string): string =>
      value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const permissionBadge = (label: string, allowed: boolean): string =>
      `<span class="perm-badge ${allowed ? "allowed" : "blocked"}">${allowed ? "✓" : "✗"} ${escapeHtml(label)}</span>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CodeLink</title>
<style>
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    padding: 10px 12px;
    color: var(--vscode-foreground);
    line-height: 1.4;
  }
  .status-card {
    background: var(--vscode-editor-inactiveSelectionBackground);
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px;
    padding: 10px;
    margin-bottom: 12px;
  }
  .status-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .indicator {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
  }
  .indicator.running { background-color: var(--vscode-testing-iconPassed, #4caf50); }
  .indicator.stopped { background-color: var(--vscode-testing-iconFailed, #f44336); }
  
  .btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  button {
    flex: 1 1 auto;
    min-width: 60px;
    padding: 4px 10px;
    border: none;
    border-radius: 2px;
    font-size: 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

  h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-sideBarTitle-foreground, var(--vscode-descriptionForeground));
    margin: 14px 0 6px 0;
  }
  .code-box {
    background: var(--vscode-textCodeBlock-background);
    padding: 4px 6px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    word-break: break-all;
    user-select: all;
    display: block;
    margin: 4px 0;
  }
  .perm-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 6px 0;
  }
  .perm-badge {
    font-size: 10.5px;
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  .perm-badge.blocked {
    opacity: 0.55;
  }
  .footer-links {
    margin-top: 14px;
  }
</style>
</head>
<body>
  <div class="status-card">
    <div class="status-header">
      <span class="indicator ${running ? "running" : "stopped"}"></span>
      <span>MCP Server: ${running ? "Running" : "Stopped"}</span>
    </div>
    ${endpoint ? `<div style="font-size:11px; margin-top: 4px;">Endpoint:</div><code class="code-box">${escapeHtml(endpoint)}</code>` : ""}
    <div class="btn-row">
      ${!running ? `<button data-command="start">Start Server</button>` : `<button class="secondary" data-command="stop">Stop Server</button>`}
      ${running ? `<button class="secondary" data-command="restart">Restart</button>` : ""}
      <button class="secondary" data-command="copyConfig">Copy Config</button>
    </div>
  </div>

  <h3>Security Profile (${escapeHtml(config.security.profile)})</h3>
  <div class="perm-grid">
    ${permissionBadge("Read", permissions.workspaceRead)}
    ${permissionBadge("Search", permissions.workspaceSearch)}
    ${permissionBadge("Editor", permissions.editorRead)}
    ${permissionBadge("Edit", permissions.editorWrite)}
    ${permissionBadge("Write", permissions.fileWrite)}
    ${permissionBadge("Delete", permissions.fileDelete)}
    ${permissionBadge("Terminal", permissions.terminal)}
    ${permissionBadge("Git", permissions.gitRead)}
    ${permissionBadge("Remote", permissions.remoteAccess)}
  </div>

  <h3>Remote Access</h3>
  <div style="font-size: 11.5px; margin-bottom: 4px;">
    Status: <strong>${config.remote.enabled ? "Enabled" : "Disabled"}</strong>
  </div>
  <div class="btn-row">
    <button class="secondary" data-command="toggleRemote">${config.remote.enabled ? "Disable" : "Enable"}</button>
    <button class="secondary" data-command="generateToken">New Token</button>
  </div>

  <h3>Cloudflare Tunnel</h3>
  <div style="font-size: 11.5px; margin-bottom: 4px;">
    Status: <strong>${tunnelRunning ? "Running" : "Stopped"}</strong>
  </div>
  ${tunnelRunning && tunnelUrl ? `
  <div style="font-size: 11px; margin-top: 4px;">Direct Web MCP Endpoint:</div>
  <code class="code-box">${escapeHtml(tunnelUrl.endsWith("/") ? `${tunnelUrl}mcp` : `${tunnelUrl}/mcp`)}</code>
  <div class="btn-row">
    <button data-command="copyTunnelUrl">Copy Tunnel URL</button>
    <button class="secondary" data-command="stopTunnel">Stop Tunnel</button>
  </div>` : `
  <div class="btn-row">
    <button data-command="startTunnel">Start Tunnel &amp; Copy Link</button>
  </div>`}

  <div class="footer-links">
    <button class="secondary" style="width: 100%;" data-command="openDashboard">Open Full Dashboard ↗</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll("button[data-command]").forEach((btn) => {
      btn.addEventListener("click", () => {
        vscode.postMessage({ command: btn.getAttribute("data-command") });
      });
    });
  </script>
</body>
</html>`;
  }
}
