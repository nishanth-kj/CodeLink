import * as os from "node:os";
import * as vscode from "vscode";
import { defineResource } from "./index.js";

export const workspaceInfoResource = defineResource({
  uri: "workspace://info",
  name: "workspace-info",
  description: "Workspace name, root path, configured folders, host OS, and the active editor.",
  mimeType: "application/json",
  permission: "workspaceRead",
  read: async (ctx) => {
    const editor = vscode.window.activeTextEditor;
    return JSON.stringify(
      {
        name: ctx.workspaceName,
        path: ctx.workspaceRoot,
        folders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
          name: folder.name,
          path: folder.uri.fsPath,
        })),
        platform: os.platform(),
        activeEditor: editor
          ? {
              file: vscode.workspace.asRelativePath(editor.document.uri, false),
              languageId: editor.document.languageId,
            }
          : null,
      },
      null,
      2,
    );
  },
});

export const editorActiveResource = defineResource({
  uri: "editor://active",
  name: "editor-active",
  description: "The file path, language, and content of the currently active editor.",
  mimeType: "application/json",
  permission: "editorRead",
  read: async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return JSON.stringify({ active: false }, null, 2);
    }
    return JSON.stringify(
      {
        active: true,
        file: vscode.workspace.asRelativePath(editor.document.uri, false),
        languageId: editor.document.languageId,
        content: editor.document.getText(),
      },
      null,
      2,
    );
  },
});
