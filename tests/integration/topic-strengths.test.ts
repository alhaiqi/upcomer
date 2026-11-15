import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordLearningEvents } from "@/lib/learning-evidence";
import { resetRateLimits } from "@/lib/rate-limit";
import { saveTopicConfidence } from "@/lib/topic-confidence";
import { getTopicStrengths } from "@/lib/topic-strengths";

// US-26 against a real database: the strongest and weakest topics come from one course's profile of one student only, and
// practice outcomes recorded through recordLearningEvents (US-25) move a topic between strong and weak. The suite makes
// its own faculty, two courses that share topic names, and three students, and deletes them at the end.

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const faculty = { id: `it-ts-faculty-${stamp}`, code: `ITS${stamp}`.toUpperCase().slice(0, 20), name: "Strengths Faculty" };
const courses = ["a", "b"].map(name => ({ id: `it-ts-${name}-${stamp}`, code: `ITS${name}${stamp}`.toUpperCase().slice(0, 20), name: `Strengths ${name}`, facultyId: faculty.id }));
const [courseA, courseB] = courses.map(course => course.id);
const students = ["one", "two", "three"].map(name => `it-ts-${name}-${stamp}`);
// Both courses have TCP, Routing, and DNS papers; TCP is in two papers of course A.
const paperTopics: Array<[string, string]> = [[courseA, "TCP"], [courseA, "TCP"], [courseA, "Routing"], [courseA, "DNS"], [courseB, "TCP"], [courseB, "Routing"], [courseB, "DNS"]];
// One question per topic and course, to record outcomes on.
const questions = new Map<string, string>();
const question = (courseId: string, topic: string) => questions.get(`${courseId}:${topic}`)!;

const form = (ratings: Record<string, string>): Array<[string, string]> => Object.entries(ratings).map(([key, value]) => [`rating:${key}`, value]);
let eventNumber = 0;
// `count` outcomes on one topic's question, in one all-or-nothing batch.
const practise = (userId: string, courseId: string, topic: string, correct: boolean, count: number) =>
  recordLearningEvents(userId, courseId, Array.from({ length: count }, () => ({ source: "QUESTION_BANK" as const, eventId: `it-ts-${stamp}-${++eventNumber}`, questionId: question(courseId, topic), correct })));
const lists = async (userId: string, courseId: string) => {
  const result = await getTopicStrengths(userId, courseId);
  return { state: result.state, weakest: result.weakest.map(topic => topic.topicKey), strongest: result.strongest.map(topic => topic.topicKey) };
};

