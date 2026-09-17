import * as os from "node:os";
import * as vscode from "vscode";
import { z } from "zod";
import { checkFileAccess } from "../security/policy.js";
import { defineTool, textResult } from "./index.js";

function activeEditorSummary() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }
  return {
    file: vscode.workspace.asRelativePath(editor.document.uri, false),
    languageId: editor.document.languageId,
    line: editor.selection.active.line + 1,
    column: editor.selection.active.character + 1,
  };
}

export const workspaceTools = [
  defineTool({
    name: "workspace_info",
    description:
      "Get information about the current workspace: its name, root path, configured folders, the host operating system, and the active editor. Does not expose environment variables.",
    inputSchema: {},
    permission: "workspaceRead",
    handler: async (_args, ctx) => {
      return textResult({
        name: ctx.workspaceName,
        path: ctx.workspaceRoot,
        folders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
          name: folder.name,
          path: folder.uri.fsPath,
        })),
        platform: os.platform(),
        activeEditor: activeEditorSummary(),
      });
    },
  }),

  defineTool({
    name: "workspace_folders",
    description: "List the workspace folders configured for this VS Code window.",
    inputSchema: {},
    permission: "workspaceRead",
    handler: async () => {
      const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
        name: folder.name,
        path: folder.uri.fsPath,
      }));
      return textResult(folders);
    },
  }),

  defineTool({
    name: "workspace_files",
    description:
      "List files and directories across the workspace, honoring the configured exclude patterns (.git, node_modules, build output, .env files, etc).",
    inputSchema: {
      path: z.string().optional().describe("Workspace-relative directory to list. Defaults to the workspace root."),
      glob: z.string().optional().describe("Glob pattern relative paths must match, e.g. '**/*.ts'."),
      maxDepth: z.number().int().min(0).optional().describe("Maximum recursion depth."),
      limit: z.number().int().min(1).max(5000).optional().describe("Maximum number of entries to return."),
    },
    permission: "workspaceRead",
    handler: async (args, ctx) => {
      const config = ctx.getConfig();
      const relative = args.path
        ? checkFileAccess(ctx.workspaceRoot, args.path, config.security.allowSecretFileAccess)
        : ".";
      const result = await ctx.bridge.call("filesystem.list", {
        root: ctx.workspaceRoot,
        path: relative,
        glob: args.glob,
        maxDepth: args.maxDepth,
        limit: args.limit,
        exclude: config.files.excludePatterns,
      });
      return textResult(result);
    },
  }),

  defineTool({
    name: "workspace_search",
    description: "Search file contents across the workspace for a literal string or regular expression.",
    inputSchema: {
      query: z.string().min(1).describe("Text or regular expression to search for."),
      path: z.string().optional().describe("Workspace-relative directory to restrict the search to."),
      filePattern: z.string().optional().describe("Glob restricting which files are searched, e.g. '**/*.ts'."),
      caseSensitive: z.boolean().optional().default(false),
      isRegex: z.boolean().optional().default(false),
      maxResults: z.number().int().min(1).max(1000).optional(),
    },
    permission: "workspaceSearch",
    handler: async (args, ctx) => {
      const config = ctx.getConfig();
      const relativePath = args.path
        ? checkFileAccess(ctx.workspaceRoot, args.path, config.security.allowSecretFileAccess)
        : undefined;
      const result = await ctx.bridge.call(
        "search.text",
        {
          root: ctx.workspaceRoot,
          query: args.query,
          path: relativePath,
          filePattern: args.filePattern,
          caseSensitive: args.caseSensitive,
          isRegex: args.isRegex,
          maxResults: args.maxResults ?? config.search.maxResults,
          maxFileSize: config.search.maxFileSize,
          timeoutMs: config.search.timeoutMs,
          exclude: config.files.excludePatterns,
        },
        config.search.timeoutMs + 2000,
      );
      return textResult(result);
    },
  }),
];
