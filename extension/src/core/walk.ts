import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkspaceGuard } from "./workspaceGuard.js";

export interface WalkEntry {
  absolutePath: string;
  relativeDisplay: string;
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  stat: fs.Stats;
}

export interface WalkOptions {
  /** Depth of the start directory's direct children is 1; undefined means unlimited. */
  maxDepth?: number;
  /** Given the display path (a directory's is probed as `"<path>/probe"`,
   * matching how the Rust walker pruned excluded directories from descent
   * rather than merely filtering them from the output), returns whether the
   * entry should be skipped entirely (and, for directories, not descended into). */
  isExcluded?: (probePath: string) => boolean;
}

/**
 * Recursively walks a directory tree, yielding every descendant entry
 * (files and directories, pre-order). Symlinks are reported as leaf entries
 * (never traversed into), which both matches the default, safer traversal
 * behavior and avoids symlink-cycle infinite loops.
 */
export async function* walk(guard: WorkspaceGuard, start: string, options: WalkOptions = {}): AsyncGenerator<WalkEntry> {
  yield* walkDir(guard, start, 1, options);
}

async function* walkDir(guard: WorkspaceGuard, absoluteDir: string, depth: number, options: WalkOptions): AsyncGenerator<WalkEntry> {
  let dirents: fs.Dirent[];
  try {
    dirents = await fs.promises.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }
  dirents.sort((a, b) => a.name.localeCompare(b.name));

  for (const dirent of dirents) {
    const absolutePath = path.join(absoluteDir, dirent.name);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(absolutePath);
    } catch {
      continue;
    }
    const isSymlink = stat.isSymbolicLink();
    const isDir = !isSymlink && stat.isDirectory();
    const relativeDisplay = guard.toRelativeDisplay(absolutePath);
    const probePath = isDir ? `${relativeDisplay}/probe` : relativeDisplay;

    if (options.isExcluded?.(probePath)) {
      continue;
    }

    yield { absolutePath, relativeDisplay, name: dirent.name, isDir, isSymlink, stat };

    if (isDir && (options.maxDepth === undefined || depth < options.maxDepth)) {
      yield* walkDir(guard, absolutePath, depth + 1, options);
    }
  }
}
