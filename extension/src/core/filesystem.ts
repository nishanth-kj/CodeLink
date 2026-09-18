import * as fs from "node:fs";
import * as path from "node:path";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import { buildExcludeMatcher, compileGlob } from "./glob.js";
import { walk } from "./walk.js";
import { WorkspaceGuard } from "./workspaceGuard.js";

const DEFAULT_MAX_READ_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_WRITE_BYTES = 10 * 1024 * 1024;
const DEFAULT_LIST_LIMIT = 1000;

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function ioError(error: unknown, notFoundPath: string): Promise<never> {
  if (isNotFound(error)) {
    throw new CodeLinkError(ErrorCodes.FILE_NOT_FOUND, `File not found: ${notFoundPath}`);
  }
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "EACCES" || code === "EPERM") {
    throw new CodeLinkError(ErrorCodes.OS_PERMISSION_DENIED, (error as Error).message);
  }
  if (code === "EEXIST") {
    throw new CodeLinkError(ErrorCodes.ALREADY_EXISTS, (error as Error).message);
  }
  throw new CodeLinkError(ErrorCodes.IO_ERROR, (error as Error).message);
}

function isValidUtf8(buffer: Buffer): boolean {
  return Buffer.from(buffer.toString("utf8"), "utf8").equals(buffer);
}

export interface ReadParams {
  root: string;
  path: string;
  maxBytes?: number;
}

export async function read(params: ReadParams): Promise<{ path: string; content: string; encoding: string; size: number }> {
  const guard = await WorkspaceGuard.create(params.root);
  const resolved = await guard.resolve(params.path);

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolved);
  } catch (error) {
    return ioError(error, params.path);
  }
  if (stat.isDirectory()) {
    throw new CodeLinkError(ErrorCodes.IS_A_DIRECTORY, `Is a directory: ${params.path}`);
  }

  const limit = params.maxBytes ?? DEFAULT_MAX_READ_BYTES;
  if (stat.size > limit) {
    throw new CodeLinkError(ErrorCodes.FILE_TOO_LARGE, `File exceeds the configured limit of ${limit} bytes`);
  }

  const bytes = await fs.promises.readFile(resolved);
  const encoding = isValidUtf8(bytes) ? "utf8" : "base64";
  const content = encoding === "utf8" ? bytes.toString("utf8") : bytes.toString("base64");

  return { path: guard.toRelativeDisplay(resolved), content, encoding, size: bytes.length };
}

export interface WriteParams {
  root: string;
  path: string;
  content: string;
  encoding?: string;
  maxBytes?: number;
  mustNotExist?: boolean;
  createParents?: boolean;
}

