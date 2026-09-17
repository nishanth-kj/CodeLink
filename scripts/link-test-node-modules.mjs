// tests/**/*.ts imports packages (vitest, @modelcontextprotocol/sdk) that
// only exist in extension/node_modules, since extension/ is a standalone
// npm project and tests/ is not. TypeScript's Node16 module resolution
// (like Node's own runtime resolution) finds packages by walking up from
// the importing file's real directory, and correctly handles a package's
// "exports" map (subpath resolution) only when it finds the real
// node_modules this way — a tsconfig "paths" override bypasses "exports"
// resolution entirely and breaks on subpath imports like
// "@modelcontextprotocol/sdk/client/index.js". A symlink (a junction on
// Windows, which unlike a symlink needs no elevated privileges) makes the
// real directory visible to that walk without duplicating anything on disk.
import { existsSync, symlinkSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(__dirname, "../extension/node_modules");
const linkPath = path.resolve(__dirname, "../tests/node_modules");

if (!existsSync(target)) {
  console.error("extension/node_modules not found. Run `npm install` inside extension/ first.");
  process.exit(1);
}

if (!existsSync(linkPath)) {
  const symlinkType = process.platform === "win32" ? "junction" : "dir";
  symlinkSync(target, linkPath, symlinkType);
  console.log(`Linked tests/node_modules -> extension/node_modules (${symlinkType}).`);
}
