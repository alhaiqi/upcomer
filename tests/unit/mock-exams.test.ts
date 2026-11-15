import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const tx = {
    mockExam: { updateMany: vi.fn(), findFirst: vi.fn() },
    mockExamQuestion: { findMany: vi.fn(), update: vi.fn() },
  };
  return {
    tx,
    course: { findUnique: vi.fn() },
    courseFile: { findMany: vi.fn() },
    mockExam: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
});
const consolidated = vi.hoisted(() => ({ getConsolidatedExam: vi.fn() }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/consolidated-exam", () => consolidated);
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), errorCode: (error: unknown) => (error as { code?: string } | null)?.code }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => ({ ok: true })), limitFromEnv: (_name: string, fallback: number) => fallback }));

import { checkRateLimit } from "@/lib/rate-limit";
import { createMockExam, getMockExam, getMockExamOptions, saveMockExam } from "@/lib/mock-exams";

const paper = (id: string, title: string) => ({ id, title, year: 2025, examType: null, term: null, professor: null });
const examQuestion = (index: number, paperId: string) => ({
  id: `g${index}`, position: index, rank: index, text: "x".repeat(index * 10), paperCount: 1, totalPapers: 2, papers: [paper(paperId, `Paper ${paperId}`)], tier: "HIGH",
});
const input = (over: Record<string, unknown> = {}) => ({ courseId: "course-1", length: "3", difficulty: "EASY", topics: [] as string[], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  db.course.findUnique.mockResolvedValue({ id: "course-1" });
  db.courseFile.findMany.mockResolvedValue([{ id: "p1", topic: "Networking Basics" }, { id: "p2", topic: " databases " }]);
  consolidated.getConsolidatedExam.mockResolvedValue({ totalPapers: 2, questions: [1, 2, 3, 4].map(index => examQuestion(index, "p1")).concat([5, 6, 7, 8].map(index => examQuestion(index, "p2"))) });
  db.mockExam.create.mockResolvedValue({ id: "mock-1" });
});

describe("createMockExam (US-45)", () => {
  it("stores the settings and a copy of exactly the questions asked for", async () => {
    expect(await createMockExam("user-1", input({ topics: ["Databases"], difficulty: "HARD" }))).toEqual({ ok: true, id: "mock-1" });
    const data = db.mockExam.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: "user-1", courseId: "course-1", length: 3, difficulty: "HARD", topicKeys: ["databases"], topics: ["databases"] });
    expect(data.questions.create).toHaveLength(3);
    expect(data.questions.create.map((item: { position: number }) => item.position)).toEqual([1, 2, 3]);
    expect(data.questions.create.every((item: { topicKey: string; groupId: string; text: string; sourcePapers: string[] }) =>
      item.topicKey === "databases" && item.groupId.startsWith("g") && item.text.length > 0 && item.sourcePapers[0] === "Paper p2 (2025)")).toBe(true);
  });

  it("uses the topic's display name from the course, not what was typed", async () => {
    await createMockExam("user-1", input({ topics: ["  NETWORKING   basics "] }));
    expect(db.mockExam.create.mock.calls[0][0].data.topics).toEqual(["Networking Basics"]);
  });

  it("refuses bad settings before touching the database", async () => {
    expect(await createMockExam("user-1", input({ length: "1" }))).toMatchObject({ ok: false, error: "length_invalid" });
    expect(await createMockExam("user-1", input({ difficulty: "NOPE" }))).toMatchObject({ ok: false, error: "difficulty_invalid" });
    expect(db.course.findUnique).not.toHaveBeenCalled();
    expect(db.mockExam.create).not.toHaveBeenCalled();
  });

  it("saves nothing and says how many match when the topics have too few questions", async () => {
    expect(await createMockExam("user-1", input({ topics: ["databases"], length: "5" }))).toEqual({ ok: false, error: "not_enough_questions", available: 4 });
    expect(db.mockExam.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown topic, an unknown course, and a course without questions", async () => {
    expect(await createMockExam("user-1", input({ topics: ["quantum"] }))).toMatchObject({ ok: false, error: "topic_invalid" });
    db.course.findUnique.mockResolvedValueOnce(null);
    expect(await createMockExam("user-1", input())).toMatchObject({ ok: false, error: "course_not_found" });
    consolidated.getConsolidatedExam.mockResolvedValueOnce({ totalPapers: 0, questions: [] });
    expect(await createMockExam("user-1", input())).toMatchObject({ ok: false, error: "no_questions" });
    expect(db.mockExam.create).not.toHaveBeenCalled();
  });

  it("builds the exam only from the course it was asked for", async () => {
    await createMockExam("user-1", input());
    expect(consolidated.getConsolidatedExam).toHaveBeenCalledWith("course-1");
    expect(db.courseFile.findMany.mock.calls[0][0].where).toMatchObject({ courseId: "course-1" });
  });

  it("stops a student who generates too much", async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce({ ok: false, retryAfterSeconds: 30 } as ReturnType<typeof checkRateLimit>);
    expect(await createMockExam("user-1", input())).toEqual({ ok: false, error: "rate_limited" });
    expect(db.mockExam.create).not.toHaveBeenCalled();
  });

  it("reports an unexpected failure without saving", async () => {
    db.mockExam.create.mockRejectedValueOnce(new Error("boom"));
    expect(await createMockExam("user-1", input())).toEqual({ ok: false, error: "unexpected" });
  });
});

