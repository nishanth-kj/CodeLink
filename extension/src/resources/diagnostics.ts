import * as vscode from "vscode";
import { toDiagnosticJson } from "../tools/diagnostics.js";
import { defineResource } from "./index.js";

export const diagnosticsWorkspaceResource = defineResource({
  uri: "diagnostics://workspace",
  name: "diagnostics-workspace",
  description: "All diagnostics (errors, warnings, hints) currently reported across the workspace.",
  mimeType: "application/json",
  permission: "workspaceRead",
  read: async () => {
    const items = vscode.languages
      .getDiagnostics()
      .flatMap(([uri, diagnostics]) => diagnostics.map((diagnostic) => toDiagnosticJson(uri, diagnostic)));
    return JSON.stringify(items, null, 2);
  },
});
