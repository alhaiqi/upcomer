import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLOW_OPERATION_MS, timed } from "@/lib/timing";

let errors: ReturnType<typeof vi.spyOn>;
const logged = () => errors.mock.calls.map(call => JSON.parse(String(call[0])));
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

describe("timed operations", () => {
  it("returns the result and logs nothing when the operation is fast", async () => {
    expect(await timed("fast", { fileId: "f1" }, async () => 42)).toBe(42);
    expect(logged()).toEqual([]);
  });
  it("logs a slow operation with its duration and IDs", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(SLOW_OPERATION_MS + 250);
    await timed("upload", { userId: "admin-1" }, async () => undefined);
    now.mockRestore();
    expect(logged()).toEqual([expect.objectContaining({ event: "slow_operation", level: "warn", operation: "upload", durationMs: "1250", userId: "admin-1" })]);
  });
  it("still times an operation that throws, and rethrows", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(5000);
    await expect(timed("broken", {}, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    now.mockRestore();
    expect(logged()[0]).toMatchObject({ event: "slow_operation", operation: "broken" });
  });
});
