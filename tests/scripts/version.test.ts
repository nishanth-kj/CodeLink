import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/version.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// Mirrors the awkward parts of the real files: an inline JSON array that
// JSON.stringify would reflow, CRLF line endings, and other packages' versions
// that must never be touched.
const FIXTURE: Record<string, string> = {
  ".version": "1.2.3\n",
  "package.json": '{\n  "name": "root",\n  "version": "0.0.1",\n  "scripts": {}\n}\n',
  "extension/package.json": '{\n  "name": "ext",\n  "version": "0.0.1",\n  "categories": ["Other", "AI"]\n}\n',
  "extension/package-lock.json":
    '{\n  "name": "ext",\n  "version": "0.0.1",\n  "packages": {\n    "": {\n      "name": "ext",\n' +
    '      "version": "0.0.1",\n      "dependencies": {\n        "dep": "^0.0.1"\n      }\n    },\n' +
    '    "node_modules/dep": {\n      "version": "0.0.1"\n    }\n  }\n}\n',
  "core/Cargo.toml":
    '[package]\r\nname = "codelink-core"\r\nversion = "0.0.1"\r\n\r\n[dependencies]\r\nserde = { version = "0.0.1" }\r\n',
  "core/Cargo.lock":
    '[[package]]\nname = "serde"\nversion = "0.0.1"\n\n[[package]]\nname = "codelink-core"\nversion = "0.0.1"\n',
};

let dir: string;

function run(...args: string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args, "--root", dir], { encoding: "utf8" });
  return { status: result.status, output: result.stdout + result.stderr };
}

function read(file: string): string {
  return fs.readFileSync(path.join(dir, file), "utf8");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codelink-version-"));
  for (const [file, content] of Object.entries(FIXTURE)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("version check", () => {
  it("fails and names every file that differs from .version", () => {
    const { status, output } = run("check");
    expect(status).toBe(1);
    for (const file of ["package.json", "extension/package.json", "extension/package-lock.json", "core/Cargo.toml", "core/Cargo.lock"]) {
      expect(output).toContain(file);
    }
  });

  it("catches a single file drifting", () => {
    run("sync");
    fs.writeFileSync(path.join(dir, "extension/package.json"), FIXTURE["extension/package.json"] as string);
    const { status, output } = run("check");
    expect(status).toBe(1);
    expect(output).toContain("extension/package.json");
    expect(output).not.toContain("core/Cargo.toml");
  });
});

describe("version sync", () => {
  it("copies .version into every file and passes check afterwards", () => {
    expect(run("sync").status).toBe(0);
    expect(read("package.json")).toContain('"version": "1.2.3"');
    expect(read("extension/package.json")).toContain('"version": "1.2.3"');
    expect(read("extension/package-lock.json").match(/"version": "1\.2\.3"/g)).toHaveLength(2);
    expect(read("core/Cargo.toml")).toContain('version = "1.2.3"');
    expect(read("core/Cargo.lock")).toContain('name = "codelink-core"\nversion = "1.2.3"');
    expect(run("check").status).toBe(0);
  });

  it("changes only the version text: formatting, line endings and other versions survive", () => {
    run("sync");
    for (const [file, original] of Object.entries(FIXTURE)) {
      if (file === ".version") {
        continue;
      }
      // Undoing the version edit must give back the original file byte for byte.
      const restored = read(file).replace('name = "codelink-core"\nversion = "1.2.3"', 'name = "codelink-core"\nversion = "0.0.1"');
      const undone = restored.replace(/"version": "1\.2\.3"/g, '"version": "0.0.1"').replace(/^version = "1\.2\.3"/m, 'version = "0.0.1"');
      expect(undone).toBe(original);
    }
    expect(read("core/Cargo.toml")).toContain("\r\n");
    expect(read("core/Cargo.toml")).toContain('serde = { version = "0.0.1" }');
    expect(read("extension/package.json")).toContain('["Other", "AI"]');
    expect(read("extension/package-lock.json")).toContain('"dep": "^0.0.1"');
    expect(read("extension/package-lock.json")).toContain('"node_modules/dep": {\n      "version": "0.0.1"');
    expect(read("core/Cargo.lock")).toContain('name = "serde"\nversion = "0.0.1"');
  });

  it("is a no-op when everything already matches", () => {
    run("sync");
    const { status, output } = run("sync");
    expect(status).toBe(0);
    expect(output).not.toContain("updated");
  });
});

describe("version set", () => {
  it("writes .version and syncs every file", () => {
    expect(run("set", "2.0.0-beta.1").status).toBe(0);
    expect(read(".version")).toBe("2.0.0-beta.1\n");
    expect(run("check").status).toBe(0);
    expect(read("package.json")).toContain('"version": "2.0.0-beta.1"');
  });

  it("rejects an invalid version without changing anything", () => {
    for (const bad of ["1.2", "v1.2.3", "one.two.three"]) {
      expect(run("set", bad).status).toBe(1);
    }
    expect(read(".version")).toBe("1.2.3\n");
    expect(read("package.json")).toContain('"version": "0.0.1"');
  });

  it("rejects a malformed .version file", () => {
    fs.writeFileSync(path.join(dir, ".version"), "not-a-version\n");
    expect(run("check").status).toBe(1);
    expect(run("sync").status).toBe(1);
    expect(read("package.json")).toContain('"version": "0.0.1"');
  });
});

describe("this repository", () => {
  it("has every versioned file in step with .version", () => {
    const result = spawnSync(process.execPath, [SCRIPT, "check", "--root", REPO_ROOT], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
