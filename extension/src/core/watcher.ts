import * as fs from "node:fs";
import * as path from "node:path";
import { WorkspaceGuard } from "./workspaceGuard.js";

export type FileChangeKind = "created" | "modified" | "removed" | "other";

export interface FileChangeEvent {
  watchId: string;
  path: string;
  kind: FileChangeKind;
}

const watchers = new Map<string, fs.FSWatcher>();

function classify(eventType: string): FileChangeKind {
  if (eventType === "rename") {
    return "other";
  }
  if (eventType === "change") {
    return "modified";
  }
  return "other";
}

export interface StartParams {
  root: string;
  id?: string;
}

export async function start(params: StartParams, onChange: (event: FileChangeEvent) => void): Promise<{ watchId: string; status: "watching" }> {
  const guard = await WorkspaceGuard.create(params.root);
  const watchId = params.id ?? "default";
  const root = guard.root();

  const emit = (eventType: string, filename: string | Buffer | null) => {
    if (!filename) {
      return;
    }
    const relative = guard.toRelativeDisplay(path.join(root, filename.toString()));
    onChange({ watchId, path: relative, kind: classify(eventType) });
  };

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(root, { recursive: true }, emit);
  } catch {
    // Recursive watching is not supported on every platform; fall back to
    // a root-level watch rather than failing the request outright.
    watcher = fs.watch(root, {}, emit);
  }

  watchers.get(watchId)?.close();
  watchers.set(watchId, watcher);
  return { watchId, status: "watching" };
}

export interface StopParams {
  id?: string;
}

export function stop(params: StopParams): { watchId: string; stopped: boolean } {
  const watchId = params.id ?? "default";
  const watcher = watchers.get(watchId);
  if (watcher) {
    watcher.close();
    watchers.delete(watchId);
  }
  return { watchId, stopped: watcher !== undefined };
}
