import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  file: { findUnique: vi.fn() }, transaction: vi.fn(), mkdir: vi.fn(), realpath: vi.fn(),
  write: vi.fn(), open: vi.fn(), close: vi.fn(), unlink: vi.fn(), log: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { courseFile: mocks.file, $transaction: mocks.transaction } }));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir, realpath: mocks.realpath, writeFile: mocks.write, open: mocks.open, unlink: mocks.unlink }));
vi.mock("@/lib/exam-extraction", () => ({ extractExamQuestions: vi.fn().mockResolvedValue(["A replacement question."]) }));
vi.mock("@/lib/question-bank", () => ({ regroupCourseInTransaction: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: mocks.log }));
import { manageFile } from "@/lib/file-management";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FILE_STORAGE_ROOT", path.resolve("reports/storage-test"));
  mocks.file.findUnique.mockResolvedValue({ id: "file", courseId: "course", category: "EXAM", updatedAt: new Date("2026-01-01") });
  mocks.realpath.mockImplementation(async value => value);
  mocks.write.mockRejectedValue(Object.assign(new Error("private filesystem detail"), { code: "ENOSPC" }));
  mocks.open.mockResolvedValue({ writeFile: mocks.write, close: mocks.close });
  mocks.close.mockResolvedValue(undefined);
  mocks.unlink.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
it("removes its own partial staged file if storage fills up before staging returns", async () => {
  const result = await manageFile("admin", "file", "2026-01-01T00:00:00.000Z", { operation: "replace", fileName: "new.pdf", bytes: Buffer.from("%PDF-1.4\n") });
  expect(result).toEqual({ ok: false, error: "unexpected" });
  expect(mocks.unlink).toHaveBeenCalledWith(expect.stringMatching(/exams[\\/].+\.pdf$/));
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("private filesystem");
});
it("does not unlink an existing file when exclusive creation fails", async () => {
  mocks.open.mockRejectedValueOnce(Object.assign(new Error("collision"), { code: "EEXIST" }));
  expect(await manageFile("admin", "file", "2026-01-01T00:00:00.000Z", { operation: "replace", fileName: "new.pdf", bytes: Buffer.from("%PDF-1.4\n") })).toEqual({ ok: false, error: "unexpected" });
  expect(mocks.unlink).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