beforeAll(async () => {
  await db.faculty.create({ data: faculty });
  await db.course.createMany({ data: courses });
  await db.user.createMany({ data: students.map(id => ({ id, email: `${id}@strengths.test`, name: "Strengths Student", passwordHash: "x" })) });
  for (const [index, [courseId, topic]] of paperTopics.entries()) {
    const paper = await db.courseFile.create({
      data: {
        id: `${courseId}-p${index}`, courseId, title: `Exam ${index}`, year: 2020 + index, topic, examType: "FINAL", category: "EXAM",
        originalFileName: "exam.pdf", storageKey: "exam.pdf", mimeType: "application/pdf",
        questions: { create: [{ number: 1, text: `Strengths question ${index} of ${stamp}.` }] },
      },
      include: { questions: { select: { id: true } } },
    });
    questions.set(`${courseId}:${topic}`, paper.questions[0].id);
  }
});
beforeEach(() => resetRateLimits());
afterAll(async () => {
  try {
    // Deleting the users and the courses deletes their profile rows, events, papers, and questions.
    await db.user.deleteMany({ where: { id: { in: students } } });
    await db.course.deleteMany({ where: { id: { in: courses.map(course => course.id) } } });
    await db.faculty.deleteMany({ where: { id: faculty.id } });
    expect(await db.learningTopic.count({ where: { userId: { in: students } } })).toBe(0);
    expect(await db.learningEvent.count({ where: { userId: { in: students } } })).toBe(0);
    expect(await db.courseFile.count({ where: { courseId: { in: courses.map(course => course.id) } } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});

describe("strongest and weakest topics (US-26)", () => {
  it("come from this course's profile only: another course and another student never change the result", async () => {
    const [student, other] = students;
    expect(await lists(student, courseA)).toEqual({ state: "no_profile", weakest: [], strongest: [] });
    expect(await saveTopicConfidence(student, courseA, form({ tcp: "5", routing: "4", dns: "3" }))).toMatchObject({ ok: true, rated: 3 });
    const before = await getTopicStrengths(student, courseA);
    expect(before.state).toBe("ok");
    expect(before.weakest).toMatchObject([{ topicKey: "dns", topic: "DNS", weakness: 0.5, confidence: 3, paperCount: 1, evidence: "Rated 3 of 5, no practice recorded" }]);
    expect(before.strongest).toMatchObject([{ topicKey: "tcp", topic: "TCP", weakness: 0, confidence: 5, paperCount: 2, evidence: "Rated 5 of 5, no practice recorded" }]);

    // The same student rates and practises the same topic names the other way round in course B.
    expect(await saveTopicConfidence(student, courseB, form({ tcp: "1", routing: "3", dns: "5" }))).toMatchObject({ ok: true });
    expect(await practise(student, courseB, "TCP", false, 4)).toMatchObject({ ok: true, recorded: 4 });
    expect(await practise(student, courseB, "DNS", true, 4)).toMatchObject({ ok: true, recorded: 4 });
    // Another student does the same in course A itself.
    expect(await saveTopicConfidence(other, courseA, form({ tcp: "1", routing: "3", dns: "5" }))).toMatchObject({ ok: true });
    expect(await practise(other, courseA, "TCP", false, 4)).toMatchObject({ ok: true });

    expect(await getTopicStrengths(student, courseA)).toEqual(before);
    expect(await lists(student, courseB)).toEqual({ state: "ok", weakest: ["tcp"], strongest: ["dns"] });
    expect(await lists(other, courseA)).toEqual({ state: "ok", weakest: ["tcp"], strongest: ["dns"] });
  });

  it("recorded practice outcomes move a topic from strongest to weakest and back", async () => {
    const [student] = students;
    expect(await lists(student, courseA)).toEqual({ state: "ok", weakest: ["dns"], strongest: ["tcp"] });

    // Three incorrect outcomes on TCP (rated 5): weakness (2 × 0 + 3) / (2 + 3) = 0.6, above DNS's 0.5.
    expect(await practise(student, courseA, "TCP", false, 3)).toEqual({ ok: true, recorded: 3, duplicates: 0 });
    const weak = await getTopicStrengths(student, courseA);
    expect(weak.weakest).toMatchObject([{ topicKey: "tcp", weakness: 0.6, evidence: "Rated 5 of 5, 0 correct and 3 incorrect" }]);
    expect(weak.strongest.map(topic => topic.topicKey)).toEqual(["routing"]);

    // Eight correct outcomes: (0 + 3) / (2 + 11) ≈ 0.23, below Routing's 0.25.
    expect(await practise(student, courseA, "TCP", true, 8)).toEqual({ ok: true, recorded: 8, duplicates: 0 });
    const strong = await getTopicStrengths(student, courseA);
    expect(strong.strongest).toMatchObject([{ topicKey: "tcp", evidence: "Rated 5 of 5, 8 correct and 3 incorrect" }]);
    expect(strong.strongest[0].weakness).toBeCloseTo(3 / 13, 10);
    expect(strong.weakest.map(topic => topic.topicKey)).toEqual(["dns"]);
  });

  it("a skipped topic counts only once it has a recorded outcome", async () => {
    const student = students[2];
    expect(await saveTopicConfidence(student, courseA, form({ tcp: "skip", routing: "skip", dns: "skip" }))).toMatchObject({ ok: true, skipped: 3 });
    expect(await lists(student, courseA)).toEqual({ state: "no_evidence", weakest: [], strongest: [] });

    expect(await practise(student, courseA, "DNS", false, 1)).toMatchObject({ ok: true });
    const one = await getTopicStrengths(student, courseA);
    expect(one.state).toBe("too_few");
    expect(one.ranked.map(topic => topic.topicKey)).toEqual(["dns"]);

    expect(await practise(student, courseA, "TCP", true, 1)).toMatchObject({ ok: true });
    const two = await getTopicStrengths(student, courseA);
    expect(two.state).toBe("ok");
    expect(two.weakest).toMatchObject([{ topicKey: "dns", confidence: null, evidence: "Not rated, 0 correct and 1 incorrect" }]);
    expect(two.strongest).toMatchObject([{ topicKey: "tcp", confidence: null, evidence: "Not rated, 1 correct and 0 incorrect" }]);
    // Routing is still skipped and unpractised: it is in neither list.
    expect(two.ranked.map(topic => topic.topicKey)).toEqual(["dns", "tcp"]);
  });
});
