import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { requireAdmin, getCurrentUser, getCatalogAdminData, getFaculty, getCourse, getProfessor, getTerm, notFound } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), getCurrentUser: vi.fn(), getCatalogAdminData: vi.fn(),
  getFaculty: vi.fn(), getCourse: vi.fn(), getProfessor: vi.fn(), getTerm: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/auth", () => ({ requireAdmin, getCurrentUser }));
vi.mock("@/lib/auth-actions", () => ({ logOutAction: vi.fn() }));
vi.mock("@/lib/catalog-admin", () => ({ getCatalogAdminData, getFaculty, getCourse, getProfessor, getTerm }));
vi.mock("@/lib/catalog-admin-actions", () => ({ saveFacultyAction: vi.fn(), saveCourseAction: vi.fn(), saveProfessorAction: vi.fn(), saveTermAction: vi.fn() }));
import RootLayout from "@/app/layout";
import CatalogAdminPage from "@/app/admin/catalog/page";
import FacultiesPage from "@/app/admin/catalog/faculties/page";
import EditFacultyPage from "@/app/admin/catalog/faculties/[id]/page";
import CoursesPage from "@/app/admin/catalog/courses/page";
import EditCoursePage from "@/app/admin/catalog/courses/[id]/page";
import ProfessorsPage from "@/app/admin/catalog/professors/page";
import EditProfessorPage from "@/app/admin/catalog/professors/[id]/page";
import TermsPage from "@/app/admin/catalog/terms/page";
import EditTermPage from "@/app/admin/catalog/terms/[id]/page";

const query = (params: Record<string, string> = {}) => ({ searchParams: Promise.resolve(params) });
const edit = (id: string, params: Record<string, string> = {}) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve(params) });
const faculties = [{ id: "faculty-eng", code: "ENG", name: "Faculty of Engineering" }, { id: "faculty-fas", code: "FAS", name: "Faculty of Arts and Sciences" }];
const professors = [{ id: "prof-a", name: "Professor A" }, { id: "prof-b", name: "Professor B" }];
const terms = [{ id: "term-fall", name: "Fall" }, { id: "term-spring", name: "Spring" }];
const courses = [{ id: "course-eece350", code: "EECE350", name: "Computer Networks", facultyId: "faculty-eng", faculty: faculties[0], professors: [{ professorId: "prof-a", professor: professors[0] }] }];
const admin = { id: "admin-1", role: "ADMIN" };
const student = { id: "user-1", role: "STUDENT" };
const listPages = [
  ["faculties", FacultiesPage, "/admin/catalog/faculties"],
  ["courses", CoursesPage, "/admin/catalog/courses"],
  ["professors", ProfessorsPage, "/admin/catalog/professors"],
  ["terms", TermsPage, "/admin/catalog/terms"],
] as const;

beforeEach(() => {
  for (const mock of [requireAdmin, getCurrentUser, getCatalogAdminData, getFaculty, getCourse, getProfessor, getTerm]) mock.mockReset();
  requireAdmin.mockResolvedValue(admin);
  getCatalogAdminData.mockResolvedValue({ faculties, courses, professors, terms });
  getFaculty.mockResolvedValue(faculties[0]);
  getCourse.mockResolvedValue({ ...courses[0], professors: [{ courseId: "course-eece350", professorId: "prof-a" }] });
  getProfessor.mockResolvedValue(professors[1]);
  getTerm.mockResolvedValue(terms[0]);
});

describe("catalog overview", () => {
  it("links to each section with its size, and to uploads", async () => {
    const html = renderToStaticMarkup(await CatalogAdminPage());
    expect(requireAdmin).toHaveBeenCalledWith("/admin/catalog");
    for (const section of ["faculties", "courses", "professors", "terms"]) expect(html).toContain(`href="/admin/catalog/${section}"`);
    expect(html).toContain("1 entry.");
    expect(html).toContain("2 entries.");
    expect(html).toContain('href="/admin/uploads"');
  });
});

