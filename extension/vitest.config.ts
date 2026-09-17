import { defineConfig } from "vitest/config";

export default defineConfig({
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
