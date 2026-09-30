import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { courseFile: { findUnique } } }));
import { getOriginalFile } from "@/lib/files";

beforeEach(() => findUnique.mockReset());

describe("original file lookup", () => {
  it("rejects a missing database record", async () => {
    findUnique.mockResolvedValue(null);
    await expect(getOriginalFile("unknown")).rejects.toMatchObject({ reason: "missing_record" });
  });
  it("rejects a missing physical file", async () => {
    findUnique.mockResolvedValue({ storageKey: "not-present.pdf" });
    await expect(getOriginalFile("missing")).rejects.toMatchObject({ reason: "missing_file" });
  });
  it("rejects an unsafe storage key", async () => {
    findUnique.mockResolvedValue({ storageKey: "../secret" });
    await expect(getOriginalFile("unsafe")).rejects.toMatchObject({ reason: "unsafe_key" });
  });
});
