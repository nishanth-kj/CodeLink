import * as fs from "node:fs";
import * as path from "node:path";

export interface PlatformTarget {
  platform: NodeJS.Platform;
  arch: string;
  binaryName: string;
}

export function getPlatformTarget(): PlatformTarget {
  const platform = process.platform;
  const arch = process.arch;
  const binaryName = platform === "win32" ? "codelink-core.exe" : "codelink-core";
  return { platform, arch, binaryName };
}

/**
 * Locates the `codelink-core` binary appropriate for the current OS/arch.
 *
 * A packaged extension ships one binary per platform under
 * `bin/<platform>-<arch>/`, populated by CI at release time (see
 * `docs/development.md`). During local development, the binary instead
 * lives at the Rust crate's normal Cargo output path. Neither location is
 * hardcoded to a particular machine or username.
 */
export function resolveCoreBinaryPath(extensionRoot: string): string | undefined {
  const { platform, arch, binaryName } = getPlatformTarget();
  const candidates = [
    path.join(extensionRoot, "bin", `${platform}-${arch}`, binaryName),
    path.join(extensionRoot, "..", "core", "target", "release", binaryName),
    path.join(extensionRoot, "..", "core", "target", "debug", binaryName),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}
