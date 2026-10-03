import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { getCatalogCourses, getCatalogFilterOptions } = vi.hoisted(() => ({ getCatalogCourses: vi.fn(), getCatalogFilterOptions: vi.fn() }));
vi.mock("@/lib/catalog", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/catalog")>(), getCatalogCourses, getCatalogFilterOptions }));
import CatalogPage from "@/app/page";

const courses = [
  { id: "course-a", code: "EECE350", name: "Computer Networks", faculty: { name: "Faculty of Engineering" }, professors: [{ professor: { name: "Professor A" } }] },
  { id: "course-b", code: "MATH201", name: "Calculus III", faculty: { name: "Faculty of Arts and Sciences" }, professors: [] },
];
const manyCourses = Array.from({ length: 45 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return { id: `course-${number}`, code: `TEST1${number}`, name: `Test Course ${number}`, faculty: { name: "Faculty of Engineering" }, professors: [] };
});
const options = {
  faculties: [{ id: "faculty-fas", name: "Faculty of Arts and Sciences" }, { id: "faculty-eng", name: "Faculty of Engineering" }],
  professors: [{ id: "prof-a", name: "Professor A" }, { id: "prof-b", name: "Professor B" }],
};
const searchParams = (params: { page?: string; q?: string; facultyId?: string; professorId?: string } = {}) => ({ searchParams: Promise.resolve(params) });

beforeEach(() => { getCatalogCourses.mockReset(); getCatalogFilterOptions.mockReset().mockResolvedValue(options); });

describe("catalog page", () => {
  it("shows every course with its code and name, linked to its course page", async () => {
    getCatalogCourses.mockResolvedValue(courses);
    const html = renderToStaticMarkup(await CatalogPage(searchParams()));
    expect(html).toContain("Browse Courses");
    expect(html).toContain("EECE350");
    expect(html).toContain("Computer Networks");
    expect(html).toContain("MATH201");
    expect(html).toContain("Calculus III");
    expect(html).toContain("/courses/course-a");
    expect(html).toContain("/courses/course-b");
    expect(html).not.toContain("No courses are available yet.");
    expect(html).not.toContain("Course pages");
  });
  it("shows the empty state when there are no courses", async () => {
    getCatalogCourses.mockResolvedValue([]);
    expect(renderToStaticMarkup(await CatalogPage(searchParams()))).toContain("No courses are available yet.");
  });
  it("lets a failed catalog query reach the error page", async () => {
    getCatalogCourses.mockRejectedValue(new Error("database down"));
    await expect(CatalogPage(searchParams())).rejects.toThrow("database down");
  });
  it("shows the first page with a link to the next one", async () => {
    getCatalogCourses.mockResolvedValue(manyCourses);
    const html = renderToStaticMarkup(await CatalogPage(searchParams()));
    expect(html).toContain("Test Course 20");
    expect(html).not.toContain("Test Course 21");
    expect(html).toContain("Page 1 of 3");
    expect(html).toContain('href="/?page=2"');
    expect(html).not.toContain("Previous");
  });
  it("shows a middle page with links in both directions", async () => {
    getCatalogCourses.mockResolvedValue(manyCourses);
    const html = renderToStaticMarkup(await CatalogPage(searchParams({ page: "2" })));
    expect(html).not.toContain("Test Course 20");
    expect(html).toContain("Test Course 21");
    expect(html).toContain("Test Course 40");
    expect(html).not.toContain("Test Course 41");
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain('href="/?page=1"');
    expect(html).toContain('href="/?page=3"');
  });
  it("shows the last page without a next link", async () => {
    getCatalogCourses.mockResolvedValue(manyCourses);
    const html = renderToStaticMarkup(await CatalogPage(searchParams({ page: "3" })));
    expect(html).toContain("Test Course 45");
    expect(html).toContain("Page 3 of 3");
    expect(html).not.toContain("Next");
  });
  it("shows a search box and loads every course when nothing is searched", async () => {
    getCatalogCourses.mockResolvedValue(courses);
    const html = renderToStaticMarkup(await CatalogPage(searchParams()));
    expect(html).toContain('name="q"');
    expect(html).toContain('value=""');
    expect(getCatalogCourses).toHaveBeenCalledWith({ query: "", facultyId: "", professorId: "" });
  });
  it("searches with the trimmed text and keeps it in the search box", async () => {
    getCatalogCourses.mockResolvedValue([courses[0]]);
    const html = renderToStaticMarkup(await CatalogPage(searchParams({ q: "  eece 350 " })));
    expect(getCatalogCourses).toHaveBeenCalledWith({ query: "eece 350", facultyId: "", professorId: "" });
    expect(html).toContain('value="eece 350"');
    expect(html).toContain("Computer Networks");
  });
  it("shows a no-results message when a search matches nothing", async () => {
    getCatalogCourses.mockResolvedValue([]);
    const html = renderToStaticMarkup(await CatalogPage(searchParams({ q: "zzz" })));
    expect(html).toContain("No courses found.");
    expect(html).not.toContain("No courses are available yet.");
  });
  it("keeps the search in the page links", async () => {
    getCatalogCourses.mockResolvedValue(manyCourses);
    const html = renderToStaticMarkup(await CatalogPage(searchParams({ q: "test course", page: "2" })));
    expect(html).toContain('href="/?q=test+course&amp;page=1"');
    expect(html).toContain('href="/?q=test+course&amp;page=3"');
  });
  it("shows faculty and professor dropdowns with an option for all", async () => {
    getCatalogCourses.mockResolvedValue(courses);
    const html = renderToStaticMarkup(await CatalogPage(searchParams()));
    expect(html).toContain('name="facultyId"');
    expect(html).toContain('<option value="" selected="">All faculties</option>');
    expect(html).toContain('<option value="faculty-eng">Faculty of Engineering</option>');
    expect(html).toContain('name="professorId"');
    expect(html).toContain('<option value="" selected="">All professors</option>');
    expect(html).toContain('<option value="prof-b">Professor B</option>');
  });
  it("filters by the chosen faculty and professor together with the search and keeps them selected", async () => {
    getCatalogCourses.mockResolvedValue([courses[0]]);
    const html = renderToStaticMarkup(await CatalogPage(searchParams({ q: "eece", facultyId: "faculty-eng", professorId: "prof-a" })));
    expect(getCatalogCourses).toHaveBeenCalledWith({ query: "eece", facultyId: "faculty-eng", professorId: "prof-a" });
    expect(html).toContain('<option value="faculty-eng" selected="">Faculty of Engineering</option>');
    expect(html).toContain('<option value="prof-a" selected="">Professor A</option>');
    expect(html).toContain("Computer Networks");
  });
  it("shows the no-results message when only a filter matches nothing", async () => {
    getCatalogCourses.mockResolvedValue([]);
    const html = renderToStaticMarkup(await CatalogPage(searchParams({ professorId: "prof-b" })));
    expect(html).toContain("No courses found.");
    expect(html).not.toContain("No courses are available yet.");
  });
  it("keeps the search and filters in the page links", async () => {
    getCatalogCourses.mockResolvedValue(manyCourses);
    const html = renderToStaticMarkup(await CatalogPage(searchParams({ q: "test", facultyId: "faculty-eng", professorId: "prof-a", page: "2" })));
    expect(html).toContain('href="/?q=test&amp;facultyId=faculty-eng&amp;professorId=prof-a&amp;page=1"');
    expect(html).toContain('href="/?q=test&amp;facultyId=faculty-eng&amp;professorId=prof-a&amp;page=3"');
  });
  it("lets a failure loading the filter options reach the error page", async () => {
    getCatalogCourses.mockResolvedValue(courses);
    getCatalogFilterOptions.mockRejectedValue(new Error("database down"));
    await expect(CatalogPage(searchParams())).rejects.toThrow("database down");
  });
  it.each([
    ["faculty", "facultyId", "All faculties"],
    ["professor", "professorId", "All professors"],
  ] as const)("shows that an unknown %s doesn't exist and finds no courses", async (label, param, allOption) => {
    getCatalogCourses.mockResolvedValue([]);
    const html = renderToStaticMarkup(await CatalogPage(searchParams({ q: "eece", [param]: "unknown" })));
    expect(getCatalogCourses).toHaveBeenCalledWith({ query: "eece", facultyId: "", professorId: "", [param]: "unknown" });
    expect(html).toContain(`The selected ${label} doesn&#x27;t exist.`);
    expect(html).toContain("No courses found.");
    expect(html).toContain(`<option value="">${allOption}</option>`);
    expect(html).not.toContain(`Unknown ${label}`);
    expect(html).not.toContain('value="unknown"');
  });
  it("shows both messages when the faculty and professor are both unknown", async () => {
    getCatalogCourses.mockResolvedValue([]);
    const html = renderToStaticMarkup(await CatalogPage(searchParams({ facultyId: "gone", professorId: "missing" })));
    expect(html).toContain("The selected faculty doesn&#x27;t exist.");
    expect(html).toContain("The selected professor doesn&#x27;t exist.");
    expect(html).toContain("No courses found.");
  });
  it("does not show an unknown message for existing or empty filters", async () => {
    getCatalogCourses.mockResolvedValue([courses[0]]);
    const html = renderToStaticMarkup(await CatalogPage(searchParams({ facultyId: "faculty-eng", professorId: "" })));
    expect(html).not.toContain("doesn&#x27;t exist");
  });
});
