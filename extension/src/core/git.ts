import { execFile } from "node:child_process";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import { WorkspaceGuard } from "./workspaceGuard.js";

const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** CodeLink never forwards a client-supplied command string to a shell.
 * Every Git operation below builds a fixed, known argv shape; the only
 * client-controlled inputs are path and revision *values*, which are
 * validated and passed as discrete arguments to `execFile` (never
 * concatenated into a shell string), so there is no command or argument
 * injection surface. */
function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: MAX_BUFFER_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        if (error && typeof (error as NodeJS.ErrnoException).code === "string" && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new CodeLinkError(ErrorCodes.GIT_NOT_AVAILABLE, `Failed to run git: ${error.message}`));
          return;
        }
        const code = typeof error?.code === "number" ? error.code : error ? -1 : 0;
        resolve({ stdout, stderr, code });
      },
    );
  });
}

function ensureSuccess({ stdout, stderr, code }: { stdout: string; stderr: string; code: number }): string {
  if (code !== 0) {
    const message = stderr.trim().length === 0 ? stdout : stderr;
    throw new CodeLinkError(ErrorCodes.GIT_COMMAND_FAILED, message);
  }
  return stdout;
}

function validateRevision(rev: string): void {
  if (rev.trim().length === 0) {
    throw new CodeLinkError(ErrorCodes.INVALID_ARGUMENT, "rev must not be empty");
  }
  if (rev.startsWith("-")) {
    throw new CodeLinkError(ErrorCodes.INVALID_ARGUMENT, "Revision must not start with '-'");
  }
}

export interface RootParams {
  root: string;
}

export async function status(
  params: RootParams,
): Promise<{ branch: string | null; upstream: string | null; ahead: number; behind: number; files: unknown[] }> {
  const guard = await WorkspaceGuard.create(params.root);
  const out = ensureSuccess(await runGit(guard.root(), ["status", "--porcelain=v1", "--branch"]));

  const aheadRe = /ahead (\d+)/;
  const behindRe = /behind (\d+)/;

  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: { path: string; indexStatus: string; worktreeStatus: string }[] = [];

  for (const line of out.split("\n")) {
    if (line.startsWith("## ")) {
      const rest = line.slice(3);
      const branchPart = rest.split(" [")[0] ?? rest;
      if (branchPart.includes("...")) {
        const [local, remote] = branchPart.split("...");
        branch = local ?? "";
        upstream = remote ?? "";
      } else {
        branch = branchPart;
      }
      const aheadMatch = aheadRe.exec(rest);
      if (aheadMatch) {
        ahead = Number.parseInt(aheadMatch[1] ?? "0", 10) || 0;
      }
      const behindMatch = behindRe.exec(rest);
      if (behindMatch) {
        behind = Number.parseInt(behindMatch[1] ?? "0", 10) || 0;
      }
    } else if (line.length >= 3) {
      files.push({ path: line.slice(3), indexStatus: line.slice(0, 1), worktreeStatus: line.slice(1, 2) });
    }
  }

  return { branch, upstream, ahead, behind, files };
}

export interface DiffParams {
  root: string;
  path?: string;
  staged?: boolean;
}

export async function diff(params: DiffParams): Promise<{ diff: string }> {
  const guard = await WorkspaceGuard.create(params.root);
  const args = ["diff"];
  if (params.staged) {
    args.push("--staged");
  }
  if (params.path) {
    const resolved = await guard.resolve(params.path);
    args.push("--", guard.toRelativeDisplay(resolved));
  }
  return { diff: ensureSuccess(await runGit(guard.root(), args)) };
}

export interface LogParams {
  root: string;
  maxCount?: number;
  path?: string;
}

const RECORD_SEP = "";
const FIELD_SEP = "";

export async function log(
  params: LogParams,
): Promise<{ commits: { hash: string; author: string; email: string; date: string; message: string }[] }> {
  const guard = await WorkspaceGuard.create(params.root);
  const maxCount = Math.min(Math.max(params.maxCount ?? 20, 1), 200);

  const args = ["log", `-${maxCount}`, `--pretty=format:%H${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%s${RECORD_SEP}`];
  if (params.path) {
    const resolved = await guard.resolve(params.path);
    args.push("--", guard.toRelativeDisplay(resolved));
  }

  const out = ensureSuccess(await runGit(guard.root(), args));
  const commits = out
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const parts = record.replace(/^\n+/, "").split(FIELD_SEP);
      return {
        hash: parts[0] ?? "",
        author: parts[1] ?? "",
        email: parts[2] ?? "",
        date: parts[3] ?? "",
        message: parts[4] ?? "",
      };
    });

  return { commits };
}

export async function branches(
  params: RootParams,
): Promise<{ branches: { name: string; current: boolean; upstream: string | null }[] }> {
  const guard = await WorkspaceGuard.create(params.root);
  const out = ensureSuccess(
    await runGit(guard.root(), ["branch", "-a", "--format=%(refname:short)\t%(HEAD)\t%(upstream:short)"]),
  );

  const list = out
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.split("\t");
      const upstream = parts[2] ?? "";
      return { name: parts[0] ?? "", current: parts[1] === "*", upstream: upstream.length === 0 ? null : upstream };
    });

  return { branches: list };
}

export interface ShowParams {
  root: string;
  rev: string;
  path?: string;
}

export async function show(params: ShowParams): Promise<{ content: string }> {
  validateRevision(params.rev);
  const guard = await WorkspaceGuard.create(params.root);

  let target = params.rev;
  if (params.path) {
    const resolved = await guard.resolve(params.path);
    target = `${params.rev}:${guard.toRelativeDisplay(resolved)}`;
  }

  return { content: ensureSuccess(await runGit(guard.root(), ["show", "--no-color", target])) };
}

export async function remote(params: RootParams): Promise<{ remotes: { name: string; url: string }[] }> {
  const guard = await WorkspaceGuard.create(params.root);
  const out = ensureSuccess(await runGit(guard.root(), ["remote", "-v"]));

  const seen = new Set<string>();
  const remotes: { name: string; url: string }[] = [];
  for (const line of out.split("\n")) {
    const parts = line.split(/\s+/).filter(Boolean);
    const name = parts[0];
    const url = parts[1];
    if (name !== undefined && url !== undefined && !seen.has(name)) {
      seen.add(name);
      remotes.push({ name, url });
    }
  }
  return { remotes };
}
