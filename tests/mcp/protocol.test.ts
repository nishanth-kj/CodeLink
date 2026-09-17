import { describe, expect, it } from "vitest";
import {
  extractBearerToken,
  httpStatusForErrorCode,
  isHostHeaderAllowed,
} from "../../extension/src/mcp/protocol.js";
import { ErrorCodes } from "../../extension/src/utils/errors.js";

describe("httpStatusForErrorCode", () => {
  it("maps authentication errors to 401", () => {
    expect(httpStatusForErrorCode(ErrorCodes.AUTHENTICATION_REQUIRED)).toBe(401);
    expect(httpStatusForErrorCode(ErrorCodes.AUTHENTICATION_FAILED)).toBe(401);
  });

  it("maps rate limiting to 429", () => {
    expect(httpStatusForErrorCode(ErrorCodes.RATE_LIMITED)).toBe(429);
  });

  it("maps permission-related errors to 403", () => {
    expect(httpStatusForErrorCode(ErrorCodes.PERMISSION_DENIED)).toBe(403);
    expect(httpStatusForErrorCode(ErrorCodes.REMOTE_ACCESS_DISABLED)).toBe(403);
  });

  it("defaults unknown codes to 500", () => {
    expect(httpStatusForErrorCode("SOMETHING_ELSE")).toBe(500);
  });
});

describe("isHostHeaderAllowed", () => {
  it("allows loopback hosts on the configured port when remote is disabled", () => {
    expect(isHostHeaderAllowed("127.0.0.1:32100", 32100, false)).toBe(true);
    expect(isHostHeaderAllowed("localhost:32100", 32100, false)).toBe(true);
    expect(isHostHeaderAllowed("[::1]:32100", 32100, false)).toBe(true);
  });

  it("rejects a mismatched port or an arbitrary host when remote is disabled", () => {
    expect(isHostHeaderAllowed("127.0.0.1:9999", 32100, false)).toBe(false);
    expect(isHostHeaderAllowed("evil.example.com", 32100, false)).toBe(false);
    expect(isHostHeaderAllowed(undefined, 32100, false)).toBe(false);
  });

  it("allows any host once remote access is enabled", () => {
    expect(isHostHeaderAllowed("evil.example.com", 32100, true)).toBe(true);
    expect(isHostHeaderAllowed(undefined, 32100, true)).toBe(true);
  });
});

describe("extractBearerToken", () => {
  it("extracts the token from a well-formed header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("returns undefined for a missing or malformed header", () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken("abc123")).toBeUndefined();
    expect(extractBearerToken("Basic abc123")).toBeUndefined();
    expect(extractBearerToken("Bearer ")).toBeUndefined();
  });

  it("uses the first value when the header is duplicated", () => {
    expect(extractBearerToken(["Bearer first", "Bearer second"])).toBe("first");
  });
});