export async function write(params: WriteParams): Promise<{ path: string; bytesWritten: number }> {
  const guard = await WorkspaceGuard.create(params.root);
  const resolved = await guard.resolve(params.path);

  if (params.mustNotExist) {
    try {
      await fs.promises.access(resolved);
      throw new CodeLinkError(ErrorCodes.ALREADY_EXISTS, `Already exists: ${params.path}`);
    } catch (error) {
      if (CodeLinkError.isCodeLinkError(error)) {
        throw error;
      }
      // ENOENT is the expected, non-error case here (file does not exist yet).
    }
  }
  try {
    const stat = await fs.promises.stat(resolved);
    if (stat.isDirectory()) {
      throw new CodeLinkError(ErrorCodes.IS_A_DIRECTORY, `Is a directory: ${params.path}`);
    }
  } catch (error) {
    if (CodeLinkError.isCodeLinkError(error)) {
      throw error;
    }
    if (!isNotFound(error)) {
      return ioError(error, params.path);
    }
  }

  const bytes = params.encoding === "base64" ? Buffer.from(params.content, "base64") : Buffer.from(params.content, "utf8");
  const limit = params.maxBytes ?? DEFAULT_MAX_WRITE_BYTES;
  if (bytes.length > limit) {
    throw new CodeLinkError(ErrorCodes.FILE_TOO_LARGE, `File exceeds the configured limit of ${limit} bytes`);
  }

  const parent = path.dirname(resolved);
  const parentExists = await fs.promises
    .access(parent)
    .then(() => true)
    .catch(() => false);
  if (!parentExists) {
    if (params.createParents ?? true) {
      await fs.promises.mkdir(parent, { recursive: true }).catch((error: unknown) => ioError(error, params.path));
    } else {
      throw new CodeLinkError(
        ErrorCodes.INVALID_ARGUMENT,
        `Parent directory does not exist: ${guard.toRelativeDisplay(parent)}`,
      );
    }
  }

  // Write atomically: stage in a sibling temp file, then rename over the
  // target so a crash or concurrent read never observes a partial write.
  const tmpPath = path.join(parent, `.codelink-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    await fs.promises.writeFile(tmpPath, bytes);
    await fs.promises.rename(tmpPath, resolved);
  } catch (error) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => undefined);
    return ioError(error, params.path);
  }

  return { path: guard.toRelativeDisplay(resolved), bytesWritten: bytes.length };
}

export interface DeleteParams {
  root: string;
  path: string;
  recursive?: boolean;
}

export async function deleteEntry(params: DeleteParams): Promise<{ path: string; deleted: true }> {
  const guard = await WorkspaceGuard.create(params.root);
  const resolved = await guard.resolve(params.path);
  guard.guardAgainstRootDeletion(resolved);

  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(resolved);
  } catch (error) {
    return ioError(error, params.path);
  }

  try {
    if (stat.isDirectory()) {
      if (params.recursive) {
        await fs.promises.rm(resolved, { recursive: true, force: true });
      } else {
        await fs.promises.rmdir(resolved);
      }
    } else {
      await fs.promises.unlink(resolved);
    }
  } catch (error) {
    return ioError(error, params.path);
  }

  return { path: guard.toRelativeDisplay(resolved), deleted: true };
}

export interface TransferParams {
  root: string;
  from: string;
  to: string;
  overwrite?: boolean;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function movePath(params: TransferParams): Promise<{ from: string; to: string }> {
  const guard = await WorkspaceGuard.create(params.root);
  const from = await guard.resolve(params.from);
  const to = await guard.resolve(params.to);
  guard.guardAgainstRootDeletion(from);

  if (!(await fileExists(from))) {
    throw new CodeLinkError(ErrorCodes.FILE_NOT_FOUND, `File not found: ${params.from}`);
  }
  if ((await fileExists(to)) && !params.overwrite) {
    throw new CodeLinkError(ErrorCodes.ALREADY_EXISTS, `Already exists: ${params.to}`);
  }
  await fs.promises.mkdir(path.dirname(to), { recursive: true }).catch((error: unknown) => ioError(error, params.to));
  try {
    await fs.promises.rename(from, to);
  } catch (error) {
    return ioError(error, params.from);
  }

  return { from: guard.toRelativeDisplay(from), to: guard.toRelativeDisplay(to) };
}

async function copyDirRecursive(from: string, to: string): Promise<void> {
  await fs.promises.mkdir(to, { recursive: true });
  const entries = await fs.promises.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const fromChild = path.join(from, entry.name);
    const toChild = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(fromChild, toChild);
    } else {
      await fs.promises.copyFile(fromChild, toChild);
    }
  }
}

export async function copyPath(params: TransferParams): Promise<{ from: string; to: string }> {
  const guard = await WorkspaceGuard.create(params.root);
  const from = await guard.resolve(params.from);
  const to = await guard.resolve(params.to);

  if (!(await fileExists(from))) {
    throw new CodeLinkError(ErrorCodes.FILE_NOT_FOUND, `File not found: ${params.from}`);
  }
  if ((await fileExists(to)) && !params.overwrite) {
    throw new CodeLinkError(ErrorCodes.ALREADY_EXISTS, `Already exists: ${params.to}`);
  }
  await fs.promises.mkdir(path.dirname(to), { recursive: true }).catch((error: unknown) => ioError(error, params.to));

  try {
    const stat = await fs.promises.stat(from);
    if (stat.isDirectory()) {
      await copyDirRecursive(from, to);
    } else {
      await fs.promises.copyFile(from, to);
    }
  } catch (error) {
    return ioError(error, params.from);
  }

  return { from: guard.toRelativeDisplay(from), to: guard.toRelativeDisplay(to) };
}

export interface ExistsParams {
  root: string;
  path: string;
}

export async function exists(
  params: ExistsParams,
): Promise<{ exists: boolean; isDirectory: boolean; isFile: boolean; size: number }> {
  const guard = await WorkspaceGuard.create(params.root);
  const resolved = await guard.resolve(params.path);

  try {
    const stat = await fs.promises.lstat(resolved);
    return { exists: true, isDirectory: stat.isDirectory(), isFile: stat.isFile(), size: stat.size };
  } catch (error) {
    if (isNotFound(error)) {
      return { exists: false, isDirectory: false, isFile: false, size: 0 };
    }
    return ioError(error, params.path);
  }
}

export interface ListParams {
  root: string;
  path?: string;
  glob?: string;
  maxDepth?: number;
  limit?: number;
  exclude?: string[];
}

export interface FileEntry {
  path: string;
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modifiedMs?: number;
}

export async function list(params: ListParams): Promise<{ entries: FileEntry[]; truncated: boolean }> {
  const guard = await WorkspaceGuard.create(params.root);
  const start = await guard.resolve(params.path ?? "");
  if (!(await fileExists(start))) {
    throw new CodeLinkError(ErrorCodes.FILE_NOT_FOUND, `File not found: ${params.path ?? ""}`);
  }

  const isExcluded = buildExcludeMatcher(params.exclude ?? []);
  const globMatcher = params.glob ? compileGlob(params.glob) : undefined;
  const limit = params.limit ?? DEFAULT_LIST_LIMIT;

  const entries: FileEntry[] = [];
  let truncated = false;

  for await (const entry of walk(guard, start, {
    maxDepth: params.maxDepth,
    isExcluded: (probePath) => isExcluded(probePath),
  })) {
    if (globMatcher && !globMatcher.test(entry.relativeDisplay)) {
      continue;
    }
    if (entries.length >= limit) {
      truncated = true;
      break;
    }
    entries.push({
      path: entry.relativeDisplay,
      name: entry.name,
      isDir: entry.isDir,
      isSymlink: entry.isSymlink,
      size: entry.stat.size,
      modifiedMs: Math.floor(entry.stat.mtimeMs),
    });
  }

  return { entries, truncated };
}
