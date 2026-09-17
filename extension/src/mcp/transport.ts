import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { SessionTracker } from "./session.js";

/** Builds the Streamable HTTP transport in stateful mode: the server
 * generates a session ID on `initialize` and tracks it via `sessionTracker`
 * so the dashboard/status bar can show whether a client is connected. */
export function createTransport(sessionTracker: SessionTracker): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: sessionTracker.onInitialized,
    onsessionclosed: sessionTracker.onClosed,
  });
}
