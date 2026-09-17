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

    const permissionItem = (label: string, allowed: boolean, permKey: PermissionKey): string =>
      `<button class="perm-btn ${allowed ? "active" : "inactive"}" data-perm="${permKey}" title="Toggle ${escapeHtml(label)}">` +
      `<span class="perm-name">${escapeHtml(label)}</span>` +
      `<span class="perm-state">${allowed ? "ON" : "OFF"}</span>` +
      `</button>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CodeLink</title>
<style>
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 12px);
    color: var(--vscode-foreground);
    padding: 10px 12px;
    margin: 0;
    box-sizing: border-box;
    line-height: 1.4;
  }
  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-sideBarTitle-foreground, var(--vscode-descriptionForeground));
    margin: 12px 0 6px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .box {
    background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    border-radius: 4px;
    padding: 8px 10px;
    margin-bottom: 10px;
  }
  .status-line {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 12px;
  }
  .indicator {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .indicator.on {
    background: #22c55e;
  }
  .indicator.off {
    background: #94a3b8;
  }
  .code {
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.25));
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    border-radius: 3px;
    padding: 4px 6px;
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 11px;
    word-break: break-all;
    display: block;
    margin: 6px 0;
    user-select: all;
  }
  .btn-row {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  button {
    flex: 1 1 auto;
    padding: 5px 8px;
    border: none;
    border-radius: 3px;
    font-size: 11.5px;
    font-weight: 500;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    font-family: inherit;
    text-align: center;
    transition: opacity 0.1s;
  }
  button:hover {
    background: var(--vscode-button-hoverBackground);
  }
  button.secondary {
    background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  button.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.14));
  }

  /* Segmented Auth Selector */
  .switch-group {
    display: flex;
    background: var(--vscode-input-background, rgba(0,0,0,0.25));
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    border-radius: 4px;
    padding: 2px;
    gap: 2px;
    margin: 6px 0;
  }
  .switch-btn {
    flex: 1;
    padding: 5px 6px;
    font-size: 11px;
    font-weight: 600;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    text-align: center;
  }
  .switch-btn.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .switch-btn:not(.active):hover {
    background: rgba(255,255,255,0.05);
    color: var(--vscode-foreground);
  }
  .desc {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 4px;
  }

  /* Permissions Grid */
  .perm-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
    margin: 6px 0;
  }
  .perm-btn {
    padding: 5px 8px;
    border-radius: 3px;
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(255,255,255,0.03);
    color: var(--vscode-foreground);
    text-align: left;
    min-width: 0;
  }
  .perm-btn.active {
    border-color: #22c55e;
    background: rgba(34,197,94,0.12);
  }
  .perm-btn.inactive {
    border-style: dashed;
    color: var(--vscode-descriptionForeground);
    opacity: 0.8;
  }
  .perm-name {
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .perm-state {
    font-size: 9.5px;
    font-weight: 700;
    margin-left: 4px;
  }
  .perm-btn.active .perm-state {
    color: #22c55e;
  }
  .perm-btn.inactive .perm-state {
    color: #94a3b8;
  }
  .footer {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
</style>
</head>
<body>
  <!-- MCP Server -->
  <div class="section-title">Server</div>
  <div class="box">
    <div class="status-line">
      <span class="indicator ${running ? "on" : "off"}"></span>
      <span>${running ? "Running" : "Stopped"}</span>
    </div>
    ${endpoint ? `<code class="code">${escapeHtml(endpoint)}</code>` : ""}
    <div class="btn-row">
      ${!running ? `<button data-command="start">Start</button>` : `<button class="secondary" data-command="stop">Stop</button>`}
      ${running ? `<button class="secondary" data-command="restart">Restart</button>` : ""}
    </div>
  </div>

  <!-- Cloudflare Tunnel -->
  <div class="section-title">Cloudflare Tunnel</div>
  <div class="box">
    <div class="status-line">
      <span class="indicator ${tunnelRunning ? "on" : "off"}"></span>
      <span>${tunnelRunning ? "Active" : "Stopped"}</span>
    </div>
    ${
      tunnelRunning && tunnelUrl
        ? `
    <code class="code">${escapeHtml(tunnelUrl.endsWith("/") ? `${tunnelUrl}mcp` : `${tunnelUrl}/mcp`)}</code>
    <div class="btn-row">
      <button data-command="copyTunnelUrl">Copy URL</button>
      <button class="secondary" data-command="stopTunnel">Stop</button>
    </div>`
        : `
    <div class="btn-row">
      <button data-command="startTunnel">Start Tunnel &amp; Copy URL</button>
    </div>`
    }
  </div>

  <!-- Authentication -->
  <div class="section-title">Authentication</div>
  <div class="box">
    <div class="switch-group">
      <button class="switch-btn ${!authRequired ? "active" : ""}" data-auth="none">No Auth</button>
      <button class="switch-btn ${authRequired ? "active" : ""}" data-auth="required">Require Auth</button>
    </div>
    <div class="desc">
      ${
        !authRequired
          ? "No Auth active. Direct connection without credentials."
          : "Authentication required via OAuth 2.0 or bearer token."
      }
    </div>
    ${
      authRequired
        ? `
    <div class="btn-row" style="margin-top:6px;">
      <button class="secondary" data-command="generateToken">Generate Token</button>
    </div>`
        : ""
    }
  </div>

  <!-- Permissions -->
  <div class="section-title">Permissions</div>
  <div class="perm-grid">
    ${permissionItem("Read", permissions.workspaceRead, "workspaceRead")}
    ${permissionItem("Search", permissions.workspaceSearch, "workspaceSearch")}
    ${permissionItem("Editor", permissions.editorRead, "editorRead")}
    ${permissionItem("Edit", permissions.editorWrite, "editorWrite")}
    ${permissionItem("Write", permissions.fileWrite, "fileWrite")}
    ${permissionItem("Delete", permissions.fileDelete, "fileDelete")}
    ${permissionItem("Terminal", permissions.terminal, "terminal")}
    ${permissionItem("Git", permissions.gitWrite, "gitWrite")}
  </div>
  <div class="btn-row" style="margin-bottom: 8px;">
    <button class="secondary" style="font-size:11px;" data-command="allowAllPermissions">Allow All</button>
  </div>

  <!-- Footer Actions -->
  <div class="footer">
    <button class="secondary" data-command="openDashboard">Open Control Center</button>
    <button class="secondary" style="font-size:11px;" data-command="reloadWindow">Reload Window</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.querySelectorAll("button[data-command]").forEach((btn) => {
      btn.addEventListener("click", () => {
        vscode.postMessage({ command: btn.getAttribute("data-command") });
      });
    });

    document.querySelectorAll(".perm-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const perm = btn.getAttribute("data-perm");
        if (perm) {
          vscode.postMessage({ command: "togglePermission", permission: perm });
        }
      });
    });

    document.querySelectorAll(".switch-btn").forEach((btn) => {
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
