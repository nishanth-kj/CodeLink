import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import type { Cancellation } from "./cancellation.js";
import * as filesystem from "./filesystem.js";
import * as git from "./git.js";
import * as process_ from "./process.js";
import * as search from "./search.js";
import * as watcher from "./watcher.js";
import type { FileChangeEvent } from "./watcher.js";

export interface DispatchDeps {
  cancellation: Cancellation;
  onFileChanged: (event: FileChangeEvent) => void;
  extensionVersion: string;
}

/** Routes a call to the appropriate local-core module. This is the
 * TypeScript equivalent of `core/src/lib.rs`'s `dispatch()`: the only place
 * method names are mapped to handlers, keeping the full surface of what a
 * tool can ask the local core to do visible in one place. */
export async function dispatch(method: string, params: unknown, requestId: string, deps: DispatchDeps): Promise<unknown> {
  const p = params as never;

  switch (method) {
    case "system.ping":
      return { pong: true, version: deps.extensionVersion };
    case "system.cancel":
      return { cancelled: deps.cancellation.cancel((params as { id: string }).id) };

    case "filesystem.read":
      return filesystem.read(p);
    case "filesystem.write":
      return filesystem.write(p);
    case "filesystem.delete":
      return filesystem.deleteEntry(p);
    case "filesystem.move":
      return filesystem.movePath(p);
    case "filesystem.copy":
      return filesystem.copyPath(p);
    case "filesystem.list":
      return filesystem.list(p);
    case "filesystem.exists":
      return filesystem.exists(p);

    case "search.text":
      return search.text(p, requestId, deps.cancellation);

    case "process.spawn":
      return process_.spawnProcess(p);
    case "process.output":
      return process_.output(p);
    case "process.kill":
      return process_.kill(p);
    case "process.list":
      return process_.list();

    case "git.status":
      return git.status(p);
    case "git.diff":
      return git.diff(p);
    case "git.log":
      return git.log(p);
    case "git.branches":
      return git.branches(p);
    case "git.show":
      return git.show(p);
    case "git.remote":
      return git.remote(p);

    case "watcher.start":
      return watcher.start(p, deps.onFileChanged);
    case "watcher.stop":
      return watcher.stop(p);

    default:
      throw new CodeLinkError(ErrorCodes.METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}
