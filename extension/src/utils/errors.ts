/**
 * Structured error codes shared across the security layer, the Rust bridge,
 * and MCP tool handlers. Keeping them in one enum-like map means every
 * layer speaks the same vocabulary and an MCP client always sees one of
 * these codes rather than a raw exception message.
 */
export const ErrorCodes = {
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  AUTHENTICATION_FAILED: "AUTHENTICATION_FAILED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  PATH_OUTSIDE_WORKSPACE: "PATH_OUTSIDE_WORKSPACE",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  FILE_WRITE_DISABLED: "FILE_WRITE_DISABLED",
  FILE_DELETE_DISABLED: "FILE_DELETE_DISABLED",
  TERMINAL_DISABLED: "TERMINAL_DISABLED",
  TERMINAL_TIMEOUT: "TERMINAL_TIMEOUT",
  PROCESS_NOT_FOUND: "PROCESS_NOT_FOUND",
  GIT_WRITE_DISABLED: "GIT_WRITE_DISABLED",
  REMOTE_ACCESS_DISABLED: "REMOTE_ACCESS_DISABLED",
  PORT_IN_USE: "PORT_IN_USE",
  SERVER_START_FAILED: "SERVER_START_FAILED",
  SERVER_NOT_RUNNING: "SERVER_NOT_RUNNING",
  RUST_CORE_UNAVAILABLE: "RUST_CORE_UNAVAILABLE",
  RUST_CORE_CRASHED: "RUST_CORE_CRASHED",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
  RATE_LIMITED: "RATE_LIMITED",
  SECRET_ACCESS_DENIED: "SECRET_ACCESS_DENIED",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  NOT_A_DIRECTORY: "NOT_A_DIRECTORY",
  IS_A_DIRECTORY: "IS_A_DIRECTORY",
  METHOD_NOT_FOUND: "METHOD_NOT_FOUND",
  REQUEST_CANCELLED: "REQUEST_CANCELLED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class CodeLinkError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: ErrorCode | string, message: string, details?: unknown) {
    super(message);
    this.name = "CodeLinkError";
    this.code = code;
    this.details = details;
  }

  static isCodeLinkError(error: unknown): error is CodeLinkError {
    return error instanceof CodeLinkError;
  }
}
