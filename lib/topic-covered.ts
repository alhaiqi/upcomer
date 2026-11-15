import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { checkRateLimit, limitFromEnv } from "@/lib/rate-limit";
import { getCourseTopics, SAVE_TRANSACTION } from "@/lib/topic-confidence";
import { parseCovered, type CoveredRefusal } from "@/lib/topic-covered-rules";

// US-32: the topics a student marked as already covered in one course. A CoveredTopic row means covered; undoing deletes
// it. Covered only leaves a topic out of the "Study next" recommendation (US-30). It is not evidence: nothing here reads
// or writes the learning profile (LearningTopic) or its events, so weakness, ratings, practice counts, and the personal
// order stay as they are. Every read and write is for one student in one course; the student's ID comes from the session
// (requireUser in the action and the page). Topics are never logged.

// Changes per student per minute. Far above what a person clicks, so it only stops a script or a stolen session.
export const TOPIC_COVERED_WINDOW_MS = 60_000;
export const topicCoveredLimit = () => limitFromEnv("TOPIC_COVERED_RATE_LIMIT_PER_MINUTE", 30);

const errorType = (error: unknown) => (error instanceof Error ? error.name : "Unknown");

// The topic keys the student marked as covered in this course. Only that course's rows of that student are read. Throws
// on a failed read; the caller logs it.
export async function getCoveredTopics(userId: string, courseId: string): Promise<Set<string>> {
  const rows = await db.coveredTopic.findMany({ where: { userId, courseId }, select: { topicKey: true } });
  return new Set(rows.map(row => row.topicKey));
}

// `changed` is false when the topic already was as asked (a double submit, or a stale page).
export type CoveredResult = { ok: true; covered: boolean; changed: boolean } | { ok: false; error: CoveredRefusal };

// Marks one topic of a course as covered for the session student, or undoes it. The topic must be a topic of the
// course's published exam papers; anything else is refused and nothing is saved. The write takes the course profile's
// lock, the same one as a confidence save (US-24) and a practice outcome (US-25), so it never interleaves with them.
export async function setTopicCovered(userId: string, courseId: string, entries: Iterable<[string, FormDataEntryValue]>): Promise<CoveredResult> {
  const limit = checkRateLimit(`topic-covered:${userId}`, topicCoveredLimit(), TOPIC_COVERED_WINDOW_MS);
  if (!limit.ok) {
    logError("topic_covered_rate_limited", { userId, retryAfterSeconds: String(limit.retryAfterSeconds) });
    return { ok: false, error: "rate_limited" };
  }
  try {
    const topics = await getCourseTopics(courseId);
    const parsed = parseCovered(entries, new Set(topics.map(topic => topic.topicKey)));
    if (!parsed.ok) {
      logError("topic_covered_refused", { userId, courseId, reason: parsed.error });
      return { ok: false, error: parsed.error };
    }
    const { topicKey, covered } = parsed;
    const changed = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`learning-profile:${userId}:${courseId}`}))`;
      if (!covered) return (await tx.coveredTopic.deleteMany({ where: { userId, courseId, topicKey } })).count > 0;
      // skipDuplicates: marking a topic that is already covered is not an error.
      return (await tx.coveredTopic.createMany({ data: [{ userId, courseId, topicKey }], skipDuplicates: true })).count > 0;
    }, SAVE_TRANSACTION);
    logError("topic_covered_saved", { userId, courseId, covered: String(covered), changed: String(changed) });
    return { ok: true, covered, changed };
  } catch (error) {
    logError("topic_covered_save_failed", { userId, courseId, errorType: errorType(error) });
    return { ok: false, error: "unexpected" };
  }
}
