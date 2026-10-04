import { db } from "@/lib/db";
import { logError } from "@/lib/logger";

export type AddCourseResult = "added" | "already_added" | "not_found";

const errorType = (error: unknown) => (error instanceof Error ? error.name : "Unknown");
const isUniqueViolation = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";

export async function addCourseToMyCourses(userId: string, courseId: string): Promise<AddCourseResult> {
  try {
    const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) return "not_found";
    await db.userCourse.create({ data: { userId, courseId } });
    return "added";
  } catch (error) {
    if (isUniqueViolation(error)) return "already_added";
    logError("my_courses_add_failed", { userId, courseId, errorType: errorType(error) });
    throw error;
  }
}

export async function getMyCourses(userId: string) {
  try {
    const enrollments = await db.userCourse.findMany({
      where: { userId },
      include: { course: { include: { faculty: true, professors: { include: { professor: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    return enrollments.map(enrollment => enrollment.course);
  } catch (error) {
    logError("my_courses_retrieval_failed", { userId, errorType: errorType(error) });
    throw error;
  }
}
