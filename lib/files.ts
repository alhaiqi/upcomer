import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

// courseId is set once the record is known, so the file route can link back to the course.
export class FileUnavailableError extends Error {
  constructor(public reason: "missing_record" | "missing_file" | "unsafe_key", public courseId?: string) { super(reason); }
}

export function resolveStoragePath(storageKey: string, root = process.env.FILE_STORAGE_ROOT || "public/uploads") {
  if (!storageKey || path.isAbsolute(storageKey) || storageKey.includes("\\") || storageKey.split("/").some(part => !part || part === "." || part === "..")) {
    throw new FileUnavailableError("unsafe_key");
  }
  const storageRoot = path.resolve(root);
  const resolved = path.resolve(storageRoot, storageKey);
  if (!resolved.startsWith(storageRoot + path.sep)) throw new FileUnavailableError("unsafe_key");
  return resolved;
}

function isWithinRoot(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function getOriginalFile(fileId: string) {
  const record = await db.courseFile.findUnique({ where: { id: fileId } });
  if (!record) {
    logError("file_record_not_found", { fileId });
    throw new FileUnavailableError("missing_record");
  }
  let filePath;
  try {
    filePath = resolveStoragePath(record.storageKey);
  } catch {
    logError("invalid_storage_key", { fileId });
    throw new FileUnavailableError("unsafe_key", record.courseId);
  }
  try {
    const root = await realpath(path.resolve(process.env.FILE_STORAGE_ROOT || "public/uploads"));
    const physicalFile = await realpath(filePath);
    if (!isWithinRoot(root, physicalFile)) throw new FileUnavailableError("unsafe_key");
    return { record, bytes: await readFile(physicalFile) };
  } catch (error) {
    if (error instanceof FileUnavailableError) {
      logError("invalid_storage_key", { fileId });
      throw new FileUnavailableError("unsafe_key", record.courseId);
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      logError("physical_file_not_found", { fileId });
      throw new FileUnavailableError("missing_file", record.courseId);
    }
    throw error instanceof Error ? Object.assign(error, { courseId: record.courseId }) : error;
  }
}
