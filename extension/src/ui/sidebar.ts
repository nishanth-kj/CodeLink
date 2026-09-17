import * as vscode from "vscode";
import type { AppContext } from "../extension.js";
import type { PermissionKey } from "../security/permissions.js";
import { DashboardPanel } from "./dashboard.js";

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

    webviewView.webview.onDidReceiveMessage(
      (message: { command?: string; permission?: string; required?: boolean }) => {
        void this.handleMessage(message);
      },
    );
  }

  refresh(): void {
    if (this.view) {
      this.view.webview.html = this.renderHtml();
    }
  }

  private async handleMessage(message: {
    command?: string;
    permission?: string;
    required?: boolean;
  }): Promise<void> {
    const { command, permission, required } = message;

    if (command === "setAuthRequired" && required !== undefined) {
      this.ctx.policy.setAuthRequired(required);
      await vscode.workspace
        .getConfiguration("codelink")
        .update("security.requireAuth", required, vscode.ConfigurationTarget.Workspace);
      this.refresh();
      DashboardPanel.refreshIfOpen(this.ctx);
      return;
    }

    if (command === "togglePermission" && permission) {
      const key = permission as PermissionKey;
      const next = this.ctx.permissions.toggle(key);
      if (key === "remoteAccess") {
        await vscode.workspace
          .getConfiguration("codelink")
          .update("remote.enabled", next, vscode.ConfigurationTarget.Workspace);
      }
      this.refresh();
      DashboardPanel.refreshIfOpen(this.ctx);
      return;
    }

    if (command === "allowAllPermissions") {
      const keys: PermissionKey[] = [
        "workspaceRead",
        "workspaceSearch",
        "editorRead",
        "editorWrite",
        "fileWrite",
        "fileDelete",
        "terminal",
        "gitRead",
        "gitWrite",
        "remoteAccess",
      ];
      for (const k of keys) {
        this.ctx.permissions.setOverride(k, true);
      }
      this.refresh();
      DashboardPanel.refreshIfOpen(this.ctx);
      return;
    }

    if (command === "reloadWindow") {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
      return;
    }

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
      const id = this.ctx.getConfig().remote.enabled
        ? "codelink.disableRemoteAccess"
        : "codelink.enableRemoteAccess";
      await vscode.commands.executeCommand(id);
    } else if (command && commandMap[command]) {
      await vscode.commands.executeCommand(commandMap[command]);
    }

    this.refresh();
    DashboardPanel.refreshIfOpen(this.ctx);
  }

  private renderHtml(): string {
    const config = this.ctx.getConfig();
    const running = this.ctx.mcpServer.isRunning();
    const permissions = this.ctx.permissions.snapshot();
    const host = config.remote.enabled ? config.server.host : "127.0.0.1";
    const endpoint = running ? `http://${host}:${config.server.port}/mcp` : null;
    const tunnelRunning = this.ctx.tunnel.isRunning();
    const tunnelUrl = this.ctx.tunnel.getUrl();
    const authRequired = this.ctx.policy.isAuthRequired();

    const escapeHtml = (value: string): string =>
      value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const permissionBadge = (label: string, allowed: boolean, permKey: PermissionKey): string =>
      `<button class="perm-chip ${allowed ? "allowed" : "blocked"}" data-perm="${permKey}" title="Click to toggle ${escapeHtml(label)}">` +
      `<span class="chip-status">${allowed ? "✓" : "✗"}</span>` +
      `<span class="chip-label">${escapeHtml(label)}</span>` +
      `</button>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CodeLink</title>
<style>
  :root {
    --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
    --card-border: var(--vscode-widget-border, rgba(255,255,255,0.08));
    --chip-pass-bg: #15803d;
    --chip-pass-fg: #ffffff;
  }
  body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    padding: 12px 14px;
    margin: 0;
    box-sizing: border-box;
  }
  h3 {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--vscode-sideBarTitle-foreground, var(--vscode-descriptionForeground));
    margin: 14px 0 6px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .hint {
    font-size: 10px;
    font-weight: normal;
    text-transform: none;
    opacity: 0.75;
  }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot.running {
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34,197,94,0.6);
  }
  .dot.stopped {
    background: #94a3b8;
  }
  .code-box {
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
    border: 1px solid var(--card-border);
    border-radius: 4px;
    padding: 6px 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    word-break: break-all;
    display: block;
    margin: 6px 0;
    user-select: all;
  }
  .btn-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  button {
    flex: 1 1 auto;
    min-width: 60px;
    padding: 6px 10px;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: inherit;
    text-align: center;
  }
  button:hover {
    background: var(--vscode-button-hoverBackground);
  }
  button.secondary {
    background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  button.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.15));
  }

  /* Segmented Auth Selector */
  .auth-mode-container {
    display: flex;
    background: var(--vscode-input-background, rgba(0,0,0,0.2));
    border: 1px solid var(--card-border);
    border-radius: 5px;
    padding: 3px;
    gap: 3px;
    margin: 6px 0 8px 0;
  }
  .auth-toggle-btn {
    flex: 1;
    padding: 5px 6px;
    font-size: 11.5px;
    font-weight: 600;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .auth-toggle-btn.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    box-shadow: 0 1px 3px rgba(0,0,0,0.25);
  }
  .auth-toggle-btn:not(.active):hover {
    background: rgba(255,255,255,0.05);
    color: var(--vscode-foreground);
  }
  .auth-desc {
    font-size: 11px;
    line-height: 1.4;
    color: var(--vscode-descriptionForeground);
    margin-top: 4px;
  }

  /* Permissions Grid */
  .perm-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 5px;
    margin: 8px 0;
  }
  .perm-chip {
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 500;
    border-radius: 4px;
    border: 1px solid var(--card-border);
    cursor: pointer !important;
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    user-select: none;
    text-align: left;
    min-width: 0;
  }
  .perm-chip:hover {
    filter: brightness(1.2);
    transform: translateY(-1px);
  }
  .perm-chip:active {
    transform: translateY(0);
  }
  .perm-chip.allowed {
    background: var(--chip-pass-bg);
    color: var(--chip-pass-fg);
    border-color: #22c55e;
    font-weight: 600;
  }
  .perm-chip.blocked {
    background: rgba(255,255,255,0.03);
    color: var(--vscode-descriptionForeground);
    border-style: dashed;
  }
  .chip-status {
    font-weight: 700;
    font-size: 11px;
  }
  .chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .footer-links {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
</style>
</head>
<body>
  <!-- MCP Server Status -->
  <div class="card">
    <div class="status-row">
      <span class="dot ${running ? "running" : "stopped"}"></span>
      <span>MCP Server: ${running ? "Running" : "Stopped"}</span>
    </div>
    ${endpoint ? `<div style="font-size:10.5px; opacity:0.8;">Local Endpoint:</div><code class="code-box">${escapeHtml(endpoint)}</code>` : ""}
    <div class="btn-row">
      ${!running ? `<button data-command="start">Start Server</button>` : `<button class="secondary" data-command="stop">Stop</button>`}
      ${running ? `<button class="secondary" data-command="restart">Restart</button>` : ""}
    </div>
  </div>

  <!-- Cloudflare Tunnel -->
  <div class="card">
    <div class="status-row">
      <span class="dot ${tunnelRunning ? "running" : "stopped"}"></span>
      <span>Tunnel: ${tunnelRunning ? "Live" : "Stopped"}</span>
    </div>
    ${
      tunnelRunning && tunnelUrl
        ? `
    <div style="font-size: 10.5px; opacity:0.8;">Direct Web MCP Endpoint:</div>
    <code class="code-box">${escapeHtml(tunnelUrl.endsWith("/") ? `${tunnelUrl}mcp` : `${tunnelUrl}/mcp`)}</code>
    <div class="btn-row">
      <button data-command="copyTunnelUrl">Copy Tunnel URL</button>
      <button class="secondary" data-command="stopTunnel">Stop</button>
    </div>`
        : `
    <div class="btn-row">
      <button data-command="startTunnel">Start Tunnel &amp; Copy Link</button>
    </div>`
    }
  </div>

  <!-- Auth Mode Selection (User Requested: No Auth vs OAuth) -->
  <h3>
    <span>Auth Mode</span>
    <span class="hint">${authRequired ? "🔒 Protected" : "🔓 Open Access"}</span>
  </h3>
  <div class="card" style="padding: 8px 10px;">
    <div class="auth-mode-container">
      <button class="auth-toggle-btn ${!authRequired ? "active" : ""}" data-auth="none">
        🔓 No Auth
      </button>
      <button class="auth-toggle-btn ${authRequired ? "active" : ""}" data-auth="required">
        🔒 OAuth / Auth
      </button>
    </div>
    <div class="auth-desc">
      ${
        !authRequired
          ? `<strong>No Auth active:</strong> AI clients (Claude.ai Web, Cursor) connect directly with zero login prompts or token errors.`
          : `<strong>OAuth active:</strong> Enforces RFC 8414 / 9728 OAuth discovery and bearer access tokens.`
      }
    </div>
    ${
      authRequired
        ? `
    <div class="btn-row" style="margin-top:6px;">
      <button class="secondary" data-command="generateToken">Generate Access Token</button>
    </div>`
        : ""
    }
  </div>

  <!-- Permissions Grid (Clickable) -->
  <h3>
    <span>Permissions</span>
    <span class="hint">(click to toggle)</span>
  </h3>
  <div class="perm-grid">
    ${permissionBadge("Read", permissions.workspaceRead, "workspaceRead")}
    ${permissionBadge("Search", permissions.workspaceSearch, "workspaceSearch")}
    ${permissionBadge("Editor", permissions.editorRead, "editorRead")}
    ${permissionBadge("Edit", permissions.editorWrite, "editorWrite")}
    ${permissionBadge("Write", permissions.fileWrite, "fileWrite")}
    ${permissionBadge("Delete", permissions.fileDelete, "fileDelete")}
    ${permissionBadge("Terminal", permissions.terminal, "terminal")}
    ${permissionBadge("Git", permissions.gitWrite, "gitWrite")}
  </div>
  <div class="btn-row" style="margin-bottom: 12px;">
    <button class="secondary" style="font-size:11px;" data-command="allowAllPermissions">Allow All</button>
  </div>

  <!-- Footer Actions -->
  <div class="footer-links">
    <button class="secondary" data-command="openDashboard">Open Full Control Center ↗</button>
    <button class="secondary" style="opacity:0.75; font-size:11px;" data-command="reloadWindow">Reload VS Code Window</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.querySelectorAll("button[data-command]").forEach((btn) => {
      btn.addEventListener("click", () => {
        vscode.postMessage({ command: btn.getAttribute("data-command") });
      });
    });

    document.querySelectorAll(".perm-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const perm = btn.getAttribute("data-perm");
        if (perm) {
          vscode.postMessage({ command: "togglePermission", permission: perm });
        }
      });
    });

    document.querySelectorAll(".auth-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const req = btn.getAttribute("data-auth") === "required";
        vscode.postMessage({ command: "setAuthRequired", required: req });
      });
    });
  </script>
</body>
</html>`;
  }
}
