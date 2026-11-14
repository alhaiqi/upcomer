import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PUBLISHED_FILES } from "@/lib/file-visibility";
import { NEUTRAL_WEAKNESS, questionTopic, topicKey } from "@/lib/learning-profile";
import { evidenceWeakness, learningSources, type LearningEventInput, type PracticeError } from "@/lib/learning-evidence-rules";
import { logError } from "@/lib/logger";
import { checkRateLimit, limitFromEnv } from "@/lib/rate-limit";
import { sourceFingerprint } from "@/lib/practice-generation-rules";

class EvidenceRefusal extends Error {
  constructor(public reason: PracticeError) { super(reason); }
}
export type EvidenceResult = { ok: true; recorded: number; duplicates: number } | { ok: false; error: PracticeError };

// Reusable, all-or-nothing contract for trusted server producers. Never expose this function directly as a server action:
// userId comes from the session or a stored attempt's owner, not an untrusted form. MOCK_EXAM callers must first persist
// and validate their rubric-backed grading. E5 sources are supported by the contract but have no producers in this sprint.
export async function recordLearningEvents(userId: string, courseId: string, events: LearningEventInput[]): Promise<EvidenceResult> {
  if (!events.length || events.length > 100 || events.some(event =>
    !/^[a-zA-Z0-9:_-]{1,160}$/.test(event.eventId) || !learningSources.includes(event.source) || typeof event.correct !== "boolean"
    || (Boolean(event.questionId) === Boolean(event.generatedQuestionId) && ["QUESTION_BANK", "MOCK_EXAM"].includes(event.source))
    || (event.source === "QUESTION_BANK" && Boolean(event.generatedQuestionId)))) return { ok: false, error: "invalid_outcome" };
  try {
    const result = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`learning-profile:${userId}:${courseId}`}))`;
      if (!await tx.course.findUnique({ where: { id: courseId }, select: { id: true } })) throw new EvidenceRefusal("not_found");
      let recorded = 0;
      let duplicates = 0;
      for (const event of events) {
        const old = await tx.learningEvent.findUnique({ where: { userId_source_eventId: { userId, source: event.source, eventId: event.eventId } } });
        // Compare immutable producer identity even if the source was subsequently removed or retagged.
        const target = event.generatedQuestionId ?? event.questionId ?? topicKey(event.topic);
        if (old) {
          if (old.courseId !== courseId || old.correct !== event.correct || old.targetKey !== target) throw new EvidenceRefusal("duplicate_conflict");
          duplicates++;
          continue;
        }
        let topic = event.topic?.replace(/\s+/g, " ").trim() ?? "";
        let questionId: string | undefined;
        let generatedQuestionId: string | undefined;
        if (event.questionId) {
          const question = await tx.question.findFirst({
            where: { id: event.questionId, file: { courseId, category: "EXAM", ...PUBLISHED_FILES } },
            include: { file: true, group: { include: { questions: { where: { file: { courseId, category: "EXAM", ...PUBLISHED_FILES } }, include: { file: true }, orderBy: [{ file: { year: "desc" } }, { file: { createdAt: "desc" } }, { id: "asc" }] } } } },
          });
          if (!question) throw new EvidenceRefusal("not_found");
          const papers = new Map((question.group?.questions ?? [question]).map(item => [item.file.id, item.file]));
          // Match question-bank papersOf exactly: topic ties must update the topic named by personal-order rationale.
          const orderedPapers = [...papers.values()].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
          topic = questionTopic(orderedPapers)?.topic ?? "";
          questionId = question.id;
        } else if (event.generatedQuestionId) {
          const generated = await tx.generatedPracticeQuestion.findFirst({
            where: { id: event.generatedQuestionId, userId, courseId, sourceQuestion: { file: { courseId, category: "EXAM", ...PUBLISHED_FILES } } },
            include: { sourceQuestion: { include: { file: { select: { topic: true } } } } },
          });
          if (!generated || generated.sourceFingerprint !== sourceFingerprint(generated.sourceQuestion.text) || generated.topicKey !== topicKey(generated.sourceQuestion.file.topic)) throw new EvidenceRefusal("not_found");
          topic = generated.topic;
          generatedQuestionId = generated.id;
        } else if (!["FLASHCARD", "AI_INTERACTION"].includes(event.source)) throw new EvidenceRefusal("not_found");
        const key = topicKey(topic);
        if (!key || topic.length > 100) throw new EvidenceRefusal("topic_required");
        // Future E5 topics must also exist in this course's published papers.
        if (!questionId && !generatedQuestionId && !await tx.courseFile.findFirst({ where: { courseId, category: "EXAM", ...PUBLISHED_FILES, topic: { equals: topic, mode: "insensitive" } }, select: { id: true } })) throw new EvidenceRefusal("not_found");
        await tx.learningEvent.create({ data: { userId, courseId, eventId: event.eventId, source: event.source, targetKey: target, topicKey: key, topic, correct: event.correct, questionId, generatedQuestionId } });
        const current = await tx.learningTopic.findUnique({ where: { userId_courseId_topicKey: { userId, courseId, topicKey: key } } });
        const baseline = current?.baselineWeakness ?? current?.weakness ?? NEUTRAL_WEAKNESS;
        const correctCount = (current?.correctCount ?? 0) + Number(event.correct);
        const incorrectCount = (current?.incorrectCount ?? 0) + Number(!event.correct);
        const data = { baselineWeakness: baseline, correctCount, incorrectCount, weakness: evidenceWeakness(baseline, correctCount, incorrectCount) };
        await tx.learningTopic.upsert({
          where: { userId_courseId_topicKey: { userId, courseId, topicKey: key } },
          create: { userId, courseId, topicKey: key, topic, ...data }, update: data,
        });
        recorded++;
      }
      return { ok: true as const, recorded, duplicates };
    }, { maxWait: 10_000, timeout: 30_000 });
    logError("learning_evidence_saved", { userId, courseId, recorded: String(result.recorded), duplicates: String(result.duplicates) });
    return result;
  } catch (error) {
    const reason = error instanceof EvidenceRefusal ? error.reason : "unexpected";
    logError(reason === "unexpected" ? "learning_evidence_failed" : "learning_evidence_refused", { userId, courseId, reason, errorType: error instanceof Error ? error.name : "Unknown" });
    return { ok: false, error: reason };
  }
}

// Session-bound browser path: a student may self-report an existing question, never submit authoritative mock grades.
export async function recordPracticeOutcome(userId: string, courseId: string, input: { eventId: string; questionId: string; outcome: string }) {
  if (!checkRateLimit(`practice:${userId}`, limitFromEnv("PRACTICE_RATE_LIMIT_PER_MINUTE", 60), 60_000).ok) {
    logError("learning_evidence_refused", { userId, courseId, reason: "rate_limited" });
    return { ok: false as const, error: "rate_limited" as const };
  }
  if (!["CORRECT", "INCORRECT"].includes(input.outcome)) return { ok: false as const, error: "invalid_outcome" as const };
  return recordLearningEvents(userId, courseId, [{ eventId: input.eventId, questionId: input.questionId, correct: input.outcome === "CORRECT", source: "QUESTION_BANK" }]);
}

// US-49 integration seam: grading must be committed and owned by this student before this trusted adapter is called.
// Stable attempt/item identifiers make retrying delivery safe. No browser route accepts these grades.
export function recordMockOutcomes(userId: string, courseId: string, attemptId: string, outcomes: Array<{ itemId: string; generatedQuestionId: string; correct: boolean }>) {
  return recordLearningEvents(userId, courseId, outcomes.map(item => ({ source: "MOCK_EXAM", eventId: `${attemptId}:${item.itemId}`, generatedQuestionId: item.generatedQuestionId, correct: item.correct })));
}

export type EvidenceClient = Pick<Prisma.TransactionClient, "learningEvent" | "learningTopic">;
