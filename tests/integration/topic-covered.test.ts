import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordLearningEvents } from "@/lib/learning-evidence";
import { getPersonalOrder } from "@/lib/personal-order";
import { resetRateLimits } from "@/lib/rate-limit";
import { getStudyNext } from "@/lib/study-next";
import { getTopicConfidence, saveTopicConfidence } from "@/lib/topic-confidence";
import { getCoveredTopics, setTopicCovered } from "@/lib/topic-covered";
import { getTopicStrengths } from "@/lib/topic-strengths";

// US-32 against a real database: marking a topic as covered only leaves it out of "Study next". It never changes the
// learning profile or its events, never reaches another course or another student, and undoing it restores the
// recommendation. The suite makes its own faculty, two courses that share topic names, and two students, and deletes
// them at the end.

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const faculty = { id: `it-tc-faculty-${stamp}`, code: `ITC${stamp}`.toUpperCase().slice(0, 20), name: "Topic Covered Faculty" };
const courses = ["a", "b"].map(name => ({ id: `it-tc-${name}-${stamp}`, code: `ITC${name}${stamp}`.toUpperCase().slice(0, 20), name: `Topic covered ${name}`, facultyId: faculty.id }));
const [courseA, courseB] = courses.map(course => course.id);
const students = ["one", "two"].map(name => `it-tc-${name}-${stamp}`);
const [student, other] = students;
// Course A has five papers: TCP twice, Routing, DNS, and one without a topic. Course B has the same topic names once
// each, and Sorting, which course A does not have.
const paperTopics: Array<[string, string | null]> = [
  [courseA, "TCP"], [courseA, "TCP"], [courseA, "Routing"], [courseA, "DNS"], [courseA, null],
  [courseB, "TCP"], [courseB, "Routing"], [courseB, "DNS"], [courseB, "Sorting"],
];
const questions = new Map<string, string>();

const ratings = (values: Record<string, string>): Array<[string, string]> => Object.entries(values).map(([key, value]) => [`rating:${key}`, value]);
const mark = (userId: string, courseId: string, topicKey: string, covered = true) =>
  setTopicCovered(userId, courseId, [["courseId", courseId], ["topicKey", topicKey], ["covered", covered ? "1" : "0"]]);
let eventNumber = 0;
const practise = (userId: string, courseId: string, topic: string, correct: boolean, count: number) =>
  recordLearningEvents(userId, courseId, Array.from({ length: count }, () => ({ source: "QUESTION_BANK" as const, eventId: `it-tc-${stamp}-${++eventNumber}`, questionId: questions.get(`${courseId}:${topic}`)!, correct })));
// Everything covered must never change: every profile row of both students, whole, and their events.
const evidence = async () => ({
  topics: await db.learningTopic.findMany({ where: { userId: { in: students } }, orderBy: [{ userId: "asc" }, { courseId: "asc" }, { topicKey: "asc" }] }),
  events: await db.learningEvent.count({ where: { userId: { in: students } } }),
});
const flags = () => db.coveredTopic.findMany({ where: { userId: { in: students } }, select: { userId: true, courseId: true, topicKey: true }, orderBy: [{ userId: "asc" }, { courseId: "asc" }, { topicKey: "asc" }] });

