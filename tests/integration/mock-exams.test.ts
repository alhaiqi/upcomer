import { randomUUID } from "node:crypto";
import { FileCategory } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { complexityOf } from "@/lib/mock-exam-rules";
import { createMockExam, getMockExam, getMockExamOptions, listMyMockExams, saveMockExam } from "@/lib/mock-exams";
import { rebuildQuestionBank } from "@/lib/question-bank";

// Mock exams (US-45) against a real, migrated database, built on the real question bank: papers with topics and questions
// are created, the bank is rebuilt, and exams are generated, sat, and submitted. Every record is created here with a unique
// suffix and deleted in afterAll. The services take the user ID directly, so no session is needed.

// Generating many exams in one run must not hit the per-hour limit (the default is 20).
process.env.MOCK_EXAM_RATE_LIMIT_PER_HOUR = "1000";

const run = randomUUID().slice(0, 8);
const ids = {} as { faculty: string; course: string; emptyCourse: string; student: string; other: string };

const NETWORKING = [
  `State the OSI model layers`,
  `Explain how the TCP three way handshake establishes a connection`,
  `Describe congestion control in TCP and compare slow start with congestion avoidance`,
  `Design a subnetting plan for a company with four departments.\na) Choose the address ranges.\nb) Justify the mask for each department.\nc) Explain how a router would forward traffic between them.`,
];
const DATABASES = [
  `Define a primary key`,
  `Explain the difference between an inner join and an outer join`,
  `Describe how B-tree indexes speed up range queries and what the cost of maintaining them is`,
  `Normalise a relation to third normal form.\na) List the functional dependencies.\nb) Show each decomposition step.\nc) Prove the result is lossless.`,
];

const generate = async (over: Partial<{ courseId: string; length: string; difficulty: string; topics: string[] }> = {}) =>
  createMockExam(ids.student, { courseId: ids.course, length: "3", difficulty: "MIXED", topics: [], ...over });
const mustGenerate = async (over: Parameters<typeof generate>[0] = {}) => {
  const result = await generate(over);
  if (!result.ok) throw new Error(`generate failed: ${result.error}`);
  return result.id;
};
const examOf = async (id: string) => (await getMockExam(ids.student, id))!;

beforeAll(async () => {
  const faculty = await db.faculty.create({ data: { code: `MF${run}`, name: `Faculty ${run}` } });
  const [course, emptyCourse, student, other] = await Promise.all([
    db.course.create({ data: { code: `MA${run}`, name: "Mock course", facultyId: faculty.id } }),
    db.course.create({ data: { code: `MB${run}`, name: "Empty course", facultyId: faculty.id } }),
    db.user.create({ data: { email: `student-${run}@example.com`, passwordHash: "x", name: `Student ${run}` } }),
    db.user.create({ data: { email: `other-${run}@example.com`, passwordHash: "x", name: `Other ${run}` } }),
  ]);
  for (const [title, topic, texts] of [[`Networks final`, "Networking Basics", NETWORKING], [`Databases final`, "Databases", DATABASES]] as const) {
    const paper = await db.courseFile.create({
      data: { courseId: course.id, title, originalFileName: `${title}.pdf`, storageKey: `test/${run}/${title}`, category: FileCategory.EXAM, year: 2025, topic },
    });
    await db.question.createMany({ data: texts.map((text, index) => ({ fileId: paper.id, number: index + 1, text })) });
  }
  const rebuilt = await rebuildQuestionBank(course.id);
  if (!rebuilt.ok) throw new Error("question bank rebuild failed");
  Object.assign(ids, { faculty: faculty.id, course: course.id, emptyCourse: emptyCourse.id, student: student.id, other: other.id });
});

afterAll(async () => {
  // Mock exams go with their course and user; papers and questions go with their course.
  await db.course.deleteMany({ where: { id: { in: [ids.course, ids.emptyCourse].filter(Boolean) } } });
  await db.user.deleteMany({ where: { id: { in: [ids.student, ids.other].filter(Boolean) } } });
  if (ids.faculty) await db.faculty.deleteMany({ where: { id: ids.faculty } });
  await db.$disconnect();
});

describe("US-45: options", () => {
  it("lists the course's topics with their question counts", async () => {
    const options = await getMockExamOptions(ids.course);
    expect(options.total).toBe(8);
    expect(options.topics).toEqual([{ key: "databases", label: "Databases", count: 4 }, { key: "networking basics", label: "Networking Basics", count: 4 }]);
  });
});

