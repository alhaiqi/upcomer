import { FileStatus, type Prisma, type Role } from "@prisma/client";

// Who may see a CourseFile (US-13). No other imports, so every service that reads files can use it without an import cycle.

// Add to every student-facing CourseFile query, and to anything that processes files (question extraction, grouping, counts).
export const PUBLISHED_FILES = { status: FileStatus.PUBLISHED } satisfies Prisma.CourseFileWhereInput;

export type FileViewer = { id: string; role: Role } | null | undefined;

// A pending or rejected file is visible to its submitter and to admins only.
export function canViewFile(file: { status: FileStatus; submittedById: string | null }, viewer: FileViewer) {
  if (file.status === FileStatus.PUBLISHED) return true;
  return Boolean(viewer && (viewer.role === "ADMIN" || viewer.id === file.submittedById));
}
