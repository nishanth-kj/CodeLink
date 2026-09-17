import * as vscode from "vscode";
import type { AppContext } from "../extension.js";
import type { PermissionKey } from "../security/permissions.js";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function permissionRow(label: string, allowed: boolean, permKey: PermissionKey): string {
  return `<li><button class="perm-chip ${allowed ? "allowed" : "blocked"}" data-perm="${permKey}" title="Click to toggle ${escapeHtml(label)}">${allowed ? "✓" : "✗"} ${escapeHtml(label)}</button></li>`;
}

function renderHtml(ctx: AppContext): string {
  const config = ctx.getConfig();
  const running = ctx.mcpServer.isRunning();
  const permissions = ctx.permissions.snapshot();
  const host = config.remote.enabled ? config.server.host : "127.0.0.1";
  const endpoint = running ? `http://${host}:${config.server.port}/mcp` : null;
  const tunnelRunning = ctx.tunnel.isRunning();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>CodeLink</title>
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 16px 24px; color: var(--vscode-foreground); }
  h1 { font-size: 1.4em; margin-bottom: 4px; }
  h2 { font-size: 1.05em; margin-bottom: 6px; }
  section { margin-bottom: 20px; }
  button {
    margin-right: 8px; margin-top: 4px; padding: 6px 14px; border: none; border-radius: 2px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  ul { list-style: none; padding-left: 0; margin: 4px 0; display: flex; flex-wrap: wrap; gap: 6px; }
  li { padding: 0; }
  .perm-chip {
    padding: 4px 10px;
    font-size: 12px;
    border-radius: 4px;
    border: 1px solid var(--vscode-widget-border, transparent);
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    font-family: inherit;
    margin: 0;
  }
  .perm-chip:hover {
    filter: brightness(1.15);
    transform: translateY(-1px);
  }
  .perm-chip.allowed {
    background: var(--vscode-testing-iconPassed, #2e7d32);
    color: #ffffff;
    font-weight: 600;
  }
  .perm-chip.blocked {
    background: var(--vscode-editor-inactiveSelectionBackground);
    color: var(--vscode-descriptionForeground);
    opacity: 0.75;
    border-style: dashed;
  }
  code { background: var(--vscode-textCodeBlock-background); padding: 2px 5px; border-radius: 2px; }
  .muted { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <h1>CodeLink Control Center</h1>

  <section>
    <h2>Server</h2>
    <p>Status: <strong>${running ? "Running" : "Stopped"}</strong></p>
    ${endpoint ? `<p>Local Endpoint: <code>${endpoint}</code></p>` : ""}
    <p class="muted">Transport: Streamable HTTP</p>
    <button data-command="start">Start</button>
    <button data-command="stop">Stop</button>
    <button data-command="restart">Restart</button>
  </section>

  <section>
    <h2>Workspace</h2>
    <p><code>${escapeHtml(ctx.workspaceRoot)}</code></p>
  </section>

  <section>
    <h2>Permissions <small style="font-size:11px; font-weight:normal; opacity:0.75;">(click any to toggle)</small></h2>
    <ul>
      ${permissionRow("Workspace Read", permissions.workspaceRead, "workspaceRead")}
      ${permissionRow("Search", permissions.workspaceSearch, "workspaceSearch")}
      ${permissionRow("Editor Read", permissions.editorRead, "editorRead")}
      ${permissionRow("Editor Write", permissions.editorWrite, "editorWrite")}
      ${permissionRow("File Write", permissions.fileWrite, "fileWrite")}
      ${permissionRow("File Delete", permissions.fileDelete, "fileDelete")}
      ${permissionRow("Terminal", permissions.terminal, "terminal")}
      ${permissionRow("Git Write", permissions.gitWrite, "gitWrite")}
      ${permissionRow("Remote Access", permissions.remoteAccess, "remoteAccess")}
    </ul>
  </section>

  <section>
    <h2>Cloudflare Tunnel (Public Web Access)</h2>
    <p>Status: <strong>${tunnelRunning ? "Running" : "Stopped"}</strong></p>
    ${
      tunnelRunning && ctx.tunnel.getUrl()
        ? `
    <p>Direct Web MCP Endpoint: <code>${escapeHtml((ctx.tunnel.getUrl() ?? "").endsWith("/") ? `${ctx.tunnel.getUrl()}mcp` : `${ctx.tunnel.getUrl()}/mcp`)}</code></p>
    <button data-command="copyTunnelUrl">Copy Tunnel URL</button>
    <button data-command="stopTunnel">Stop Tunnel</button>
    `
        : `
    <button data-command="startTunnel">Start Tunnel &amp; Copy Link</button>
    `
    }
  </section>

  <section>
    <h2>Remote Access &amp; Tokens</h2>
    <p>${config.remote.enabled ? "Enabled" : "Disabled"}</p>
    <button data-command="generateToken">Generate Access Token</button>
    <button data-command="toggleRemote">${config.remote.enabled ? "Disable" : "Enable"} Remote Access</button>
  </section>

  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll("button[data-command]").forEach((button) => {
      button.addEventListener("click", () => {
        vscode.postMessage({ command: button.getAttribute("data-command") });
      });
    });
    document.querySelectorAll("button[data-perm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        vscode.postMessage({ command: "togglePermission", permission: btn.getAttribute("data-perm") });
      });
    });
  </script>
