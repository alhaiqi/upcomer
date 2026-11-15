import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordLearningEvents } from "@/lib/learning-evidence";
import { resetRateLimits } from "@/lib/rate-limit";
import { getStudyNext } from "@/lib/study-next";
import { saveTopicConfidence } from "@/lib/topic-confidence";

// US-30 against a real database: the topic to study next comes from one course's profile of one student only, and
// practice outcomes recorded through recordLearningEvents (US-25) change it on the next read. The suite makes its own
// faculty, two courses that share topic names, and two students, and deletes them at the end.

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const faculty = { id: `it-sn-faculty-${stamp}`, code: `ISN${stamp}`.toUpperCase().slice(0, 20), name: "Study Next Faculty" };
const courses = ["a", "b"].map(name => ({ id: `it-sn-${name}-${stamp}`, code: `ISN${name}${stamp}`.toUpperCase().slice(0, 20), name: `Study next ${name}`, facultyId: faculty.id }));
const [courseA, courseB] = courses.map(course => course.id);
const students = ["one", "two"].map(name => `it-sn-${name}-${stamp}`);
// Course A has five papers: TCP twice, Routing, DNS, and one without a topic. Course B has the same topic names once each.
const paperTopics: Array<[string, string | null]> = [[courseA, "TCP"], [courseA, "TCP"], [courseA, "Routing"], [courseA, "DNS"], [courseA, null], [courseB, "TCP"], [courseB, "Routing"], [courseB, "DNS"]];
// One question per topic and course, to record outcomes on.
const questions = new Map<string, string>();
const question = (courseId: string, topic: string) => questions.get(`${courseId}:${topic}`)!;

const form = (ratings: Record<string, string>): Array<[string, string]> => Object.entries(ratings).map(([key, value]) => [`rating:${key}`, value]);
let eventNumber = 0;
// `count` outcomes on one topic's question, in one all-or-nothing batch.
const practise = (userId: string, courseId: string, topic: string, correct: boolean, count: number) =>
  recordLearningEvents(userId, courseId, Array.from({ length: count }, () => ({ source: "QUESTION_BANK" as const, eventId: `it-sn-${stamp}-${++eventNumber}`, questionId: question(courseId, topic), correct })));
const order = async (userId: string, courseId: string) => (await getStudyNext(userId, courseId)).ranked.map(topic => topic.topicKey);

beforeAll(async () => {
  await db.faculty.create({ data: faculty });
  await db.course.createMany({ data: courses });
  await db.user.createMany({ data: students.map(id => ({ id, email: `${id}@studynext.test`, name: "Study Next Student", passwordHash: "x" })) });
  for (const [index, [courseId, topic]] of paperTopics.entries()) {
    const paper = await db.courseFile.create({
      data: {
        id: `${courseId}-p${index}`, courseId, title: `Exam ${index}`, year: 2020 + index, topic, examType: "FINAL", category: "EXAM",
        originalFileName: "exam.pdf", storageKey: "exam.pdf", mimeType: "application/pdf",
        questions: { create: [{ number: 1, text: `Study next question ${index} of ${stamp}.` }] },
      },
      include: { questions: { select: { id: true } } },
    });
    if (topic) questions.set(`${courseId}:${topic}`, paper.questions[0].id);
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

describe("what to study next (US-30)", () => {
  it("is the most frequent topic for a student without a profile, at the neutral weakness", async () => {
    const result = await getStudyNext(students[0], courseA);
    expect(result.state).toBe("ok");
    // TCP 2/5 × (1 + 2 × 0.5) = 0.8; the paper without a topic counts towards the five.
    expect(result.recommended).toMatchObject({
      topicKey: "tcp", topic: "TCP", paperCount: 2, totalPapers: 5, weakness: 0.5, rated: false,
      reason: "In 2 of this course's 5 published exam papers. Not rated and no practice recorded, so a neutral weakness is used.",
    });
    expect(result.recommended!.priority).toBeCloseTo(0.8, 10);
    expect(result.ranked.map(topic => topic.topicKey)).toEqual(["tcp", "dns", "routing"]);
  });

  it("changes when incorrect practice outcomes are recorded, and back with correct ones", async () => {
    const [student] = students;
    // TCP rated 5 (weakness 0): 0.4 × 1 = 0.4. Routing and DNS rated 3 (0.5): 0.2 × 2 = 0.4. A three-way tie: TCP is in more papers.
    expect(await saveTopicConfidence(student, courseA, form({ tcp: "5", routing: "3", dns: "3" }))).toMatchObject({ ok: true, rated: 3 });
    expect(await order(student, courseA)).toEqual(["tcp", "dns", "routing"]);

    // Three incorrect outcomes on Routing: weakness (2 × 0.5 + 3) / (2 + 3) = 0.8, priority 0.2 × 2.6 = 0.52.
    expect(await practise(student, courseA, "Routing", false, 3)).toEqual({ ok: true, recorded: 3, duplicates: 0 });
    const weak = await getStudyNext(student, courseA);
    expect(weak.recommended).toMatchObject({ topicKey: "routing", weakness: 0.8, rated: true, reason: "In 1 of this course's 5 published exam papers. Rated 3 of 5, 0 correct and 3 incorrect." });
    expect(weak.recommended!.priority).toBeCloseTo(0.52, 10);
    expect(weak.recommended!.explanation).toContain("0 correct and 3 incorrect recorded outcomes");

    // Eight correct outcomes: weakness (1 + 3) / (2 + 11) ≈ 0.31, priority ≈ 0.32, below the others' 0.4.
    expect(await practise(student, courseA, "Routing", true, 8)).toEqual({ ok: true, recorded: 8, duplicates: 0 });
    expect(await order(student, courseA)).toEqual(["tcp", "dns", "routing"]);
  });

  it("comes from this course's profile only: another course and another student never change it", async () => {
    const [student, other] = students;
    const before = await getStudyNext(student, courseA);

    // The same student rates and practises the same topic names in course B.
    expect(await saveTopicConfidence(student, courseB, form({ tcp: "5", routing: "5", dns: "1" }))).toMatchObject({ ok: true });
    expect(await practise(student, courseB, "DNS", false, 4)).toMatchObject({ ok: true, recorded: 4 });
    // Another student does the same in course A itself.
    expect(await saveTopicConfidence(other, courseA, form({ tcp: "5", routing: "5", dns: "1" }))).toMatchObject({ ok: true });
    expect(await practise(other, courseA, "DNS", false, 4)).toMatchObject({ ok: true });

    expect(await getStudyNext(student, courseA)).toEqual(before);
    // Course B has three papers: DNS 1/3 × 3 against 1/3 × 1 for the others.
    expect((await getStudyNext(student, courseB)).recommended).toMatchObject({ topicKey: "dns", paperCount: 1, totalPapers: 3, weakness: 1 });
    // The other student in course A: DNS 1/5 × 3 = 0.6 against TCP 2/5 × 1 = 0.4.
    expect((await getStudyNext(other, courseA)).recommended).toMatchObject({ topicKey: "dns", paperCount: 1, totalPapers: 5 });
  });
});
