export type ActivityOutcome = "success" | "denied" | "error";

export interface ActivityEntry {
  id: number;
  atMs: number;
  tool: string;
  permission: string | null;
  outcome: ActivityOutcome;
  /** Error code when outcome is "denied" or "error" (e.g. FILE_WRITE_DISABLED). */
  code?: string;
  clientId: string;
  durationMs: number;
}

export type ActivityListener = (entry: ActivityEntry) => void;

const MAX_ENTRIES = 200;

/**
 * In-memory, per-session record of every tool call handled through
 * `bindTool()` (`tools/index.ts`) — which permission it needed, whether it
 * was allowed, and how it turned out. Backs the "Activity" section in the
 * dashboard and sidebar so a developer can see, at a glance, what an
 * MCP client has actually been doing and which permission gated each call.
 * Not persisted: it resets when the extension host reloads, same as the
 * in-memory rate limiter and session tracker.
 */
export class ActivityLog {
  private readonly entries: ActivityEntry[] = [];
  private readonly listeners = new Set<ActivityListener>();
  private nextId = 1;

  record(entry: Omit<ActivityEntry, "id" | "atMs">): ActivityEntry {
    const full: ActivityEntry = { ...entry, id: this.nextId, atMs: Date.now() };
    this.nextId += 1;
    this.entries.push(full);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
    for (const listener of this.listeners) {
      listener(full);
    }
    return full;
  }

  /** Most recent entries first. */
  list(limit = MAX_ENTRIES): ActivityEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  onEntry(listener: ActivityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.entries.length = 0;
  }
}
