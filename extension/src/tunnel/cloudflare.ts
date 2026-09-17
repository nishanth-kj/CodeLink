import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/**
 * Wraps `cloudflared tunnel --url <local>` (a "quick tunnel": no Cloudflare
 * account or DNS configuration required). cloudflared prints the generated
 * public URL to stdout or stderr depending on version, so both streams are
 * scanned for it. This class only manages the OS process; whether starting
 * one is *allowed* (remote access must already be enabled) is decided by
 * `TunnelManager`.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export declare interface CloudflareTunnel {
  on(event: "url", listener: (url: string) => void): this;
  on(event: "exit", listener: (code: number | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class CloudflareTunnel extends EventEmitter {
  private child: ChildProcess | undefined;

  constructor(
    private readonly binaryPath: string,
    private readonly localUrl: string,
  ) {
    super();
  }

  start(): void {
    if (this.child) {
      throw new Error("Tunnel is already running");
    }
    const child = spawn(this.binaryPath, ["tunnel", "--url", this.localUrl], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    const onData = (chunk: Buffer): void => {
      const match = TUNNEL_URL_PATTERN.exec(chunk.toString("utf8"));
      if (match) {
        this.emit("url", match[0]);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error) => this.emit("error", error));
    child.on("exit", (code) => {
      this.child = undefined;
      this.emit("exit", code);
    });
  }

  stop(): void {
    this.child?.kill();
  }

  isRunning(): boolean {
    return this.child !== undefined;
  }
}
