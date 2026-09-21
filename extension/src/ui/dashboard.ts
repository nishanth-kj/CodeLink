import * as vscode from "vscode";
import { setRemoteEnabled } from "../commands/remoteAccess.js";
import { bindsAllIpv6, ipv6Endpoints, localEndpoint } from "../config/network.js";
import type { AppContext } from "../extension.js";
import type { ActivityEntry } from "../utils/activityLog.js";
import type { PermissionKey } from "../security/permissions.js";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function permissionCard(label: string, desc: string, allowed: boolean, permKey: PermissionKey): string {
  return `
    <button class="perm-card ${allowed ? "active" : "inactive"}" data-perm="${permKey}" title="Toggle ${escapeHtml(label)}">
      <div class="perm-card-top">
        <span class="indicator-dot ${allowed ? "on" : "off"}"></span>
        <span class="perm-card-title">${escapeHtml(label)}</span>
        <span class="perm-card-badge ${allowed ? "on" : "off"}">${allowed ? "ON" : "OFF"}</span>
      </div>
      <div class="perm-card-desc">${escapeHtml(desc)}</div>
    </button>`;
}

function activityRow(entry: ActivityEntry): string {
  const time = new Date(entry.atMs).toLocaleTimeString(undefined, { hour12: false });
  const outcomeLabel = entry.outcome === "success" ? "OK" : entry.outcome === "denied" ? "DENIED" : "ERROR";
  const detail = entry.code ? escapeHtml(entry.code) : entry.outcome === "success" ? `${entry.durationMs}ms` : "";
  return `
    <div class="activity-row activity-${entry.outcome}">
      <span class="activity-time">${escapeHtml(time)}</span>
      <span class="activity-tool">${escapeHtml(entry.tool)}</span>
      <span class="activity-perm">${entry.permission ? escapeHtml(entry.permission) : "—"}</span>
      <span class="activity-outcome ${entry.outcome}">${outcomeLabel}</span>
      <span class="activity-detail">${detail}</span>
    </div>`;
}

