import { FileCategory } from "@prisma/client";
import { db } from "@/lib/db";
import { PUBLISHED_FILES } from "@/lib/file-visibility";
import { logError } from "@/lib/logger";

export async function getCourseById(courseId: string) {
  try {
    return await db.course.findUnique({
      where: { id: courseId },
      include: { faculty: true, professors: { include: { professor: true } } },
    });
  } catch (error) {
    logError("course_retrieval_failed", { courseId, errorType: error instanceof Error ? error.name : "Unknown" });
    throw error;
  }
}

async function getCourseFiles(courseId: string, category: FileCategory) {
  try {
    return await db.courseFile.findMany({
      // Pending and rejected submissions (US-13) are never listed.
      where: { courseId, category, ...PUBLISHED_FILES },
      include: { professor: true, term: true },
      orderBy: [{ year: "desc" }, { createdAt: "desc" }],
    });
  } catch (error) {
    logError(category === "EXAM" ? "exam_list_retrieval_failed" : "material_list_retrieval_failed", {
      courseId, resourceCategory: category, errorType: error instanceof Error ? error.name : "Unknown",
    });
    throw error;
  }
}

export const getCourseExams = (courseId: string) => getCourseFiles(courseId, FileCategory.EXAM);
export const getCourseMaterials = (courseId: string) => getCourseFiles(courseId, FileCategory.MATERIAL);
