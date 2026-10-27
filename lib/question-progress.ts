import { FileCategory, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PUBLISHED_FILES } from "@/lib/file-visibility";
import { logError } from "@/lib/logger";
import { isProgressChoice, type ProgressRefusal } from "@/lib/question-progress-rules";
import { checkRateLimit, limitFromEnv } from "@/lib/rate-limit";

// Questions a student marked done on the Upcomer Exam (US-21). Every read and write is for one student, whose ID comes
// from the session (requireUser in the action and the page), so one student's progress is never shown to another.
// Marking a question done does not change the learning profile. Nothing here checks the caller.

export type QuestionMark = { doneAt: Date };
// A student's marks in one course, by question group ID.
export type CourseProgress = Map<string, QuestionMark>;

type OrphanMark = { id: string; sourceQuestionIds: string[] };
type Client = Pick<Prisma.TransactionClient, "question" | "questionProgress">;

// Marks per student per minute. Far above what a person clicks, so it only stops a script or a stolen session.
export const PROGRESS_WINDOW_MS = 60_000;
export const progressLimit = () => limitFromEnv("QUESTION_PROGRESS_RATE_LIMIT_PER_MINUTE", 60);

const errorType = (error: unknown) => (error instanceof Error ? error.name : "Unknown");
const isUniqueViolation = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";

// Where an unlinked mark belongs now: the group holding its first source question (the question the student saw), or,
// if that question is gone, the group holding most of its other source questions (a tie goes to the one listed first).
// Null when none of its questions is in a group any more, so a mark is never attached to a guess.
export function relinkTarget(sourceQuestionIds: string[], groupOf: Map<string, string>): string | null {
  const [anchor, ...others] = sourceQuestionIds;
  const anchored = anchor === undefined ? undefined : groupOf.get(anchor);
  if (anchored) return anchored;
  const counts = new Map<string, number>();
  for (const id of others) {
    const group = groupOf.get(id);
    if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [group, count] of counts) if (best === null || count > counts.get(best)!) best = group;
  return best;
}

// A regroup that changes a group's first question replaces the group, and its marks are kept with a null groupId
// (onDelete: SetNull). This re-links them to the group of the same course that now holds their questions. A mark whose
// new group is already marked is a duplicate and is removed. Returns the marks it re-linked, by their new group.
async function relinkMarks(client: Client, userId: string, courseId: string, orphans: OrphanMark[], linked: Set<string>) {
  const relinked = new Map<string, string>();
  // Only questions of this course's published exam papers count, so a mark never moves to another course (US-33).
  const questions = await client.question.findMany({
    where: { id: { in: [...new Set(orphans.flatMap(mark => mark.sourceQuestionIds))] }, groupId: { not: null }, file: { courseId, category: FileCategory.EXAM, ...PUBLISHED_FILES } },
    select: { id: true, groupId: true },
  });
  const groupOf = new Map(questions.map(question => [question.id, question.groupId!]));
  for (const mark of orphans) {
    const target = relinkTarget(mark.sourceQuestionIds, groupOf);
    if (!target) continue;
    if (linked.has(target)) {
      await client.questionProgress.deleteMany({ where: { id: mark.id, userId, groupId: null } });
      continue;
    }
    try {
      // Only while still unlinked, so two page loads re-linking at once agree.
      const { count } = await client.questionProgress.updateMany({ where: { id: mark.id, userId, groupId: null }, data: { groupId: target } });
      if (count) relinked.set(mark.id, target);
      linked.add(target);
    } catch (error) {
      // Another request linked a mark to the same group first.
      if (!isUniqueViolation(error)) throw error;
      await client.questionProgress.deleteMany({ where: { id: mark.id, userId, groupId: null } });
      linked.add(target);
    }
  }
  return relinked;
}

