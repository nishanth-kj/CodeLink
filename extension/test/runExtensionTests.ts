import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

/**
 * Entry point for the extension-host test suite (real VS Code API, run via
 * @vscode/test-electron — not vitest, since `vscode` only exists inside a
 * real extension host). Downloads/caches a VS Code build under
 * .vscode-test/ on first run.
 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(__dirname, "suite", "index.js");
  // The fixture workspace is a plain asset (not TypeScript), so it lives
  // under the source test/ tree rather than the compiled out-test/ one.
  const workspacePath = path.resolve(extensionDevelopmentPath, "test", "fixtures", "workspace");

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, "--disable-extensions"],
  });
}

main().catch((error) => {
  console.error("Failed to run extension tests:", error);
  process.exitCode = 1;
});
