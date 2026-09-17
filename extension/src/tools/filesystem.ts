import { z } from "zod";
import { checkFileAccess } from "../security/policy.js";
import { defineTool, textResult } from "./index.js";

export const filesystemTools = [
  defineTool({
    name: "file_read",
    description: "Read a file's contents as UTF-8 text (or base64 if the file is not valid UTF-8).",
    inputSchema: {
      path: z.string().describe("Workspace-relative file path."),
      maxBytes: z.number().int().min(1).optional().describe("Override the configured maximum read size."),
    },
    permission: "workspaceRead",
    handler: async (args, ctx) => {
      const config = ctx.getConfig();
      const relative = checkFileAccess(ctx.workspaceRoot, args.path, config.security.allowSecretFileAccess);
      const result = await ctx.bridge.call("filesystem.read", {
        root: ctx.workspaceRoot,
        path: relative,
        maxBytes: args.maxBytes ?? config.files.maxReadBytes,
      });
      return textResult(result);
    },
  }),

  defineTool({
    name: "file_write",
    description: "Overwrite (or create) a file with the given text content. Disabled unless file write access is enabled.",
    inputSchema: {
      path: z.string().describe("Workspace-relative file path."),
      content: z.string().describe("New file content."),
      createParents: z.boolean().optional().default(true).describe("Create missing parent directories."),
    },
    permission: "fileWrite",
    handler: async (args, ctx) => {
      const config = ctx.getConfig();
      const relative = checkFileAccess(ctx.workspaceRoot, args.path, config.security.allowSecretFileAccess);
      const result = await ctx.bridge.call("filesystem.write", {
        root: ctx.workspaceRoot,
        path: relative,
        content: args.content,
        maxBytes: config.files.maxWriteBytes,
        createParents: args.createParents,
      });
      return textResult(result);
    },
  }),

  defineTool({
    name: "file_create",
    description: "Create a new file with the given content. Fails if the file already exists.",
    inputSchema: {
      path: z.string().describe("Workspace-relative file path."),
      content: z.string().optional().default("").describe("Initial file content."),
    },
    permission: "fileWrite",
    handler: async (args, ctx) => {
      const config = ctx.getConfig();
      const relative = checkFileAccess(ctx.workspaceRoot, args.path, config.security.allowSecretFileAccess);
      const result = await ctx.bridge.call("filesystem.write", {
        root: ctx.workspaceRoot,
        path: relative,
        content: args.content,
        maxBytes: config.files.maxWriteBytes,
        mustNotExist: true,
        createParents: true,
      });
      return textResult(result);
    },
  }),

  defineTool({
    name: "file_delete",
    description: "Delete a file or directory. Disabled unless the active security profile allows file deletion.",
    inputSchema: {
      path: z.string().describe("Workspace-relative path to delete."),
      recursive: z.boolean().optional().default(false).describe("Required to delete a non-empty directory."),
    },
    permission: "fileDelete",
    handler: async (args, ctx) => {
      const config = ctx.getConfig();
      const relative = checkFileAccess(ctx.workspaceRoot, args.path, config.security.allowSecretFileAccess);
      const result = await ctx.bridge.call("filesystem.delete", {
        root: ctx.workspaceRoot,
        path: relative,
        recursive: args.recursive,
      });
      return textResult(result);
    },
  }),

  defineTool({
    name: "file_move",
    description: "Move or rename a file or directory within the workspace.",
    inputSchema: {
      from: z.string().describe("Workspace-relative source path."),
      to: z.string().describe("Workspace-relative destination path."),
      overwrite: z.boolean().optional().default(false),
    },
    permission: "fileWrite",
    handler: async (args, ctx) => {
      const config = ctx.getConfig();
      const from = checkFileAccess(ctx.workspaceRoot, args.from, config.security.allowSecretFileAccess);
      const to = checkFileAccess(ctx.workspaceRoot, args.to, config.security.allowSecretFileAccess);
      const result = await ctx.bridge.call("filesystem.move", {
        root: ctx.workspaceRoot,
        from,
        to,
        overwrite: args.overwrite,
      });
      return textResult(result);
    },
  }),

  defineTool({
    name: "file_copy",
    description: "Copy a file or directory within the workspace.",
    inputSchema: {
      from: z.string().describe("Workspace-relative source path."),
      to: z.string().describe("Workspace-relative destination path."),
      overwrite: z.boolean().optional().default(false),
    },
    permission: "fileWrite",
    handler: async (args, ctx) => {
      const config = ctx.getConfig();
      const from = checkFileAccess(ctx.workspaceRoot, args.from, config.security.allowSecretFileAccess);
      const to = checkFileAccess(ctx.workspaceRoot, args.to, config.security.allowSecretFileAccess);
      const result = await ctx.bridge.call("filesystem.copy", {
        root: ctx.workspaceRoot,
        from,
        to,
        overwrite: args.overwrite,
      });
      return textResult(result);
    },
  }),

  defineTool({
    name: "file_list",
    description: "List the contents of a directory, optionally recursing with maxDepth.",
    inputSchema: {
      path: z.string().optional().describe("Workspace-relative directory. Defaults to the workspace root."),
      maxDepth: z.number().int().min(0).optional().default(1),
      limit: z.number().int().min(1).max(5000).optional(),
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
        maxDepth: args.maxDepth,
        limit: args.limit,
        exclude: config.files.excludePatterns,
      });
      return textResult(result);
    },
  }),

  defineTool({
    name: "file_exists",
    description: "Check whether a file or directory exists in the workspace.",
    inputSchema: { path: z.string().describe("Workspace-relative path.") },
    permission: "workspaceRead",
    handler: async (args, ctx) => {
      const config = ctx.getConfig();
      const relative = checkFileAccess(ctx.workspaceRoot, args.path, config.security.allowSecretFileAccess);
      const result = await ctx.bridge.call("filesystem.exists", { root: ctx.workspaceRoot, path: relative });
      return textResult(result);
    },
  }),
];
