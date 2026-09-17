import * as path from "node:path";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import { toPosixDisplay } from "../utils/paths.js";

/**
 * Fast, filesystem-free first line of defense against path traversal and
 * absolute-path escapes, run in TypeScript before a request ever reaches
 * the Rust core. This intentionally cannot detect a symlink that redirects
 * an in-workspace path to somewhere else on disk — only `WorkspaceGuard` in
 * `core/src/security.rs`, which does touch the filesystem, can do that. Both
 * checks run on every request: defense in depth, not duplication, since
 * they catch different classes of attack and Rust must never trust its
 * caller (even its own extension host) blindly.
 */
export function validateWorkspacePath(workspaceRoot: string, requested: string): string {
  if (requested.includes("\0")) {
    throw new CodeLinkError(ErrorCodes.INVALID_ARGUMENT, "Path contains a null byte");
  }

  const trimmed = requested.trim();
  if (trimmed.length === 0) {
    return ".";
  }

  const combined = path.isAbsolute(trimmed) ? trimmed : path.join(workspaceRoot, trimmed);
  const normalized = path.normalize(combined);
  const normalizedRoot = path.normalize(workspaceRoot);

  const isInside = normalized === normalizedRoot || normalized.startsWith(normalizedRoot + path.sep);
  if (!isInside) {
    throw new CodeLinkError(ErrorCodes.PATH_OUTSIDE_WORKSPACE, `The requested path is outside the workspace: ${requested}`);
  }

  const relative = path.relative(normalizedRoot, normalized);
  return relative.length === 0 ? "." : toPosixDisplay(relative);
}
