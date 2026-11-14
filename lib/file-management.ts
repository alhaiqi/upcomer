import { randomUUID } from "node:crypto";
import { mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { extractExamQuestions } from "@/lib/exam-extraction";
import { resolveStoragePath } from "@/lib/files";
import { logError } from "@/lib/logger";
import { regroupCourseInTransaction } from "@/lib/question-bank";
import { UploadError, validateUploadFile } from "@/lib/uploads";

export type FileManagementError = "not_found" | "stale" | "busy" | "confirmation_required" | "invalid_file" | "unsupported_exam" | "unsafe_storage" | "unexpected";
const messages: Record<FileManagementError, string> = {
  not_found: "That file is no longer available.",
  stale: "This file changed since you opened the form. Reload before trying again.",
  busy: "This file is being processed. Wait for processing to finish before changing it.",
  confirmation_required: "Confirm that you want to remove this file.",
  invalid_file: "Choose a valid supported replacement file within the upload size limit. PDF exams must contain readable numbered questions.",
  unsupported_exam: "Replacement exam papers must be searchable PDFs.",
  unsafe_storage: "The storage location could not be verified. No changes were made.",
  unexpected: "The file could not be changed. Please try again.",
};
export const fileManagementMessage = (reason: string) => messages[reason as FileManagementError] ?? messages.unexpected;
class ManagementRefusal extends Error {
  constructor(public reason: FileManagementError) { super(reason); }
}

// Verify canonical paths as well as lexical keys. Replacement writes never follow an uploads-directory symlink outside
// the configured root. A fresh UUID and exclusive creation prevent overwriting another file.
async function stageReplacement(fileId: string, category: string, fileName: string, bytes: Uint8Array) {
  const { extension, mimeType } = validateUploadFile(fileName, bytes);
  const key = `${category === "EXAM" ? "exams" : "materials"}/${randomUUID()}.${extension}`;
  const destination = resolveStoragePath(key);
  await mkdir(path.dirname(destination), { recursive: true });
  const root = await realpath(path.resolve(process.env.FILE_STORAGE_ROOT || "public/uploads"));
  const parent = await realpath(path.dirname(destination));
  const relative = path.relative(root, parent);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new ManagementRefusal("unsafe_storage");
  // Only unlink a file after we successfully created it. A partial write can fail before staging returns, so the
  // outer mutation has no staged path to clean up yet; an EEXIST failure must never remove someone else's file.
  const handle = await open(destination, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(destination).catch(() => logError("file_management_cleanup_failed", { fileId, operation: "staging" }));
    throw error;
  }
  return { storageKey: key, mimeType, destination };
}

async function cleanupStoredFile(storageKey: string, fileId: string) {
  try {
    if (await db.courseFile.count({ where: { storageKey } })) return true;
    const destination = resolveStoragePath(storageKey);
    const root = await realpath(path.resolve(process.env.FILE_STORAGE_ROOT || "public/uploads"));
    const physical = await realpath(destination);
    const relative = path.relative(root, physical);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new ManagementRefusal("unsafe_storage");
    await unlink(destination);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
    logError("file_management_cleanup_failed", { fileId, errorType: error instanceof Error ? error.name : "Unknown" });
    return false;
  }
}

export type FileMutation = { operation: "remove"; confirmed: boolean } | { operation: "replace"; fileName: string; bytes: Uint8Array };

// The admin route authenticates before calling this service. Replacement keeps CourseFile.id, its metadata and source
// URL. Questions and grouping are replaced atomically; invalid replacement PDFs leave the old file completely intact.
export async function manageFile(adminId: string, fileId: string, expectedVersion: string, mutation: FileMutation) {
  let staged: Awaited<ReturnType<typeof stageReplacement>> | undefined;
  let committed = false;
  try {
    if (mutation.operation === "remove" && !mutation.confirmed) throw new ManagementRefusal("confirmation_required");
    const before = await db.courseFile.findUnique({ where: { id: fileId } });
    if (!before) throw new ManagementRefusal("not_found");
    if (before.updatedAt.toISOString() !== expectedVersion) throw new ManagementRefusal("stale");
    let texts: string[] = [];
    if (mutation.operation === "replace") {
      const type = validateUploadFile(mutation.fileName, mutation.bytes);
      if (before.category === "EXAM") {
        if (type.mimeType !== "application/pdf") throw new ManagementRefusal("unsupported_exam");
        try { texts = await extractExamQuestions(mutation.bytes); }
        catch { throw new ManagementRefusal("invalid_file"); }
      }
      staged = await stageReplacement(fileId, before.category, mutation.fileName, mutation.bytes);
    }
    // A metadata edit can move a paper before its old groups have been rebuilt. Removing its questions affects those
    // groups too. Lock all affected courses in a stable order and rebuild them together instead of leaving old counts.
    const memberships = await db.question.findMany({ where: { fileId }, select: { group: { select: { courseId: true } } } });
    const groupedCourses = new Set(memberships.flatMap(item => item.group ? [item.group.courseId] : []));
    const affectedCourses = [...new Set([before.courseId, ...groupedCourses])].sort();
    await db.$transaction(async tx => {
      // Same lock order as generation/regroup. startRun's file lock prevents starting a processing run during mutation.
      for (const courseId of affectedCourses) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${courseId}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`exam-processing:${fileId}`}))`;
      const file = await tx.courseFile.findUnique({ where: { id: fileId } });
      if (!file) throw new ManagementRefusal("not_found");
      if (file.updatedAt.toISOString() !== expectedVersion || file.courseId !== before.courseId) throw new ManagementRefusal("stale");
      const currentMemberships = await tx.question.findMany({ where: { fileId }, select: { group: { select: { courseId: true } } } });
      if (currentMemberships.some(item => item.group && !affectedCourses.includes(item.group.courseId))) throw new ManagementRefusal("stale");
      const active = await tx.fileProcessingRun.findFirst({ where: { fileId, status: "RUNNING", createdAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
      if (active) throw new ManagementRefusal("busy");
      if (mutation.operation === "remove") await tx.courseFile.delete({ where: { id: fileId } });
      else {
        await tx.question.deleteMany({ where: { fileId } });
        await tx.courseFile.update({ where: { id: fileId }, data: {
          storageKey: staged!.storageKey, originalFileName: path.basename(mutation.fileName.replaceAll("\\", "/")).slice(0, 255),
          mimeType: staged!.mimeType, sizeBytes: mutation.bytes.length,
          // Explicitly advance even for two changes in one clock tick.
          updatedAt: new Date(Math.max(Date.now(), file.updatedAt.getTime() + 1)),
        } });
        if (file.category === "EXAM" && file.status === "PUBLISHED") {
          await tx.question.createMany({ data: texts.map((text, index) => ({ fileId, number: index + 1, text })) });
          await tx.fileProcessingRun.create({ data: { fileId, status: "SUCCEEDED", stage: "GROUPING" } });
        }
      }
      for (const courseId of affectedCourses) {
        if (file.category === "EXAM" || groupedCourses.has(courseId)) await regroupCourseInTransaction(tx, courseId);
      }
    }, { maxWait: 10_000, timeout: 30_000 });
    committed = true;
    const cleaned = await cleanupStoredFile(before.storageKey, fileId);
    logError("file_management_completed", { userId: adminId, fileId, courseId: before.courseId, operation: mutation.operation, cleanupPending: String(!cleaned) });
    return { ok: true as const, courseId: before.courseId, cleanupPending: !cleaned };
  } catch (error) {
    if (staged && !committed) await unlink(staged.destination).catch(() => logError("file_management_cleanup_failed", { fileId, operation: "rollback" }));
    const reason = error instanceof ManagementRefusal ? error.reason : error instanceof UploadError ? "invalid_file" : "unexpected";
    logError(reason === "unexpected" ? "file_management_failed" : "file_management_refused", { userId: adminId, fileId, operation: mutation.operation, reason, errorType: error instanceof Error ? error.name : "Unknown" });
    return { ok: false as const, error: reason };
  }
}
