import { FileCategory } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { resolveStoragePath } from "@/lib/files";
import { logError } from "@/lib/logger";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, UPLOAD_FILE_TYPES, UPLOAD_TYPES_LABEL } from "@/lib/upload-rules";

const STATUS = {
  invalid_fields: 400, empty_file: 400, content_mismatch: 400, professor_not_found: 400,
  course_not_found: 404, file_too_large: 413, unsupported_type: 415,
  storage_failed: 500, record_failed: 500,
} as const;

export type UploadFailure = keyof typeof STATUS;

export class UploadError extends Error {
  status: number;
  constructor(public reason: UploadFailure, message: string) {
    super(message);
    this.status = STATUS[reason];
  }
}

export type UploadInput = {
  courseId: string; category: FileCategory; title: string; fileName: string; bytes: Uint8Array;
  professorId?: string; year?: number; session?: string; topic?: string;
};

export function validateUploadFile(fileName: string, bytes: Uint8Array) {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  const type = UPLOAD_FILE_TYPES[extension];
  if (!type) throw new UploadError("unsupported_type", `Unsupported file type. Upload a ${UPLOAD_TYPES_LABEL} file.`);
  if (bytes.length === 0) throw new UploadError("empty_file", "The selected file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError("file_too_large", `The file is larger than ${MAX_UPLOAD_LABEL}.`);
  if (!type.signature.every((byte, index) => bytes[index] === byte)) {
    throw new UploadError("content_mismatch", `The file is corrupt or is not a real .${extension} file.`);
  }
  return { extension, mimeType: type.mimeType };
}

function text(form: FormData, name: string, label: string, maxLength: number) {
  const value = form.get(name);
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length > maxLength) throw new UploadError("invalid_fields", `${label} must be ${maxLength} characters or fewer.`);
  return trimmed;
}

export function parseUploadForm(form: FormData, now = new Date()) {
  const category = text(form, "category", "Category", 20);
  if (category !== FileCategory.EXAM && category !== FileCategory.MATERIAL) throw new UploadError("invalid_fields", "Choose whether this is an exam or a material.");
  const courseId = text(form, "courseId", "Course", 100);
  if (!courseId) throw new UploadError("invalid_fields", "Choose a course.");
  const title = text(form, "title", "Title", 150);
  if (!title) throw new UploadError("invalid_fields", "Enter a title.");
  const yearText = text(form, "year", "Year", 10);
  const year = yearText ? Number(yearText) : undefined;
  const latestYear = now.getFullYear() + 1;
  if (year !== undefined && (!/^\d{4}$/.test(yearText) || year < 1950 || year > latestYear)) {
    throw new UploadError("invalid_fields", `Year must be between 1950 and ${latestYear}.`);
  }
  const file = form.get("file");
  if (!file || typeof file === "string") throw new UploadError("invalid_fields", "Choose a file to upload.");
  return {
    courseId, category: category as FileCategory, title, year, file,
    professorId: text(form, "professorId", "Professor", 100) || undefined,
    session: text(form, "session", "Session", 50) || undefined,
    topic: text(form, "topic", "Topic", 100) || undefined,
  };
}

export async function saveUpload(input: UploadInput) {
  const { extension, mimeType } = validateUploadFile(input.fileName, input.bytes);
  const course = await db.course.findUnique({ where: { id: input.courseId }, select: { id: true } });
  if (!course) throw new UploadError("course_not_found", "The selected course doesn't exist.");
  if (input.professorId && !(await db.professor.findUnique({ where: { id: input.professorId }, select: { id: true } }))) {
    throw new UploadError("professor_not_found", "The selected professor doesn't exist.");
  }

  const storageKey = `${input.category === FileCategory.EXAM ? "exams" : "materials"}/${randomUUID()}.${extension}`;
  const filePath = resolveStoragePath(storageKey);
  const context = { courseId: course.id, resourceCategory: input.category };
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.bytes, { flag: "wx" });
  } catch (error) {
    logError("upload_storage_failed", { ...context, errorType: error instanceof Error ? error.name : "Unknown", errorCode: errorCode(error) });
    throw new UploadError("storage_failed", "The file could not be stored. Please try again.");
  }
  try {
    return await db.courseFile.create({
      data: {
        courseId: course.id, professorId: input.professorId, title: input.title, category: input.category,
        originalFileName: path.basename(input.fileName.replaceAll("\\", "/")).slice(0, 255), storageKey,
        year: input.year, session: input.session, topic: input.topic, mimeType, sizeBytes: input.bytes.length,
      },
    });
  } catch (error) {
    // Do not leave a stored file that no record points to.
    await unlink(filePath).catch(() => logError("upload_cleanup_failed", context));
    logError("upload_record_failed", { ...context, errorType: error instanceof Error ? error.name : "Unknown" });
    throw new UploadError("record_failed", "The file could not be saved. Please try again.");
  }
}

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

export async function getUploadOptions() {
  try {
    const courses = await db.course.findMany({
      select: { id: true, code: true, name: true, professors: { select: { professor: { select: { id: true, name: true } } } } },
      orderBy: { code: "asc" },
    });
    return courses.map(({ professors, ...course }) => ({ ...course, professors: professors.map(item => item.professor) }));
  } catch (error) {
    logError("upload_options_retrieval_failed", { errorType: error instanceof Error ? error.name : "Unknown" });
    throw error;
  }
}

export type UploadCourseOption = Awaited<ReturnType<typeof getUploadOptions>>[number];