describe("catalog list pages", () => {
  it("lists faculties with an add form and edit links", async () => {
    const html = renderToStaticMarkup(await FacultiesPage(query()));
    expect(html).toContain("Faculty of Engineering");
    expect(html).toContain('name="code"');
    expect(html).toContain("Add faculty");
    expect(html).toContain('href="/admin/catalog/faculties/faculty-eng"');
  });
  it("lists courses with their faculty and professors and offers every faculty and professor in the form", async () => {
    const html = renderToStaticMarkup(await CoursesPage(query()));
    expect(html).toContain("EECE350");
    expect(html).toContain("Faculty of Engineering · Professor A");
    expect(html).toContain('<option value="faculty-fas">Faculty of Arts and Sciences</option>');
    expect(html).toContain('type="checkbox" name="professorIds" value="prof-b"');
    expect(html).toContain('href="/admin/catalog/courses/course-eece350"');
    expect(html).toContain('href="/admin/uploads/exams?courseId=course-eece350"');
  });
  it("asks for a faculty before a course can be added", async () => {
    getCatalogAdminData.mockResolvedValue({ faculties: [], courses: [], professors: [], terms: [] });
    const html = renderToStaticMarkup(await CoursesPage(query()));
    expect(html).toContain("before adding courses");
    expect(html).not.toContain("Add course");
    expect(html).toContain("No courses yet.");
  });
  it("lists professors and terms", async () => {
    expect(renderToStaticMarkup(await ProfessorsPage(query()))).toContain('href="/admin/catalog/professors/prof-b"');
    const html = renderToStaticMarkup(await TermsPage(query()));
    expect(html).toContain("Spring");
    expect(html).toContain("Add term");
  });
  it("confirms a save", async () => {
    expect(renderToStaticMarkup(await TermsPage(query({ saved: "1" })))).toContain("Saved. The catalog shows the change now.");
  });
  it("explains a duplicate course code with the code that clashed", async () => {
    const html = renderToStaticMarkup(await CoursesPage(query({ error: "duplicate_code", value: "EECE350" })));
    expect(html).toContain("A course with code EECE350 already exists.");
    expect(html).toContain('role="alert"');
  });
  it("explains the other refusals", async () => {
    expect(renderToStaticMarkup(await TermsPage(query({ error: "duplicate_name", value: "Fall" })))).toContain("A term named “Fall” already exists.");
    expect(renderToStaticMarkup(await CoursesPage(query({ error: "unknown_professor" })))).toContain("One of the selected professors doesn&#x27;t exist.");
    expect(renderToStaticMarkup(await FacultiesPage(query({ error: "invalid_fields" })))).toContain("Enter a faculty code of 2 to 20 letters or digits and a name.");
    expect(renderToStaticMarkup(await ProfessorsPage(query({ error: "not_found" })))).toContain("That professor doesn&#x27;t exist anymore.");
    expect(renderToStaticMarkup(await ProfessorsPage(query({ error: "made_up" })))).toContain("Something went wrong. Please try again.");
  });
  it("lets a retrieval failure reach the error page", async () => {
    getCatalogAdminData.mockRejectedValue(new Error("database down"));
    await expect(CoursesPage(query())).rejects.toThrow("database down");
  });
});

describe("catalog edit pages", () => {
  it("fills the course form, with its faculty selected and its professors ticked", async () => {
    const html = renderToStaticMarkup(await EditCoursePage(edit("course-eece350")));
    expect(getCourse).toHaveBeenCalledWith("course-eece350");
    expect(html).toContain('name="id" value="course-eece350"');
    expect(html).toContain('value="EECE350"');
    expect(html).toContain('<option value="faculty-eng" selected="">');
    expect(html).toContain('name="professorIds" checked="" value="prof-a"');
    expect(html).toContain('<input type="checkbox" name="professorIds" value="prof-b"/>');
    expect(html).toContain("Save course");
  });
  it("fills the faculty, professor, and term forms", async () => {
    expect(renderToStaticMarkup(await EditFacultyPage(edit("faculty-eng")))).toContain('value="Faculty of Engineering"');
    expect(renderToStaticMarkup(await EditProfessorPage(edit("prof-b")))).toContain('value="Professor B"');
    const html = renderToStaticMarkup(await EditTermPage(edit("term-fall", { error: "duplicate_name", value: "Spring" })));
    expect(html).toContain('value="Fall"');
    expect(html).toContain("A term named “Spring” already exists.");
  });
  it("shows the not-found page for an unknown entry", async () => {
    getFaculty.mockResolvedValue(null);
    getCourse.mockResolvedValue(null);
    getProfessor.mockResolvedValue(null);
    getTerm.mockResolvedValue(null);
    await expect(EditFacultyPage(edit("ghost"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(EditCoursePage(edit("ghost"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(EditProfessorPage(edit("ghost"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(EditTermPage(edit("ghost"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("catalog page access", () => {
  it.each(listPages)("refuses a student on the %s page before reading the catalog", async (_name, Page, route) => {
    requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(Page(query())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(requireAdmin).toHaveBeenCalledWith(route);
    expect(getCatalogAdminData).not.toHaveBeenCalled();
  });
  it("refuses a student on the overview and edit pages", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(CatalogAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    for (const Page of [EditFacultyPage, EditCoursePage, EditProfessorPage, EditTermPage]) await expect(Page(edit("any"))).rejects.toThrow("NEXT_NOT_FOUND");
    for (const read of [getCatalogAdminData, getFaculty, getCourse, getProfessor, getTerm]) expect(read).not.toHaveBeenCalled();
  });
  it("sends a visitor to log in", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT /login?next=%2Fadmin%2Fcatalog"));
    await expect(CatalogAdminPage()).rejects.toThrow("NEXT_REDIRECT /login?next=%2Fadmin%2Fcatalog");
  });
});

describe("Admin link in the header", () => {
  it("is shown to an admin", async () => {
    getCurrentUser.mockResolvedValue(admin);
    expect(renderToStaticMarkup(await RootLayout({ children: null }))).toContain('<a href="/admin/catalog">Admin</a>');
  });
  it("is hidden from a student and a visitor", async () => {
    getCurrentUser.mockResolvedValue(student);
    expect(renderToStaticMarkup(await RootLayout({ children: null }))).not.toContain("/admin/catalog");
    getCurrentUser.mockResolvedValue(null);
    expect(renderToStaticMarkup(await RootLayout({ children: null }))).not.toContain("/admin/catalog");
  });
});
