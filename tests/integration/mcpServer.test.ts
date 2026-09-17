import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../extension/src/config/defaults.js";
import type { CodeLinkConfig } from "../../extension/src/config/schema.js";
import { McpServerManager, type McpServerAddress } from "../../extension/src/mcp/server.js";
import { RustBridge } from "../../extension/src/rust/bridge.js";
import { AuthenticationManager, InMemorySecretStore } from "../../extension/src/security/authentication.js";
import { PermissionManager } from "../../extension/src/security/permissions.js";
import { SecurityPolicy } from "../../extension/src/security/policy.js";
import { RateLimiter } from "../../extension/src/security/rateLimiter.js";
import { ConsoleSink, Logger } from "../../extension/src/utils/logger.js";

const EXTENSION_ROOT = path.resolve(__dirname, "../../extension");

interface Harness {
  bridge: RustBridge;
  mcpServer: McpServerManager;
  authentication: AuthenticationManager;
  workspaceRoot: string;
  address: McpServerAddress;
}

function silentLogger(): Logger {
  const logger = new Logger(new ConsoleSink());
  logger.setLevel("error");
  return logger;
}

async function startHarness(overrides: Partial<CodeLinkConfig>, port: number): Promise<Harness> {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codelink-it-"));
  const config: CodeLinkConfig = {
    ...DEFAULT_CONFIG,
    ...overrides,
    server: { ...DEFAULT_CONFIG.server, ...(overrides.server ?? {}), port },
    security: { ...DEFAULT_CONFIG.security, ...(overrides.security ?? {}) },
    remote: { ...DEFAULT_CONFIG.remote, ...(overrides.remote ?? {}) },
  };

  const logger = silentLogger();
  const bridge = new RustBridge({ extensionRoot: EXTENSION_ROOT, workspaceRoot, logger });
  bridge.start();

  const permissions = new PermissionManager(() => config);
  const authentication = new AuthenticationManager(new InMemorySecretStore());
  const rateLimiter = new RateLimiter(config.rateLimit.requestsPerMinute, config.rateLimit.maxConcurrentRequests);
  const policy = new SecurityPolicy(permissions, authentication, rateLimiter, () => config, logger);

  const mcpServer = new McpServerManager({
    extensionVersion: "0.0.0-test",
    workspaceRoot,
    workspaceName: "integration-test-workspace",
    bridge,
    policy,
    getConfig: () => config,
    logger,
  });

  try {
    const address = await mcpServer.start();
    return { bridge, mcpServer, authentication, workspaceRoot, address };
  } catch (error) {
    await bridge.stop();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
}

async function stopHarness(harness: Harness): Promise<void> {
  await harness.mcpServer.stop();
  await harness.bridge.stop();
  fs.rmSync(harness.workspaceRoot, { recursive: true, force: true });
}

async function connectClient(address: McpServerAddress, token?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`http://${address.host}:${address.port}/mcp`), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  const client = new Client({ name: "codelink-integration-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

// client.callTool()'s return type is a union: the normal content-bearing
// result, or an experimental task-style `{ toolResult }` shape we never
// produce (none of our tools declare task execution). Accepting the
// broader record type here (rather than narrowing the call site's type)
// keeps every call site simple while still failing loudly, not silently,
// if that assumption is ever wrong.
function firstText(result: Record<string, unknown>): string {
  if (!Array.isArray(result.content)) {
    throw new Error(`Expected a content-bearing tool result, got: ${JSON.stringify(result)}`);
  }
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0]?.text ?? "";
}

describe("MCP server end-to-end (real codelink-core, real MCP client)", () => {
  let harness: Harness;

  beforeAll(async () => {
    // The trusted profile is needed here so the terminal_* tool calls
    // below aren't denied by permission before they can exercise the real
    // Rust process-spawn path this suite is meant to verify.
    harness = await startHarness({ security: { ...DEFAULT_CONFIG.security, profile: "trusted" } }, 32171);
  });

  afterAll(async () => {
    await stopHarness(harness);
  });

  it("lists the registered tools", async () => {
    const client = await connectClient(harness.address);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["file_read", "file_write", "workspace_search", "git_status", "terminal_run"]),
    );
    await client.close();
  });

  it("writes and reads a file through the real Rust core", async () => {
    const client = await connectClient(harness.address);
    const writeResult = await client.callTool({ name: "file_write", arguments: { path: "hello.txt", content: "hi there" } });
    expect(writeResult.isError).not.toBe(true);

    const readResult = await client.callTool({ name: "file_read", arguments: { path: "hello.txt" } });
    expect(readResult.isError).not.toBe(true);
    expect(JSON.parse(firstText(readResult)).content).toBe("hi there");
    await client.close();
  });

  it("lists directory contents via workspace_files", async () => {
    const client = await connectClient(harness.address);
    await client.callTool({ name: "file_write", arguments: { path: "nested/inner.txt", content: "x" } });
    const listing = await client.callTool({ name: "workspace_files", arguments: {} });
    const entries = JSON.parse(firstText(listing)).entries as Array<{ path: string }>;
    expect(entries.some((entry) => entry.path === "nested")).toBe(true);
    await client.close();
  });

  it("rejects a path traversal attempt with PATH_OUTSIDE_WORKSPACE", async () => {
    const client = await connectClient(harness.address);
    const result = await client.callTool({ name: "file_read", arguments: { path: "../../etc/passwd" } });
    expect(result.isError).toBe(true);
    expect(JSON.parse(firstText(result)).code).toBe("PATH_OUTSIDE_WORKSPACE");
    await client.close();
  });

  it("blocks a secret-looking file with SECRET_ACCESS_DENIED", async () => {
    const client = await connectClient(harness.address);
    const result = await client.callTool({ name: "file_read", arguments: { path: ".env" } });
    expect(result.isError).toBe(true);
    expect(JSON.parse(firstText(result)).code).toBe("SECRET_ACCESS_DENIED");
    await client.close();
  });

  it("runs a command end to end via terminal_run/terminal_output", async () => {
    const client = await connectClient(harness.address);
    const created = await client.callTool({ name: "terminal_create", arguments: {} });
    const { terminalId } = JSON.parse(firstText(created));

    const isWindows = process.platform === "win32";
    const run = await client.callTool({
      name: "terminal_run",
      arguments: isWindows
        ? { terminalId, command: "cmd", args: ["/C", "echo hello-from-terminal"] }
        : { terminalId, command: "echo", args: ["hello-from-terminal"] },
    });
    const { id } = JSON.parse(firstText(run));

    let output = "";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const polled = await client.callTool({ name: "terminal_output", arguments: { processId: id } });
      const parsed = JSON.parse(firstText(polled));
      output = parsed.stdout;
      if (parsed.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(output).toContain("hello-from-terminal");
    await client.close();
  });

  it("reports Git status through the real git binary", async () => {
    const client = await connectClient(harness.address);
    const result = await client.callTool({ name: "git_status", arguments: {} });
    // Not a git repo, so this should fail with a structured GIT_COMMAND_FAILED
    // rather than crash the server or the client connection.
    expect(result.isError).toBe(true);
    expect(JSON.parse(firstText(result)).code).toBe("GIT_COMMAND_FAILED");
    await client.close();
  });
});

describe("MCP server permission enforcement", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness({ security: { ...DEFAULT_CONFIG.security, profile: "readonly" } }, 32172);
  });

  afterAll(async () => {
    await stopHarness(harness);
  });

  it("denies file_write under the readonly profile", async () => {
    const client = await connectClient(harness.address);
    const result = await client.callTool({ name: "file_write", arguments: { path: "a.txt", content: "x" } });
    expect(result.isError).toBe(true);
    expect(JSON.parse(firstText(result)).code).toBe("FILE_WRITE_DISABLED");
    await client.close();
  });

  it("denies terminal_create under the readonly profile", async () => {
    const client = await connectClient(harness.address);
    const result = await client.callTool({ name: "terminal_create", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.parse(firstText(result)).code).toBe("TERMINAL_DISABLED");
    await client.close();
  });

  it("still allows file_read under the readonly profile", async () => {
    const client = await connectClient(harness.address);
    const result = await client.callTool({ name: "file_exists", arguments: { path: "." } });
    expect(result.isError).not.toBe(true);
    await client.close();
  });
});

describe("MCP server remote authentication", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness({ remote: { enabled: true } }, 32173);
  });

  afterAll(async () => {
    await stopHarness(harness);
  });

  it("rejects a connection with no token", async () => {
    await expect(connectClient(harness.address)).rejects.toBeTruthy();
  });

  it("rejects a connection with an invalid token", async () => {
    await expect(connectClient(harness.address, "not-the-right-token")).rejects.toBeTruthy();
  });

  it("accepts a connection with a valid token", async () => {
    const token = await harness.authentication.generateToken();
    const client = await connectClient(harness.address, token);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.close();
  });
});

describe("MCP server port conflict", () => {
  it("surfaces PORT_IN_USE instead of crashing when the port is already bound", async () => {
    const first = await startHarness({}, 32174);
    try {
      await expect(startHarness({}, 32174)).rejects.toMatchObject({ code: "PORT_IN_USE" });
    } finally {
      await stopHarness(first);
    }
  });
});
