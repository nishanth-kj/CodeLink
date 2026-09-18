/**
 * Minimal stand-in for the `vscode` module, used only so that modules
 * which statically `import * as vscode from "vscode"` (several tools/*.ts
 * files, mcp/server.ts by extension) can be loaded outside the real VS
 * Code extension host, where no such module exists on disk.
 *
 * This suite mostly exercises tools backed by the local core directly
 * (filesystem, terminal, git) rather than real VS Code state — coverage
 * for the VS Code-API-backed tools (editor, diagnostics, symbol search)
 * lives in extension/test, which runs inside a real extension host via
 * @vscode/test-electron. The one exception is the four MCP resources
 * (workspace://info, workspace://files, editor://active,
 * diagnostics://workspace), which this suite does read end to end to
 * verify resources/list and resources/read work — each degrades to an
 * empty/"nothing active" shape against this stub rather than throwing,
 * which is enough to prove the MCP resource-serving plumbing itself
 * works without needing a real editor or diagnostics to be present.
 */
export const window = {};
export const workspace = {};
export const languages = { getDiagnostics: () => [] };
export const commands = {};
export const env = {};
export const Uri = {};
export class Range {}
export class Position {}
export class WorkspaceEdit {}
export class TabInputText {}
export const DiagnosticSeverity = {};
export const SymbolKind = {};
export const ConfigurationTarget = {};
export const StatusBarAlignment = {};
export const ViewColumn = {};
