import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, logError } = vi.hoisted(() => ({ findMany: vi.fn(), logError: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { course: { findMany } } }));
vi.mock("@/lib/logger", () => ({ logError }));
import { COURSES_PER_PAGE, getCatalogCourses, paginateCourses } from "@/lib/catalog";

beforeEach(() => { findMany.mockReset(); logError.mockReset(); });

describe("catalog service", () => {
  it("returns every course with its faculty and professors, ordered by code", async () => {
    findMany.mockResolvedValue([{ id: "course-a" }, { id: "course-b" }]);
    expect(await getCatalogCourses()).toEqual([{ id: "course-a" }, { id: "course-b" }]);
    expect(findMany).toHaveBeenCalledWith({
      include: { faculty: true, professors: { include: { professor: true } } },
      orderBy: { code: "asc" },
    });
  });
  it("returns an empty list when there are no courses", async () => {
    findMany.mockResolvedValue([]);
    expect(await getCatalogCourses()).toEqual([]);
  });
  it("logs and rethrows a failed query", async () => {
    const error = new Error("connection refused");
    error.name = "PrismaClientInitializationError";
    findMany.mockRejectedValue(error);
    await expect(getCatalogCourses()).rejects.toBe(error);
    expect(logError).toHaveBeenCalledWith("course_catalog_retrieval_failed", { errorType: "PrismaClientInitializationError" });
  });
});

describe("catalog pagination", () => {
  const courses = Array.from({ length: 45 }, (_, index) => ({ id: `course-${index + 1}` }));

  it("splits courses into pages without skipping or repeating any", () => {
    const pages = ["1", "2", "3"].map(page => paginateCourses(courses, page));
    expect(pages.map(result => result.courses.length)).toEqual([20, 20, 5]);
    expect(pages.flatMap(result => result.courses)).toEqual(courses);
    expect(pages.map(result => result.totalPages)).toEqual([3, 3, 3]);
  });
  it("shows 20 courses per page", () => {
    expect(COURSES_PER_PAGE).toBe(20);
    expect(paginateCourses(courses).courses).toEqual(courses.slice(0, 20));
  });
  it.each([
    [undefined, 1], ["abc", 1], ["0", 1], ["-2", 1], ["1.5", 1], ["99", 3], ["3", 3],
  ])("treats page %s as page %i", (requested, expected) => {
    expect(paginateCourses(courses, requested).page).toBe(expected);
  });
  it("has one empty page when there are no courses", () => {
    expect(paginateCourses([], "4")).toEqual({ courses: [], page: 1, totalPages: 1 });
  });
});
