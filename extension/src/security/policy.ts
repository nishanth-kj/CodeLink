import * as path from "node:path";
import type { CodeLinkConfig } from "../config/schema.js";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { validateWorkspacePath } from "./pathValidator.js";
import { isSecretPath } from "./secretFilter.js";
import type { AuthenticationManager } from "./authentication.js";
import type { PermissionKey, PermissionManager } from "./permissions.js";
import type { RateLimiter } from "./rateLimiter.js";

export interface ConnectionContext {
  clientId: string;
  bearerToken?: string;
}

/**
 * Runs the security checks from the tool execution pipeline (docs/mcp.md)
 * that do not depend on which tool is being called or what arguments it
 * received: authentication and rate limiting, both scoped to the whole
 * connection rather than a single tool call. Called once per incoming HTTP
 * request in `mcp/server.ts`, before the request is ever handed to the MCP
 * transport, so an unauthenticated or rate-limited request never reaches
 * tool-routing logic at all.
 */
export class SecurityPolicy {
  private requireAuthOverride: boolean | undefined = undefined;

  constructor(
    private readonly permissions: PermissionManager,
    private readonly authentication: AuthenticationManager,
    private readonly rateLimiter: RateLimiter,
    private readonly getConfig: () => CodeLinkConfig,
    private readonly logger: Logger,
  ) {}

  isAuthRequired(): boolean {
    if (this.requireAuthOverride !== undefined) {
      return this.requireAuthOverride;
    }
    const config = this.getConfig();
    if (!config.remote.enabled) {
      return false;
    }
    return config.security?.requireAuth ?? true;
  }

  setAuthRequired(required: boolean): void {
    this.requireAuthOverride = required;
  }

  toggleAuthRequired(): boolean {
    const next = !this.isAuthRequired();
    this.requireAuthOverride = next;
    return next;
  }

  async authorizeConnection(context: ConnectionContext): Promise<void> {
    if (!this.isAuthRequired()) {
      return;
    }

    const authenticated = await this.authentication.verify(context.bearerToken);
    if (!authenticated) {
      this.logger.warn("Rejected connection: authentication failed", { clientId: context.clientId });
      throw new CodeLinkError(
        context.bearerToken ? ErrorCodes.AUTHENTICATION_FAILED : ErrorCodes.AUTHENTICATION_REQUIRED,
        "A valid bearer token or OAuth authorization is required.",
      );
    }

    const rate = this.rateLimiter.checkAndConsume(context.clientId);
    if (!rate.allowed) {
      throw new CodeLinkError(ErrorCodes.RATE_LIMITED, `Rate limit exceeded; retry after ${rate.retryAfterMs}ms.`);
    }
  }

  /** Tool-specific permission check (Check Permission stage). Called from
   * inside each registered tool's handler, since only the tool registration
   * knows which permission it requires. */
  checkPermission(permission: PermissionKey): void {
    const result = this.permissions.check(permission);
    if (!result.allowed) {
      this.logger.warn("Rejected tool call: permission denied", { permission });
      throw new CodeLinkError(result.code, result.message);
    }
  }

  /** Acquires a concurrency slot for a tool call; a no-op when remote
   * access is disabled, since concurrency limiting exists to protect a
   * shared remote endpoint, not a single local developer session. */
  acquireConcurrency(clientId: string): () => void {
    const config = this.getConfig();
    if (!config.remote.enabled) {
      return () => undefined;
    }
    if (!this.rateLimiter.tryAcquireConcurrency(clientId)) {
      throw new CodeLinkError(ErrorCodes.RATE_LIMITED, "Too many concurrent requests.");
    }
    return () => this.rateLimiter.releaseConcurrency(clientId);
  }
}

/**
 * Validate-Workspace-Path + Secret/Safety-Checks stages of the pipeline.
 * Combines the filesystem-free traversal check with the secret-filename
 * check so every tool that touches a path (filesystem, editor, search,
 * git) applies both the same way, instead of re-implementing the
 * combination itself.
 */
export function checkFileAccess(workspaceRoot: string, requestedPath: string, allowSecretFileAccess: boolean): string {
  const relative = validateWorkspacePath(workspaceRoot, requestedPath);
  if (!allowSecretFileAccess && isSecretPath(relative)) {
    throw new CodeLinkError(
      ErrorCodes.SECRET_ACCESS_DENIED,
      `Access to '${relative}' is blocked because it looks like a secret file. ` +
        "Enable codelink.security.allowSecretFileAccess to override.",
    );
  }
  return relative;
}

/** Resolves a workspace-relative display path back to an absolute path on
 * disk, purely for cases (like passing a `cwd` to a spawned process) where
 * an absolute path is required locally. Never used for anything that
 * crosses the IPC boundary, since Rust always re-validates paths itself. */
export function toAbsolute(workspaceRoot: string, relativeDisplayPath: string): string {
  return path.join(workspaceRoot, relativeDisplayPath);
}
