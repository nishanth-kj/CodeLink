import { randomUUID } from "node:crypto";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { resolveCoreBinaryPath } from "../utils/platform.js";
import { CoreProcess } from "./process.js";
import { isIpcNotification, type IpcMessage } from "./protocol.js";

export interface RustBridgeOptions {
  extensionRoot: string;
  workspaceRoot: string;
  logger: Logger;
  defaultTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  method: string;
}

export type NotificationHandler = (method: string, params: unknown) => void;

const DEFAULT_TIMEOUT_MS = 15_000;
const CANCEL_TIMEOUT_MS = 2_000;

/**
 * The TypeScript half of the JSON IPC protocol: owns the `codelink-core`
 * child process, assigns request IDs, matches responses back to callers,
 * enforces per-request timeouts (attempting a best-effort cancellation of
 * the timed-out request in Rust), and fans out watcher notifications. Every
 * filesystem/search/process/git tool goes through `call()` rather than
 * touching the child process directly.
 */
export class RustBridge {
  private process: CoreProcess | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private readonly logger: Logger;

  constructor(private readonly options: RustBridgeOptions) {
    this.logger = options.logger.child("rust-bridge");
  }

  start(): void {
    if (this.process?.isRunning()) {
      return;
    }
    const binaryPath = resolveCoreBinaryPath(this.options.extensionRoot);
    if (!binaryPath) {
      throw new CodeLinkError(
        ErrorCodes.RUST_CORE_UNAVAILABLE,
        "codelink-core binary was not found. In development, run `cargo build --manifest-path core/Cargo.toml`; " +
          "a packaged extension should ship a prebuilt binary under bin/<platform>-<arch>/.",
      );
    }

    const proc = new CoreProcess(binaryPath, this.options.workspaceRoot);
    proc.on("message", (message) => this.handleMessage(message));
    proc.on("stderr", (line) => this.logger.debug(`core: ${line}`));
    proc.on("error", (error) => this.logger.error("codelink-core transport error", { message: error.message }));
    proc.on("exit", (code, signal) => {
      this.logger.warn("codelink-core exited", { code, signal });
      this.process = undefined;
      this.rejectAllPending(new CodeLinkError(ErrorCodes.RUST_CORE_CRASHED, "codelink-core process exited unexpectedly"));
    });

    proc.start();
    this.process = proc;
    this.logger.info("codelink-core started", { binaryPath });
  }

  stop(): void {
    this.process?.stop();
    this.process = undefined;
    this.rejectAllPending(new CodeLinkError(ErrorCodes.SERVER_NOT_RUNNING, "codelink-core was stopped"));
  }

  restart(): void {
    this.stop();
    this.start();
  }

  isRunning(): boolean {
    return this.process?.isRunning() ?? false;
  }

  /** Subscribes to Rust-originated notifications (currently only
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
    const proc = this.process;
    if (!proc?.isRunning()) {
      throw new CodeLinkError(ErrorCodes.RUST_CORE_UNAVAILABLE, "codelink-core is not running");
    }

    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.call("system.cancel", { id }, CANCEL_TIMEOUT_MS).catch(() => undefined);
        reject(new CodeLinkError(ErrorCodes.REQUEST_TIMEOUT, `Timed out waiting for '${method}' to complete`));
      }, timeoutMs);

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout, method });

      const sent = proc.send(JSON.stringify({ id, method, params }));
      if (!sent) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new CodeLinkError(ErrorCodes.RUST_CORE_UNAVAILABLE, "Failed to write request to codelink-core"));
      }
    });
  }

  private handleMessage(message: IpcMessage): void {
    if (isIpcNotification(message)) {
      for (const handler of this.notificationHandlers) {
        handler(message.method, message.params);
      }
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      this.logger.debug("Received response for an unknown or already-resolved request", { id: message.id });
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);

    if (message.success) {
      pending.resolve(message.result);
    } else {
      pending.reject(new CodeLinkError(message.error.code, message.error.message));
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
