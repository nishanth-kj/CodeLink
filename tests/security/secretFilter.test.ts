import { describe, expect, it } from "vitest";
import { containsLikelySecretContent, isSecretPath } from "../../extension/src/security/secretFilter.js";

describe("isSecretPath", () => {
  it.each([".env", ".env.local", ".env.production", "config/.env", "id_rsa", "keys/id_ed25519", "certs/server.pem", "credentials.json", ".aws/credentials", ".npmrc", ".git-credentials"])(
    "flags %s as a secret path",
    (candidate) => {
      expect(isSecretPath(candidate)).toBe(true);
    },
  );

  it.each(["src/app.ts", "README.md", "package.json", "envelope.ts", "credentials-form.tsx"])(
    "does not flag %s as a secret path",
    (candidate) => {
      expect(isSecretPath(candidate)).toBe(false);
    },
  );
});

describe("containsLikelySecretContent", () => {
  it("flags an assignment that looks like a secret", () => {
    expect(containsLikelySecretContent("API_KEY=sk-abc123")).toBe(true);
    expect(containsLikelySecretContent('password: "hunter2"')).toBe(true);
  });

  it("does not flag unrelated content", () => {
    expect(containsLikelySecretContent("export function add(a, b) { return a + b; }")).toBe(false);
  });
});
