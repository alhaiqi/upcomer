import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

// Everything a run creates carries its stamp, so cleanup can find it without touching anything else.
export function createStamp(now = Date.now()) {
  return `RL${now.toString(36).toUpperCase()}`;
}

export const storageRoot = () => path.resolve(process.env.FILE_STORAGE_ROOT || "public/uploads");
const UPLOAD_FOLDERS = ["exams", "materials"];
// Only keys the upload API itself writes are ever deleted; fixture keys such as "../../.env" never match.
const UPLOAD_KEY = /^(exams|materials)\/[0-9a-f-]{36}\.[a-z]+$/;

export async function countRows(db: PrismaClient) {
  const [faculties, professors, terms, users, sessions, userCourses, courses, courseProfessors, courseFiles, logEntries] = await Promise.all([
    db.faculty.count(), db.professor.count(), db.term.count(), db.user.count(), db.session.count(), db.userCourse.count(),
    db.course.count(), db.courseProfessor.count(), db.courseFile.count(), db.logEntry.count(),
  ]);
  return { faculties, professors, terms, users, sessions, userCourses, courses, courseProfessors, courseFiles, logEntries };
}
export type RowCounts = Awaited<ReturnType<typeof countRows>>;

export async function listUploadFolders() {
  const files: string[] = [];
  for (const folder of UPLOAD_FOLDERS) {
    const entries = await readdir(path.join(storageRoot(), folder)).catch(() => [] as string[]);
    files.push(...entries.map(entry => `${folder}/${entry}`));
  }
  return files.sort();
}

// Deletes everything carrying the stamp, the files the upload API stored, and the admin's sessions from this run.
export async function cleanUp(db: PrismaClient, stamp: string, options: { uploadedFileIds: Iterable<string>; adminId?: string; since: Date }) {
  const lower = stamp.toLowerCase();
  const files = await db.courseFile.findMany({
    where: { OR: [{ id: { in: [...options.uploadedFileIds] } }, { title: { startsWith: stamp } }, { id: { startsWith: lower } }] },
    select: { id: true, storageKey: true },
  });
  for (const file of files) {
    if (UPLOAD_KEY.test(file.storageKey)) await unlink(path.join(storageRoot(), file.storageKey)).catch(() => undefined);
  }
  const users = await db.user.findMany({ where: { email: { startsWith: lower } }, select: { id: true } });
  await db.$transaction([
    db.courseFile.deleteMany({ where: { id: { in: files.map(file => file.id) } } }),
    // Sessions and My Courses entries go with their users (cascade).
    db.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } }),
    ...(options.adminId ? [db.session.deleteMany({ where: { userId: options.adminId, createdAt: { gte: options.since } } })] : []),
    // Course professors and any remaining files of stamped courses cascade with the course.
    db.course.deleteMany({ where: { code: { startsWith: stamp } } }),
    db.faculty.deleteMany({ where: { code: { startsWith: stamp } } }),
    db.professor.deleteMany({ where: { name: { startsWith: stamp } } }),
    db.term.deleteMany({ where: { name: { startsWith: stamp } } }),
  ]);
}

export function diffCounts(before: RowCounts, after: RowCounts) {
  return (Object.keys(before) as (keyof RowCounts)[])
    .filter(key => before[key] !== after[key])
    .map(key => `${key}: ${before[key]} → ${after[key]}`);
}
