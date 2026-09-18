import * as fs from "node:fs";
import { CodeLinkError, ErrorCodes } from "../utils/errors.js";
import { buildExcludeMatcher, compileGlob } from "./glob.js";
import { walk } from "./walk.js";
import { WorkspaceGuard } from "./workspaceGuard.js";
import type { Cancellation } from "./cancellation.js";

const DEFAULT_MAX_RESULTS = 100;
const HARD_MAX_RESULTS = 10_000;
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_LINE_DISPLAY_CHARS = 500;
/** How often (in scanned lines) the deadline/cancellation flag is polled
 * and the event loop is yielded, matching the Rust core's cadence. */
const CHECK_EVERY_N_LINES = 200;

export interface SearchParams {
  root: string;
  query: string;
  path?: string;
  filePattern?: string;
  caseSensitive?: boolean;
  isRegex?: boolean;
  maxResults?: number;
  maxFileSize?: number;
  timeoutMs?: number;
  exclude?: string[];
}

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  lineText: string;
}

function truncateLine(line: string): string {
  return line.length > MAX_LINE_DISPLAY_CHARS ? `${line.slice(0, MAX_LINE_DISPLAY_CHARS)}…` : line;
}

function isValidUtf8(buffer: Buffer): boolean {
  return Buffer.from(buffer.toString("utf8"), "utf8").equals(buffer);
}

function splitLines(text: string): string[] {
  const withoutTrailingNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (withoutTrailingNewline.length === 0) {
    return [];
  }
  return withoutTrailingNewline.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export async function text(
  params: SearchParams,
  requestId: string,
  cancellation: Cancellation,
): Promise<{ matches: SearchMatch[]; truncated: boolean; timedOut: boolean }> {
  if (params.query.length === 0) {
    throw new CodeLinkError(ErrorCodes.INVALID_ARGUMENT, "query must not be empty");
  }

  const guard = await WorkspaceGuard.create(params.root);
  const start = await guard.resolve(params.path ?? "");
  if (!(await fs.promises.stat(start).catch(() => undefined))) {
    throw new CodeLinkError(ErrorCodes.FILE_NOT_FOUND, `File not found: ${params.path ?? ""}`);
  }

  const isExcluded = buildExcludeMatcher(params.exclude ?? []);
  const fileMatcher = params.filePattern ? compileGlob(params.filePattern) : undefined;

  let regex: RegExp | undefined;
  if (params.isRegex) {
    try {
      regex = new RegExp(params.query, params.caseSensitive ? "" : "i");
    } catch (error) {
      throw new CodeLinkError(ErrorCodes.INVALID_ARGUMENT, `Invalid regex: ${(error as Error).message}`);
    }
  }
  const needle = params.caseSensitive ? params.query : params.query.toLowerCase();

  const maxResults = Math.min(params.maxResults ?? DEFAULT_MAX_RESULTS, HARD_MAX_RESULTS);
  const maxFileSize = params.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const deadline = Date.now() + (params.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const cancellationFlag = cancellation.register(requestId);
  try {
    const matches: SearchMatch[] = [];
    let truncated = false;
    let timedOut = false;
    let linesSinceCheck = 0;

    walkFiles: for await (const entry of walk(guard, start, { isExcluded: (probePath) => isExcluded(probePath) })) {
      if (entry.isDir) {
        continue;
      }
      if (cancellationFlag.cancelled) {
        throw new CodeLinkError(ErrorCodes.REQUEST_CANCELLED, "The request was cancelled");
      }
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }
      if (fileMatcher && !fileMatcher.test(entry.relativeDisplay)) {
        continue;
      }
      if (entry.stat.size > maxFileSize) {
        continue;
      }

      let buffer: Buffer;
      try {
        buffer = await fs.promises.readFile(entry.absolutePath);
      } catch {
        continue;
      }
      if (!isValidUtf8(buffer)) {
        continue;
      }

      const lines = splitLines(buffer.toString("utf8"));
      for (let idx = 0; idx < lines.length; idx += 1) {
        linesSinceCheck += 1;
        if (linesSinceCheck >= CHECK_EVERY_N_LINES) {
          linesSinceCheck = 0;
          await yieldToEventLoop();
          if (cancellationFlag.cancelled) {
            throw new CodeLinkError(ErrorCodes.REQUEST_CANCELLED, "The request was cancelled");
          }
          if (Date.now() >= deadline) {
            timedOut = true;
            break walkFiles;
          }
        }

        const line = lines[idx] ?? "";
        const column = regex
          ? (regex.exec(line)?.index ?? -1)
          : (params.caseSensitive ? line : line.toLowerCase()).indexOf(needle);

        if (column >= 0) {
          matches.push({ file: entry.relativeDisplay, line: idx + 1, column: column + 1, lineText: truncateLine(line) });
          if (matches.length >= maxResults) {
            truncated = true;
            break walkFiles;
          }
        }
      }
    }

    return { matches, truncated, timedOut };
  } finally {
    cancellation.unregister(requestId);
  }
}
