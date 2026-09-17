import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import * as readline from "node:readline";
import { MAX_MESSAGE_BYTES, type IpcMessage } from "./protocol.js";

/**
 * Owns a single `codelink-core` OS process: spawning it, reading
 * line-delimited JSON from its stdout, forwarding its stderr (human logs,
 * never protocol data), and writing outgoing request lines to its stdin.
 * Correlating requests with responses is `RustBridge`'s job, not this
 * class's; this class only knows about a single process's lifecycle.
 */
export declare interface CoreProcess {
  on(event: "message", listener: (message: IpcMessage) => void): this;
  on(event: "stderr", listener: (line: string) => void): this;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

export class CoreProcess extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | undefined;

  constructor(
    private readonly binaryPath: string,
    private readonly cwd: string,
  ) {
    super();
  }

  start(): void {
    if (this.child) {
      throw new Error("codelink-core is already running");
    }

    const child = spawn(this.binaryPath, [], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    readline.createInterface({ input: child.stdout }).on("line", (line) => this.handleStdoutLine(line));
    readline.createInterface({ input: child.stderr }).on("line", (line) => this.emit("stderr", line));

    child.on("error", (error) => this.emit("error", error));
    child.on("exit", (code, signal) => {
      this.child = undefined;
      this.emit("exit", code, signal);
    });
  }

  private handleStdoutLine(line: string): void {
    if (line.trim().length === 0) {
      return;
    }
    if (Buffer.byteLength(line, "utf8") > MAX_MESSAGE_BYTES) {
      this.emit("error", new Error("codelink-core sent a message exceeding the maximum size limit"));
      return;
    }
    try {
      this.emit("message", JSON.parse(line) as IpcMessage);
    } catch (error) {
      this.emit("error", new Error(`Failed to parse codelink-core message: ${(error as Error).message}`));
    }
  }

  /** Writes one protocol line to the child's stdin. Returns false if the
   * process is not currently writable (not started, or already exited). */
  send(line: string): boolean {
    if (!this.child || !this.child.stdin.writable) {
      return false;
    }
    return this.child.stdin.write(line + "\n");
  }

  isRunning(): boolean {
    return this.child !== undefined;
  }

  stop(): void {
    this.child?.kill();
  }
}
