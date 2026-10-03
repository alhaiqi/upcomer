import { db } from "@/lib/db";
import { logError } from "@/lib/logger";

export const COURSES_PER_PAGE = 20;

export async function getCatalogCourses() {
  try {
    return await db.course.findMany({
      include: { faculty: true, professors: { include: { professor: true } } },
      orderBy: { code: "asc" },
    });
  } catch (error) {
    logError("course_catalog_retrieval_failed", { errorType: error instanceof Error ? error.name : "Unknown" });
    throw error;
  }
}

export function paginateCourses<T>(courses: T[], requestedPage?: string, pageSize = COURSES_PER_PAGE) {
  const totalPages = Math.max(1, Math.ceil(courses.length / pageSize));
  const number = Number(requestedPage);
  const page = Number.isInteger(number) ? Math.min(Math.max(number, 1), totalPages) : 1;
  return { courses: courses.slice((page - 1) * pageSize, page * pageSize), page, totalPages };
}
