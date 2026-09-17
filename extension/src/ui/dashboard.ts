import * as vscode from "vscode";
import type { AppContext } from "../extension.js";
import type { PermissionKey } from "../security/permissions.js";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function permissionChip(label: string, desc: string, allowed: boolean, permKey: PermissionKey): string {
  return `
    <button class="perm-card ${allowed ? "allowed" : "blocked"}" data-perm="${permKey}" title="Click to toggle ${escapeHtml(label)}">
      <div class="perm-card-header">
        <span class="perm-card-status">${allowed ? "✓" : "✗"}</span>
        <span class="perm-card-title">${escapeHtml(label)}</span>
      </div>
      <div class="perm-card-desc">${escapeHtml(desc)}</div>
    </button>`;
}

function renderHtml(ctx: AppContext): string {
  const config = ctx.getConfig();
  const running = ctx.mcpServer.isRunning();
  const permissions = ctx.permissions.snapshot();
  const host = config.remote.enabled ? config.server.host : "127.0.0.1";
  const localEndpoint = running ? `http://${host}:${config.server.port}/mcp` : null;
  const tunnelRunning = ctx.tunnel.isRunning();
  const rawTunnel = ctx.tunnel.getUrl();
  const tunnelMcp = rawTunnel ? (rawTunnel.endsWith("/") ? `${rawTunnel}mcp` : `${rawTunnel}/mcp`) : null;
  const authRequired = ctx.policy.isAuthRequired();

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
    --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(30, 41, 59, 0.6));
    --card-border: var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
    --accent: var(--vscode-button-background, #38bdf8);
    --accent-fg: var(--vscode-button-foreground, #0f172a);
    --success: #22c55e;
    --danger: #ef4444;
    --muted: var(--vscode-descriptionForeground, #94a3b8);
  }

  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    margin: 0;
    padding: 24px 32px;
    box-sizing: border-box;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--card-border);
    padding-bottom: 20px;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 16px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo-badge {
    background: linear-gradient(135deg, #0ea5e9, #6366f1);
    color: white;
    font-weight: 800;
    font-size: 16px;
    padding: 8px 12px;
    border-radius: 8px;
    letter-spacing: -0.5px;
    box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
  }

  h1 {
    font-size: 22px;
    margin: 0;
    font-weight: 700;
  }

  .subtitle {
    color: var(--muted);
    font-size: 13px;
    margin-top: 3px;
  }

  .status-badges {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot.green { background: var(--success); box-shadow: 0 0 8px rgba(34,197,94,0.6); }
  .dot.gray { background: #94a3b8; }
  .dot.blue { background: #38bdf8; box-shadow: 0 0 8px rgba(56,189,248,0.6); }

  /* Layout Grid */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 20px;
    margin-bottom: 24px;
  }

  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    padding: 20px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  }

  .card-title {
    font-size: 15px;
    font-weight: 700;
    margin: 0 0 14px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--fg);
  }

  .btn-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 14px;
  }

  button {
    padding: 8px 16px;
    border-radius: 6px;
    border: none;
    font-size: 12.5px;
    font-weight: 600;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: inherit;
  }
  button:hover {
    background: var(--vscode-button-hoverBackground);
    transform: translateY(-1px);
  }
  button:active {
    transform: translateY(0);
  }

  button.secondary {
    background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
    color: var(--vscode-button-secondaryForeground, var(--fg));
    border: 1px solid var(--card-border);
  }
  button.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.15));
  }

  .code-box {
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.3));
    border: 1px solid var(--card-border);
    border-radius: 6px;
    padding: 10px 12px;
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 12px;
    word-break: break-all;
    margin: 8px 0;
    user-select: all;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  /* Auth Mode Segmented Control */
  .auth-selector {
    display: flex;
    background: var(--vscode-input-background, rgba(0,0,0,0.25));
    border: 1px solid var(--card-border);
    border-radius: 8px;
    padding: 4px;
    gap: 4px;
    margin: 12px 0;
  }

  .auth-mode-btn {
    flex: 1;
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 600;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    background: transparent;
    color: var(--muted);
    transition: all 0.2s ease;
    justify-content: center;
    text-align: center;
  }

  .auth-mode-btn.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  }

  .auth-mode-btn:not(.active):hover {
    background: rgba(255,255,255,0.06);
    color: var(--fg);
  }

  .auth-callout {
    padding: 12px 14px;
    border-radius: 6px;
    font-size: 12.5px;
    line-height: 1.5;
    margin-top: 8px;
    border: 1px solid transparent;
  }
  .auth-callout.open {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.3);
    color: #86efac;
  }
  .auth-callout.protected {
    background: rgba(56, 189, 248, 0.12);
    border-color: rgba(56, 189, 248, 0.3);
    color: #bae6fd;
  }

  /* Permissions Grid */
  .perm-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
    margin-top: 12px;
  }

  .perm-card {
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--card-border);
    cursor: pointer !important;
    transition: all 0.15s ease;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 4px;
    user-select: none;
  }

  .perm-card:hover {
    transform: translateY(-2px);
    filter: brightness(1.15);
  }

  .perm-card.allowed {
    background: rgba(34, 197, 94, 0.15);
    border-color: rgba(34, 197, 94, 0.4);
    color: #ffffff;
  }
  .perm-card.allowed .perm-card-status {
    color: #4ade80;
    font-weight: 800;
  }

  .perm-card.blocked {
    background: rgba(255, 255, 255, 0.02);
    border-style: dashed;
    color: var(--muted);
  }
  .perm-card.blocked .perm-card-status {
    color: #f87171;
    font-weight: 800;
  }

  .perm-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 13px;
  }

  .perm-card-desc {
    font-size: 11px;
    color: var(--muted);
    line-height: 1.3;
  }

  /* Quick connect guide tabs */
  .guide-box {
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.3));
    border: 1px solid var(--card-border);
    border-radius: 6px;
    padding: 12px 16px;
    font-size: 12.5px;
    line-height: 1.6;
    margin-top: 10px;
  }
  .guide-step {
    margin-bottom: 6px;
  }
  .step-num {
    display: inline-block;
    width: 20px;
    height: 20px;
    line-height: 20px;
    text-align: center;
    border-radius: 50%;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font-size: 11px;
    font-weight: 700;
    margin-right: 6px;
  }
