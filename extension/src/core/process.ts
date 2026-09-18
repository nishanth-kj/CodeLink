import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import { WorkspaceGuard } from "./workspaceGuard.js";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

type ProcessLifecycleStatus = "running" | "exited" | "killed" | "timedout";

interface TrackedProcess {
  child: ChildProcess;
  command: string;
  args: string[];
  cwd: string;
  startedAtMs: number;
  stdoutChunks: Buffer[];
  stdoutBytes: number;
  stderrChunks: Buffer[];
  stderrBytes: number;
  truncated: boolean;
  status: ProcessLifecycleStatus;
  exitCode: number | null;
  timeout?: NodeJS.Timeout;
}

const registry = new Map<string, TrackedProcess>();
let nextId = 1;

/** Substrings that mark an environment variable as likely to hold a
 * credential. Matched case-insensitively against the variable name (not
 * its value): this is a name-based allowlist-by-exclusion, not a secret
 * scanner, and callers may still pass a sensitive value explicitly via
 * `params.env` if they really mean to. */
const SENSITIVE_ENV_SUBSTRINGS = ["API_KEY", "TOKEN", "PASSWORD", "SECRET", "PRIVATE_KEY", "CREDENTIAL"];

function isSensitiveEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return upper.startsWith("AWS_") || SENSITIVE_ENV_SUBSTRINGS.some((needle) => upper.includes(needle));
}

/** A spawned process must still be able to resolve `PATH` (or it can't find
 * `git`, `npm`, etc. by name), so this does not simply clear the
 * environment; it starts from the extension host's own inherited
 * environment and drops anything that looks like a credential, matching
 * the default terminal/process security posture described in docs/security.md. */
function filteredInheritedEnv(): NodeJS.ProcessEnv {
  const filtered: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!isSensitiveEnvKey(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function appendCapped(chunks: Buffer[], currentBytes: number, maxBytes: number, chunk: Buffer): { bytes: number; truncated: boolean } {
  const remaining = maxBytes - currentBytes;
  if (remaining <= 0) {
    return { bytes: currentBytes, truncated: true };
  }
  if (chunk.length <= remaining) {
    chunks.push(chunk);
    return { bytes: currentBytes + chunk.length, truncated: false };
  }
  chunks.push(chunk.subarray(0, remaining));
  return { bytes: currentBytes + remaining, truncated: true };
}

export interface SpawnParams {
  root: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export async function spawnProcess(params: SpawnParams): Promise<{ id: string; command: string; args: string[]; status: "running" }> {
  if (params.command.trim().length === 0) {
    throw new CodeLinkError(ErrorCodes.INVALID_ARGUMENT, "command must not be empty");
  }

  const guard = await WorkspaceGuard.create(params.root);
  const cwdResolved = await guard.resolve(params.cwd ?? "");
  const cwdStat = await fs.promises.stat(cwdResolved).catch(() => undefined);
  if (!cwdStat?.isDirectory()) {
    throw new CodeLinkError(ErrorCodes.NOT_A_DIRECTORY, `Not a directory: ${params.cwd ?? ""}`);
  }

  const maxOutputBytes = params.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const args = params.args ?? [];

  const child = spawn(params.command, args, {
    cwd: cwdResolved,
    env: { ...filteredInheritedEnv(), ...params.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  // Node delivers a missing-executable failure asynchronously via the
  // 'error' event rather than throwing from spawn() itself (unlike Rust's
  // Command::spawn(), which fails synchronously); wait for either that or
  // the 'spawn' confirmation before reporting success, so callers see the
  // same synchronous-looking failure Rust gave them.
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  } catch (error) {
    throw new CodeLinkError(ErrorCodes.PROCESS_SPAWN_FAILED, `Failed to start '${params.command}': ${(error as Error).message}`);
  }

  const id = `proc-${nextId}`;
  nextId += 1;

  const tracked: TrackedProcess = {
    child,
    command: params.command,
    args,
    cwd: guard.toRelativeDisplay(cwdResolved),
    startedAtMs: Date.now(),
    stdoutChunks: [],
    stdoutBytes: 0,
    stderrChunks: [],
    stderrBytes: 0,
    truncated: false,
    status: "running",
    exitCode: null,
  };
  registry.set(id, tracked);

  // A post-spawn 'error' (e.g. EPIPE) must still be handled or Node treats
  // it as an uncaught exception; there is no synchronous caller left to
  // report it to, so it just surfaces as a non-zero-looking exit below.
  child.on("error", () => {
    if (tracked.status === "running") {
      tracked.status = "exited";
    }
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    const result = appendCapped(tracked.stdoutChunks, tracked.stdoutBytes, maxOutputBytes, chunk);
    tracked.stdoutBytes = result.bytes;
    tracked.truncated = tracked.truncated || result.truncated;
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const result = appendCapped(tracked.stderrChunks, tracked.stderrBytes, maxOutputBytes, chunk);
    tracked.stderrBytes = result.bytes;
    tracked.truncated = tracked.truncated || result.truncated;
  });

  child.on("exit", (code) => {
    if (tracked.timeout) {
      clearTimeout(tracked.timeout);
    }
    if (tracked.status === "running") {
      tracked.status = "exited";
      tracked.exitCode = code;
    }
  });

  if (params.timeoutMs !== undefined) {
    tracked.timeout = setTimeout(() => {
      if (tracked.status === "running") {
        tracked.status = "timedout";
        tracked.child.kill();
      }
    }, params.timeoutMs);
  }

  return { id, command: params.command, args, status: "running" };
}

export interface IdParams {
  id: string;
}

function getTracked(id: string): TrackedProcess {
  const tracked = registry.get(id);
  if (!tracked) {
    throw new CodeLinkError(ErrorCodes.PROCESS_NOT_FOUND, `Unknown process id: ${id}`);
  }
  return tracked;
}

export async function output(
  params: IdParams,
): Promise<{ id: string; stdout: string; stderr: string; status: ProcessLifecycleStatus; exitCode: number | null; truncated: boolean }> {
  const tracked = getTracked(params.id);
  return {
    id: params.id,
    stdout: Buffer.concat(tracked.stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(tracked.stderrChunks).toString("utf8"),
    status: tracked.status,
    exitCode: tracked.exitCode,
    truncated: tracked.truncated,
  };
}

export async function kill(params: IdParams): Promise<{ id: string; status: ProcessLifecycleStatus }> {
  const tracked = getTracked(params.id);
  if (tracked.status === "running") {
    if (tracked.timeout) {
      clearTimeout(tracked.timeout);
    }
    tracked.status = "killed";
    tracked.child.kill();
  }
  return { id: params.id, status: tracked.status };
}

export async function list(): Promise<{
  processes: { id: string; command: string; args: string[]; cwd: string; startedAtMs: number; status: ProcessLifecycleStatus; exitCode: number | null }[];
}> {
  const processes = Array.from(registry.entries()).map(([id, tracked]) => ({
    id,
    command: tracked.command,
    args: tracked.args,
    cwd: tracked.cwd,
    startedAtMs: tracked.startedAtMs,
    status: tracked.status,
    exitCode: tracked.exitCode,
  }));
  return { processes };
}