function renderHtml(ctx: AppContext): string {
  const config = ctx.getConfig();
  const running = ctx.mcpServer.isRunning();
  const permissions = ctx.permissions.snapshot();
  const localUrl = running ? localEndpoint(config) : null;
  const ipv6On = bindsAllIpv6(config);
  const ipv6Urls = ipv6On && running ? ipv6Endpoints(config) : [];
  const tunnelRunning = ctx.tunnel.isRunning();
  const rawTunnel = ctx.tunnel.getUrl();
  const tunnelMcp = rawTunnel ? (rawTunnel.endsWith("/") ? `${rawTunnel}mcp` : `${rawTunnel}/mcp`) : null;
  const authRequired = ctx.policy.isAuthRequired();
  const activity = ctx.activityLog.list(30);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CodeLink Control Center</title>
<style>
  :root {
    --bg: var(--vscode-editor-background, #0f172a);
    --fg: var(--vscode-editor-foreground, #f8fafc);
    --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(255, 255, 255, 0.03));
    --border: var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
    --muted: var(--vscode-descriptionForeground, #94a3b8);
    --success: #22c55e;
  }

  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    margin: 0;
    padding: 24px 28px;
    box-sizing: border-box;
    line-height: 1.5;
  }

  .header {
    border-bottom: 1px solid var(--border);
    padding-bottom: 16px;
    margin-bottom: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  h1 {
    font-size: 18px;
    font-weight: 700;
    margin: 0 0 4px 0;
  }

  .version-tag {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    background: var(--vscode-badge-background, rgba(255,255,255,0.08));
    padding: 2px 7px;
    border-radius: 4px;
    margin-left: 8px;
    vertical-align: middle;
    letter-spacing: 0.3px;
  }

  .meta {
    font-size: 12px;
    color: var(--muted);
  }

  .status-group {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .status-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 600;
    background: var(--card-bg);
  }

  .indicator-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .indicator-dot.on { background: var(--success); }
  .indicator-dot.off { background: #94a3b8; }

  /* Sections */
  .section {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 16px 18px;
    margin-bottom: 16px;
  }

  .section-header {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 10px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .code-line {
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.3));
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 10px;
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 12px;
    margin: 6px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    word-break: break-all;
    user-select: all;
  }

  .btn-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 10px;
  }

  button {
    padding: 6px 12px;
    border-radius: 4px;
    border: none;
    font-size: 12px;
    font-weight: 500;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    font-family: inherit;
    transition: opacity 0.1s;
  }
  button:hover {
    background: var(--vscode-button-hoverBackground);
  }

  button.secondary {
    background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.06));
    color: var(--vscode-button-secondaryForeground, var(--fg));
    border: 1px solid var(--border);
  }
  button.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.12));
  }

  /* Segmented Control */
  .switch-box {
    display: flex;
    background: var(--vscode-input-background, rgba(0,0,0,0.25));
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px;
    gap: 3px;
    margin: 10px 0;
  }

  .switch-btn {
    flex: 1;
    padding: 7px 12px;
    font-size: 12px;
    font-weight: 600;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    background: transparent;
    color: var(--muted);
    text-align: center;
  }

  .switch-btn.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .switch-btn:not(.active):hover {
    background: rgba(255,255,255,0.04);
    color: var(--fg);
  }

  .notice-box {
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    margin-top: 6px;
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .notice-box.open {
    border-color: rgba(34, 197, 94, 0.3);
    color: #86efac;
    background: rgba(34, 197, 94, 0.08);
  }
  .notice-box.protected {
    border-color: rgba(56, 189, 248, 0.3);
    color: #bae6fd;
    background: rgba(56, 189, 248, 0.08);
  }

  /* Permissions Grid */
  .perm-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 8px;
    margin-top: 10px;
  }

  .perm-card {
    padding: 10px 12px;
    border-radius: 4px;
    border: 1px solid var(--border);
    cursor: pointer !important;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: rgba(255, 255, 255, 0.02);
    color: var(--fg);
  }

  .perm-card.active {
    border-color: #22c55e;
    background: rgba(34, 197, 94, 0.1);
  }

  .perm-card.inactive {
    border-style: dashed;
    color: var(--muted);
  }

  .perm-card-top {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 12px;
  }

  .perm-card-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .perm-card-badge {
    font-size: 9.5px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 2px;
  }
  .perm-card-badge.on {
    background: #15803d;
    color: #ffffff;
  }
  .perm-card-badge.off {
    background: rgba(255,255,255,0.08);
    color: var(--muted);
  }

  .perm-card-desc {
    font-size: 11px;
    color: var(--muted);
    line-height: 1.3;
  }

  .guide-step {
    font-size: 12px;
    color: var(--muted);
    margin: 4px 0;
  }

  /* Activity log */
  .activity-list {
    max-height: 260px;
    overflow-y: auto;
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .activity-row {
    display: grid;
    grid-template-columns: 72px 1fr 110px 64px 90px;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 3px;
    font-size: 11.5px;
    background: rgba(255, 255, 255, 0.02);
    border-left: 2px solid transparent;
  }
  .activity-row.activity-success { border-left-color: #22c55e; }
  .activity-row.activity-denied { border-left-color: #f59e0b; }
  .activity-row.activity-error { border-left-color: #ef4444; }

  .activity-time {
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    color: var(--muted);
  }
  .activity-tool {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .activity-perm {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .activity-outcome {
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0.3px;
  }
  .activity-outcome.success { color: #4ade80; }
  .activity-outcome.denied { color: #fbbf24; }
  .activity-outcome.error { color: #f87171; }
  .activity-detail {
    color: var(--muted);
    font-size: 10.5px;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div>
      <h1>CodeLink Control Center <span class="version-tag">v${escapeHtml(ctx.version)}</span></h1>
      <div class="meta">Workspace: <code>${escapeHtml(ctx.workspaceName)}</code> (${escapeHtml(ctx.workspaceRoot)})</div>
    </div>
    <div class="status-group">
      <div class="status-tag">
        <span class="indicator-dot ${running ? "on" : "off"}"></span>
        Server: ${running ? "Running" : "Stopped"}
      </div>
      <div class="status-tag">
        <span class="indicator-dot ${tunnelRunning ? "on" : "off"}"></span>
        Tunnel: ${tunnelRunning ? "Active" : "Stopped"}
      </div>
      <div class="status-tag">
        <span class="indicator-dot ${ipv6On ? "on" : "off"}"></span>
        Direct IPv6: ${ipv6On ? "On" : "Off"}
      </div>
      <div class="status-tag">
        <span class="indicator-dot ${authRequired ? "off" : "on"}"></span>
        Auth: ${authRequired ? "Require Auth" : "No Auth"}
      </div>
    </div>
  </div>

  <!-- Section 1: Connection Endpoints -->
  <div class="section">
    <div class="section-header">Endpoints</div>
    ${tunnelRunning && tunnelMcp
      ? `
    <div class="meta" style="margin-bottom:2px;">Public Tunnel Endpoint:</div>
    <div class="code-line">
      <span>${escapeHtml(tunnelMcp)}</span>
      <button class="secondary" style="padding:2px 8px; font-size:11px;" data-command="copyTunnelUrl">Copy</button>
    </div>
    <div class="btn-row">
      <button data-command="copyTunnelUrl">Copy Tunnel URL</button>
      <button class="secondary" data-command="stopTunnel">Stop Tunnel</button>
    </div>
    `
      : `
    <div class="btn-row">
      <button data-command="startTunnel">Start Tunnel &amp; Copy URL</button>
    </div>
    `
    }
    <div class="meta" style="margin-top:10px; margin-bottom:2px;">Direct IPv6 Endpoint:</div>
    ${ipv6On
      ? !running
        ? `<div class="notice-box">Start the server to accept IPv6 connections.</div>`
        : ipv6Urls.length === 0
          ? `<div class="notice-box">No IPv6 address that other hosts can reach was found on this machine.</div>`
          : ipv6Urls
              .map(
                (entry) => `
    <div class="code-line">
      <span>${escapeHtml(entry.url)}${entry.scope === "unique-local" ? " (local network only)" : ""}</span>
    </div>`,
              )
              .join("")
      : `<div class="meta">Let others connect straight to this machine's IPv6 address and port, no tunnel needed.</div>`
    }
    <div class="btn-row">
      ${ipv6On
      ? `${ipv6Urls.length > 0 ? `<button data-command="copyIpv6Url">Copy IPv6 URL</button>` : ""}<button class="secondary" data-command="disableIpv6">Disable Direct IPv6</button>`
      : `<button data-command="enableIpv6">Enable Direct IPv6</button>`
    }
    </div>
    ${localUrl
      ? `
    <div class="meta" style="margin-top:10px; margin-bottom:2px;">Local Endpoint:</div>
    <div class="code-line">
      <span>${escapeHtml(localUrl)}</span>
    </div>
    <div class="btn-row">
      ${!running ? `<button data-command="start">Start Server</button>` : `<button class="secondary" data-command="stop">Stop Server</button>`}
      ${running ? `<button class="secondary" data-command="restart">Restart Server</button>` : ""}
    </div>
    `
      : ""
    }
  </div>

  <!-- Section 2: Authentication Mode -->
  <div class="section">
    <div class="section-header">Authentication</div>
    <div class="meta">Select authentication policy for incoming connections:</div>
    <div class="switch-box">
      <button class="switch-btn ${!authRequired ? "active" : ""}" data-auth="none">No Auth (Open)</button>
      <button class="switch-btn ${authRequired ? "active" : ""}" data-auth="required">Require Auth (Tokens / OAuth)</button>
    </div>
    ${!authRequired
      ? `
    <div class="notice-box open">
      No Auth active. Direct connection enabled without tokens or authorization handshakes.
    </div>
    `
      : `
    <div class="notice-box protected">
      Authentication active. Incoming requests must supply a valid OAuth 2.0 or bearer access token.
    </div>
    <div class="btn-row">
      <button class="secondary" data-command="generateToken">Generate Token</button>
    </div>
    `
    }
  </div>

  <!-- Section 3: Workspace Permissions -->
  <div class="section">
    <div class="section-header">
      <span>Permissions</span>
      <div class="btn-row" style="margin:0;">
        <button class="secondary" style="font-size:11px; padding:3px 8px;" data-command="allowAll">Allow All</button>
        <button class="secondary" style="font-size:11px; padding:3px 8px;" data-command="developerPreset">Developer Preset</button>
        <button class="secondary" style="font-size:11px; padding:3px 8px;" data-command="readOnlyPreset">Read-Only Preset</button>
      </div>
    </div>
    <div class="meta">Click any permission card to toggle:</div>
    <div class="perm-grid">
      ${permissionCard("Workspace Read", "Read files and directories", permissions.workspaceRead, "workspaceRead")}
      ${permissionCard("Workspace Search", "Ripgrep search across files", permissions.workspaceSearch, "workspaceSearch")}
      ${permissionCard("Editor Read", "Read active document contents", permissions.editorRead, "editorRead")}
      ${permissionCard("Editor Write", "Modify active document", permissions.editorWrite, "editorWrite")}
      ${permissionCard("File Write", "Write or overwrite files", permissions.fileWrite, "fileWrite")}
      ${permissionCard("File Delete", "Remove workspace files", permissions.fileDelete, "fileDelete")}
      ${permissionCard("Terminal", "Execute commands in terminal", permissions.terminal, "terminal")}
      ${permissionCard("Git Operations", "Git status, diff, commit", permissions.gitWrite, "gitWrite")}
      ${permissionCard("Remote Access", "Permit non-local connections", permissions.remoteAccess, "remoteAccess")}
    </div>
  </div>

  <!-- Section 3.5: Activity -->
  <div class="section">
    <div class="section-header">
      <span>Activity</span>
      <span class="meta">${activity.length} recent tool call${activity.length === 1 ? "" : "s"}</span>
    </div>
    <div class="meta">What clients connected to this server have actually called, and whether the active permissions allowed it.</div>
    ${activity.length === 0
      ? `<div class="notice-box" style="margin-top:8px;">No tool calls yet.</div>`
      : `<div class="activity-list">${activity.map(activityRow).join("")}</div>`
    }
  </div>

  <!-- Section 4: Client Setup -->
  <div class="section">
    <div class="section-header">Client Setup</div>
    <div class="guide-step">1. In your client (such as Claude.ai or Cursor), add MCP server with Streamable HTTP transport.</div>
    <div class="guide-step">2. Set server URL to: <code>${escapeHtml(tunnelMcp ?? ipv6Urls[0]?.url ?? "http://127.0.0.1:32100/mcp")}</code></div>
    <div class="guide-step">3. With <strong>No Auth</strong> selected, the connection establishes immediately without credentials.</div>
    <div class="btn-row" style="margin-top:12px;">
      <button class="secondary" data-command="reloadWindow">Reload Window</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.querySelectorAll("button[data-command]").forEach((btn) => {
      btn.addEventListener("click", () => {
        vscode.postMessage({ command: btn.getAttribute("data-command") });
      });
    });

    document.querySelectorAll(".perm-card").forEach((btn) => {
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
    this.panel = vscode.window.createWebviewPanel("codelinkDashboard", "CodeLink Control Center", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    this.panel.onDidDispose(() => {
      DashboardPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage(
      (message: { command?: string; permission?: string; required?: boolean }) => {
        void this.handleMessage(message);
      },
    );
    this.refresh();
  }

  private refresh(): void {
    this.panel.webview.html = renderHtml(this.ctx);
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
      this.ctx.sidebar?.refresh();
      return;
    }

    if (command === "togglePermission" && permission) {
      const key = permission as PermissionKey;
      const next = this.ctx.permissions.toggle(key);
      if (key === "remoteAccess") {
        await setRemoteEnabled(this.ctx, next);
      }
      this.refresh();
      this.ctx.sidebar?.refresh();
      return;
    }

    if (command === "allowAll") {
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
      await vscode.workspace
        .getConfiguration("codelink")
        .update("remote.enabled", true, vscode.ConfigurationTarget.Workspace);
      this.refresh();
      this.ctx.sidebar?.refresh();
      return;
    }

    if (command === "developerPreset") {
      this.ctx.permissions.clearOverrides();
      await vscode.workspace
        .getConfiguration("codelink")
        .update("security.profile", "developer", vscode.ConfigurationTarget.Workspace);
      this.refresh();
      this.ctx.sidebar?.refresh();
      return;
    }

    if (command === "readOnlyPreset") {
      this.ctx.permissions.clearOverrides();
      await vscode.workspace
        .getConfiguration("codelink")
        .update("security.profile", "readonly", vscode.ConfigurationTarget.Workspace);
      this.refresh();
      this.ctx.sidebar?.refresh();
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
      startTunnel: "codelink.startTunnel",
      stopTunnel: "codelink.stopTunnel",
      copyTunnelUrl: "codelink.copyTunnelUrl",
      enableIpv6: "codelink.enableIpv6Access",
      disableIpv6: "codelink.disableIpv6Access",
      copyIpv6Url: "codelink.copyIpv6Url",
    };

    if (command && commandMap[command]) {
      await vscode.commands.executeCommand(commandMap[command]);
    }
    this.refresh();
    this.ctx.sidebar?.refresh();
  }
}
