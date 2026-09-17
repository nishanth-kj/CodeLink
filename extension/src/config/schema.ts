export type SecurityProfile = "readonly" | "developer" | "trusted" | "custom";
export type LogLevel = "error" | "warn" | "info" | "debug";

export interface CodeLinkConfig {
  server: {
    enabled: boolean;
    host: string;
    port: number;
    transport: "streamable-http";
  };
  security: {
    profile: SecurityProfile;
    requireAuth: boolean;
    allowFileWrite: boolean;
    allowFileDelete: boolean;
    allowEditorWrite: boolean;
    allowTerminal: boolean;
    allowGitWrite: boolean;
    allowSecretFileAccess: boolean;
  };
  remote: {
    enabled: boolean;
  };
  files: {
    excludePatterns: string[];
    maxReadBytes: number;
    maxWriteBytes: number;
  };
  search: {
    maxResults: number;
    maxFileSize: number;
    timeoutMs: number;
  };
  terminal: {
    timeoutMs: number;
    maxOutputBytes: number;
  };
  rateLimit: {
    requestsPerMinute: number;
    maxConcurrentRequests: number;
  };
  logging: {
    level: LogLevel;
  };
  tunnel: {
    cloudflaredPath: string;
  };
}
