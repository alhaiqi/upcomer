import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { getCatalogCourses } = vi.hoisted(() => ({ getCatalogCourses: vi.fn() }));
vi.mock("@/lib/catalog", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/catalog")>(), getCatalogCourses }));
import CatalogPage from "@/app/page";

const courses = [
  { id: "course-a", code: "EECE350", name: "Computer Networks", faculty: { name: "Faculty of Engineering" }, professors: [{ professor: { name: "Professor A" } }] },
  { id: "course-b", code: "MATH201", name: "Calculus III", faculty: { name: "Faculty of Arts and Sciences" }, professors: [] },
];
const manyCourses = Array.from({ length: 45 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return { id: `course-${number}`, code: `TEST1${number}`, name: `Test Course ${number}`, faculty: { name: "Faculty of Engineering" }, professors: [] };
});
const searchParams = (params: { page?: string } = {}) => ({ searchParams: Promise.resolve(params) });

beforeEach(() => { getCatalogCourses.mockReset(); });

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
});
