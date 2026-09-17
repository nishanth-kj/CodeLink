import * as vscode from "vscode";
import type { CodeLinkConfig, LogLevel, SecurityProfile } from "./schema.js";
import { DEFAULT_CONFIG } from "./defaults.js";

const SECTION = "codelink";

function read<T>(config: vscode.WorkspaceConfiguration, key: string, fallback: T): T {
  return config.get<T>(key, fallback);
}

/** Reads the live VS Code configuration into a fully-typed, defaulted `CodeLinkConfig`. */
export function loadConfig(): CodeLinkConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    server: {
      enabled: read(c, "server.enabled", DEFAULT_CONFIG.server.enabled),
      host: read(c, "server.host", DEFAULT_CONFIG.server.host),
      port: read(c, "server.port", DEFAULT_CONFIG.server.port),
      transport: "streamable-http",
    },
    security: {
      profile: read<SecurityProfile>(c, "security.profile", DEFAULT_CONFIG.security.profile),
      requireAuth: read(c, "security.requireAuth", DEFAULT_CONFIG.security.requireAuth),
      allowFileWrite: read(c, "security.allowFileWrite", DEFAULT_CONFIG.security.allowFileWrite),
      allowFileDelete: read(c, "security.allowFileDelete", DEFAULT_CONFIG.security.allowFileDelete),
      allowEditorWrite: read(c, "security.allowEditorWrite", DEFAULT_CONFIG.security.allowEditorWrite),
      allowTerminal: read(c, "security.allowTerminal", DEFAULT_CONFIG.security.allowTerminal),
      allowGitWrite: read(c, "security.allowGitWrite", DEFAULT_CONFIG.security.allowGitWrite),
      allowSecretFileAccess: read(
        c,
        "security.allowSecretFileAccess",
        DEFAULT_CONFIG.security.allowSecretFileAccess,
      ),
    },
    remote: {
      enabled: read(c, "remote.enabled", DEFAULT_CONFIG.remote.enabled),
    },
    files: {
      excludePatterns: read(c, "files.excludePatterns", DEFAULT_CONFIG.files.excludePatterns),
      maxReadBytes: read(c, "files.maxReadBytes", DEFAULT_CONFIG.files.maxReadBytes),
      maxWriteBytes: read(c, "files.maxWriteBytes", DEFAULT_CONFIG.files.maxWriteBytes),
    },
    search: {
      maxResults: read(c, "search.maxResults", DEFAULT_CONFIG.search.maxResults),
      maxFileSize: read(c, "search.maxFileSize", DEFAULT_CONFIG.search.maxFileSize),
      timeoutMs: read(c, "search.timeoutMs", DEFAULT_CONFIG.search.timeoutMs),
    },
    terminal: {
      timeoutMs: read(c, "terminal.timeoutMs", DEFAULT_CONFIG.terminal.timeoutMs),
      maxOutputBytes: read(c, "terminal.maxOutputBytes", DEFAULT_CONFIG.terminal.maxOutputBytes),
    },
    rateLimit: {
      requestsPerMinute: read(c, "rateLimit.requestsPerMinute", DEFAULT_CONFIG.rateLimit.requestsPerMinute),
      maxConcurrentRequests: read(
        c,
        "rateLimit.maxConcurrentRequests",
        DEFAULT_CONFIG.rateLimit.maxConcurrentRequests,
      ),
    },
    logging: {
      level: read<LogLevel>(c, "logging.level", DEFAULT_CONFIG.logging.level),
    },
    tunnel: {
      cloudflaredPath: read(c, "tunnel.cloudflaredPath", DEFAULT_CONFIG.tunnel.cloudflaredPath),
    },
  };
}

export function onConfigChanged(listener: (event: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(SECTION)) {
      listener(event);
    }
  });
}
