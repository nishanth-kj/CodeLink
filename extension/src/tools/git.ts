import { z } from "zod";
import { checkFileAccess } from "../security/policy.js";
import { defineTool, textResult } from "./index.js";

/**
 * Read-only Git tools. Every one of these shells out, in Rust, to a fixed
 * `git` argv (see core/src/git.rs) — no tool here ever lets a client
 * supply a raw command string. Git *write* operations (commit, push,
 * reset, checkout, branch deletion, remote changes) are intentionally not
 * implemented; `codelink.security.allowGitWrite` exists for when they are
 * added later, and until then any attempt simply has no matching tool.
 */
export const gitTools = [
  defineTool({
    name: "git_status",
    description: "Get the working tree status: current branch, upstream tracking info, and changed files.",
    inputSchema: {},
    permission: "gitRead",
    handler: async (_args, ctx) => textResult(await ctx.bridge.call("git.status", { root: ctx.workspaceRoot })),
  }),

  defineTool({
    name: "git_diff",
    description: "Get the diff of unstaged (or staged) changes, optionally restricted to one file.",
    inputSchema: {
      path: z.string().optional().describe("Workspace-relative file path to restrict the diff to."),
      staged: z.boolean().optional().default(false).describe("Show staged changes instead of unstaged."),
    },
    permission: "gitRead",
    handler: async (args, ctx) => {
      const relative = args.path
        ? checkFileAccess(ctx.workspaceRoot, args.path, ctx.getConfig().security.allowSecretFileAccess)
        : undefined;
      return textResult(await ctx.bridge.call("git.diff", { root: ctx.workspaceRoot, path: relative, staged: args.staged }));
    },
  }),

  defineTool({
    name: "git_log",
    description: "Get recent commit history, optionally restricted to one file.",
    inputSchema: {
      maxCount: z.number().int().min(1).max(200).optional().default(20),
      path: z.string().optional().describe("Workspace-relative file path to restrict the log to."),
    },
    permission: "gitRead",
    handler: async (args, ctx) => {
      const relative = args.path
        ? checkFileAccess(ctx.workspaceRoot, args.path, ctx.getConfig().security.allowSecretFileAccess)
        : undefined;
      return textResult(
        await ctx.bridge.call("git.log", { root: ctx.workspaceRoot, maxCount: args.maxCount, path: relative }),
      );
    },
  }),

  defineTool({
    name: "git_branches",
    description: "List local and remote branches, marking the current branch and its upstream.",
    inputSchema: {},
    permission: "gitRead",
    handler: async (_args, ctx) => textResult(await ctx.bridge.call("git.branches", { root: ctx.workspaceRoot })),
  }),

  defineTool({
    name: "git_show",
    description: "Show a commit's details, or a file's content as of a specific revision.",
    inputSchema: {
      rev: z.string().min(1).describe("Commit-ish revision, e.g. 'HEAD', 'HEAD~1', or a commit hash."),
      path: z.string().optional().describe("Workspace-relative file path to show at that revision."),
    },
    permission: "gitRead",
    handler: async (args, ctx) => {
      const relative = args.path
        ? checkFileAccess(ctx.workspaceRoot, args.path, ctx.getConfig().security.allowSecretFileAccess)
        : undefined;
      return textResult(await ctx.bridge.call("git.show", { root: ctx.workspaceRoot, rev: args.rev, path: relative }));
    },
  }),

  defineTool({
    name: "git_remote",
    description: "List configured Git remotes and their URLs.",
    inputSchema: {},
    permission: "gitRead",
    handler: async (_args, ctx) => textResult(await ctx.bridge.call("git.remote", { root: ctx.workspaceRoot })),
  }),
];
