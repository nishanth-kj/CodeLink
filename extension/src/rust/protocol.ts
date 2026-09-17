/**
 * Mirrors `core/src/protocol.rs`. This is the wire format for the
 * line-delimited JSON IPC protocol spoken over the `codelink-core`
 * process's stdin/stdout: one JSON object per line, stdout reserved
 * exclusively for these messages (all Rust-side logging goes to stderr).
 */

export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

export interface IpcRequest {
  id: string;
  method: string;
  params: unknown;
}

export interface IpcSuccessResponse {
  id: string;
  success: true;
  result: unknown;
}

export interface IpcErrorResponse {
  id: string;
  success: false;
  error: { code: string; message: string };
}

export type IpcResponse = IpcSuccessResponse | IpcErrorResponse;

export interface IpcNotification {
  method: string;
  params: unknown;
}

export type IpcMessage = IpcResponse | IpcNotification;

export function isIpcNotification(message: IpcMessage): message is IpcNotification {
  return !("id" in message);
}
