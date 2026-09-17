import * as assert from "node:assert";
import * as vscode from "vscode";
import "mocha";

const EXPECTED_COMMANDS = [
  "codelink.startServer",
  "codelink.stopServer",
  "codelink.restartServer",
  "codelink.showStatus",
  "codelink.showEndpoint",
  "codelink.copyConfig",
  "codelink.generateToken",
  "codelink.revokeToken",
  "codelink.enableRemoteAccess",
  "codelink.disableRemoteAccess",
  "codelink.startTunnel",
  "codelink.stopTunnel",
  "codelink.showTunnelUrl",
  "codelink.copyTunnelUrl",
  "codelink.openDashboard",
];

suite("CodeLink extension (real extension host)", () => {
  test("activates and registers every command", async () => {
    const extension = vscode.extensions.getExtension("nishanth-kj.codelink");
    assert.ok(extension, "the codelink extension should be discoverable");
    await extension?.activate();
    assert.strictEqual(extension?.isActive, true, "the extension should be active");

    const registered = await vscode.commands.getCommands(true);
    for (const id of EXPECTED_COMMANDS) {
      assert.ok(registered.includes(id), `expected command '${id}' to be registered`);
    }
  });

  test("workspace_info-relevant state: a workspace folder is open", () => {
    assert.ok(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
  });

  test("start, status, and stop run against the real Rust core without throwing", async function (this: Mocha.Context) {
    this.timeout(20000);
    await vscode.commands.executeCommand("codelink.startServer");
    await vscode.commands.executeCommand("codelink.showStatus");
    await vscode.commands.executeCommand("codelink.stopServer");
  });

  test("revoke token runs without throwing when no token exists", async () => {
    // generateToken/enableRemoteAccess are intentionally not exercised here:
    // both await an interactive showInformationMessage/showWarningMessage
    // choice, which never resolves in a headless test run.
    await vscode.commands.executeCommand("codelink.revokeToken");
  });
});
