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
    /** Listen on every IPv6 interface (`::`) so clients can reach the server
     * directly at `http://[<ipv6-address>]:<port>/mcp`. Only honoured while
     * `enabled` is true. */
    ipv6: boolean;
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
