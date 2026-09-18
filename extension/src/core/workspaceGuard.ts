import * as fs from "node:fs";
import * as path from "node:path";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Enforces that every filesystem path the local core touches resolves to a
 * location inside the workspace root, even across symlinks, `..` segments,
 * absolute paths, or paths that do not exist yet (e.g. a file about to be
 * created). This is the last line of defense before any `fs` call; the
 * request-entry layer (`security/pathValidator.ts`) performs the same class
 * of check earlier for defense in depth, but this guard never trusts its
 * caller blindly either, since it does the one check pathValidator cannot:
 * resolving symlinks against the real filesystem.
 */
export class WorkspaceGuard {
  private constructor(private readonly rootPath: string) {}

  static async create(root: string): Promise<WorkspaceGuard> {
    if (!(await pathExists(root))) {
      throw new CodeLinkError(ErrorCodes.INVALID_ARGUMENT, `Workspace root does not exist: ${root}`);
    }
    const canonical = await fs.promises.realpath(root);
    return new WorkspaceGuard(canonical);
  }

  root(): string {
    return this.rootPath;
  }

  /**
   * Resolves a client-supplied path (relative or absolute) against the
   * workspace root, returning the real, symlink-resolved absolute path.
   * Throws `PATH_OUTSIDE_WORKSPACE` if the result would escape the root.
   */
  async resolve(requested: string): Promise<string> {
    if (requested.includes("\0")) {
      throw new CodeLinkError(ErrorCodes.INVALID_ARGUMENT, "Path contains a null byte");
    }
    if (requested.trim().length === 0) {
      return this.rootPath;
    }

    const combined = path.isAbsolute(requested) ? requested : path.join(this.rootPath, requested);
    const normalized = path.normalize(combined);
    if (!this.isInsideRoot(normalized)) {
      throw new CodeLinkError(ErrorCodes.PATH_OUTSIDE_WORKSPACE, `The requested path is outside the workspace: ${requested}`);
    }

    const realPath = await this.resolveThroughSymlinks(normalized, requested);
    if (!this.isInsideRoot(realPath)) {
      throw new CodeLinkError(ErrorCodes.PATH_OUTSIDE_WORKSPACE, `The requested path is outside the workspace: ${requested}`);
    }
    return realPath;
  }

  /**
   * Walks up from `normalized` to the longest existing ancestor,
   * canonicalizes that ancestor (resolving any symlinks), then reattaches
   * the not-yet-existing suffix. This blocks a symlink inside the workspace
   * from redirecting reads or writes outside it.
   */
  private async resolveThroughSymlinks(normalized: string, original: string): Promise<string> {
    let existing = normalized;
    const suffix: string[] = [];

    while (!(await pathExists(existing))) {
      const parent = path.dirname(existing);
      if (parent === existing) {
        break;
      }
      suffix.push(path.basename(existing));
      existing = parent;
      if (!this.isInsideRoot(existing)) {
        throw new CodeLinkError(ErrorCodes.PATH_OUTSIDE_WORKSPACE, `The requested path is outside the workspace: ${original}`);
      }
    }

    const canonicalExisting = (await pathExists(existing)) ? await fs.promises.realpath(existing) : existing;
    let realPath = canonicalExisting;
    for (const part of suffix.reverse()) {
      realPath = path.join(realPath, part);
    }
    return realPath;
  }

  private isInsideRoot(candidate: string): boolean {
    return candidate === this.rootPath || candidate.startsWith(this.rootPath + path.sep);
  }

  /** Converts an absolute, already-resolved path back into a
   * forward-slashed, workspace-relative display path for MCP responses. */
  toRelativeDisplay(absolute: string): string {
    const relative = absolute.startsWith(this.rootPath) ? path.relative(this.rootPath, absolute) : absolute;
    const display = relative.split(path.sep).join("/");
    return display.length === 0 ? "." : display;
  }

  /** Refuses deletion of the workspace root itself. */
  guardAgainstRootDeletion(target: string): void {
    if (target === this.rootPath) {
      throw new CodeLinkError(ErrorCodes.INVALID_ARGUMENT, "Refusing to delete the workspace root");
    }
  }
}
