import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    findUnique.mockResolvedValue({ storageKey: "not-present.pdf", courseId: "course-a", status: "PUBLISHED", submittedById: null });
    await expect(getOriginalFile("missing")).rejects.toMatchObject({ reason: "missing_file", courseId: "course-a" });
  });
  it("rejects an unsafe storage key", async () => {
    findUnique.mockResolvedValue({ storageKey: "../secret", courseId: "course-a", status: "PUBLISHED", submittedById: null });
    await expect(getOriginalFile("unsafe")).rejects.toMatchObject({ reason: "unsafe_key", courseId: "course-a" });
  });
});

describe("unpublished submissions (US-13)", () => {
  const pending = { id: "file-p", storageKey: "eece350-final-2025.pdf", courseId: "course-a", status: "PENDING", submittedById: "student-a" };
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { errors = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => errors.mockRestore());

  it.each([
    ["a visitor", null, "anonymous"],
    ["another student", { id: "student-b", role: "STUDENT" as const }, "STUDENT"],
  ])("looks like a missing record to %s, without a course link", async (_name, viewer, role) => {
    findUnique.mockResolvedValue(pending);
    const failure = await getOriginalFile("file-p", viewer).catch(error => error);
    expect(failure).toMatchObject({ reason: "missing_record" });
    expect(failure.courseId).toBeUndefined();
    const line = JSON.parse(String(errors.mock.calls[0][0]));
    expect(line).toMatchObject({ event: "unpublished_file_access", level: "warn", fileId: "file-p", role });
  });
  it.each(["PENDING", "REJECTED"])("opens a %s file for its submitter and for admins", async status => {
    findUnique.mockResolvedValue({ ...pending, status });
    for (const viewer of [{ id: "student-a", role: "STUDENT" as const }, { id: "admin", role: "ADMIN" as const }]) {
      const { record, bytes } = await getOriginalFile("file-p", viewer);
      expect(record.id).toBe("file-p");
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });
});
