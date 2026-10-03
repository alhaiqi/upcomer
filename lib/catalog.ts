import { db } from "@/lib/db";
import { logError } from "@/lib/logger";

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
