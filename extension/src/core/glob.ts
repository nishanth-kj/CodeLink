import { CodeLinkError, ErrorCodes } from "../utils/errors.js";

function escapeRegExpChar(char: string): string {
  return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/**
 * Compiles a small, self-contained glob syntax (`*`, `**`, `?`) against
 * forward-slashed, workspace-relative display paths. Only the subset of
 * glob syntax this codebase's exclude/include patterns actually use is
 * supported: no brace expansion or character classes.
 */
export function compileGlob(pattern: string): RegExp {
  let body = "";
  let i = 0;
  while (i < pattern.length) {
    const char = pattern.charAt(i);
    if (char === "*") {
      if (pattern.charAt(i + 1) === "*") {
        if (pattern.charAt(i + 2) === "/") {
          body += "(?:.*/)?";
          i += 3;
        } else {
          body += ".*";
          i += 2;
        }
      } else {
        body += "[^/]*";
        i += 1;
      }
      continue;
    }
    if (char === "?") {
      body += "[^/]";
      i += 1;
      continue;
    }
    body += escapeRegExpChar(char);
    i += 1;
  }
  try {
    return new RegExp(`^${body}$`);
  } catch (error) {
    throw new CodeLinkError(ErrorCodes.INVALID_ARGUMENT, `Invalid glob '${pattern}': ${(error as Error).message}`);
  }
}

export type ExcludeMatcher = (relativeDisplay: string) => boolean;

export function buildExcludeMatcher(patterns: string[]): ExcludeMatcher {
  const regexes = patterns.map(compileGlob);
  return (relativeDisplay: string) => regexes.some((regex) => regex.test(relativeDisplay));
}
