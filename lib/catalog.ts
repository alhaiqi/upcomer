import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";

export const COURSES_PER_PAGE = 20;

const normalize = (text: string) => text.replace(/\s+/g, "").toLowerCase();

export async function getCatalogCourses({ query = "", facultyId = "", professorId = "" }: { query?: string; facultyId?: string; professorId?: string } = {}) {
  const search = query.trim();
  const where: Prisma.CourseWhereInput = {
    ...(search ? { OR: [
      { code: { contains: search, mode: "insensitive" } },
      { code: { contains: search.replace(/\s+/g, ""), mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
    ] } : {}),
    ...(facultyId ? { facultyId } : {}),
    ...(professorId ? { professors: { some: { professorId } } } : {}),
  };
  try {
    const courses = await db.course.findMany({
      where,
      include: { faculty: true, professors: { include: { professor: true } } },
      orderBy: { code: "asc" },
    });
    return search ? rankCourses(courses, search) : courses;
  } catch (error) {
    logError(search || facultyId || professorId ? "course_search_failed" : "course_catalog_retrieval_failed", {
      facultyId: facultyId || undefined, professorId: professorId || undefined, errorType: error instanceof Error ? error.name : "Unknown",
    });
    throw error;
  }
}

export async function getCatalogFilterOptions() {
  try {
    const [faculties, professors] = await Promise.all([
      db.faculty.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      db.professor.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    return { faculties, professors };
  } catch (error) {
    logError("catalog_filter_options_retrieval_failed", { errorType: error instanceof Error ? error.name : "Unknown" });
    throw error;
  }
}

export function rankCourses<T extends { code: string }>(courses: T[], query: string) {
  const search = normalize(query);
  const rank = (code: string) => normalize(code) === search ? 0 : normalize(code).startsWith(search) ? 1 : 2;
  return [...courses].sort((a, b) => rank(a.code) - rank(b.code));
}

export function paginateCourses<T>(courses: T[], requestedPage?: string, pageSize = COURSES_PER_PAGE) {
  const totalPages = Math.max(1, Math.ceil(courses.length / pageSize));
  const number = Number(requestedPage);
  const page = Number.isInteger(number) ? Math.min(Math.max(number, 1), totalPages) : 1;
  return { courses: courses.slice((page - 1) * pageSize, page * pageSize), page, totalPages };
}
