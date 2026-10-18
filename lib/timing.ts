import { logError, sanitizeContext, type LogContext } from "@/lib/logger";

// Response times in the logs. The target for this app is 100 ms to 1 s per operation.
// Every timed operation prints one JSON line (event "operation_timed") to the server log; the load test reads these lines.
// One slower than SLOW_OPERATION_MS is also logged as "slow_operation", so it is saved and shows on /admin/monitoring.
export const SLOW_OPERATION_MS = 1000;

export async function timed<T>(operation: string, context: LogContext, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await run();
  } finally {
    const durationMs = Math.round(performance.now() - started);
    if (process.env.NODE_ENV !== "test") {
      console.log(JSON.stringify({ event: "operation_timed", level: "info", timestamp: new Date().toISOString(), operation, durationMs, ...sanitizeContext(context) }));
    }
    if (durationMs > SLOW_OPERATION_MS) logError("slow_operation", { ...context, operation, durationMs: String(durationMs) });
  }
}
