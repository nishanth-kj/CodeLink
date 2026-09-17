import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { validateWorkspacePath } from "../../extension/src/security/pathValidator.js";
import { CodeLinkError } from "../../extension/src/utils/errors.js";

const ROOT = path.resolve("/workspace/project");

describe("validateWorkspacePath", () => {
  it("accepts a simple relative path", () => {
    expect(validateWorkspacePath(ROOT, "src/app.ts")).toBe("src/app.ts");
  });

  it("accepts the empty path as the workspace root", () => {
    expect(validateWorkspacePath(ROOT, "")).toBe(".");
  });

  it("rejects parent traversal that escapes the workspace", () => {
    expect(() => validateWorkspacePath(ROOT, "../../../etc/passwd")).toThrow(CodeLinkError);
    try {
      validateWorkspacePath(ROOT, "../../../etc/passwd");
    } catch (error) {
      expect((error as CodeLinkError).code).toBe("PATH_OUTSIDE_WORKSPACE");
    }
  });

  it("rejects an absolute path outside the workspace", () => {
    const outside = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    expect(() => validateWorkspacePath(ROOT, outside)).toThrow(CodeLinkError);
  });

  it("rejects a null byte", () => {
    try {
      validateWorkspacePath(ROOT, "a\0b");
      throw new Error("expected validateWorkspacePath to throw");
    } catch (error) {
      expect((error as CodeLinkError).code).toBe("INVALID_ARGUMENT");
    }
  });

  it("allows a path that legitimately starts with the root's own name as a sibling prefix to be rejected", () => {
    // A sibling directory that merely shares a string prefix with the root
    // (e.g. root "/workspace/project" vs "/workspace/project-evil") must
    // not be treated as inside the workspace.
    const sibling = path.resolve("/workspace/project-evil/secret.txt");
    expect(() => validateWorkspacePath(ROOT, sibling)).toThrow(CodeLinkError);
  });

  it("normalizes backslashes to forward slashes in the returned relative path", () => {
    const nested = validateWorkspacePath(ROOT, path.join("src", "nested", "file.ts"));
    expect(nested).toBe("src/nested/file.ts");
  });
});