</body>
</html>`;
}

/** The lightweight webview dashboard from section 26. Reuses the exact
 * same command implementations as the command palette (via
 * `vscode.commands.executeCommand`) rather than duplicating their logic. */
export class DashboardPanel {
  private static current: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private ctx: AppContext;

  static show(ctx: AppContext): void {
    if (DashboardPanel.current) {
      DashboardPanel.current.ctx = ctx;
      DashboardPanel.current.panel.reveal();
      DashboardPanel.current.refresh();
      return;
    }
    DashboardPanel.current = new DashboardPanel(ctx);
  }

  static refreshIfOpen(ctx: AppContext): void {
    if (DashboardPanel.current) {
      DashboardPanel.current.ctx = ctx;
      DashboardPanel.current.refresh();
    }
  }

  private constructor(ctx: AppContext) {
    this.ctx = ctx;
    this.panel = vscode.window.createWebviewPanel("codelinkDashboard", "CodeLink", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    this.panel.onDidDispose(() => {
      DashboardPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message: { command?: string; permission?: string }) => {
      void this.handleMessage(message);
    });
    this.refresh();
  }

  private refresh(): void {
    this.panel.webview.html = renderHtml(this.ctx);
  }

  private async handleMessage(message: { command?: string; permission?: string }): Promise<void> {
    const { command, permission } = message;

    if (command === "togglePermission" && permission) {
      const key = permission as PermissionKey;
      const next = this.ctx.permissions.toggle(key);
      if (key === "remoteAccess") {
        await vscode.workspace
          .getConfiguration("codelink")
          .update("remote.enabled", next, vscode.ConfigurationTarget.Workspace);
      }
      this.refresh();
      this.ctx.sidebar?.refresh();
      return;
    }

    const commandMap: Record<string, string> = {
      start: "codelink.startServer",
      stop: "codelink.stopServer",
      restart: "codelink.restartServer",
      generateToken: "codelink.generateToken",
      startTunnel: "codelink.startTunnel",
      stopTunnel: "codelink.stopTunnel",
      copyTunnelUrl: "codelink.copyTunnelUrl",
    };
    if (command === "toggleRemote") {
      const id = this.ctx.getConfig().remote.enabled ? "codelink.disableRemoteAccess" : "codelink.enableRemoteAccess";
      await vscode.commands.executeCommand(id);
    } else if (command && commandMap[command]) {
      await vscode.commands.executeCommand(commandMap[command]);
    }
    this.refresh();
    this.ctx.sidebar?.refresh();
  }
}
