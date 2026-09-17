import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../extension/src/security/rateLimiter.js";

describe("RateLimiter", () => {
  it("allows requests up to the configured limit within a window", () => {
    const limiter = new RateLimiter(3, 10);
    const now = 1_000_000;
    expect(limiter.checkAndConsume("client", now).allowed).toBe(true);
    expect(limiter.checkAndConsume("client", now + 1).allowed).toBe(true);
    expect(limiter.checkAndConsume("client", now + 2).allowed).toBe(true);
    const fourth = limiter.checkAndConsume("client", now + 3);
    expect(fourth.allowed).toBe(false);
  });

  it("resets once the window has elapsed", () => {
    const limiter = new RateLimiter(1, 10);
    const now = 1_000_000;
    expect(limiter.checkAndConsume("client", now).allowed).toBe(true);
    expect(limiter.checkAndConsume("client", now + 100).allowed).toBe(false);
    expect(limiter.checkAndConsume("client", now + 60_001).allowed).toBe(true);
  });

  it("tracks separate clients independently", () => {
    const limiter = new RateLimiter(1, 10);
    const now = 1_000_000;
    expect(limiter.checkAndConsume("a", now).allowed).toBe(true);
    expect(limiter.checkAndConsume("b", now).allowed).toBe(true);
  });

  it("caps concurrency per client", () => {
    const limiter = new RateLimiter(100, 2);
    expect(limiter.tryAcquireConcurrency("client")).toBe(true);
    expect(limiter.tryAcquireConcurrency("client")).toBe(true);
    expect(limiter.tryAcquireConcurrency("client")).toBe(false);
    limiter.releaseConcurrency("client");
    expect(limiter.tryAcquireConcurrency("client")).toBe(true);
  });
});
