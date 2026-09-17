import * as path from "node:path";
import * as vscode from "vscode";
import { z } from "zod";
import { checkFileAccess } from "../security/policy.js";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import { defineTool, textResult, type ToolContext } from "./index.js";

function requireActiveEditor(): vscode.TextEditor {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new CodeLinkError(ErrorCodes.INVALID_ARGUMENT, "There is no active editor.");
  }
  return editor;
}

/** Resolves a tool's optional `path` argument to the matching open
 * document, or falls back to the active editor's document. Never allows
 * opening a path outside the workspace or a blocked secret file. */
async function resolveDocument(ctx: ToolContext, relativePath: string | undefined): Promise<vscode.TextDocument> {
  if (!relativePath) {
    return requireActiveEditor().document;
  }
  const relative = checkFileAccess(ctx.workspaceRoot, relativePath, ctx.getConfig().security.allowSecretFileAccess);
  const absolute = path.join(ctx.workspaceRoot, relative);
  const existing = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === absolute);
  return existing ?? vscode.workspace.openTextDocument(vscode.Uri.file(absolute));
}

export const editorTools = [
  defineTool({
    name: "editor_active_file",
    description: "Get the file path, language, cursor position, and selection of the currently active editor.",
    inputSchema: {},
    permission: "editorRead",
    handler: async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return textResult({ active: false });
      }
      return textResult({
        active: true,
        file: vscode.workspace.asRelativePath(editor.document.uri, false),
        languageId: editor.document.languageId,
        line: editor.selection.active.line + 1,
        column: editor.selection.active.character + 1,
        selection: editor.document.getText(editor.selection),
      });
    },
  }),

  defineTool({
    name: "editor_read",
    description: "Read the in-memory content of the active editor, or of a specific open/openable document.",
    inputSchema: {
      path: z.string().optional().describe("Workspace-relative file path. Defaults to the active editor."),
    },
    permission: "editorRead",
    handler: async (args, ctx) => {
      const document = await resolveDocument(ctx, args.path);
      return textResult({
        file: vscode.workspace.asRelativePath(document.uri, false),
        languageId: document.languageId,
        content: document.getText(),
        isDirty: document.isDirty,
      });
    },
  }),

  defineTool({
    name: "editor_selection",
    description: "Get the current selection (text and range) of the active editor.",
    inputSchema: {},
    permission: "editorRead",
    handler: async () => {
      const editor = requireActiveEditor();
      return textResult({
        file: vscode.workspace.asRelativePath(editor.document.uri, false),
        text: editor.document.getText(editor.selection),
        range: {
          startLine: editor.selection.start.line + 1,
          startColumn: editor.selection.start.character + 1,
          endLine: editor.selection.end.line + 1,
          endColumn: editor.selection.end.character + 1,
        },
      });
    },
  }),

  defineTool({
    name: "editor_write",
    description:
      "Replace the entire content of the active editor (or a specific document). Modifies the in-memory buffer only; it does not save to disk automatically.",
    inputSchema: {
      content: z.string().describe("New full document content."),
      path: z.string().optional().describe("Workspace-relative file path. Defaults to the active editor."),
    },
    permission: "editorWrite",
    handler: async (args, ctx) => {
      const document = await resolveDocument(ctx, args.path);
      const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, fullRange, args.content);
      const applied = await vscode.workspace.applyEdit(edit);
      return textResult({ file: vscode.workspace.asRelativePath(document.uri, false), applied, saved: false });
    },
  }),

  defineTool({
    name: "editor_insert",
    description:
      "Insert text at a specific line/column in the active editor (or a specific document). Modifies the in-memory buffer only.",
    inputSchema: {
      text: z.string().describe("Text to insert."),
      line: z.number().int().min(1).describe("1-based line number."),
      column: z.number().int().min(1).describe("1-based column number."),
      path: z.string().optional().describe("Workspace-relative file path. Defaults to the active editor."),
    },
    permission: "editorWrite",
    handler: async (args, ctx) => {
      const document = await resolveDocument(ctx, args.path);
      const position = new vscode.Position(args.line - 1, args.column - 1);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, position, args.text);
      const applied = await vscode.workspace.applyEdit(edit);
      return textResult({ file: vscode.workspace.asRelativePath(document.uri, false), applied, saved: false });
    },
  }),

  defineTool({
    name: "editor_replace",
    description:
      "Replace a specific line/column range in the active editor (or a specific document) with new text. Modifies the in-memory buffer only.",
    inputSchema: {
      text: z.string().describe("Replacement text."),
      startLine: z.number().int().min(1),
      startColumn: z.number().int().min(1),
      endLine: z.number().int().min(1),
      endColumn: z.number().int().min(1),
      path: z.string().optional().describe("Workspace-relative file path. Defaults to the active editor."),
    },
    permission: "editorWrite",
    handler: async (args, ctx) => {
      const document = await resolveDocument(ctx, args.path);
      const range = new vscode.Range(
        new vscode.Position(args.startLine - 1, args.startColumn - 1),
        new vscode.Position(args.endLine - 1, args.endColumn - 1),
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, range, args.text);
      const applied = await vscode.workspace.applyEdit(edit);
      return textResult({ file: vscode.workspace.asRelativePath(document.uri, false), applied, saved: false });
    },
  }),

  defineTool({
    name: "editor_open",
    description: "Open a workspace file in the editor.",
    inputSchema: {
      path: z.string().describe("Workspace-relative file path."),
      preview: z.boolean().optional().default(false),
    },
    permission: "editorRead",
    handler: async (args, ctx) => {
      const relative = checkFileAccess(ctx.workspaceRoot, args.path, ctx.getConfig().security.allowSecretFileAccess);
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(ctx.workspaceRoot, relative)));
      await vscode.window.showTextDocument(document, { preview: args.preview });
      return textResult({ file: relative, opened: true });
    },
  }),

  defineTool({
    name: "editor_close",
    description: "Close the editor tab for a workspace file, if it is open.",
    inputSchema: { path: z.string().describe("Workspace-relative file path.") },
    permission: "editorRead",
    handler: async (args, ctx) => {
      const relative = checkFileAccess(ctx.workspaceRoot, args.path, ctx.getConfig().security.allowSecretFileAccess);
      const absolute = path.join(ctx.workspaceRoot, relative);
      const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
      const matches = tabs.filter(
        (tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === absolute,
      );
      if (matches.length === 0) {
        return textResult({ file: relative, closed: false, reason: "not open" });
      }
      await vscode.window.tabGroups.close(matches);
      return textResult({ file: relative, closed: true });
    },
  }),
];
