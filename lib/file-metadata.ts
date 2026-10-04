import { FileCategory, type ExamType } from "@prisma/client";
import { db } from "@/lib/db";
import { EXAM_TYPES, latestYear, MAX_TOPIC_LENGTH, YEAR_MIN, type FileMetadataError, type FileMetadataFieldError, type FileMetadataReferenceError } from "@/lib/file-metadata-rules";
import { logError } from "@/lib/logger";

// Parsing, reference checks, and the admin service for file metadata (US-72). The upload service uses the same parsing and checks.

export type FileMetadata = { courseId: string; professorId?: string; termId?: string; year?: number; topic?: string; examType?: ExamType };
export type SaveFileResult = { ok: true; id: string; courseId: string } | { ok: false; error: FileMetadataError };

const text = (form: Pick<FormData, "get">, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

export function parseFileMetadata(form: Pick<FormData, "get">, category: FileCategory, now = new Date()): { ok: true; metadata: FileMetadata } | { ok: false; error: FileMetadataFieldError } {
  const courseId = text(form, "courseId");
  if (!courseId) return { ok: false, error: "course_required" };
  const yearText = text(form, "year");
  const year = yearText ? Number(yearText) : undefined;
  if (year !== undefined && (!/^\d{4}$/.test(yearText) || year < YEAR_MIN || year > latestYear(now))) return { ok: false, error: "invalid_year" };
  const topic = text(form, "topic");
  if (topic.length > MAX_TOPIC_LENGTH) return { ok: false, error: "topic_too_long" };
  const type = text(form, "examType");
  if (type && category !== FileCategory.EXAM) return { ok: false, error: "type_not_allowed" };
  if (type && !EXAM_TYPES.some(item => item.value === type)) return { ok: false, error: "invalid_type" };
  return {
    ok: true,
    metadata: {
      courseId, year, topic: topic || undefined, examType: (type || undefined) as ExamType | undefined,
      professorId: text(form, "professorId") || undefined, termId: text(form, "termId") || undefined,
    },
  };
}

// Checks the references against the database: the course exists, the professor teaches that course, and the term exists.
export async function checkFileMetadata(metadata: FileMetadata): Promise<FileMetadataReferenceError | null> {
  if (!(await db.course.findUnique({ where: { id: metadata.courseId }, select: { id: true } }))) return "course_not_found";
  if (metadata.professorId && !(await db.courseProfessor.findUnique({
    where: { courseId_professorId: { courseId: metadata.courseId, professorId: metadata.professorId } }, select: { courseId: true },
  }))) return "professor_not_assigned";
  if (metadata.termId && !(await db.term.findUnique({ where: { id: metadata.termId }, select: { id: true } }))) return "term_not_found";
  return null;
}

const errorType = (error: unknown) => (error instanceof Error ? error.name : "Unknown");
const errorCode = (error: unknown) => (typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined);

function reject(error: FileMetadataError, fileId: string): SaveFileResult {
  logError("file_metadata_rejected", { fileId: fileId || undefined, reason: error });
  return { ok: false, error };
}

async function read<T>(context: Record<string, string | undefined>, query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    logError("file_metadata_retrieval_failed", { ...context, errorType: errorType(error) });
    throw error;
  }
}

export const getAdminFiles = (courseId?: string) => read({ entity: "files", courseId }, () => db.courseFile.findMany({
  where: courseId ? { courseId } : {},
  include: { course: { select: { id: true, code: true, name: true } }, professor: true, term: true },
  orderBy: [{ course: { code: "asc" } }, { createdAt: "desc" }],
}));

export const getAdminFile = (id: string) => read({ entity: "file", fileId: id }, () => db.courseFile.findUnique({ where: { id } }));

export const getTermOptions = () => read({ entity: "terms" }, () => db.term.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } }));

export async function saveFileMetadata(fileId: string, form: Pick<FormData, "get">, now = new Date()): Promise<SaveFileResult> {
  if (!fileId) return reject("not_found", fileId);
  try {
    const file = await db.courseFile.findUnique({ where: { id: fileId }, select: { category: true } });
    if (!file) return reject("not_found", fileId);
    const parsed = parseFileMetadata(form, file.category, now);
    if (!parsed.ok) return reject(parsed.error, fileId);
    const { metadata } = parsed;
    const invalid = await checkFileMetadata(metadata);
    if (invalid) return reject(invalid, fileId);
    // Blank optional fields clear the stored value. Changing the course moves the file to that course's pages.
    await db.courseFile.update({
      where: { id: fileId },
      data: {
        courseId: metadata.courseId, professorId: metadata.professorId ?? null, termId: metadata.termId ?? null,
        year: metadata.year ?? null, topic: metadata.topic ?? null, examType: metadata.examType ?? null,
      },
    });
    return { ok: true, id: fileId, courseId: metadata.courseId };
  } catch (error) {
    // P2025: the file was deleted between the check and the update.
    if (errorCode(error) === "P2025") return reject("not_found", fileId);
    logError("file_metadata_save_failed", { fileId, errorType: errorType(error) });
    throw error;
  }
}
