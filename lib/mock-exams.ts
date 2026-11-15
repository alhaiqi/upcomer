import { MockExamDifficulty, MockExamStatus } from "@prisma/client";
import { getConsolidatedExam } from "@/lib/consolidated-exam";
import { db } from "@/lib/db";
import { PUBLISHED_FILES } from "@/lib/file-visibility";
import { questionTopic } from "@/lib/learning-profile";
import { errorCode, logError } from "@/lib/logger";
import {
  MOCK_ANSWER_MAX_LENGTH, parseMockExamConfig, selectMockQuestions, type MockExamError, type MockExamOptions, type PoolQuestion, type SittingError,
} from "@/lib/mock-exam-rules";
import { checkRateLimit, limitFromEnv } from "@/lib/rate-limit";

// Configurable mock exams (US-45). A student picks topics, a length, and a difficulty; the exam is drawn from the course's
// consolidated exam (lib/consolidated-exam.ts), copied into MockExam/MockExamQuestion so it never changes afterwards, and
// then sat: answers are saved and the exam is submitted. Marking and results are US-49 and US-50.
// Nothing here checks the caller: the pages and actions call requireUser() first and pass the session user's ID, and every
// read and write of an exam is limited to its own student. Question text and answers are never logged.

export const MOCK_EXAM_RATE_WINDOW_MS = 60 * 60_000;
export const mockExamLimit = () => limitFromEnv("MOCK_EXAM_RATE_LIMIT_PER_HOUR", 20);
export const MOCK_EXAM_LIST_LIMIT = 20;

const errorType = (error: unknown) => (error instanceof Error ? error.name : "Unknown");

// Every question the course's published papers can give, with its topic. Only published papers count (US-13).
export async function buildPool(courseId: string): Promise<PoolQuestion[]> {
  const exam = await getConsolidatedExam(courseId);
  const paperIds = [...new Set(exam.questions.flatMap(question => question.papers.map(paper => paper.id)))];
  const papers = paperIds.length ? await db.courseFile.findMany({ where: { id: { in: paperIds }, courseId, ...PUBLISHED_FILES }, select: { id: true, topic: true } }) : [];
  const topics = new Map(papers.map(paper => [paper.id, paper.topic]));
  return exam.questions.map(question => {
    const topic = questionTopic(question.papers.map(paper => ({ topic: topics.get(paper.id) ?? null })));
    return {
      id: question.id, position: question.position, text: question.text, paperCount: question.paperCount, totalPapers: question.totalPapers,
      topicKey: topic?.topicKey ?? null, topic: topic?.topic ?? null, papers: question.papers.map(paper => ({ title: paper.title, year: paper.year })),
    };
  });
}

// The topics a student can build an exam from, with how many questions each has, for the form.
export async function getMockExamOptions(courseId: string): Promise<MockExamOptions> {
  try {
    const pool = await buildPool(courseId);
    const topics = new Map<string, { key: string; label: string; count: number }>();
    for (const question of pool) {
      if (!question.topicKey || !question.topic) continue;
      const entry = topics.get(question.topicKey) ?? { key: question.topicKey, label: question.topic, count: 0 };
      entry.count++;
      topics.set(question.topicKey, entry);
    }
    return { total: pool.length, topics: [...topics.values()].sort((a, b) => a.label.localeCompare(b.label)) };
  } catch (error) {
    logError("mock_exam_retrieval_failed", { courseId, entity: "options", errorType: errorType(error) });
    throw error;
  }
}

export type CreateMockExamInput = { courseId: string; length: string; difficulty: string; topics: string[] };
export type CreateMockExamResult = { ok: true; id: string } | { ok: false; error: MockExamError; available?: number };

const paperLabel = (paper: { title: string; year: number | null }) => (paper.year ? `${paper.title} (${paper.year})` : paper.title);

// Generates a mock exam for the given student. The exam has exactly the length asked for, only questions of the chosen
// topics, and the chosen difficulty; if the course cannot give that, nothing is saved and the error says how many questions match.
export async function createMockExam(userId: string, input: CreateMockExamInput): Promise<CreateMockExamResult> {
  const context = { userId, courseId: input.courseId.slice(0, 100) || undefined };
  const refuse = (error: MockExamError, available?: number): CreateMockExamResult => {
    logError("mock_exam_refused", { ...context, reason: error });
    return { ok: false, error, available };
  };
  const parsed = parseMockExamConfig(input);
  if (!parsed.ok) return refuse(parsed.error);
  const { config } = parsed;
  const limit = checkRateLimit(`mock-exam:${userId}`, mockExamLimit(), MOCK_EXAM_RATE_WINDOW_MS);
  if (!limit.ok) {
    logError("mock_exam_rate_limited", { ...context, retryAfterSeconds: String(limit.retryAfterSeconds) });
    return { ok: false, error: "rate_limited" };
  }
  try {
    const course = await db.course.findUnique({ where: { id: input.courseId }, select: { id: true } });
    if (!course) return refuse("course_not_found");
    const pool = await buildPool(course.id);
    if (!pool.length) return refuse("no_questions");
    const selected = selectMockQuestions(pool, config);
    if (!selected.ok) return refuse(selected.error, selected.available);
    const labels = new Map(pool.flatMap(question => (question.topicKey && question.topic ? [[question.topicKey, question.topic] as const] : [])));
    const created = await db.mockExam.create({
      data: {
        userId, courseId: course.id, topicKeys: config.topicKeys, topics: config.topicKeys.map(key => labels.get(key) ?? key),
        length: config.length, difficulty: MockExamDifficulty[config.difficulty],
        questions: {
          create: selected.questions.map((question, index) => ({
            position: index + 1, groupId: question.id, topicKey: question.topicKey, topic: question.topic, text: question.text,
            paperCount: question.paperCount, totalPapers: question.totalPapers, sourcePapers: question.papers.map(paperLabel),
          })),
        },
      },
      select: { id: true },
    });
    logError("mock_exam_created", {
      ...context, mockExamId: created.id, difficulty: config.difficulty, length: String(config.length), topicCount: String(config.topicKeys.length),
    });
    return { ok: true, id: created.id };
  } catch (error) {
    logError("mock_exam_failed", { ...context, errorType: errorType(error), errorCode: errorCode(error) });
    return { ok: false, error: "unexpected" };
  }
}

