# Extension host tests

Tests that need the real `vscode` API (editor state, diagnostics, real command execution against a real VS Code window) can't run under vitest — `vscode` only exists inside a genuine extension host process, and `@vscode/test-electron` is the standard way to drive one from a test script. Rather than fake that here, those tests live at [`../../extension/test/`](../../extension/test/), following the layout `@vscode/test-electron` expects (`runExtensionTests.ts` as the entry point, `suite/` as the Mocha suite, `suite/index.ts` exporting the `run()` it requires).

Run them with `npm run test:vscode` from `extension/` (see [../../docs/development.md](../../docs/development.md) for the full command sequence and a known environment limitation around downloading a real VS Code build).

Everything else — pure-logic security/MCP unit tests and full end-to-end MCP tests that don't need the real VS Code API — lives directly under `../` (`tests/security`, `tests/mcp`, `tests/integration`) and runs under vitest.