describe("US-45: the exam follows the chosen constraints", () => {
  it("has exactly the length asked for, for every difficulty", async () => {
    for (const length of ["3", "5", "8"]) for (const difficulty of ["EASY", "MEDIUM", "HARD", "MIXED"]) {
      const exam = await examOf(await mustGenerate({ length, difficulty }));
      expect(exam.questions).toHaveLength(Number(length));
      expect(exam.length).toBe(Number(length));
      expect(exam.questions.map(question => question.position)).toEqual(Array.from({ length: Number(length) }, (_, index) => index + 1));
    }
  });

  it("uses only the chosen topics, and stores the settings", async () => {
    const exam = await examOf(await mustGenerate({ topics: ["Networking Basics"], difficulty: "HARD" }));
    expect(exam).toMatchObject({ courseId: ids.course, difficulty: "HARD", topics: ["Networking Basics"], status: "IN_PROGRESS" });
    expect(exam.questions.every(question => question.topic === "Networking Basics")).toBe(true);
    const both = await examOf(await mustGenerate({ topics: ["databases", "networking basics"], length: "8" }));
    expect(both.questions).toHaveLength(8);
  });

  it("picks easier questions for EASY than for HARD", async () => {
    const easy = await examOf(await mustGenerate({ difficulty: "EASY" }));
    const hard = await examOf(await mustGenerate({ difficulty: "HARD" }));
    expect(Math.max(...easy.questions.map(question => complexityOf(question.text)))).toBeLessThanOrEqual(Math.min(...hard.questions.map(question => complexityOf(question.text))));
  });

  it("gives the same questions for the same settings", async () => {
    const first = await examOf(await mustGenerate({ difficulty: "MEDIUM", topics: ["databases"] }));
    const second = await examOf(await mustGenerate({ difficulty: "MEDIUM", topics: ["databases"] }));
    expect(second.questions.map(question => question.text)).toEqual(first.questions.map(question => question.text));
  });

  it("keeps the evidence of each question: its papers and how often it appeared", async () => {
    const exam = await examOf(await mustGenerate({ topics: ["databases"] }));
    for (const question of exam.questions) {
      expect(question).toMatchObject({ paperCount: 1, totalPapers: 2 });
      expect(question.sourcePapers).toEqual([`Databases final ${run} (2025)`]);
    }
  });

  it("refuses what the course cannot give, and saves nothing", async () => {
    const before = await db.mockExam.count({ where: { userId: ids.student } });
    expect(await generate({ topics: ["databases"], length: "5" })).toEqual({ ok: false, error: "not_enough_questions", available: 4 });
    expect(await generate({ topics: ["quantum"] })).toMatchObject({ ok: false, error: "topic_invalid" });
    expect(await generate({ length: "2" })).toMatchObject({ ok: false, error: "length_invalid" });
    expect(await generate({ length: "abc" })).toMatchObject({ ok: false, error: "length_invalid" });
    expect(await generate({ difficulty: "IMPOSSIBLE" })).toMatchObject({ ok: false, error: "difficulty_invalid" });
    expect(await generate({ courseId: ids.emptyCourse })).toMatchObject({ ok: false, error: "no_questions" });
    expect(await generate({ courseId: "no-such-course" })).toMatchObject({ ok: false, error: "course_not_found" });
    expect(await db.mockExam.count({ where: { userId: ids.student } })).toBe(before);
  });
});

describe("US-45: the sitting flow", () => {
  it("saves answers, keeps them on reload, and locks them on submit", async () => {
    const id = await mustGenerate({ length: "3" });
    const exam = await examOf(id);
    const [first, second] = exam.questions;
    expect(await saveMockExam(ids.student, id, { [first.id]: "  my first answer ", [second.id]: "second" }, false)).toEqual({ ok: true, submitted: false });
    const reloaded = await examOf(id);
    expect(reloaded.questions.map(question => question.answer)).toEqual(["my first answer", "second", null]);
    expect(reloaded.status).toBe("IN_PROGRESS");

    expect(await saveMockExam(ids.student, id, { [first.id]: "changed", [second.id]: "" }, false)).toEqual({ ok: true, submitted: false });
    expect((await examOf(id)).questions.map(question => question.answer)).toEqual(["changed", null, null]);

    expect(await saveMockExam(ids.student, id, { [first.id]: "final answer" }, true)).toEqual({ ok: true, submitted: true });
    const submitted = await examOf(id);
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.submittedAt).not.toBeNull();

    expect(await saveMockExam(ids.student, id, { [first.id]: "too late" }, false)).toEqual({ ok: false, error: "already_submitted" });
    expect(await saveMockExam(ids.student, id, {}, true)).toEqual({ ok: false, error: "already_submitted" });
    expect((await examOf(id)).questions[0].answer).toBe("final answer");
  });

  it("ignores answers for questions of other exams", async () => {
    const mine = await mustGenerate();
    const another = await mustGenerate();
    const foreign = (await examOf(another)).questions[0];
    expect(await saveMockExam(ids.student, mine, { [foreign.id]: "sneaky" }, false)).toEqual({ ok: true, submitted: false });
    expect((await examOf(another)).questions[0].answer).toBeNull();
  });

  it("refuses an answer that is too long", async () => {
    const id = await mustGenerate();
    const [question] = (await examOf(id)).questions;
    expect(await saveMockExam(ids.student, id, { [question.id]: "x".repeat(5001) }, false)).toEqual({ ok: false, error: "answer_too_long" });
  });

  it("lets only the student see or change their exam", async () => {
    const id = await mustGenerate();
    const [question] = (await examOf(id)).questions;
    expect(await getMockExam(ids.other, id)).toBeNull();
    expect(await saveMockExam(ids.other, id, { [question.id]: "hijack" }, true)).toEqual({ ok: false, error: "not_found" });
    expect((await examOf(id)).status).toBe("IN_PROGRESS");
    expect((await listMyMockExams(ids.other, ids.course))).toEqual([]);
    expect((await listMyMockExams(ids.student, ids.course)).length).toBeGreaterThan(0);
  });

  it("lets only one of two simultaneous submits win", async () => {
    const id = await mustGenerate();
    const results = await Promise.all([saveMockExam(ids.student, id, {}, true), saveMockExam(ids.student, id, {}, true)]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toEqual([{ ok: false, error: "already_submitted" }]);
  });
});

describe("US-45: the exam stays the same when the question bank changes", () => {
  it("keeps the questions after the source questions are removed and the bank is rebuilt", async () => {
    const id = await mustGenerate({ length: "4", topics: ["databases"] });
    const before = (await examOf(id)).questions.map(question => question.text);
    await db.question.deleteMany({ where: { file: { courseId: ids.course } } });
    await rebuildQuestionBank(ids.course);
    const after = (await examOf(id)).questions;
    expect(after.map(question => question.text)).toEqual(before);
    expect(await db.mockExamQuestion.count({ where: { mockExamId: id, groupId: null } })).toBe(4);
  });
});
