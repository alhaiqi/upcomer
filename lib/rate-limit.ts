// A fixed-window request limit per key, kept in memory (DoS protection).
// One server process keeps its own counts, which fits one Next.js server; several servers would need a shared store such as Redis.

type Window = { startedAt: number; count: number };
const windows = new Map<string, Window>();
const MAX_KEYS = 10_000;

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  let window = windows.get(key);
  if (!window || now - window.startedAt >= windowMs) {
    // Old windows are dropped first, so a flood of new keys cannot grow the map without bound.
    if (windows.size >= MAX_KEYS) {
      for (const [stored, value] of windows) if (now - value.startedAt >= windowMs) windows.delete(stored);
      if (windows.size >= MAX_KEYS) windows.delete(windows.keys().next().value!);
    }
    window = { startedAt: now, count: 0 };
    windows.set(key, window);
  }
  window.count++;
  if (window.count <= limit) return { ok: true };
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + windowMs - now) / 1000)) };
}

// For tests.
export function resetRateLimits() {
  windows.clear();
}

// A positive whole number from the environment, or the fallback.
export function limitFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
