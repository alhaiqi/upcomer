import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, findMany } = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { course: { findUnique }, courseFile: { findMany } } }));
import { getCourseById, getCourseExams, getCourseMaterials } from "@/lib/courses";

beforeEach(() => { findUnique.mockReset(); findMany.mockReset(); });

describe("course service", () => {
  it("returns a course and handles missing courses", async () => {
    findUnique.mockResolvedValueOnce({ id: "a" }).mockResolvedValueOnce(null);
    expect(await getCourseById("a")).toEqual({ id: "a" });
    expect(await getCourseById("missing")).toBeNull();
  });
  it("queries only the requested course's exams", async () => {
    findMany.mockResolvedValue([{ id: "exam-a" }]);
    expect(await getCourseExams("a")).toEqual([{ id: "exam-a" }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { courseId: "a", category: "EXAM" } }));
  });
  it("queries only the requested course's materials", async () => {
    findMany.mockResolvedValue([{ id: "material-a" }]);
    expect(await getCourseMaterials("a")).toEqual([{ id: "material-a" }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { courseId: "a", category: "MATERIAL" } }));
  });
});
