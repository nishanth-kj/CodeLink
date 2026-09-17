import type { CodeLinkConfig } from "./schema.js";

/**
 * Mirrors the defaults declared in `package.json` under
 * `contributes.configuration`. Kept in code so unit tests and any code path
 * that runs outside the VS Code configuration system (e.g. tests) can
 * construct a valid, safe-by-default config without touching `vscode`.
 */
export const DEFAULT_CONFIG: CodeLinkConfig = {
  server: {
    enabled: false,
    host: "127.0.0.1",
    port: 32100,
    transport: "streamable-http",
  },
  security: {
    profile: "developer",
    allowFileWrite: true,
    allowFileDelete: false,
    allowEditorWrite: true,
    allowTerminal: false,
    allowGitWrite: false,
    allowSecretFileAccess: false,
  },
  remote: {
    enabled: false,
  },
  files: {
    excludePatterns: [
      "**/.git/**",
      "**/node_modules/**",
      "**/target/**",
      "**/dist/**",
      "**/build/**",
      "**/.env",
      "**/.env.*",
    ],
    maxReadBytes: 10 * 1024 * 1024,
    maxWriteBytes: 10 * 1024 * 1024,
  },
  search: {
    maxResults: 100,
    maxFileSize: 10 * 1024 * 1024,
    timeoutMs: 5000,
  },
  terminal: {
    timeoutMs: 30000,
    maxOutputBytes: 1024 * 1024,
  },
  rateLimit: {
    requestsPerMinute: 120,
    maxConcurrentRequests: 8,
  },
  logging: {
    level: "info",
  },
  tunnel: {
    cloudflaredPath: "",
  },
};

/** Always-on invariant: CodeLink never binds to a non-loopback host unless
 * remote access has been explicitly enabled, regardless of what a user (or a
 * misconfigured settings.json) puts in `codelink.server.host`. */
export function effectiveHost(config: CodeLinkConfig): string {
  return config.remote.enabled ? config.server.host : "127.0.0.1";
}
