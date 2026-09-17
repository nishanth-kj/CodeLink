import * as vscode from "vscode";
import { z } from "zod";
import { defineTool, textResult } from "./index.js";

export const searchTools = [
  defineTool({
    name: "file_search",
    description: "Find files by name or glob pattern across the workspace.",
    inputSchema: {
      pattern: z.string().min(1).describe("Glob pattern to match workspace-relative paths, e.g. '**/*.test.ts'."),
      limit: z.number().int().min(1).max(5000).optional(),
    },
    permission: "workspaceSearch",
    handler: async (args, ctx) => {
      const config = ctx.getConfig();
      const result = await ctx.bridge.call("filesystem.list", {
        root: ctx.workspaceRoot,
        path: ".",
        glob: args.pattern,
        limit: args.limit ?? config.search.maxResults,
        exclude: config.files.excludePatterns,
      });
      return textResult(result);
    },
  }),

  defineTool({
    name: "symbol_search",
    description:
      "Search for symbols (functions, classes, variables, etc.) across the workspace by name, using VS Code's language services.",
    inputSchema: {
      query: z.string().min(1).describe("Symbol name or fragment to search for."),
    },
    permission: "workspaceSearch",
    handler: async (args) => {
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[] | undefined>(
        "vscode.executeWorkspaceSymbolProvider",
        args.query,
      );
      const items = (symbols ?? []).map((symbol) => ({
        name: symbol.name,
        kind: vscode.SymbolKind[symbol.kind],
        containerName: symbol.containerName || null,
        file: vscode.workspace.asRelativePath(symbol.location.uri, false),
        range: {
          startLine: symbol.location.range.start.line + 1,
          startColumn: symbol.location.range.start.character + 1,
          endLine: symbol.location.range.end.line + 1,
          endColumn: symbol.location.range.end.character + 1,
        },
      }));
      return textResult(items);
    },
  }),
];