// One of the student's own mock exams with its questions in sitting order, or null. Another student's exam is also null,
// so the answer never says whether an ID exists.
export async function getMockExam(userId: string, mockExamId: string) {
  try {
    return await db.mockExam.findFirst({
      where: { id: mockExamId, userId },
      select: {
        id: true, courseId: true, length: true, difficulty: true, topics: true, status: true, createdAt: true, submittedAt: true,
        questions: {
          orderBy: { position: "asc" },
          select: { id: true, position: true, topic: true, text: true, paperCount: true, totalPapers: true, sourcePapers: true, answer: true },
        },
      },
    });
  } catch (error) {
    logError("mock_exam_retrieval_failed", { userId, mockExamId: mockExamId.slice(0, 100), errorType: errorType(error) });
    throw error;
  }
}
export type MockExamView = NonNullable<Awaited<ReturnType<typeof getMockExam>>>;

// The student's latest mock exams in one course, newest first.
export async function listMyMockExams(userId: string, courseId: string) {
  try {
    return await db.mockExam.findMany({
      where: { userId, courseId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MOCK_EXAM_LIST_LIMIT,
      select: { id: true, length: true, difficulty: true, topics: true, status: true, createdAt: true, submittedAt: true },
    });
  } catch (error) {
    logError("mock_exam_retrieval_failed", { userId, courseId, entity: "list", errorType: errorType(error) });
    throw error;
  }
}

export type SittingResult = { ok: true; submitted: boolean } | { ok: false; error: SittingError };

class Refused extends Error {
  constructor(readonly reason: SittingError) {
    super(reason);
  }
}

// Saves the student's answers (keyed by the exam question's ID), and with `submit` also submits the exam. Answers of other
// exams' questions are ignored. A submitted exam cannot change: claiming the exam and writing the answers are one
// transaction, so two tabs can never both submit it, and nothing is written once it is submitted.
export async function saveMockExam(userId: string, mockExamId: string, answers: Record<string, string>, submit: boolean): Promise<SittingResult> {
  const context = { userId, mockExamId: mockExamId.slice(0, 100), submit: String(submit) };
  if (Object.values(answers).some(answer => answer.length > MOCK_ANSWER_MAX_LENGTH)) {
    logError("mock_exam_save_refused", { ...context, reason: "answer_too_long" });
    return { ok: false, error: "answer_too_long" };
  }
  try {
    await db.$transaction(async tx => {
      const now = new Date();
      const claimed = await tx.mockExam.updateMany({
        where: { id: mockExamId, userId, status: MockExamStatus.IN_PROGRESS },
        data: submit ? { status: MockExamStatus.SUBMITTED, submittedAt: now } : { updatedAt: now },
      });
      if (claimed.count === 0) {
        const exists = await tx.mockExam.findFirst({ where: { id: mockExamId, userId }, select: { id: true } });
        throw new Refused(exists ? "already_submitted" : "not_found");
      }
      const own = new Set((await tx.mockExamQuestion.findMany({ where: { mockExamId }, select: { id: true } })).map(question => question.id));
      for (const [id, raw] of Object.entries(answers)) {
        if (!own.has(id)) continue;
        const answer = raw.replace(/\r\n?/g, "\n").trim();
        await tx.mockExamQuestion.update({ where: { id }, data: answer ? { answer, answeredAt: now } : { answer: null, answeredAt: null } });
      }
    });
    logError(submit ? "mock_exam_submitted" : "mock_exam_saved", context);
    return { ok: true, submitted: submit };
  } catch (error) {
    if (error instanceof Refused) {
      logError("mock_exam_save_refused", { ...context, reason: error.reason });
      return { ok: false, error: error.reason };
    }
    logError("mock_exam_save_failed", { ...context, errorType: errorType(error), errorCode: errorCode(error) });
    return { ok: false, error: "unexpected" };
  }
}
