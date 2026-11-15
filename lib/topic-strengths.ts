import { FileCategory } from "@prisma/client";
import { db } from "@/lib/db";
import { PUBLISHED_FILES } from "@/lib/file-visibility";
import { getLearningProfile, topicKey } from "@/lib/learning-profile";
import { logError } from "@/lib/logger";
import { selectStrengths, type CourseTopicCount, type TopicStrengths } from "@/lib/topic-strengths-rules";

// US-26: a student's strongest and weakest topics in one course. Reads that course's learning profile through
// getLearningProfile (never another course's, never another student's) and the course's published exam-paper topics.
// Nothing here checks the caller: the page calls requireUser() first and passes the session user's ID. Topics are never
// logged.

class RetrievalFailed extends Error {
  constructor(public source: "profile" | "course_topics", public cause: unknown) { super(source); }
}
const errorType = (error: unknown) => (error instanceof Error ? error.name : "Unknown");

// The course's topics by topic key: each named as its newest published exam paper writes it (like the confidence page),
// with the number of published exam papers that carry it, which is the topic's exam frequency.
async function getCourseTopicCounts(courseId: string): Promise<Map<string, CourseTopicCount>> {
  const papers = await db.courseFile.findMany({
    where: { courseId, category: FileCategory.EXAM, ...PUBLISHED_FILES, topic: { not: null } },
    select: { topic: true },
    orderBy: [{ year: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  const topics = new Map<string, CourseTopicCount>();
  for (const { topic } of papers) {
    const key = topicKey(topic);
    if (!key) continue;
    const entry = topics.get(key);
    if (entry) entry.paperCount++;
    else topics.set(key, { topic: topic!.replace(/\s+/g, " ").trim(), paperCount: 1 });
  }
  return topics;
}

export async function getTopicStrengths(userId: string, courseId: string): Promise<TopicStrengths> {
  let result: TopicStrengths;
  try {
    const [profile, courseTopics] = await Promise.all([
      getLearningProfile(userId, courseId).catch(error => { throw new RetrievalFailed("profile", error); }),
      getCourseTopicCounts(courseId).catch(error => { throw new RetrievalFailed("course_topics", error); }),
    ]);
    result = selectStrengths(profile, courseTopics);
  } catch (error) {
    // One line per failed page load: which read failed and the error's type, never its message.
    const failure = error instanceof RetrievalFailed ? error : null;
    logError("topic_strengths_retrieval_failed", { userId, courseId, source: failure?.source ?? "selection", errorType: errorType(failure ? failure.cause : error) });
    throw failure ? failure.cause : error;
  }
  if (result.invalidRows) logError("topic_strengths_invalid_data", { userId, courseId, invalidTopics: String(result.invalidRows) });
  return result;
}
