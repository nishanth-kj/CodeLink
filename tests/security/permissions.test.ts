import { describe, expect, it } from "vitest";
import { PermissionManager } from "../../extension/src/security/permissions.js";
import { DEFAULT_CONFIG } from "../../extension/src/config/defaults.js";
import type { CodeLinkConfig } from "../../extension/src/config/schema.js";

function configWith(overrides: Partial<CodeLinkConfig>): CodeLinkConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    security: { ...DEFAULT_CONFIG.security, ...overrides.security },
    remote: { ...DEFAULT_CONFIG.remote, ...overrides.remote },
  };
}

describe("PermissionManager", () => {
  it("readonly profile denies every write-capable permission", () => {
    const manager = new PermissionManager(() => configWith({ security: { ...DEFAULT_CONFIG.security, profile: "readonly" } }));
    expect(manager.check("workspaceRead").allowed).toBe(true);
    expect(manager.check("editorWrite").allowed).toBe(false);
    expect(manager.check("fileWrite").allowed).toBe(false);
    expect(manager.check("fileDelete").allowed).toBe(false);
    expect(manager.check("terminal").allowed).toBe(false);
    expect(manager.check("gitWrite").allowed).toBe(false);
  });

  it("developer profile allows editor/file write but not delete/terminal/git write", () => {
    const manager = new PermissionManager(() => configWith({ security: { ...DEFAULT_CONFIG.security, profile: "developer" } }));
    expect(manager.check("editorWrite").allowed).toBe(true);
    expect(manager.check("fileWrite").allowed).toBe(true);
    expect(manager.check("fileDelete").allowed).toBe(false);
    expect(manager.check("terminal").allowed).toBe(false);
    expect(manager.check("gitWrite").allowed).toBe(false);
  });

  it("trusted profile allows delete, terminal, and git write", () => {
    const manager = new PermissionManager(() => configWith({ security: { ...DEFAULT_CONFIG.security, profile: "trusted" } }));
    expect(manager.check("fileDelete").allowed).toBe(true);
    expect(manager.check("terminal").allowed).toBe(true);
    expect(manager.check("gitWrite").allowed).toBe(true);
  });

  it("custom profile reads individual allow* settings", () => {
    const manager = new PermissionManager(() =>
      configWith({
        security: {
          ...DEFAULT_CONFIG.security,
          profile: "custom",
          allowFileWrite: false,
          allowFileDelete: true,
          allowTerminal: true,
          allowGitWrite: false,
        },
      }),
    );
    expect(manager.check("fileWrite").allowed).toBe(false);
    expect(manager.check("fileDelete").allowed).toBe(true);
    expect(manager.check("terminal").allowed).toBe(true);
    expect(manager.check("gitWrite").allowed).toBe(false);
  });

  it("denied permissions return the dedicated error code where one exists", () => {
    const manager = new PermissionManager(() => configWith({ security: { ...DEFAULT_CONFIG.security, profile: "readonly" } }));
    const result = manager.check("fileWrite");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("FILE_WRITE_DISABLED");
    }
  });

  it("remoteAccess always mirrors codelink.remote.enabled regardless of profile", () => {
    const trustedNoRemote = new PermissionManager(() =>
      configWith({ security: { ...DEFAULT_CONFIG.security, profile: "trusted" }, remote: { ...DEFAULT_CONFIG.remote, enabled: false } }),
    );
    expect(trustedNoRemote.check("remoteAccess").allowed).toBe(false);

    const readonlyWithRemote = new PermissionManager(() =>
      configWith({ security: { ...DEFAULT_CONFIG.security, profile: "readonly" }, remote: { ...DEFAULT_CONFIG.remote, enabled: true } }),
    );
    expect(readonlyWithRemote.check("remoteAccess").allowed).toBe(true);
  });
});
