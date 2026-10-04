import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { requireAdmin, getAdminFiles, getAdminFile, getTermOptions, getUploadOptions, getCatalogAdminData, notFound } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), getAdminFiles: vi.fn(), getAdminFile: vi.fn(), getTermOptions: vi.fn(), getUploadOptions: vi.fn(), getCatalogAdminData: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/file-metadata", () => ({ getAdminFiles, getAdminFile, getTermOptions }));
vi.mock("@/lib/file-metadata-actions", () => ({ saveFileMetadataAction: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ getUploadOptions }));
vi.mock("@/lib/catalog-admin", () => ({ getCatalogAdminData }));
import AdminFilesPage from "@/app/admin/files/page";
import EditFilePage from "@/app/admin/files/[id]/page";
import CatalogAdminPage from "@/app/admin/catalog/page";

const courses = [
  { id: "course-eece350", code: "EECE350", name: "Computer Networks", professors: [{ id: "prof-a", name: "Professor A" }] },
  { id: "course-eece330", code: "EECE330", name: "Data Structures", professors: [{ id: "prof-b", name: "Professor B" }] },
];
const terms = [{ id: "term-fall", name: "Fall" }, { id: "term-spring", name: "Spring" }];
const exam = {
  id: "file-1", title: "Final Exam 2025", category: "EXAM", courseId: "course-eece350", professorId: "prof-a", termId: "term-spring",
  year: 2025, topic: "Routing", examType: "FINAL",
};
const listed = { ...exam, course: { id: "course-eece350", code: "EECE350", name: "Computer Networks" }, professor: { name: "Professor A" }, term: { name: "Spring" } };
const query = (params: Record<string, string> = {}) => ({ searchParams: Promise.resolve(params) });
const edit = (id: string, params: Record<string, string> = {}) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve(params) });

beforeEach(() => {
  for (const mock of [requireAdmin, getAdminFiles, getAdminFile, getTermOptions, getUploadOptions, getCatalogAdminData]) mock.mockReset();
  requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  getAdminFiles.mockResolvedValue([listed]);
  getAdminFile.mockResolvedValue(exam);
  getTermOptions.mockResolvedValue(terms);
  getUploadOptions.mockResolvedValue(courses);
  getCatalogAdminData.mockResolvedValue({ faculties: [], courses: [], professors: [], terms: [] });
});

describe("admin files list", () => {
  it("lists files with their metadata and edit links", async () => {
    const html = renderToStaticMarkup(await AdminFilesPage(query()));
    expect(html).toContain("Final Exam 2025");
    expect(html).toContain("EECE350 · Exam");
    expect(html).toContain("Final · Spring · 2025 · Professor A · Routing");
    expect(html).toContain('href="/admin/files/file-1"');
    expect(html).toContain('aria-label="Edit Final Exam 2025"');
    expect(getAdminFiles).toHaveBeenCalledWith(undefined);
  });
  it("filters by course", async () => {
    const html = renderToStaticMarkup(await AdminFilesPage(query({ courseId: "course-eece330" })));
    expect(getAdminFiles).toHaveBeenCalledWith("course-eece330");
    expect(html).toContain('<option value="course-eece330" selected="">EECE330 — Data Structures</option>');
  });
  it("shows the empty state and an unknown course", async () => {
    getAdminFiles.mockResolvedValue([]);
    const html = renderToStaticMarkup(await AdminFilesPage(query({ courseId: "ghost" })));
    expect(html).toContain("No files for this course yet.");
    expect(html).toContain("The selected course doesn&#x27;t exist.");
  });
  it("shows the saved notice and errors", async () => {
    expect(renderToStaticMarkup(await AdminFilesPage(query({ saved: "1" })))).toContain("Saved. The file is listed under its course now.");
    expect(renderToStaticMarkup(await AdminFilesPage(query({ error: "not_found" })))).toContain("That file doesn&#x27;t exist anymore.");
  });
});

describe("edit file page", () => {
  it("prefills every field for an exam", async () => {
    const html = renderToStaticMarkup(await EditFilePage(edit("file-1")));
    expect(html).toContain("Edit File Details");
    expect(html).toContain("Final Exam 2025");
    expect(html).toContain('name="id" value="file-1"');
    expect(html).toContain('<option value="course-eece350" selected="">EECE350 — Computer Networks</option>');
    expect(html).toContain('<option value="prof-a" selected="">Professor A</option>');
    expect(html).not.toContain("Professor B");
    expect(html).toContain('<option value="term-spring" selected="">Spring</option>');
    expect(html).toContain('<option value="FINAL" selected="">Final</option>');
    expect(html).toContain('value="2025"');
    expect(html).toContain('value="Routing"');
    expect(html).toContain("Save file details");
  });
  it("has no type for a material", async () => {
    getAdminFile.mockResolvedValue({ ...exam, category: "MATERIAL", examType: null });
    const html = renderToStaticMarkup(await EditFilePage(edit("file-1")));
    expect(html).toContain('name="termId"');
    expect(html).not.toContain('name="examType"');
  });
  it.each([
    ["course_required", "Choose a course."],
    ["professor_not_assigned", "The selected professor doesn&#x27;t teach the selected course."],
    ["invalid_year", "Year must be a 4-digit year between 1950"],
    ["type_not_allowed", "Only exams have a type."],
  ])("shows the %s message", async (error, message) => {
    expect(renderToStaticMarkup(await EditFilePage(edit("file-1", { error })))).toContain(message);
  });
  it("shows the not-found page for an unknown file", async () => {
    getAdminFile.mockResolvedValue(null);
    await expect(EditFilePage(edit("ghost"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("file admin access", () => {
  it("checks for an admin before reading anything", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(AdminFilesPage(query())).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(EditFilePage(edit("file-1"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(requireAdmin.mock.calls).toEqual([["/admin/files"], ["/admin/files"]]);
    for (const read of [getAdminFiles, getAdminFile, getTermOptions, getUploadOptions]) expect(read).not.toHaveBeenCalled();
  });
  it("links the files pages from the catalog overview", async () => {
    const html = renderToStaticMarkup(await CatalogAdminPage());
    expect(html).toContain('href="/admin/files"');
    expect(html).toContain("Manage files");
  });
});
