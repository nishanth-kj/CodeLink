import type { CodeLinkConfig, SecurityProfile } from "../config/schema.js";
import { ErrorCodes } from "../utils/errors.js";

export type PermissionKey =
  | "workspaceRead"
  | "workspaceSearch"
  | "editorRead"
  | "editorWrite"
  | "fileWrite"
  | "fileDelete"
  | "terminal"
  | "gitRead"
  | "gitWrite"
  | "remoteAccess";

export type PermissionSet = Record<PermissionKey, boolean>;

const READONLY: PermissionSet = {
  workspaceRead: true,
  workspaceSearch: true,
  editorRead: true,
  editorWrite: false,
  fileWrite: false,
  fileDelete: false,
  terminal: false,
  gitRead: true,
  gitWrite: false,
  remoteAccess: false,
};

const DEVELOPER: PermissionSet = {
  ...READONLY,
  editorWrite: true,
  fileWrite: true,
};

const TRUSTED: PermissionSet = {
  ...DEVELOPER,
  fileDelete: true,
  terminal: true,
  gitWrite: true,
};

/** Built-in profiles from section 19 of the CodeLink spec. `remoteAccess` is
 * always overridden by `codelink.remote.enabled` regardless of profile —
 * it has exactly one source of truth so a profile can never silently
 * imply remote exposure. */
export const SECURITY_PROFILES: Record<Exclude<SecurityProfile, "custom">, PermissionSet> = {
  readonly: READONLY,
  developer: DEVELOPER,
  trusted: TRUSTED,
};

/** Maps a denied permission to the specific MCP-facing error code a caller
 * should see, falling back to the generic PERMISSION_DENIED for permissions
 * that don't have a dedicated code. */
const DENIAL_CODES: Partial<Record<PermissionKey, string>> = {
  fileWrite: ErrorCodes.FILE_WRITE_DISABLED,
  fileDelete: ErrorCodes.FILE_DELETE_DISABLED,
  terminal: ErrorCodes.TERMINAL_DISABLED,
  gitWrite: ErrorCodes.GIT_WRITE_DISABLED,
  remoteAccess: ErrorCodes.REMOTE_ACCESS_DISABLED,
};

export type PermissionCheckResult = { allowed: true } | { allowed: false; code: string; message: string };

/**
 * The single place tool permission is decided. Every tool handler calls
 * `check()` (indirectly, via the tool execution pipeline in
 * `security/policy.ts`) instead of re-implementing profile/override logic
 * itself, so there is exactly one definition of what "developer profile"
 * or "custom profile with fileDelete on" means.
 */
export class PermissionManager {
  private readonly overrides = new Map<PermissionKey, boolean>();

  constructor(private readonly getConfig: () => CodeLinkConfig) {}

  toggle(permission: PermissionKey): boolean {
    const current = this.snapshot()[permission];
    const next = !current;
    this.overrides.set(permission, next);
    return next;
  }

  setOverride(permission: PermissionKey, allowed: boolean): void {
    this.overrides.set(permission, allowed);
  }

  clearOverrides(): void {
    this.overrides.clear();
  }

  private computeSet(): PermissionSet {
    const config = this.getConfig();
    const base: PermissionSet =
      config.security.profile === "custom"
        ? {
            workspaceRead: true,
            workspaceSearch: true,
            editorRead: true,
            editorWrite: config.security.allowEditorWrite,
            fileWrite: config.security.allowFileWrite,
            fileDelete: config.security.allowFileDelete,
            terminal: config.security.allowTerminal,
            gitRead: true,
            gitWrite: config.security.allowGitWrite,
            remoteAccess: false,
          }
        : { ...SECURITY_PROFILES[config.security.profile] };

    const set: PermissionSet = { ...base, remoteAccess: config.remote.enabled };
    for (const [key, value] of this.overrides.entries()) {
      set[key] = value;
    }
    return set;
  }

  snapshot(): PermissionSet {
    return this.computeSet();
  }

  check(permission: PermissionKey): PermissionCheckResult {
    const set = this.computeSet();
    if (set[permission]) {
      return { allowed: true };
    }
    const code = DENIAL_CODES[permission] ?? ErrorCodes.PERMISSION_DENIED;
    return { allowed: false, code, message: `Permission denied: '${permission}' is not enabled.` };
  }
}