// The student's marks in one course, by group ID, with any marks a regroup unlinked re-linked first. If re-linking fails,
// the marks that are still linked are returned and the failure is logged, so the exam still opens.
export async function getCourseProgress(userId: string, courseId: string): Promise<CourseProgress> {
  let rows;
  try {
    rows = await db.questionProgress.findMany({
      where: { userId, courseId },
      select: { id: true, groupId: true, sourceQuestionIds: true, doneAt: true },
    });
  } catch (error) {
    logError("question_progress_retrieval_failed", { userId, courseId, errorType: errorType(error) });
    throw error;
  }
  const progress: CourseProgress = new Map();
  for (const row of rows) if (row.groupId) progress.set(row.groupId, { doneAt: row.doneAt });
  const orphans = rows.filter(row => !row.groupId);
  if (!orphans.length) return progress;
  try {
    const relinked = await relinkMarks(db, userId, courseId, orphans, new Set(progress.keys()));
    for (const row of orphans) {
      const groupId = relinked.get(row.id);
      if (groupId) progress.set(groupId, { doneAt: row.doneAt });
    }
  } catch (error) {
    logError("question_progress_failed", { userId, courseId, operation: "relink", errorType: errorType(error) });
  }
  return progress;
}

export type MarkInput = { groupId: string; choice: string };
export type MarkResult = { ok: true; courseId: string; done: boolean } | { ok: false; error: ProgressRefusal };

// Marks a question done ("DONE") or undoes the mark ("UNDO") for the session's student (US-21). Marking a done question
// again, or undoing one that is not done, changes nothing.
export async function markQuestion(userId: string, input: MarkInput): Promise<MarkResult> {
  const groupId = input.groupId.trim();
  const refuse = (error: ProgressRefusal): MarkResult => {
    logError("question_progress_refused", { groupId: groupId || undefined, reason: error, userId });
    return { ok: false, error };
  };
  const limit = checkRateLimit(`question-progress:${userId}`, progressLimit(), PROGRESS_WINDOW_MS);
  if (!limit.ok) {
    logError("question_progress_rate_limited", { userId, retryAfterSeconds: String(limit.retryAfterSeconds) });
    return { ok: false, error: "rate_limited" };
  }
  if (!isProgressChoice(input.choice)) return refuse("invalid_choice");
  const done = input.choice === "DONE";
  if (!groupId) return refuse("not_found");
  try {
    const saved = await db.$transaction(async tx => {
      // One student's clicks wait for each other, so a double click gives one mark and no error.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`question-progress:${userId}`}))`;
      const group = await tx.questionGroup.findUnique({ where: { id: groupId }, select: { id: true, courseId: true } });
      // Only a question students can see can be marked: one from a published exam paper of its course (US-13).
      const questions = group && await tx.question.findMany({
        where: { groupId, file: { courseId: group.courseId, category: FileCategory.EXAM, ...PUBLISHED_FILES } },
        select: { id: true },
        orderBy: [{ fileId: "asc" }, { number: "asc" }],
      });
      if (!group || !questions?.length) return "not_found" as const;
      const courseId = group.courseId;
      // Marks a regroup unlinked are re-linked first, so an undo also clears an old mark of the question, and it cannot
      // come back as done when a later page load would have re-linked it.
      const marks = await tx.questionProgress.findMany({ where: { userId, courseId }, select: { id: true, groupId: true, sourceQuestionIds: true } });
      const orphans = marks.filter(mark => !mark.groupId);
      if (orphans.length) await relinkMarks(tx, userId, courseId, orphans, new Set(marks.flatMap(mark => (mark.groupId ? [mark.groupId] : []))));
      const existing = await tx.questionProgress.findUnique({ where: { userId_groupId: { userId, groupId } }, select: { id: true } });
      if (Boolean(existing) === done) return { courseId, operation: "unchanged" as const };
      if (existing) await tx.questionProgress.delete({ where: { id: existing.id } });
      else await tx.questionProgress.create({ data: { userId, courseId, groupId, sourceQuestionIds: questions.map(question => question.id) } });
      return { courseId, operation: done ? "mark" as const : "undo" as const };
    });
    if (saved === "not_found") return refuse("not_found");
    if (saved.operation !== "unchanged") logError("question_progress_saved", { userId, courseId: saved.courseId, groupId, operation: saved.operation });
    return { ok: true, courseId: saved.courseId, done };
  } catch (error) {
    logError("question_progress_failed", { userId, groupId, operation: "mark", errorType: errorType(error) });
    return { ok: false, error: "unexpected" };
  }
}
