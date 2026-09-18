import * as path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Several tools/*.ts modules statically `import ... from "vscode"`,
      // which does not exist as an installed package outside the real
      // extension host. Integration tests that only exercise local-core-
      // backed tools (filesystem/terminal/git) can still load that module
      // graph by resolving "vscode" to a minimal stub; see vscodeStub.ts.
      vscode: path.resolve(__dirname, "../tests/integration/vscodeStub.ts"),
    },
  },
  test: {
    include: [
      "../tests/security/**/*.test.ts",
      "../tests/mcp/**/*.test.ts",
      "../tests/integration/**/*.test.ts"
    ],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    globals: false
  }
});