describe("getMockExamOptions", () => {
  it("counts the questions of each topic", async () => {
    expect(await getMockExamOptions("course-1")).toEqual({
      total: 8, topics: [{ key: "databases", label: "databases", count: 4 }, { key: "networking basics", label: "Networking Basics", count: 4 }],
    });
  });
});

describe("getMockExam", () => {
  it("only reads an exam of the student asking", async () => {
    db.mockExam.findFirst.mockResolvedValue(null);
    expect(await getMockExam("user-2", "mock-1")).toBeNull();
    expect(db.mockExam.findFirst.mock.calls[0][0].where).toEqual({ id: "mock-1", userId: "user-2" });
  });
});

describe("saveMockExam (the sitting flow)", () => {
  it("saves answers of the exam's own questions and trims them", async () => {
    db.tx.mockExam.updateMany.mockResolvedValue({ count: 1 });
    db.tx.mockExamQuestion.findMany.mockResolvedValue([{ id: "q1" }, { id: "q2" }]);
    expect(await saveMockExam("user-1", "mock-1", { q1: "  my answer \r\n", q2: "   ", other: "not mine" }, false)).toEqual({ ok: true, submitted: false });
    expect(db.tx.mockExam.updateMany.mock.calls[0][0].where).toMatchObject({ id: "mock-1", userId: "user-1", status: "IN_PROGRESS" });
    expect(db.tx.mockExamQuestion.update).toHaveBeenCalledTimes(2);
    expect(db.tx.mockExamQuestion.update.mock.calls[0][0]).toMatchObject({ where: { id: "q1" }, data: { answer: "my answer" } });
    expect(db.tx.mockExamQuestion.update.mock.calls[1][0]).toMatchObject({ where: { id: "q2" }, data: { answer: null, answeredAt: null } });
  });

  it("submits by moving the exam to SUBMITTED in the same transaction", async () => {
    db.tx.mockExam.updateMany.mockResolvedValue({ count: 1 });
    db.tx.mockExamQuestion.findMany.mockResolvedValue([{ id: "q1" }]);
    expect(await saveMockExam("user-1", "mock-1", { q1: "final" }, true)).toEqual({ ok: true, submitted: true });
    expect(db.tx.mockExam.updateMany.mock.calls[0][0].data).toMatchObject({ status: "SUBMITTED" });
  });

  it("refuses to change an exam that was already submitted", async () => {
    db.tx.mockExam.updateMany.mockResolvedValue({ count: 0 });
    db.tx.mockExam.findFirst.mockResolvedValue({ id: "mock-1" });
    expect(await saveMockExam("user-1", "mock-1", { q1: "late" }, false)).toEqual({ ok: false, error: "already_submitted" });
    expect(db.tx.mockExamQuestion.update).not.toHaveBeenCalled();
  });

  it("says not found for an exam that is not the student's", async () => {
    db.tx.mockExam.updateMany.mockResolvedValue({ count: 0 });
    db.tx.mockExam.findFirst.mockResolvedValue(null);
    expect(await saveMockExam("user-2", "mock-1", {}, true)).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses an answer that is too long without starting a transaction", async () => {
    expect(await saveMockExam("user-1", "mock-1", { q1: "x".repeat(5001) }, false)).toEqual({ ok: false, error: "answer_too_long" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
