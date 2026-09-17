import type { CodeLinkConfig } from "../config/schema.js";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import { CloudflareTunnel } from "./cloudflare.js";

const TUNNEL_URL_TIMEOUT_MS = 20_000;

function resolveCloudflaredPath(configuredPath: string): string {
  if (configuredPath.trim().length > 0) {
    return configuredPath;
  }
  return process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

/**
 * The tunnel is never started automatically and never bypasses CodeLink's
 * own authentication: `start()` refuses unless `codelink.remote.enabled`
 * is already true, so a user cannot accidentally expose the server to the
 * internet by starting a tunnel alone (see docs/remote-access.md — the
 * tunnel makes the server *reachable*, it does not make it *secure* on its
 * own).
 */
export class TunnelManager {
  private tunnel: CloudflareTunnel | undefined;
  private url: string | undefined;
  private readonly logger: Logger;

  constructor(
    private readonly getConfig: () => CodeLinkConfig,
    logger: Logger,
  ) {
    this.logger = logger.child("tunnel");
  }

  isRunning(): boolean {
    return this.tunnel?.isRunning() ?? false;
  }

  getUrl(): string | undefined {
    return this.url;
  }

  start(localPort: number): Promise<string> {
    const config = this.getConfig();
    if (!config.remote.enabled) {
      throw new CodeLinkError(
        ErrorCodes.REMOTE_ACCESS_DISABLED,
        "Enable remote access (CodeLink: Enable Remote Access) before starting a tunnel.",
      );
    }
    if (this.tunnel?.isRunning()) {
      throw new CodeLinkError(ErrorCodes.SERVER_START_FAILED, "The tunnel is already running.");
    }

    const binaryPath = resolveCloudflaredPath(config.tunnel.cloudflaredPath);
    const tunnel = new CloudflareTunnel(binaryPath, `http://127.0.0.1:${localPort}`);
    this.url = undefined;
    this.tunnel = tunnel;

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        tunnel.stop();
        reject(new CodeLinkError(ErrorCodes.SERVER_START_FAILED, "Timed out waiting for the Cloudflare tunnel URL."));
      }, TUNNEL_URL_TIMEOUT_MS);

      tunnel.on("url", (url) => {
        clearTimeout(timeout);
        this.url = url;
        this.logger.info("Cloudflare tunnel established", { url });
        resolve(url);
      });
      tunnel.on("error", (error) => {
        clearTimeout(timeout);
        this.tunnel = undefined;
        reject(
          new CodeLinkError(
            ErrorCodes.SERVER_START_FAILED,
            `Failed to start cloudflared: ${error.message}. Is cloudflared installed and on PATH?`,
          ),
        );
      });
      tunnel.on("exit", (code) => {
        this.logger.warn("Cloudflare tunnel exited", { code });
        this.tunnel = undefined;
        this.url = undefined;
      });

      tunnel.start();
    });
  }

  stop(): void {
    this.tunnel?.stop();
    this.tunnel = undefined;
    this.url = undefined;
  }
}
