import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, saveFileMetadata, redirect } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), saveFileMetadata: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/file-metadata", () => ({ saveFileMetadata }));
import { saveFileMetadataAction } from "@/lib/file-metadata-actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  saveFileMetadata.mockReset().mockResolvedValue({ ok: true, id: "file-1", courseId: "course-eece330" });
  redirect.mockClear();
});

describe("file metadata action", () => {
  it("saves and returns to the list filtered by the file's new course", async () => {
    const data = form({ id: "file-1", courseId: "course-eece330" });
    await expect(saveFileMetadataAction(data)).rejects.toThrow("NEXT_REDIRECT /admin/files?courseId=course-eece330&saved=1");
    expect(requireAdmin).toHaveBeenCalledWith("/admin/files");
    expect(saveFileMetadata).toHaveBeenCalledWith("file-1", data);
  });
  it("sends a refused save back to the edit page with the reason", async () => {
    saveFileMetadata.mockResolvedValue({ ok: false, error: "course_required" });
    await expect(saveFileMetadataAction(form({ id: "file-1", courseId: "" }))).rejects.toThrow("NEXT_REDIRECT /admin/files/file-1?error=course_required");
  });
  it("sends an edit of a deleted file back to the list", async () => {
    saveFileMetadata.mockResolvedValue({ ok: false, error: "not_found" });
    await expect(saveFileMetadataAction(form({ id: "ghost" }))).rejects.toThrow("NEXT_REDIRECT /admin/files?error=not_found");
  });
  it("saves nothing for a student or a visitor", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    await expect(saveFileMetadataAction(form({ id: "file-1", courseId: "course-eece330" }))).rejects.toThrow("NEXT_NOT_FOUND");
    requireAdmin.mockRejectedValueOnce(new Error("NEXT_REDIRECT /login?next=%2Fadmin%2Ffiles"));
    await expect(saveFileMetadataAction(form({ id: "file-1", courseId: "course-eece330" }))).rejects.toThrow("NEXT_REDIRECT /login?next=%2Fadmin%2Ffiles");
    expect(saveFileMetadata).not.toHaveBeenCalled();
  });
});
