import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkFileAccess } from "../security/policy.js";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import { defineTool, textResult } from "./index.js";

interface TerminalSession {
  id: string;
  cwd: string;
}

/** In-memory only: a terminal session is just a remembered working
 * directory grouping process runs together for the MCP client's
 * convenience. The actual process lifecycle is tracked by the local core
 * (see extension/src/core/process.ts), keyed by its own process id. */
const sessions = new Map<string, TerminalSession>();

export const terminalTools = [
  defineTool({
    name: "terminal_create",
    description:
      "Create a terminal session bound to a working directory within the workspace. Disabled unless terminal access is enabled.",
    inputSchema: {
      cwd: z.string().optional().describe("Workspace-relative working directory. Defaults to the workspace root."),
    },
    permission: "terminal",
    handler: async (args, ctx) => {
      const relative = args.cwd
        ? checkFileAccess(ctx.workspaceRoot, args.cwd, ctx.getConfig().security.allowSecretFileAccess)
        : ".";
      const id = randomUUID();
      sessions.set(id, { id, cwd: relative });
      return textResult({ terminalId: id, cwd: relative });
    },
  }),

  defineTool({
    name: "terminal_run",
    description:
      "Run a command in a terminal session. Returns immediately with a process id; poll terminal_output for results. The child process environment is filtered to remove credential-like variables.",
    inputSchema: {
      terminalId: z.string().describe("Session id returned by terminal_create."),
      command: z.string().min(1).describe("Executable to run."),
      args: z.array(z.string()).optional().default([]),
    },
    permission: "terminal",
    handler: async (args, ctx) => {
      const session = sessions.get(args.terminalId);
      if (!session) {
        throw new CodeLinkError(ErrorCodes.INVALID_ARGUMENT, `Unknown terminal id: ${args.terminalId}`);
      }
      const config = ctx.getConfig();
      const result = await ctx.bridge.call(
        "process.spawn",
        {
          root: ctx.workspaceRoot,
          command: args.command,
          args: args.args,
          cwd: session.cwd,
          timeoutMs: config.terminal.timeoutMs,
          maxOutputBytes: config.terminal.maxOutputBytes,
        },
        config.terminal.timeoutMs + 5000,
      );
      return textResult(result);
    },
  }),

  defineTool({
    name: "terminal_output",
    description: "Get the accumulated output and status of a running or finished process.",
    inputSchema: { processId: z.string().describe("Process id returned by terminal_run.") },
    permission: "terminal",
    handler: async (args, ctx) => {
      const result = await ctx.bridge.call("process.output", { id: args.processId });
      return textResult(result);
    },
  }),

  defineTool({
    name: "terminal_kill",
    description: "Terminate a running process.",
    inputSchema: { processId: z.string().describe("Process id returned by terminal_run.") },
    permission: "terminal",
    handler: async (args, ctx) => {
      const result = await ctx.bridge.call("process.kill", { id: args.processId });
      return textResult(result);
    },
  }),

  defineTool({
    name: "terminal_list",
    description: "List all tracked processes started via terminal_run, running or finished.",
    inputSchema: {},
    permission: "terminal",
    handler: async (_args, ctx) => {
      const result = await ctx.bridge.call("process.list", {});
      return textResult(result);
    },
  }),
];
