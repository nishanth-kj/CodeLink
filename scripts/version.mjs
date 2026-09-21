#!/usr/bin/env node
// The project version lives in one place: the `.version` file at the repo root.
// Some files need a literal copy of it (npm and the VS Code manifest can't read
// another file), so this script copies it into each of them and can verify that
// none has drifted.
//
//   node scripts/version.mjs check          fail if any file differs from .version
//   node scripts/version.mjs sync           copy .version into every file below
//   node scripts/version.mjs set <version>  write .version, then sync
//
// Add `--root <dir>` to run against another checkout (the tests do this).
// Files are edited in place, touching only the version text, so formatting and
// line endings are preserved.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// Every pattern has two capture groups around the version number. Only the
// first match is replaced, so dependency versions further down are never touched.
const TARGETS = [
  { file: "package.json", patterns: [/^(  "version": ")[^"]*(")/m] },
  { file: "extension/package.json", patterns: [/^(  "version": ")[^"]*(")/m] },
  {
    file: "extension/package-lock.json",
    patterns: [
      /^(  "version": ")[^"]*(")/m,
      /("packages": \{\s*"": \{[\s\S]*?\n      "version": ")[^"]*(")/,
    ],
  },
  { file: "core/Cargo.toml", patterns: [/(^\[package\][\s\S]*?^version\s*=\s*")[^"]*(")/m] },
  { file: "core/Cargo.lock", patterns: [/(name = "codelink-core"\r?\nversion = ")[^"]*(")/] },
];

function fail(message) {
  console.error(`version: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      root = path.resolve(argv[++i] ?? fail("--root needs a directory"));
    } else {
      positional.push(argv[i]);
    }
  }
  return { command: positional[0] ?? "check", value: positional[1], root };
}

function readSourceVersion(root) {
  let raw;
  try {
    raw = readFileSync(path.join(root, ".version"), "utf8");
  } catch {
    return fail(`cannot read ${path.join(root, ".version")}`);
  }
  const version = raw.trim();
  return SEMVER.test(version) ? version : fail(`.version contains "${version}", which is not a valid version`);
}

/** Returns the file's text with the version replaced by every pattern. */
function rewrite(target, text, version) {
  for (const pattern of target.patterns) {
    if (!pattern.test(text)) {
      fail(`no version found in ${target.file} (pattern ${pattern})`);
    }
    text = text.replace(pattern, (_match, before, after) => `${before}${version}${after}`);
  }
  return text;
}

/** The version each of the target's patterns currently finds. */
function currentVersions(target, text) {
  return target.patterns.map((pattern) => {
    const match = pattern.exec(text);
    if (!match) {
      return fail(`no version found in ${target.file} (pattern ${pattern})`);
    }
    return text.slice(match.index + match[1].length, match.index + match[0].length - match[2].length);
  });
}

function readTarget(root, target) {
  try {
    return readFileSync(path.join(root, target.file), "utf8");
  } catch {
    return fail(`cannot read ${target.file}`);
  }
}

function check(root, version) {
  const drifted = [];
  for (const target of TARGETS) {
    const versions = currentVersions(target, readTarget(root, target));
    if (versions.some((v) => v !== version)) {
      drifted.push(`  ${target.file}: ${[...new Set(versions)].join(", ")}`);
    }
  }
  if (drifted.length > 0) {
    console.error(`version: these files do not match .version (${version}):\n${drifted.join("\n")}`);
    console.error("Run `npm run version:sync` to update them.");
    process.exit(1);
  }
  console.log(`version: all ${TARGETS.length} files are at ${version}`);
}

function sync(root, version) {
  for (const target of TARGETS) {
    const before = readTarget(root, target);
    const after = rewrite(target, before, version);
    if (after !== before) {
      writeFileSync(path.join(root, target.file), after);
      console.log(`version: updated ${target.file} -> ${version}`);
    }
  }
  console.log(`version: all ${TARGETS.length} files are at ${version}`);
}

const { command, value, root } = parseArgs(process.argv.slice(2));

if (command === "check") {
  check(root, readSourceVersion(root));
} else if (command === "sync") {
  sync(root, readSourceVersion(root));
} else if (command === "set") {
  if (!value || !SEMVER.test(value)) {
    fail(`usage: version set <major.minor.patch>  (got "${value ?? ""}")`);
  }
  writeFileSync(path.join(root, ".version"), `${value}\n`);
  sync(root, value);
} else {
  fail(`unknown command "${command}" (expected check, sync or set)`);
}
