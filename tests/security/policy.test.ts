import { describe, expect, it } from "vitest";
import { checkFileAccess, SecurityPolicy } from "../../extension/src/security/policy.js";
import { PermissionManager } from "../../extension/src/security/permissions.js";
import { AuthenticationManager, InMemorySecretStore } from "../../extension/src/security/authentication.js";
import { RateLimiter } from "../../extension/src/security/rateLimiter.js";
import { DEFAULT_CONFIG } from "../../extension/src/config/defaults.js";
import type { CodeLinkConfig } from "../../extension/src/config/schema.js";
import { ConsoleSink, Logger } from "../../extension/src/utils/logger.js";
import { CodeLinkError } from "../../extension/src/utils/errors.js";

function buildPolicy(config: CodeLinkConfig) {
  const permissions = new PermissionManager(() => config);
  const authentication = new AuthenticationManager(new InMemorySecretStore());
  const rateLimiter = new RateLimiter(config.rateLimit.requestsPerMinute, config.rateLimit.maxConcurrentRequests);
  const logger = new Logger(new ConsoleSink());
  logger.setLevel("error");
  return { policy: new SecurityPolicy(permissions, authentication, rateLimiter, () => config, logger), authentication };
}

describe("SecurityPolicy.authorizeConnection", () => {
  it("allows local (non-remote) connections without a token", async () => {
    const { policy } = buildPolicy({ ...DEFAULT_CONFIG, remote: { enabled: false } });
    await expect(policy.authorizeConnection({ clientId: "local" })).resolves.toBeUndefined();
  });

  it("rejects remote connections with no token as AUTHENTICATION_REQUIRED", async () => {
    const { policy } = buildPolicy({ ...DEFAULT_CONFIG, remote: { enabled: true } });
    await expect(policy.authorizeConnection({ clientId: "remote" })).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("rejects remote connections with a wrong token as AUTHENTICATION_FAILED", async () => {
    const { policy, authentication } = buildPolicy({ ...DEFAULT_CONFIG, remote: { enabled: true } });
    await authentication.generateToken();
    await expect(policy.authorizeConnection({ clientId: "remote", bearerToken: "wrong" })).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
    });
  });

  it("allows a remote connection with a valid token", async () => {
    const { policy, authentication } = buildPolicy({ ...DEFAULT_CONFIG, remote: { enabled: true } });
    const token = await authentication.generateToken();
    await expect(policy.authorizeConnection({ clientId: "remote", bearerToken: token })).resolves.toBeUndefined();
  });

  it("enforces the rate limit only for remote connections", async () => {
    const config: CodeLinkConfig = {
      ...DEFAULT_CONFIG,
      remote: { enabled: true },
      rateLimit: { requestsPerMinute: 1, maxConcurrentRequests: 10 },
    };
    const { policy, authentication } = buildPolicy(config);
    const token = await authentication.generateToken();
    await policy.authorizeConnection({ clientId: "remote", bearerToken: token });
    await expect(policy.authorizeConnection({ clientId: "remote", bearerToken: token })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});

describe("SecurityPolicy.checkPermission", () => {
  it("throws the dedicated error code when a permission is denied", () => {
    const config: CodeLinkConfig = { ...DEFAULT_CONFIG, security: { ...DEFAULT_CONFIG.security, profile: "readonly" } };
    const { policy } = buildPolicy(config);
    expect(() => policy.checkPermission("fileWrite")).toThrow(CodeLinkError);
    try {
      policy.checkPermission("fileWrite");
    } catch (error) {
      expect((error as CodeLinkError).code).toBe("FILE_WRITE_DISABLED");
    }
  });

  it("does not throw when the permission is granted", () => {
    const { policy } = buildPolicy(DEFAULT_CONFIG);
    expect(() => policy.checkPermission("workspaceRead")).not.toThrow();
  });
});

describe("SecurityPolicy.acquireConcurrency", () => {
  it("is a no-op for local requests", () => {
    const { policy } = buildPolicy({ ...DEFAULT_CONFIG, remote: { enabled: false } });
    const release = policy.acquireConcurrency("local");
    expect(typeof release).toBe("function");
    expect(() => policy.acquireConcurrency("local")).not.toThrow();
    release();
  });

  it("enforces the concurrency cap for remote requests", () => {
    const config: CodeLinkConfig = {
      ...DEFAULT_CONFIG,
      remote: { enabled: true },
      rateLimit: { requestsPerMinute: 100, maxConcurrentRequests: 1 },
    };
    const { policy } = buildPolicy(config);
    const release = policy.acquireConcurrency("remote");
    expect(() => policy.acquireConcurrency("remote")).toThrow(CodeLinkError);
    release();
    expect(() => policy.acquireConcurrency("remote")).not.toThrow();
  });
});

describe("checkFileAccess", () => {
  const root = process.platform === "win32" ? "C:\\workspace\\project" : "/workspace/project";

  it("returns the relative display path for an ordinary file", () => {
    expect(checkFileAccess(root, "src/app.ts", false)).toBe("src/app.ts");
  });

  it("blocks a secret-looking path by default", () => {
    expect(() => checkFileAccess(root, ".env", false)).toThrow(CodeLinkError);
    try {
      checkFileAccess(root, ".env", false);
    } catch (error) {
      expect((error as CodeLinkError).code).toBe("SECRET_ACCESS_DENIED");
    }
  });

  it("allows a secret-looking path when explicitly enabled", () => {
    expect(checkFileAccess(root, ".env", true)).toBe(".env");
  });

  it("still rejects traversal outside the workspace", () => {
    expect(() => checkFileAccess(root, "../outside.txt", false)).toThrow(CodeLinkError);
  });
});
