import type { z } from "zod";
import type { CodeLinkConfig } from "../config/schema.js";
import type { CoreBridge } from "../core/bridge.js";
import type { PermissionKey } from "../security/permissions.js";
import type { SecurityPolicy } from "../security/policy.js";
import type { ActivityLog } from "../utils/activityLog.js";
import { CodeLinkError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";

/** Everything a tool handler needs, gathered in one place so tool modules
 * never import `vscode` extension-activation state directly. */
export interface ToolContext {
  workspaceRoot: string;
  workspaceName: string;
  bridge: CoreBridge;
  activityLog: ActivityLog;
  getConfig: () => CodeLinkConfig;
  logger: Logger;
}

export interface ToolContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  /** MCP's CallToolResult schema is a "loose" object (extra keys allowed);
   * this index signature exists purely so ToolResult stays structurally
   * assignable to it without importing the SDK's generated type here. */
  [key: string]: unknown;
}

export function textResult(value: unknown): ToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

export function errorResult(error: unknown): ToolResult {
  if (CodeLinkError.isCodeLinkError(error)) {
    return {
      content: [{ type: "text", text: JSON.stringify({ code: error.code, message: error.message }) }],
      isError: true,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: JSON.stringify({ code: "INTERNAL_ERROR", message }) }], isError: true };
}

/**
 * A tool as stored in the registry, with its Zod shape type-erased to
 * `z.ZodRawShape` so heterogeneous tools can live in one array. Always
 * created via `defineTool()`, which is where the erasure happens safely:
 * the same concrete `inputSchema` object is what both the SDK validates
 * incoming arguments against and what `handler` was written against, so
 * the erasure never actually lets a mismatched shape reach a handler.
 */
export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** Permission required to call this tool, or null if every profile may
   * call it (e.g. it only reads already-public metadata). */
  permission: PermissionKey | null;
  handler: (args: never, ctx: ToolContext) => Promise<ToolResult>;
}

export function defineTool<Shape extends z.ZodRawShape>(definition: {
  name: string;
  description: string;
  inputSchema: Shape;
  permission: PermissionKey | null;
  handler: (args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext) => Promise<ToolResult>;
}): RegisteredTool {
  return definition as unknown as RegisteredTool;
}

/**
 * Wraps a registered tool's handler with the tool-scoped stages of the
 * execution pipeline (docs/mcp.md): permission check, then a concurrency
 * slot for the duration of the call. Authentication and rate limiting
 * already happened once for the whole HTTP request in `mcp/server.ts`
 * before routing ever reached this tool.
 */
export function bindTool(tool: RegisteredTool, ctx: ToolContext, policy: SecurityPolicy) {
  return async (args: unknown, extra: { sessionId?: string }): Promise<ToolResult> => {
    const clientId = extra.sessionId ?? "local";
    const startedAt = Date.now();
    try {
      if (tool.permission) {
        policy.checkPermission(tool.permission);
      }
      const release = policy.acquireConcurrency(clientId);
      let result: ToolResult;
      try {
        result = await tool.handler(args as never, ctx);
      } finally {
        release();
      }
      ctx.activityLog.record({
        tool: tool.name,
        permission: tool.permission,
        outcome: result.isError ? "error" : "success",
        code: result.isError ? extractErrorCode(result) : undefined,
        clientId,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      ctx.logger.debug(`Tool '${tool.name}' failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      const code = CodeLinkError.isCodeLinkError(error) ? error.code : undefined;
      ctx.activityLog.record({
        tool: tool.name,
        permission: tool.permission,
        outcome: code?.endsWith("_DISABLED") || code === "PERMISSION_DENIED" ? "denied" : "error",
        code,
        clientId,
        durationMs: Date.now() - startedAt,
      });
      return errorResult(error);
    }
  };
}

function extractErrorCode(result: ToolResult): string | undefined {
  const text = result.content[0]?.text;
  if (!text) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as { code?: string };
    return parsed.code;
  } catch {
    return undefined;
  }
}
