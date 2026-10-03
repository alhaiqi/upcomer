import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { getCatalogCourses } = vi.hoisted(() => ({ getCatalogCourses: vi.fn() }));
vi.mock("@/lib/catalog", () => ({ getCatalogCourses }));
import CatalogPage from "@/app/page";

const courses = [
  { id: "course-a", code: "EECE350", name: "Computer Networks", faculty: { name: "Faculty of Engineering" }, professors: [{ professor: { name: "Professor A" } }] },
  { id: "course-b", code: "MATH201", name: "Calculus III", faculty: { name: "Faculty of Arts and Sciences" }, professors: [] },
];

beforeEach(() => { getCatalogCourses.mockReset(); });

describe("catalog page", () => {
  it("shows every course with its code and name, linked to its course page", async () => {
    getCatalogCourses.mockResolvedValue(courses);
    const html = renderToStaticMarkup(await CatalogPage());
    expect(html).toContain("Browse Courses");
    expect(html).toContain("EECE350");
    expect(html).toContain("Computer Networks");
    expect(html).toContain("MATH201");
    expect(html).toContain("Calculus III");
    expect(html).toContain("/courses/course-a");
    expect(html).toContain("/courses/course-b");
    expect(html).not.toContain("No courses are available yet.");
  });
  it("shows the empty state when there are no courses", async () => {
    getCatalogCourses.mockResolvedValue([]);
    expect(renderToStaticMarkup(await CatalogPage())).toContain("No courses are available yet.");
  });
  it("lets a failed catalog query reach the error page", async () => {
    getCatalogCourses.mockRejectedValue(new Error("database down"));
    await expect(CatalogPage()).rejects.toThrow("database down");
  });
});
