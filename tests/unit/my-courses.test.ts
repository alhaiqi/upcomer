import { beforeEach, describe, expect, it, vi } from "vitest";

const { courseFindUnique, enrollmentCreate, enrollmentFindMany, logError } = vi.hoisted(() => ({
  courseFindUnique: vi.fn(), enrollmentCreate: vi.fn(), enrollmentFindMany: vi.fn(), logError: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { course: { findUnique: courseFindUnique }, userCourse: { create: enrollmentCreate, findMany: enrollmentFindMany } } }));
vi.mock("@/lib/logger", () => ({ logError }));
import { addCourseToMyCourses, getMyCourses } from "@/lib/my-courses";

const course = { id: "course-eece350", code: "EECE350", name: "Computer Networks", faculty: { name: "Faculty of Engineering" }, professors: [] };

beforeEach(() => { courseFindUnique.mockReset(); enrollmentCreate.mockReset(); enrollmentFindMany.mockReset(); logError.mockReset(); });

describe("adding a course to My Courses", () => {
  it("adds the course for the user", async () => {
    courseFindUnique.mockResolvedValue({ id: course.id });
    enrollmentCreate.mockResolvedValue({ userId: "user-1", courseId: course.id });
    expect(await addCourseToMyCourses("user-1", course.id)).toBe("added");
    expect(courseFindUnique).toHaveBeenCalledWith({ where: { id: course.id }, select: { id: true } });
    expect(enrollmentCreate).toHaveBeenCalledWith({ data: { userId: "user-1", courseId: course.id } });
    expect(logError).not.toHaveBeenCalled();
  });
  it("reports an unknown course without writing anything", async () => {
    courseFindUnique.mockResolvedValue(null);
    expect(await addCourseToMyCourses("user-1", "course-missing")).toBe("not_found");
    expect(enrollmentCreate).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });
  it("treats the composite key clash of a second click as already added, not an error", async () => {
    courseFindUnique.mockResolvedValue({ id: course.id });
    enrollmentCreate.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    expect(await addCourseToMyCourses("user-1", course.id)).toBe("already_added");
    expect(logError).not.toHaveBeenCalled();
  });
  it("logs and rethrows any other database failure", async () => {
    const error = new Error("connection refused");
    error.name = "PrismaClientInitializationError";
    courseFindUnique.mockResolvedValue({ id: course.id });
    enrollmentCreate.mockRejectedValue(error);
    await expect(addCourseToMyCourses("user-1", course.id)).rejects.toBe(error);
    expect(logError).toHaveBeenCalledWith("my_courses_add_failed", { userId: "user-1", courseId: course.id, errorType: "PrismaClientInitializationError" });
  });
});

describe("reading My Courses", () => {
  it("returns the user's courses with faculty and professors, most recently added first", async () => {
    enrollmentFindMany.mockResolvedValue([{ course }, { course: { ...course, id: "course-math201", code: "MATH201" } }]);
    expect(await getMyCourses("user-1")).toEqual([course, { ...course, id: "course-math201", code: "MATH201" }]);
    expect(enrollmentFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      include: { course: { include: { faculty: true, professors: { include: { professor: true } } } } },
      orderBy: { createdAt: "desc" },
    });
  });
  it("returns an empty list for a user with no courses", async () => {
    enrollmentFindMany.mockResolvedValue([]);
    expect(await getMyCourses("user-1")).toEqual([]);
  });
  it("logs and rethrows a failed query", async () => {
    const error = new Error("timeout");
    error.name = "PrismaClientKnownRequestError";
    enrollmentFindMany.mockRejectedValue(error);
    await expect(getMyCourses("user-1")).rejects.toBe(error);
    expect(logError).toHaveBeenCalledWith("my_courses_retrieval_failed", { userId: "user-1", errorType: "PrismaClientKnownRequestError" });
  });
});
