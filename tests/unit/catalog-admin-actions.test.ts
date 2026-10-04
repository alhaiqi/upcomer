import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, saveFaculty, saveCourse, saveProfessor, saveTerm, redirect } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), saveFaculty: vi.fn(), saveCourse: vi.fn(), saveProfessor: vi.fn(), saveTerm: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/catalog-admin", () => ({ saveFaculty, saveCourse, saveProfessor, saveTerm }));
import { saveCourseAction, saveFacultyAction, saveProfessorAction, saveTermAction } from "@/lib/catalog-admin-actions";

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const item of [value].flat()) data.append(name, item);
  return data;
};
const admin = { id: "admin-1", role: "ADMIN" };

beforeEach(() => {
  for (const mock of [requireAdmin, saveFaculty, saveCourse, saveProfessor, saveTerm]) mock.mockReset();
  redirect.mockClear();
  requireAdmin.mockResolvedValue(admin);
  for (const save of [saveFaculty, saveCourse, saveProfessor, saveTerm]) save.mockResolvedValue({ ok: true, id: "new-id" });
});

describe("catalog actions", () => {
  it("adds a course with every ticked professor and returns to the list", async () => {
    await expect(saveCourseAction(form({ code: "eece 351", name: "Signals", facultyId: "faculty-eng", professorIds: ["prof-a", "prof-b"] })))
      .rejects.toThrow("NEXT_REDIRECT /admin/catalog/courses?saved=1");
    expect(requireAdmin).toHaveBeenCalledWith("/admin/catalog/courses");
    expect(saveCourse).toHaveBeenCalledWith({ id: undefined, code: "eece 351", name: "Signals", facultyId: "faculty-eng", professorIds: ["prof-a", "prof-b"] });
  });
  it("sends a duplicate course code back to the add form with the code", async () => {
    saveCourse.mockResolvedValue({ ok: false, error: "duplicate_code", value: "EECE350" });
    await expect(saveCourseAction(form({ code: "eece 350", name: "Again", facultyId: "faculty-eng" })))
      .rejects.toThrow("NEXT_REDIRECT /admin/catalog/courses?error=duplicate_code&value=EECE350");
  });
  it("sends a failed edit back to the edit page", async () => {
    saveFaculty.mockResolvedValue({ ok: false, error: "invalid_fields" });
    await expect(saveFacultyAction(form({ id: "faculty-eng", code: "", name: "Engineering" })))
      .rejects.toThrow("NEXT_REDIRECT /admin/catalog/faculties/faculty-eng?error=invalid_fields");
    expect(saveFaculty).toHaveBeenCalledWith({ id: "faculty-eng", code: "", name: "Engineering" });
  });
  it("sends an edit of a deleted entry back to the list", async () => {
    saveTerm.mockResolvedValue({ ok: false, error: "not_found" });
    await expect(saveTermAction(form({ id: "ghost", name: "Fall" }))).rejects.toThrow("NEXT_REDIRECT /admin/catalog/terms?error=not_found");
  });
  it("saves professors and terms", async () => {
    await expect(saveProfessorAction(form({ id: "prof-a", name: "Professor A" }))).rejects.toThrow("NEXT_REDIRECT /admin/catalog/professors?saved=1");
    expect(saveProfessor).toHaveBeenCalledWith({ id: "prof-a", name: "Professor A" });
    await expect(saveTermAction(form({ name: "Winter" }))).rejects.toThrow("NEXT_REDIRECT /admin/catalog/terms?saved=1");
    expect(saveTerm).toHaveBeenCalledWith({ id: undefined, name: "Winter" });
  });
});

describe("catalog action access", () => {
  const actions = [
    [saveFacultyAction, saveFaculty, "/admin/catalog/faculties"],
    [saveCourseAction, saveCourse, "/admin/catalog/courses"],
    [saveProfessorAction, saveProfessor, "/admin/catalog/professors"],
    [saveTermAction, saveTerm, "/admin/catalog/terms"],
  ] as const;
  it.each(actions)("refuses a student before saving anything (%#)", async (action, save, route) => {
    requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(action(form({ code: "EECE999", name: "Sneaky", facultyId: "faculty-eng" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(requireAdmin).toHaveBeenCalledWith(route);
    expect(save).not.toHaveBeenCalled();
  });
  it.each(actions)("sends a visitor to log in before saving anything (%#)", async (action, save, route) => {
    requireAdmin.mockRejectedValue(new Error(`NEXT_REDIRECT /login?next=${encodeURIComponent(route)}`));
    await expect(action(form({ name: "Sneaky" }))).rejects.toThrow("NEXT_REDIRECT /login");
    expect(save).not.toHaveBeenCalled();
  });
});
