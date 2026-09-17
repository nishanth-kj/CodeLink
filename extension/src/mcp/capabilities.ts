export interface ServerInfo {
  name: string;
  version: string;
}

export function buildServerInfo(version: string): ServerInfo {
  return { name: "codelink", version };
}

export const SERVER_INSTRUCTIONS = [
  "CodeLink exposes a single local VS Code workspace to this MCP client.",
  "Every tool call is gated by the workspace's active security profile",
  "(readonly, developer, trusted, or custom); a denied call returns a",
  "structured error such as FILE_WRITE_DISABLED or TERMINAL_DISABLED rather",
  "than failing silently or being omitted from tools/list. All file paths",
  "in tool arguments and results are workspace-relative, forward-slashed,",
  "and validated to stay inside the workspace root.",
].join(" ");
