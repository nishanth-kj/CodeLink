/**
 * Minimal stand-in for the `vscode` module, used only so that modules
 * which statically `import * as vscode from "vscode"` (several tools/*.ts
 * files, mcp/server.ts by extension) can be loaded outside the real VS
 * Code extension host, where no such module exists on disk.
 *
 * This suite never exercises a code path that actually calls into these
 * objects — it only calls tools that talk to codelink-core directly
 * (filesystem, terminal, git). Coverage for the VS Code-API-backed tools
 * (editor, diagnostics, symbol search) lives in extension/test, which runs
 * inside a real extension host via @vscode/test-electron. If a future
 * integration test needs a real vscode.* call to succeed, extend this
 * stub rather than reaching for the real API here.
 */
export const window = {};
export const workspace = {};
export const languages = {};
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
