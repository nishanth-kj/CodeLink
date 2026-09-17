export interface SessionInfo {
  sessionId: string;
  connectedAtMs: number;
}

/** Tracks active Streamable HTTP sessions for the status bar and dashboard.
 * Wired to the transport's `onsessioninitialized`/`onsessionclosed`
 * callbacks in `mcp/transport.ts`. */
export class SessionTracker {
  private readonly sessions = new Map<string, SessionInfo>();

  readonly onInitialized = (sessionId: string): void => {
    this.sessions.set(sessionId, { sessionId, connectedAtMs: Date.now() });
  };

  readonly onClosed = (sessionId: string): void => {
    this.sessions.delete(sessionId);
  };

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  get isConnected(): boolean {
    return this.sessions.size > 0;
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  reset(): void {
    this.sessions.clear();
  }
}
