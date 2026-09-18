import { randomUUID } from "node:crypto";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { Cancellation } from "./cancellation.js";
import { dispatch } from "./dispatch.js";
import type { FileChangeEvent } from "./watcher.js";

export interface CoreBridgeOptions {
  logger: Logger;
  defaultTimeoutMs?: number;
  extensionVersion?: string;
}

export type NotificationHandler = (method: string, params: unknown) => void;

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The local, in-process equivalent of the old Rust `codelink-core` IPC
 * bridge: same public shape (`start`/`stop`/`restart`/`isRunning`/`call`/
 * `onNotification`), so every filesystem/search/process/git tool still goes
 * through one `call(method, params)` chokepoint, but the method now runs as
 * a plain TypeScript function call instead of a message round-trip to a
 * child process. `start()`/`stop()` remain a real gate (calls made before
 * the first `start()` or after `stop()` are rejected) so a caller that
 * forgot to start it fails loudly rather than silently succeeding.
 */
export class CoreBridge {
  private running = false;
  private readonly cancellation = new Cancellation();
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private readonly logger: Logger;

  constructor(private readonly options: CoreBridgeOptions) {
    this.logger = options.logger.child("core-bridge");
  }

  start(): void {
    this.running = true;
    this.logger.info("Local core started");
  }

  async stop(): Promise<void> {
    this.running = false;
    this.logger.info("Local core stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    this.start();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Subscribes to core-originated notifications (currently only
   * `workspace.fileChanged` from the file watcher). Returns an unsubscribe
   * function. */
  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  async call<T = unknown>(
    method: string,
    params: unknown,
    timeoutMs: number = this.options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.running) {
      throw new CodeLinkError(ErrorCodes.SERVER_NOT_RUNNING, "The local core is not running");
    }

    const id = randomUUID();
    const dispatchPromise = dispatch(method, params, id, {
      cancellation: this.cancellation,
      onFileChanged: (event: FileChangeEvent) => this.emitNotification("workspace.fileChanged", event),
      extensionVersion: this.options.extensionVersion ?? "0.0.0",
    });
    // If the timeout below wins the race, this promise is orphaned; attach
    // a handler now so its eventual settlement never becomes an unhandled
    // rejection.
    dispatchPromise.catch(() => undefined);

    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.cancellation.cancel(id);
        reject(new CodeLinkError(ErrorCodes.REQUEST_TIMEOUT, `Timed out waiting for '${method}' to complete`));
      }, timeoutMs);
    });

    try {
      return (await Promise.race([dispatchPromise, timeoutPromise])) as T;
    } finally {
      clearTimeout(timer!);
    }
  }

  private emitNotification(method: string, params: unknown): void {
    for (const handler of this.notificationHandlers) {
      handler(method, params);
    }
  }
}
