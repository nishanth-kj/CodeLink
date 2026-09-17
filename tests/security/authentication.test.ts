import { describe, expect, it } from "vitest";
import { AuthenticationManager, InMemorySecretStore } from "../../extension/src/security/authentication.js";

describe("AuthenticationManager", () => {
  it("has no token until one is generated", async () => {
    const auth = new AuthenticationManager(new InMemorySecretStore());
    expect(await auth.hasToken()).toBe(false);
    expect(await auth.verify("anything")).toBe(false);
  });

  it("verifies a freshly generated token", async () => {
    const auth = new AuthenticationManager(new InMemorySecretStore());
    const token = await auth.generateToken();
    expect(await auth.hasToken()).toBe(true);
    expect(await auth.verify(token)).toBe(true);
  });

  it("rejects an incorrect token", async () => {
    const auth = new AuthenticationManager(new InMemorySecretStore());
    await auth.generateToken();
    expect(await auth.verify("wrong-token")).toBe(false);
  });

  it("rejects a missing token", async () => {
    const auth = new AuthenticationManager(new InMemorySecretStore());
    await auth.generateToken();
    expect(await auth.verify(undefined)).toBe(false);
  });

  it("invalidates the old token once revoked", async () => {
    const auth = new AuthenticationManager(new InMemorySecretStore());
    const token = await auth.generateToken();
    await auth.revokeToken();
    expect(await auth.verify(token)).toBe(false);
    expect(await auth.hasToken()).toBe(false);
  });

  it("regenerating replaces the previous token", async () => {
    const auth = new AuthenticationManager(new InMemorySecretStore());
    const first = await auth.generateToken();
    const second = await auth.generateToken();
    expect(first).not.toBe(second);
    expect(await auth.verify(first)).toBe(false);
    expect(await auth.verify(second)).toBe(true);
  });
});
