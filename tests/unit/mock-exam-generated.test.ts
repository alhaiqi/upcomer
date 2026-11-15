import { beforeEach, describe, expect, it, vi } from "vitest";

// US-45 with US-44: a mock exam can include the student's generated practice questions, read only through
// getGeneratedPracticeQuestions; and each past-paper question records one source question of its group for US-49.

const mocks = vi.hoisted(() => ({
  db: {
    course: { findUnique: vi.fn() }, courseFile: { findMany: vi.fn() }, question: { findMany: vi.fn() },
    mockExam: { create: vi.fn() }, generatedPracticeQuestion: { findMany: vi.fn() },
  },
  getConsolidatedExam: vi.fn(), getGeneratedPracticeQuestions: vi.fn(), logError: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/consolidated-exam", () => ({ getConsolidatedExam: mocks.getConsolidatedExam }));
vi.mock("@/lib/practice-generation", () => ({ getGeneratedPracticeQuestions: mocks.getGeneratedPracticeQuestions }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, errorCode: () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => ({ ok: true })), limitFromEnv: (_name: string, fallback: number) => fallback }));

import {
  generatedShare, selectMockQuestions, sourceQuestionOf, type GeneratedCandidate, type MockConfig, type PoolQuestion,
} from "@/lib/mock-exam-rules";
import { createMockExam, getMockExamOptions } from "@/lib/mock-exams";

const question = (index: number): PoolQuestion => ({
  id: `g${index}`, position: index, text: "x".repeat(index * 10), paperCount: 1, totalPapers: 2,
  topicKey: index <= 4 ? "networking" : "databases", topic: index <= 4 ? "Networking" : "Databases", papers: [{ id: `p${index}`, title: `Paper ${index}`, year: 2025 }],
});
// Eight past-paper questions, from the simplest (g1) to the most complex (g8); g1-g4 are Networking, g5-g8 Databases.
const pool = Array.from({ length: 8 }, (_, index) => question(index + 1));
const candidate = (id: string, topicKey: string, difficulty: GeneratedCandidate["difficulty"]): GeneratedCandidate =>
  ({ id, topicKey, topic: topicKey === "networking" ? "Networking" : "Databases", difficulty, text: `Secret task ${id}`, sourcePaper: `Paper of ${id}` });
// Newest first, as getGeneratedPracticeQuestions returns them.
const generated = [
  candidate("n-easy", "networking", "EASY"), candidate("d-hard", "databases", "HARD"), candidate("n-hard", "networking", "HARD"),
  candidate("d-easy", "databases", "EASY"), candidate("n-medium", "networking", "MEDIUM"), candidate("n-easy-2", "networking", "EASY"),
];
const config = (over: Partial<MockConfig> = {}): MockConfig => ({ topicKeys: [], length: 6, difficulty: "MIXED", includeGenerated: true, ...over });
const pick = (settings: MockConfig, options: Parameters<typeof selectMockQuestions>[2] = { generated }) => {
  const result = selectMockQuestions(pool, settings, options);
  if (!result.ok) throw new Error(result.error);
  return { past: result.questions.map(item => item.id), generated: result.generated.map(item => item.id), narrowed: result.narrowed };
};

describe("selectMockQuestions with generated practice questions", () => {
  it("leaves them out unless the settings ask for them, so the past-paper exam is unchanged", () => {
    const without = selectMockQuestions(pool, config({ includeGenerated: false }));
    expect(selectMockQuestions(pool, config({ includeGenerated: false }), { generated })).toEqual(without);
    expect(selectMockQuestions(pool, { topicKeys: [], length: 6, difficulty: "MIXED" }, { generated })).toEqual(without);
    expect(without).toMatchObject({ ok: true, generated: [] });
  });

  it("gives them at most half of the exam, rounded down, and always the exact length", () => {
    expect([3, 4, 5, 6, 7].map(generatedShare)).toEqual([1, 2, 2, 3, 3]);
    for (const length of [3, 4, 5, 6, 7]) {
      const exam = pick(config({ length }));
      expect(exam.generated).toHaveLength(generatedShare(length));
      expect(exam.past.length + exam.generated.length).toBe(length);
    }
  });

  it("takes them in the order given, newest first", () => {
    expect(pick(config({ length: 6 })).generated).toEqual(["n-easy", "d-hard", "n-hard"]);
  });

  it("uses only those of the chosen topics", () => {
    const exam = pick(config({ topicKeys: ["databases"], length: 4 }));
    expect(exam.generated).toEqual(["d-hard", "d-easy"]);
    expect(exam.past.every(id => ["g5", "g6", "g7", "g8"].includes(id))).toBe(true);
  });

  it("uses only those generated at the chosen difficulty, and any for MIXED", () => {
    expect(pick(config({ difficulty: "EASY", length: 6 })).generated).toEqual(["n-easy", "d-easy", "n-easy-2"]);
    expect(pick(config({ difficulty: "MEDIUM", length: 6 })).generated).toEqual(["n-medium"]);
    expect(pick(config({ difficulty: "HARD", topicKeys: ["databases"], length: 4 })).generated).toEqual(["d-hard"]);
  });

  it("fills with past-paper questions when there are fewer generated ones than the share", () => {
    const exam = pick(config({ difficulty: "MEDIUM", length: 6 }));
    expect(exam.generated).toEqual(["n-medium"]);
    expect(exam.past).toHaveLength(5);
    // No generated question at all: the same exam as without the setting.
    expect(selectMockQuestions(pool, config(), { generated: [] })).toEqual(selectMockQuestions(pool, config({ includeGenerated: false })));
  });

  it("picks the past-paper part by the usual difficulty rule", () => {
    // Four of the seven are past-paper questions: the four simplest for EASY.
    expect(pick(config({ difficulty: "EASY", length: 7 })).past).toEqual(["g1", "g2", "g3", "g4"]);
    expect(pick(config({ difficulty: "HARD", topicKeys: ["databases"], length: 4 })).past).toEqual(["g6", "g7", "g8"]);
  });

  it("makes exams the past papers alone could not, and says how long an exam can be", () => {
    // Databases has four past-paper questions and two generated ones.
    expect(selectMockQuestions(pool, config({ topicKeys: ["databases"], length: 6, includeGenerated: false }), { generated }))
      .toEqual({ ok: false, error: "not_enough_questions", available: 4 });
    expect(pick(config({ topicKeys: ["databases"], length: 6 }))).toMatchObject({ past: ["g5", "g6", "g7", "g8"], generated: ["d-hard", "d-easy"], narrowed: false });
    expect(selectMockQuestions(pool, config({ topicKeys: ["databases"], length: 7 }), { generated })).toEqual({ ok: false, error: "not_enough_questions", available: 6 });
  });

  it("never offers more generated questions than past-paper ones as available", () => {
    const one = [question(1)];
    expect(selectMockQuestions(one, config({ length: 5 }), { generated })).toEqual({ ok: false, error: "not_enough_questions", available: 2 });
  });

  it("still refuses a topic the course's papers do not have", () => {
    expect(selectMockQuestions(pool, config({ topicKeys: ["quantum"] }), { generated: [candidate("q", "quantum", "EASY")] }))
      .toEqual({ ok: false, error: "topic_invalid", available: 0 });
  });

  it("leaves out excluded questions of both kinds (for an alternative version, US-46)", () => {
    const first = pick(config({ length: 4 }));
    const second = pick(config({ length: 4 }), { generated, exclude: new Set([...first.past, ...first.generated]) });
    expect([...second.past, ...second.generated].filter(id => [...first.past, ...first.generated].includes(id))).toEqual([]);
    expect(second.past.length + second.generated.length).toBe(4);
  });

  it("gives the same exam for the same inputs", () => {
    expect(selectMockQuestions([...pool].reverse(), config(), { generated })).toEqual(selectMockQuestions(pool, config(), { generated }));
  });
});

describe("sourceQuestionOf", () => {
  const papers = [{ id: "newest" }, { id: "older" }, { id: "oldest" }];
  it("takes the question in the first paper, in the question bank's paper order", () => {
    const questions = [{ id: "q-oldest", number: 1, fileId: "oldest" }, { id: "q-newest", number: 4, fileId: "newest" }, { id: "q-older", number: 2, fileId: "older" }];
    expect(sourceQuestionOf(papers, questions)).toBe("q-newest");
    expect(sourceQuestionOf(papers, [...questions].reverse())).toBe("q-newest");
  });
  it("takes the lowest number inside a paper, then the lowest ID", () => {
    expect(sourceQuestionOf(papers, [{ id: "b", number: 3, fileId: "newest" }, { id: "a", number: 2, fileId: "newest" }])).toBe("a");
    expect(sourceQuestionOf(papers, [{ id: "b", number: 2, fileId: "newest" }, { id: "a", number: 2, fileId: "newest" }])).toBe("a");
  });
  it("skips a paper without a question, and questions of papers that are not the group's", () => {
    expect(sourceQuestionOf(papers, [{ id: "q", number: 1, fileId: "older" }, { id: "stray", number: 1, fileId: "another" }])).toBe("q");
  });
  it("is null when no question is left", () => {
    expect(sourceQuestionOf(papers, [])).toBeNull();
    expect(sourceQuestionOf([], [{ id: "q", number: 1, fileId: "newest" }])).toBeNull();
  });
});

describe("createMockExam with generated practice questions", () => {
  const paper = (id: string) => ({ id, title: `Paper ${id}`, year: 2025, examType: null, term: null, professor: null });
  const examQuestion = (index: number) => ({
    id: `g${index}`, position: index, rank: index, text: "x".repeat(index * 10), paperCount: 2, totalPapers: 2, papers: [paper("p2"), paper("p1")], tier: "HIGH",
  });
  const stored = (id: string, difficulty: string) => ({
    id, topicKey: "networking", topic: "Networking", difficulty, prompt: `Secret task ${id}`, sourceQuestion: { text: "source", fileId: "p1", file: { title: `Paper of ${id}` } },
  });
  const input = (over: Record<string, unknown> = {}) => ({ courseId: "course-1", length: "4", difficulty: "MIXED", topics: [] as string[], ...over });
  const rows = () => mocks.db.mockExam.create.mock.calls[0][0].data.questions.create as Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.db.courseFile.findMany.mockResolvedValue([{ id: "p1", topic: "Networking" }, { id: "p2", topic: "Networking" }]);
    mocks.getConsolidatedExam.mockResolvedValue({ totalPapers: 2, questions: [1, 2, 3, 4, 5].map(examQuestion) });
    // Each group has a question in both papers; p2 is first in the bank's order.
    mocks.db.question.findMany.mockResolvedValue([1, 2, 3, 4, 5].flatMap(index => [
      { id: `q${index}-p1`, number: index, fileId: "p1", groupId: `g${index}` }, { id: `q${index}-p2`, number: index, fileId: "p2", groupId: `g${index}` },
    ]));
    mocks.getGeneratedPracticeQuestions.mockResolvedValue([stored("gen-1", "EASY"), stored("gen-2", "HARD"), stored("gen-3", "EASY")]);
    mocks.db.mockExam.create.mockResolvedValue({ id: "mock-1" });
  });

  it("does not read generated questions unless the student asks, and stores a past-paper exam as before", async () => {
    expect(await createMockExam("user-1", input())).toMatchObject({ ok: true });
    expect(mocks.getGeneratedPracticeQuestions).not.toHaveBeenCalled();
    expect(mocks.db.mockExam.create.mock.calls[0][0].data).toMatchObject({ includeGenerated: false });
    expect(rows()).toHaveLength(4);
    expect(rows().every(row => typeof row.groupId === "string" && row.generatedQuestionId === undefined && row.paperCount === 2)).toBe(true);
  });

  it("records each past-paper question's source question by the fixed rule", async () => {
    await createMockExam("user-1", input());
    expect(mocks.db.question.findMany.mock.calls[0][0].where).toMatchObject({ file: { courseId: "course-1", category: "EXAM", status: "PUBLISHED" } });
    for (const row of rows()) expect(row.questionId).toBe(`q${String(row.groupId).slice(1)}-p2`);
  });

  it("stores no source question when the group has none left", async () => {
    mocks.db.question.findMany.mockResolvedValue([]);
    await createMockExam("user-1", input());
    expect(rows().every(row => row.questionId === null)).toBe(true);
  });

  it("reads the student's generated questions through the US-44 contract only, and copies up to half of the exam", async () => {
    expect(await createMockExam("user-1", input({ includeGenerated: true }))).toMatchObject({ ok: true });
    expect(mocks.getGeneratedPracticeQuestions).toHaveBeenCalledTimes(1);
    expect(mocks.getGeneratedPracticeQuestions).toHaveBeenCalledWith("user-1", "course-1");
    expect(mocks.db.generatedPracticeQuestion.findMany).not.toHaveBeenCalled();
    expect(mocks.db.mockExam.create.mock.calls[0][0].data).toMatchObject({ includeGenerated: true, length: 4 });
    expect(rows().map(row => row.position)).toEqual([1, 2, 3, 4]);
    // Past-paper questions first, then the generated ones, newest first.
    expect(rows().slice(0, 2).every(row => typeof row.groupId === "string" && typeof row.questionId === "string")).toBe(true);
    expect(rows().slice(2)).toEqual([
      { position: 3, generatedQuestionId: "gen-1", topicKey: "networking", topic: "Networking", text: "Secret task gen-1", paperCount: 0, totalPapers: 2, sourcePapers: ["Paper of gen-1"] },
      { position: 4, generatedQuestionId: "gen-2", topicKey: "networking", topic: "Networking", text: "Secret task gen-2", paperCount: 0, totalPapers: 2, sourcePapers: ["Paper of gen-2"] },
    ]);
  });

  it("uses only generated questions of the chosen difficulty", async () => {
    await createMockExam("user-1", input({ includeGenerated: true, difficulty: "HARD" }));
    expect(rows().filter(row => row.generatedQuestionId).map(row => row.generatedQuestionId)).toEqual(["gen-2"]);
    expect(rows()).toHaveLength(4);
  });

  it("logs the number of generated questions, never a question's text", async () => {
    await createMockExam("user-1", input({ includeGenerated: true }));
    expect(mocks.logError).toHaveBeenCalledWith("mock_exam_created", expect.objectContaining({ userId: "user-1", courseId: "course-1", mockExamId: "mock-1", length: "4", generatedCount: "2" }));
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toMatch(/secret|xxxx/i);
  });

  it("saves nothing when reading the generated questions fails", async () => {
    mocks.getGeneratedPracticeQuestions.mockRejectedValue(new Error("down"));
    expect(await createMockExam("user-1", input({ includeGenerated: true }))).toEqual({ ok: false, error: "unexpected" });
    expect(mocks.db.mockExam.create).not.toHaveBeenCalled();
  });

  it("tells the form how many generated questions the student has, and reads none for a visitor", async () => {
    expect((await getMockExamOptions("course-1", "user-1")).generated).toBe(3);
    expect(mocks.getGeneratedPracticeQuestions).toHaveBeenCalledWith("user-1", "course-1");
    mocks.getGeneratedPracticeQuestions.mockClear();
    expect((await getMockExamOptions("course-1")).generated).toBe(0);
    expect(mocks.getGeneratedPracticeQuestions).not.toHaveBeenCalled();
  });
});
