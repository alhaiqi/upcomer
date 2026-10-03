import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, logError } = vi.hoisted(() => ({ findMany: vi.fn(), logError: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { course: { findMany } } }));
vi.mock("@/lib/logger", () => ({ logError }));
import { getCatalogCourses } from "@/lib/catalog";

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