</style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="brand">
      <div class="logo-badge">CL</div>
      <div>
        <h1>CodeLink Control Center</h1>
        <div class="subtitle">Workspace: <code>${escapeHtml(ctx.workspaceName)}</code> (${escapeHtml(ctx.workspaceRoot)})</div>
      </div>
    </div>
    <div class="status-badges">
      <div class="pill">
        <span class="dot ${running ? "green" : "gray"}"></span>
        MCP Server: ${running ? "Running" : "Stopped"}
      </div>
      <div class="pill">
        <span class="dot ${tunnelRunning ? "green" : "gray"}"></span>
        Tunnel: ${tunnelRunning ? "Live" : "Inactive"}
      </div>
      <div class="pill">
        <span class="dot ${authRequired ? "blue" : "green"}"></span>
        Auth: ${authRequired ? "🔒 Protected" : "🔓 Open Access"}
      </div>
    </div>
  </div>

  <div class="grid">
    <!-- Card 1: Cloudflare Tunnel & Endpoints -->
    <div class="card">
      <div class="card-title">
        <span>🌐 Cloudflare Public Tunnel</span>
        <span style="font-size:12px; font-weight:normal;" class="pill">${tunnelRunning ? "Active" : "Stopped"}</span>
      </div>
      <p style="font-size:13px; color:var(--muted); margin:0 0 10px 0;">
        Provides a public HTTPS URL enabling remote AI clients (Claude.ai Web, Cursor, ChatGPT) to reach your local workspace.
      </p>
      ${
        tunnelRunning && tunnelMcp
          ? `
      <div style="font-size:11.5px; font-weight:600; color:var(--muted); margin-top:8px;">Direct Web MCP Endpoint:</div>
      <div class="code-box">
        <span>${escapeHtml(tunnelMcp)}</span>
        <button class="secondary" style="padding:4px 8px; font-size:11px;" data-command="copyTunnelUrl">Copy</button>
      </div>
      <div class="btn-row">
        <button data-command="copyTunnelUrl">Copy Tunnel Link</button>
        <button class="secondary" data-command="stopTunnel">Stop Tunnel</button>
      </div>
      `
          : `
      <div class="btn-row">
        <button data-command="startTunnel">Start Tunnel &amp; Copy Link</button>
      </div>
      `
      }
      ${
        localEndpoint
          ? `
      <div style="font-size:11.5px; font-weight:600; color:var(--muted); margin-top:14px;">Local Endpoint:</div>
      <div class="code-box">
        <span>${escapeHtml(localEndpoint)}</span>
      </div>
      `
          : ""
      }
    </div>

    <!-- Card 2: Authentication Mode Selector (User Feature Request) -->
    <div class="card">
      <div class="card-title">
        <span>🔑 Authentication Mode</span>
        <span style="font-size:12px; font-weight:normal;" class="pill">${authRequired ? "OAuth / Token" : "No Auth (Open)"}</span>
      </div>
      <p style="font-size:13px; color:var(--muted); margin:0;">
        Choose whether remote clients must authenticate or can connect directly with zero friction:
      </p>

      <div class="auth-selector">
        <button class="auth-mode-btn ${!authRequired ? "active" : ""}" data-auth="none">
          🔓 No Auth (Open Access)
        </button>
        <button class="auth-mode-btn ${authRequired ? "active" : ""}" data-auth="required">
          🔒 OAuth / Token Auth
        </button>
      </div>

      ${
        !authRequired
          ? `
      <div class="auth-callout open">
        <strong>🔓 No Auth Active:</strong> Clients connect directly to your MCP endpoint with zero login prompts or token errors. Perfect for fast testing in Claude.ai Web, Cursor, or local agents!
      </div>
      `
          : `
      <div class="auth-callout protected">
        <strong>🔒 Auth Required Active:</strong> Clients must complete RFC 8414 / RFC 9728 OAuth discovery or provide a CodeLink Bearer Access Token.
      </div>
      <div class="btn-row">
        <button class="secondary" data-command="generateToken">Generate Bearer Token</button>
      </div>
      `
      }
    </div>
  </div>

  <!-- Card 3: Permissions Matrix -->
  <div class="card" style="margin-bottom: 24px;">
    <div class="card-title">
      <div>
        <span>🛡️ Workspace Permissions</span>
        <span style="font-size:12px; font-weight:normal; color:var(--muted); margin-left:8px;">(Click any card to toggle live)</span>
      </div>
      <div class="btn-row" style="margin:0;">
        <button class="secondary" style="font-size:11.5px; padding:5px 10px;" data-command="allowAll">Allow All</button>
        <button class="secondary" style="font-size:11.5px; padding:5px 10px;" data-command="developerPreset">Developer Preset</button>
        <button class="secondary" style="font-size:11.5px; padding:5px 10px;" data-command="readOnlyPreset">Read-Only</button>
      </div>
    </div>

    <div class="perm-grid">
      ${permissionChip("Workspace Read", "Read workspace files & tree", permissions.workspaceRead, "workspaceRead")}
      ${permissionChip("Workspace Search", "Ripgrep search in codebase", permissions.workspaceSearch, "workspaceSearch")}
      ${permissionChip("Editor Read", "Inspect open tabs & cursors", permissions.editorRead, "editorRead")}
      ${permissionChip("Editor Write", "Insert & edit in active editor", permissions.editorWrite, "editorWrite")}
      ${permissionChip("File Write", "Create & modify project files", permissions.fileWrite, "fileWrite")}
      ${permissionChip("File Delete", "Delete files in workspace", permissions.fileDelete, "fileDelete")}
      ${permissionChip("Terminal", "Run shell commands in IDE", permissions.terminal, "terminal")}
      ${permissionChip("Git Operations", "Git status, diff, commit, log", permissions.gitWrite, "gitWrite")}
      ${permissionChip("Remote Access", "Allow external connections", permissions.remoteAccess, "remoteAccess")}
    </div>
  </div>

  <!-- Card 4: How to Connect to Claude.ai Web -->
  <div class="card">
    <div class="card-title">
      <span>🚀 Quick Connect Guide for Claude.ai Web</span>
    </div>
    <div class="guide-box">
      <div class="guide-step">
        <span class="step-num">1</span> Click <strong>Start Tunnel &amp; Copy Link</strong> above (or select <strong>🔓 No Auth</strong> mode).
      </div>
      <div class="guide-step">
        <span class="step-num">2</span> Open <a href="https://claude.ai" target="_blank" style="color:var(--accent);">Claude.ai</a> &rarr; <strong>Settings</strong> &rarr; <strong>Integrations</strong> &rarr; <strong>Add MCP Server</strong>.
      </div>
      <div class="guide-step">
        <span class="step-num">3</span> Paste your Tunnel URL: <code>${escapeHtml(tunnelMcp ?? "https://<your-tunnel>.trycloudflare.com/mcp")}</code>.
      </div>
      <div class="guide-step">
        <span class="step-num">4</span> Claude links immediately to your VS Code workspace! Ask Claude to read, edit, or search your code!
      </div>
    </div>
    <div class="btn-row" style="margin-top:16px;">
      <button class="secondary" data-command="reloadWindow">🔄 Reload VS Code Window (Apply Updates)</button>
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

    document.querySelectorAll(".auth-mode-btn").forEach((btn) => {
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
        await vscode.workspace
          .getConfiguration("codelink")
          .update("remote.enabled", next, vscode.ConfigurationTarget.Workspace);
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
    };

    if (command && commandMap[command]) {
      await vscode.commands.executeCommand(commandMap[command]);
    }
    this.refresh();
    this.ctx.sidebar?.refresh();
  }
}
