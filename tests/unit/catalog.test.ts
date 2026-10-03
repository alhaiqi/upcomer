import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, logError } = vi.hoisted(() => ({ findMany: vi.fn(), logError: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { course: { findMany } } }));
vi.mock("@/lib/logger", () => ({ logError }));
import { COURSES_PER_PAGE, getCatalogCourses, paginateCourses, rankCourses } from "@/lib/catalog";

beforeEach(() => { findMany.mockReset(); logError.mockReset(); });

describe("catalog service", () => {
  it("returns every course with its faculty and professors, ordered by code", async () => {
    findMany.mockResolvedValue([{ id: "course-a" }, { id: "course-b" }]);
    expect(await getCatalogCourses()).toEqual([{ id: "course-a" }, { id: "course-b" }]);
    expect(findMany).toHaveBeenCalledWith({
      where: undefined,
      include: { faculty: true, professors: { include: { professor: true } } },
      orderBy: { code: "asc" },
    });
  });
  it.each(["", "   "])("does not filter when the search is %j", async query => {
    findMany.mockResolvedValue([]);
    await getCatalogCourses({ query });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
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

describe("catalog search", () => {
  it("matches the code with and without spaces, and the name, ignoring case", async () => {
    findMany.mockResolvedValue([]);
    await getCatalogCourses({ query: " eece 350 " });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { code: { contains: "eece 350", mode: "insensitive" } },
        { code: { contains: "eece350", mode: "insensitive" } },
        { name: { contains: "eece 350", mode: "insensitive" } },
      ] },
    }));
  });
  it("returns the exact code match first", async () => {
    findMany.mockResolvedValue([{ code: "EECE3501" }, { code: "MECH350" }, { code: "EECE350" }]);
    expect((await getCatalogCourses({ query: "eece 350" })).map(course => course.code)).toEqual(["EECE350", "EECE3501", "MECH350"]);
  });
  it("logs a failed search without the search text and rethrows", async () => {
    const error = new Error("timeout");
    error.name = "PrismaClientKnownRequestError";
    findMany.mockRejectedValue(error);
    await expect(getCatalogCourses({ query: "networks" })).rejects.toBe(error);
    expect(logError).toHaveBeenCalledWith("course_search_failed", { errorType: "PrismaClientKnownRequestError" });
  });
});

describe("catalog ranking", () => {
  const courses = [{ code: "CMPS2140" }, { code: "MATH214" }, { code: "CMPS 214" }, { code: "CMPS211" }];
  it.each([
    ["CMPS 214", ["CMPS 214", "CMPS2140", "MATH214", "CMPS211"]],
    ["cmps214", ["CMPS 214", "CMPS2140", "MATH214", "CMPS211"]],
    ["cmps", ["CMPS2140", "CMPS 214", "CMPS211", "MATH214"]],
    ["214", ["CMPS2140", "MATH214", "CMPS 214", "CMPS211"]],
  ])("ranks courses for %j", (query, expected) => {
    expect(rankCourses(courses, query).map(course => course.code)).toEqual(expected);
  });
  it("does not change the list it is given", () => {
    const original = [...courses];
    rankCourses(courses, "CMPS 214");
    expect(courses).toEqual(original);
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