beforeAll(async () => {
  await db.faculty.create({ data: faculty });
  await db.course.createMany({ data: courses });
  await db.user.createMany({ data: students.map(id => ({ id, email: `${id}@topiccovered.test`, name: "Topic Covered Student", passwordHash: "x" })) });
  for (const [index, [courseId, topic]] of paperTopics.entries()) {
    const paper = await db.courseFile.create({
      data: {
        id: `${courseId}-p${index}`, courseId, title: `Exam ${index}`, year: 2020 + index, topic, examType: "FINAL", category: "EXAM",
        originalFileName: "exam.pdf", storageKey: "exam.pdf", mimeType: "application/pdf",
        questions: { create: [{ number: 1, text: `Topic covered question ${index} of ${stamp}.` }] },
      },
      include: { questions: { select: { id: true } } },
    });
    if (topic) questions.set(`${courseId}:${topic}`, paper.questions[0].id);
  }
});
beforeEach(() => resetRateLimits());
afterAll(async () => {
  try {
    // Deleting the users and the courses deletes their covered flags, profile rows, events, papers, and questions.
    await db.user.deleteMany({ where: { id: { in: students } } });
    await db.course.deleteMany({ where: { id: { in: courses.map(course => course.id) } } });
    await db.faculty.deleteMany({ where: { id: faculty.id } });
    expect(await db.coveredTopic.count({ where: { OR: [{ userId: { in: students } }, { courseId: { in: courses.map(course => course.id) } }] } })).toBe(0);
    expect(await db.learningTopic.count({ where: { userId: { in: students } } })).toBe(0);
    expect(await db.learningEvent.count({ where: { userId: { in: students } } })).toBe(0);
    expect(await db.courseFile.count({ where: { courseId: { in: courses.map(course => course.id) } } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});

describe("marking a topic as covered (US-32)", () => {
  it("is not evidence: a student without a profile still has none, and the personal order stays as it is", async () => {
    const before = await getStudyNext(other, courseA);
    expect(before.recommended!.topicKey).toBe("tcp");

    expect(await mark(other, courseA, "tcp")).toEqual({ ok: true, covered: true, changed: true });
    expect(await db.learningTopic.count({ where: { userId: other } })).toBe(0);
    expect(await db.learningEvent.count({ where: { userId: other } })).toBe(0);
    expect((await getPersonalOrder(other, courseA, [])).hasProfile).toBe(false);
    expect((await getTopicStrengths(other, courseA)).state).toBe("no_profile");
    // The confidence page still shows the topic as never rated.
    expect([...(await getTopicConfidence(other, courseA)).values()].every(value => value == null)).toBe(true);

    // DNS and Routing are both in 1 of 5 papers at the neutral weakness; the name decides.
    const after = await getStudyNext(other, courseA);
    expect(after).toMatchObject({ state: "ok", coveredTopics: 1 });
    expect(after.ranked.map(topic => topic.topicKey)).toEqual(["dns", "routing"]);

    expect(await mark(other, courseA, "tcp", false)).toEqual({ ok: true, covered: false, changed: true });
    expect(await getStudyNext(other, courseA)).toEqual(before);
    expect(await flags()).toEqual([]);
  });

  it("moves the recommendation to the next topic and changes no weakness, rating or practice count", async () => {
    // Routing rated 1 with two incorrect outcomes (weakness 1): 0.2 × 3 = 0.6. TCP rated 5: 0.4 × 1. DNS rated 3: 0.2 × 2.
    expect(await saveTopicConfidence(student, courseA, ratings({ tcp: "5", routing: "1", dns: "3" }))).toMatchObject({ ok: true, rated: 3 });
    expect(await practise(student, courseA, "Routing", false, 2)).toMatchObject({ ok: true, recorded: 2 });
    // The same topic names in the other course, and the other student in this course.
    expect(await saveTopicConfidence(student, courseB, ratings({ tcp: "5", routing: "1", dns: "3" }))).toMatchObject({ ok: true });
    expect(await saveTopicConfidence(other, courseA, ratings({ tcp: "5", routing: "1", dns: "3" }))).toMatchObject({ ok: true });

    const stored = await evidence();
    const [next, strengths, otherCourse, otherStudent] = await Promise.all([
      getStudyNext(student, courseA), getTopicStrengths(student, courseA), getStudyNext(student, courseB), getStudyNext(other, courseA),
    ]);
    expect(next.recommended!.topicKey).toBe("routing");
    expect(otherCourse.recommended!.topicKey).toBe("routing");
    expect(otherStudent.recommended!.topicKey).toBe("routing");
    expect(strengths.weakest.map(topic => topic.topicKey)).toEqual(["routing"]);

    expect(await mark(student, courseA, "routing")).toEqual({ ok: true, covered: true, changed: true });

    // The profile rows (weakness, confidence, counts, timestamps) and the events are exactly as before.
    expect(await evidence()).toEqual(stored);
    // TCP and DNS tie at 0.4; TCP is in more papers.
    const moved = await getStudyNext(student, courseA);
    expect(moved).toMatchObject({ state: "ok", coveredTopics: 1 });
    expect(moved.recommended!.topicKey).toBe("tcp");
    expect(moved.ranked).toEqual(next.ranked.filter(topic => topic.topicKey !== "routing"));
    // Strongest and weakest: the same topics in the same places, only the label is new.
    const labelled = await getTopicStrengths(student, courseA);
    expect(labelled.weakest[0]).toMatchObject({ topicKey: "routing", covered: true, weakness: 1 });
    expect(labelled.strongest.map(topic => topic.topicKey)).not.toContain("routing");
    const unlabelled = (topics: typeof labelled.ranked) => topics.map(topic => ({ ...topic, covered: false }));
    expect({ ...labelled, ranked: unlabelled(labelled.ranked), weakest: unlabelled(labelled.weakest), strongest: unlabelled(labelled.strongest) }).toEqual(strengths);

    // Per student per course: the other course and the other student are untouched and have no flag.
    expect(await getStudyNext(student, courseB)).toEqual(otherCourse);
    expect(await getStudyNext(other, courseA)).toEqual(otherStudent);
    expect(await flags()).toEqual([{ userId: student, courseId: courseA, topicKey: "routing" }]);
    expect(await getCoveredTopics(student, courseB)).toEqual(new Set());
    expect(await getCoveredTopics(other, courseA)).toEqual(new Set());

    // Marking it again changes nothing.
    expect(await mark(student, courseA, "routing")).toEqual({ ok: true, covered: true, changed: false });
    expect(await flags()).toHaveLength(1);

    // Undo restores the recommendation and the unlabelled lists, and still changes no evidence.
    expect(await mark(student, courseA, "routing", false)).toEqual({ ok: true, covered: false, changed: true });
    expect(await getStudyNext(student, courseA)).toEqual(next);
    expect(await getTopicStrengths(student, courseA)).toEqual(strengths);
    expect(await evidence()).toEqual(stored);
    expect(await flags()).toEqual([]);
    expect(await mark(student, courseA, "routing", false)).toEqual({ ok: true, covered: false, changed: false });
  });

  it("says every topic is covered instead of recommending one, in that course only", async () => {
    const stored = await evidence();
    const [before, strengths] = await Promise.all([getStudyNext(student, courseA), getTopicStrengths(student, courseA)]);
    for (const topicKey of ["tcp", "routing", "dns"]) expect(await mark(student, courseA, topicKey)).toMatchObject({ ok: true, changed: true });

    expect(await getStudyNext(student, courseA)).toMatchObject({ state: "all_covered", recommended: null, ranked: [], coveredTopics: 3 });
    // The lists keep every topic, each labelled.
    const labelled = await getTopicStrengths(student, courseA);
    expect(labelled.state).toBe(strengths.state);
    expect(labelled.ranked.map(topic => topic.topicKey)).toEqual(strengths.ranked.map(topic => topic.topicKey));
    expect(labelled.ranked.every(topic => topic.covered)).toBe(true);
    expect((await getStudyNext(student, courseB)).state).toBe("ok");
    expect((await getStudyNext(other, courseA)).state).toBe("ok");
    expect(await evidence()).toEqual(stored);

    for (const topicKey of ["tcp", "routing", "dns"]) expect(await mark(student, courseA, topicKey, false)).toMatchObject({ ok: true, changed: true });
    expect(await getStudyNext(student, courseA)).toEqual(before);
  });

  it("refuses a topic of another course, an unknown topic, an unknown course and a tampered value, and saves nothing", async () => {
    // Sorting is a topic of course B only.
    expect(await mark(student, courseB, "sorting")).toMatchObject({ ok: true });
    expect(await mark(student, courseB, "sorting", false)).toMatchObject({ ok: true });
    expect(await mark(student, courseA, "sorting")).toEqual({ ok: false, error: "unknown_topic" });
    expect(await mark(student, courseA, "no such topic")).toEqual({ ok: false, error: "unknown_topic" });
    expect(await mark(student, `it-tc-none-${stamp}`, "tcp")).toEqual({ ok: false, error: "unknown_topic" });
    expect(await setTopicCovered(student, courseA, [["topicKey", "tcp"], ["covered", "yes"]])).toEqual({ ok: false, error: "invalid_value" });
    expect(await setTopicCovered(student, courseA, [["topicKey", "tcp"], ["topicKey", "dns"], ["covered", "1"]])).toEqual({ ok: false, error: "invalid_value" });
    expect(await flags()).toEqual([]);
  });

  it("limits changes per student, and saves nothing over the limit", async () => {
    process.env.TOPIC_COVERED_RATE_LIMIT_PER_MINUTE = "1";
    try {
      expect(await mark(student, courseA, "dns")).toMatchObject({ ok: true });
      expect(await mark(student, courseA, "tcp")).toEqual({ ok: false, error: "rate_limited" });
      expect(await flags()).toEqual([{ userId: student, courseId: courseA, topicKey: "dns" }]);
      // The other student has their own limit.
      expect(await mark(other, courseA, "tcp")).toMatchObject({ ok: true });
    } finally {
      delete process.env.TOPIC_COVERED_RATE_LIMIT_PER_MINUTE;
      resetRateLimits();
    }
    expect(await mark(student, courseA, "dns", false)).toMatchObject({ ok: true });
    expect(await mark(other, courseA, "tcp", false)).toMatchObject({ ok: true });
    expect(await flags()).toEqual([]);
  });

  it("shares the course profile's lock with a rating save and a practice outcome: all three succeed together", async () => {
    const events = (await evidence()).events;
    const [rated, covered, practised] = await Promise.all([
      saveTopicConfidence(student, courseA, ratings({ tcp: "4" })),
      mark(student, courseA, "tcp"),
      practise(student, courseA, "DNS", true, 1),
    ]);
    expect(rated).toMatchObject({ ok: true, rated: 1 });
    expect(covered).toEqual({ ok: true, covered: true, changed: true });
    expect(practised).toEqual({ ok: true, recorded: 1, duplicates: 0 });
    expect((await getTopicConfidence(student, courseA)).get("tcp")).toBe(4);
    expect((await evidence()).events).toBe(events + 1);
    expect(await getCoveredTopics(student, courseA)).toEqual(new Set(["tcp"]));
    // A rating saved while the topic is covered keeps the flag, and the flag keeps the rating.
    expect(await saveTopicConfidence(student, courseA, ratings({ tcp: "2" }))).toMatchObject({ ok: true, rated: 1 });
    expect(await getCoveredTopics(student, courseA)).toEqual(new Set(["tcp"]));
    expect((await getStudyNext(student, courseA)).ranked.map(topic => topic.topicKey)).not.toContain("tcp");
  });
});
