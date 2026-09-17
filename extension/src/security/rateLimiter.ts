export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * Sliding-window request-rate limiting plus a concurrency cap, keyed per
 * client. Only wired into the tool execution pipeline when remote access is
 * enabled (see `security/policy.ts`) — a purely local, unauthenticated
 * session isn't the threat model this defends against, and applying it
 * there would just add friction for a single trusted developer.
 */
export class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly concurrent = new Map<string, number>();

  constructor(
    private requestsPerMinute: number,
    private maxConcurrentRequests: number,
  ) {}

  updateLimits(requestsPerMinute: number, maxConcurrentRequests: number): void {
    this.requestsPerMinute = requestsPerMinute;
    this.maxConcurrentRequests = maxConcurrentRequests;
  }

  checkAndConsume(clientId: string, now: number = Date.now()): RateLimitResult {
    const windowStart = now - 60_000;
    const timestamps = (this.windows.get(clientId) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= this.requestsPerMinute) {
      const oldest = timestamps[0] ?? now;
      this.windows.set(clientId, timestamps);
      return { allowed: false, retryAfterMs: Math.max(0, oldest + 60_000 - now) };
    }

    timestamps.push(now);
    this.windows.set(clientId, timestamps);
    return { allowed: true };
  }

  tryAcquireConcurrency(clientId: string): boolean {
    const current = this.concurrent.get(clientId) ?? 0;
    if (current >= this.maxConcurrentRequests) {
      return false;
    }
    this.concurrent.set(clientId, current + 1);
    return true;
  }

  releaseConcurrency(clientId: string): void {
    const current = this.concurrent.get(clientId) ?? 0;
    if (current <= 1) {
      this.concurrent.delete(clientId);
    } else {
      this.concurrent.set(clientId, current - 1);
    }
  }

  reset(): void {
    this.windows.clear();
    this.concurrent.clear();
  }
}
