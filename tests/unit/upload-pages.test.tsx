import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { getUploadOptions, getTermOptions, requireAdmin } = vi.hoisted(() => ({ getUploadOptions: vi.fn(), getTermOptions: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ getUploadOptions }));
vi.mock("@/lib/file-metadata", () => ({ getTermOptions }));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
import UploadsPage from "@/app/admin/uploads/page";
import UploadExamPage from "@/app/admin/uploads/exams/page";
import UploadMaterialPage from "@/app/admin/uploads/materials/page";

const courses = [
  { id: "course-a", code: "EECE350", name: "Computer Networks", professors: [{ id: "prof-a", name: "Professor A" }] },
  { id: "course-b", code: "EECE330", name: "Data Structures", professors: [{ id: "prof-b", name: "Professor B" }] },
];
const props = (courseId?: string) => ({ searchParams: Promise.resolve({ courseId }) });

beforeEach(() => {
  getUploadOptions.mockReset().mockResolvedValue(courses);
  getTermOptions.mockReset().mockResolvedValue([{ id: "term-fall", name: "Fall" }, { id: "term-spring", name: "Spring" }]);
  requireAdmin.mockReset().mockResolvedValue({ id: "admin-1", role: "ADMIN" });
});

describe("admin upload pages", () => {
  it("links to both upload forms", async () => {
    const html = renderToStaticMarkup(await UploadsPage());
    expect(html).toContain("/admin/uploads/exams");
    expect(html).toContain("/admin/uploads/materials");
  });
  it("shows the exam form with every course and exam fields", async () => {
    const html = renderToStaticMarkup(await UploadExamPage(props()));
    expect(html).toContain("Upload Previous Exam");
    expect(html).toContain('name="category" value="EXAM"');
    expect(html).toContain("EECE350 — Computer Networks");
    expect(html).toContain("EECE330 — Data Structures");
    expect(html).not.toContain('name="session"');
    expect(html).toContain('<option value="term-fall">Fall</option>');
    expect(html).toContain('name="examType"');
    expect(html).toContain('<option value="MIDTERM">Midterm</option>');
    expect(html).toContain('type="file"');
    expect(html).toContain("Upload exam");
  });
  it("shows the material form with a term but no type", async () => {
    const html = renderToStaticMarkup(await UploadMaterialPage(props()));
    expect(html).toContain("Upload Course Material");
    expect(html).toContain('name="category" value="MATERIAL"');
    expect(html).toContain('name="termId"');
    expect(html).not.toContain('name="examType"');
    expect(html).toContain("Upload material");
  });
  it("preselects a course from the link and offers only its professors", async () => {
    const html = renderToStaticMarkup(await UploadExamPage(props("course-b")));
    expect(html).toContain('<option value="course-b" selected="">');
    expect(html).toContain("Professor B");
    expect(html).not.toContain("Professor A");
  });
  it("ignores an unknown course in the link", async () => {
    const html = renderToStaticMarkup(await UploadExamPage(props("ghost")));
    expect(html).toContain('<option value="" selected="">Choose a course</option>');
  });
  it("explains when no courses exist", async () => {
    getUploadOptions.mockResolvedValue([]);
    const html = renderToStaticMarkup(await UploadMaterialPage(props()));
    expect(html).toContain("No courses exist yet");
    expect(html).not.toContain('type="file"');
  });
  it("lets a retrieval failure reach the error page", async () => {
    getUploadOptions.mockRejectedValue(new Error("database down"));
    await expect(UploadExamPage(props())).rejects.toThrow("database down");
  });
});

describe("admin upload page access", () => {
  it("checks for an admin on every upload page", async () => {
    await UploadsPage();
    await UploadExamPage(props());
    await UploadMaterialPage(props());
    expect(requireAdmin.mock.calls).toEqual([["/admin/uploads"], ["/admin/uploads/exams"], ["/admin/uploads/materials"]]);
  });
  it("shows a student the not-found page without loading the course list", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(UploadsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(UploadExamPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(UploadMaterialPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getUploadOptions).not.toHaveBeenCalled();
    expect(getTermOptions).not.toHaveBeenCalled();
  });
  it("sends a visitor to the login page", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT /login?next=%2Fadmin%2Fuploads%2Fexams"));
    await expect(UploadExamPage(props())).rejects.toThrow("NEXT_REDIRECT /login?next=%2Fadmin%2Fuploads%2Fexams");
  });
});
