import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, limitFromEnv, resetRateLimits } from "@/lib/rate-limit";

beforeEach(() => resetRateLimits());
afterEach(() => vi.unstubAllEnvs());

describe("rate limit", () => {
  it("allows the limit, refuses the rest, and opens again in the next window", () => {
    const start = 1_000_000;
    for (let index = 0; index < 3; index++) expect(checkRateLimit("review:a", 3, 60_000, start)).toEqual({ ok: true });
    expect(checkRateLimit("review:a", 3, 60_000, start + 15_000)).toEqual({ ok: false, retryAfterSeconds: 45 });
    expect(checkRateLimit("review:b", 3, 60_000, start + 15_000)).toEqual({ ok: true });
    expect(checkRateLimit("review:a", 3, 60_000, start + 60_000)).toEqual({ ok: true });
  });
  it("reads a positive whole limit from the environment, or falls back", () => {
    vi.stubEnv("TEST_LIMIT", "12");
    expect(limitFromEnv("TEST_LIMIT", 30)).toBe(12);
    for (const value of ["0", "-3", "2.5", "lots", ""]) {
      vi.stubEnv("TEST_LIMIT", value);
      expect(limitFromEnv("TEST_LIMIT", 30)).toBe(30);
    }
    vi.unstubAllEnvs();
  });
});
