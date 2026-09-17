import * as path from "node:path";
import * as vscode from "vscode";
import { z } from "zod";
import { checkFileAccess } from "../security/policy.js";
import { defineTool, textResult } from "./index.js";

export function severityName(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "information";
    case vscode.DiagnosticSeverity.Hint:
    default:
      return "hint";
  }
}

export function toDiagnosticJson(uri: vscode.Uri, diagnostic: vscode.Diagnostic) {
  const code =
    typeof diagnostic.code === "object" && diagnostic.code !== null ? diagnostic.code.value : (diagnostic.code ?? null);
  return {
    file: vscode.workspace.asRelativePath(uri, false),
    severity: severityName(diagnostic.severity),
    message: diagnostic.message,
    source: diagnostic.source ?? null,
    code,
    range: {
      startLine: diagnostic.range.start.line + 1,
      startColumn: diagnostic.range.start.character + 1,
      endLine: diagnostic.range.end.line + 1,
      endColumn: diagnostic.range.end.character + 1,
    },
  };
}

export const diagnosticsTools = [
  defineTool({
    name: "diagnostics_get",
    description: "Get all diagnostics (errors, warnings, hints) currently reported anywhere in the workspace.",
    inputSchema: {},
    permission: "workspaceRead",
    handler: async () => {
      const items = vscode.languages
        .getDiagnostics()
        .flatMap(([uri, diagnostics]) => diagnostics.map((diagnostic) => toDiagnosticJson(uri, diagnostic)));
      return textResult(items);
    },
  }),

  defineTool({
    name: "diagnostics_file",
    description: "Get diagnostics for a specific file.",
    inputSchema: { path: z.string().describe("Workspace-relative file path.") },
    permission: "workspaceRead",
    handler: async (args, ctx) => {
      const relative = checkFileAccess(ctx.workspaceRoot, args.path, ctx.getConfig().security.allowSecretFileAccess);
      const uri = vscode.Uri.file(path.join(ctx.workspaceRoot, relative));
      const items = vscode.languages.getDiagnostics(uri).map((diagnostic) => toDiagnosticJson(uri, diagnostic));
      return textResult(items);
    },
  }),
];
