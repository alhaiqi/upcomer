import { describe, expect, it } from "vitest";
import path from "node:path";
import { FileUnavailableError, resolveStoragePath } from "@/lib/files";

describe("file path validation", () => {
  it("resolves a key within storage", () => {
    expect(resolveStoragePath("notes/file.pdf", "storage")).toBe(path.resolve("storage/notes/file.pdf"));
  });
  it.each(["../secret", "/etc/passwd", "C:\\secret", "notes\\file.pdf", "a//b", "./file.pdf", ""]) ("rejects unsafe key %s", key => {
    expect(() => resolveStoragePath(key, "storage")).toThrow(FileUnavailableError);
  });
});
