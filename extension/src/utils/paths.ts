/** Converts an OS-native path separator style to the forward-slashed display
 * form CodeLink uses consistently in tool inputs/outputs and MCP resource
 * URIs, regardless of whether the server is running on Windows or POSIX. */
export function toPosixDisplay(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Strips a leading "./" and collapses an empty path to ".", matching the
 * relative-display convention used by the Rust core (see
 * `WorkspaceGuard::to_relative_display`). */
export function normalizeDisplayPath(value: string): string {
  const posix = toPosixDisplay(value).replace(/^\.\/+/, "");
  return posix.length === 0 ? "." : posix;
}
