import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// US-21 against a real database and the real regroup (rebuildQuestionBank, US-15a/b): marking and undoing a question,
// for one student only, and a regroup that replaces a question's group keeps the student's mark and re-links it to the
// new group, in the same course only, and never to a guess. Marking never changes the learning profile.

import { db } from "@/lib/db";
import { rebuildQuestionBank } from "@/lib/question-bank";
import { getCourseProgress, markQuestion } from "@/lib/question-progress";
import { resetRateLimits } from "@/lib/rate-limit";

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const faculty = { id: `it-qp-faculty-${stamp}`, code: `IQF${stamp}`.toUpperCase().slice(0, 20), name: "Progress Faculty" };
const students = [`it-qp-s1-${stamp}`, `it-qp-s2-${stamp}`];
const courseIds: string[] = [];

async function course(name: string) {
  const id = `it-qp-${name}-${stamp}`;
  await db.course.create({ data: { id, code: `IQ${name}${stamp}`.toUpperCase().slice(0, 20), name: `Progress ${name}`, facultyId: faculty.id } });
  courseIds.push(id);
  return id;
}
// Paper IDs decide which question comes first in a group, and so the group's key: "p1" sorts before "p2".
async function paper(courseId: string, name: string, questions: string[]) {
  const id = `${courseId}-${name}`;
  await db.courseFile.create({
    data: {
      id, courseId, title: `Paper ${name}`, category: "EXAM", year: 2024, originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf",
      mimeType: "application/pdf", questions: { create: questions.map((text, index) => ({ number: index + 1, text })) },
    },
  });
  return id;
}
async function regroup(...ids: string[]) {
  for (const id of ids) expect(await rebuildQuestionBank(id)).toMatchObject({ ok: true });
}
const groupOf = async (courseId: string, text: string) => {
  const question = await db.question.findFirstOrThrow({ where: { text, file: { courseId } }, select: { groupId: true } });
  return question.groupId!;
};
// A mark as US-21 stores it: the group and its source questions at that moment, the first question first.
async function mark(student: string, courseId: string, groupId: string) {
  const questions = await db.question.findMany({ where: { groupId }, orderBy: [{ fileId: "asc" }, { number: "asc" }], select: { id: true } });
  return db.questionProgress.create({ data: { userId: student, courseId, groupId, sourceQuestionIds: questions.map(question => question.id) } });
}
const row = (id: string) => db.questionProgress.findUnique({ where: { id }, select: { groupId: true, courseId: true } });

beforeAll(async () => {
  await db.faculty.create({ data: faculty });
  await db.user.createMany({ data: students.map((id, index) => ({ id, email: `${id}@progress.test`, name: `Student ${index}`, passwordHash: "x" })) });
});
afterAll(async () => {
  try {
    // Deleting the courses deletes their papers, questions, groups, and marks; deleting the students deletes the rest.
    await db.course.deleteMany({ where: { id: { in: courseIds } } });
    await db.user.deleteMany({ where: { id: { in: students } } });
    await db.faculty.deleteMany({ where: { id: faculty.id } });
    expect(await db.questionProgress.count({ where: { userId: { in: students } } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});

describe("marks survive a regroup (US-21)", () => {
  it("re-links a mark when a new paper changes the group's first question, and only for its student", async () => {
    const id = await course("new");
    await paper(id, "p2", ["Explain the TCP three-way handshake.", "Define a socket."]);
    await regroup(id);
    const before = await groupOf(id, "Explain the TCP three-way handshake.");
    const saved = await mark(students[0], id, before);
    // A paper that sorts first, with a typo in the same question, becomes the group's first question: a new key and ID.
    await paper(id, "p1", ["Explain the TCP three-way hanshake."]);
    await regroup(id);
    const after = await groupOf(id, "Explain the TCP three-way handshake.");
    expect(after).not.toBe(before);
    expect(await db.questionGroup.findUnique({ where: { id: before } })).toBeNull();
    expect(await row(saved.id)).toEqual({ groupId: null, courseId: id });

    const progress = await getCourseProgress(students[0], id);
    expect([...progress.keys()]).toEqual([after]);
    expect(progress.get(after)?.doneAt).toEqual(saved.doneAt);
    expect(await row(saved.id)).toEqual({ groupId: after, courseId: id });
    expect((await getCourseProgress(students[1], id)).size).toBe(0);
  });
  it("follows the question's other papers when the paper it was marked from is deleted", async () => {
    const id = await course("del");
    const first = await paper(id, "p2", ["Define a socket."]);
    await paper(id, "p3", ["Define a sockat."]);
    await regroup(id);
    const before = await groupOf(id, "Define a socket.");
    const saved = await mark(students[0], id, before);
    await db.courseFile.delete({ where: { id: first } });
    await regroup(id);
    const after = await groupOf(id, "Define a sockat.");
    expect(after).not.toBe(before);
    expect([...(await getCourseProgress(students[0], id)).keys()]).toEqual([after]);
    expect(await row(saved.id)).toEqual({ groupId: after, courseId: id });
  });
  it("keeps a mark unlinked and hidden when none of its questions remain, instead of guessing", async () => {
    const id = await course("gone");
    const only = await paper(id, "p1", ["What does ARP do?", "Define a socket."]);
    await regroup(id);
    const saved = await mark(students[0], id, await groupOf(id, "What does ARP do?"));
    await db.question.deleteMany({ where: { fileId: only, number: 1 } });
    await regroup(id);
    expect((await getCourseProgress(students[0], id)).size).toBe(0);
    expect(await row(saved.id)).toEqual({ groupId: null, courseId: id });
  });
  it("never moves a mark to another course, even when its paper moved there", async () => {
    const [from, to] = [await course("from"), await course("to")];
    const moved = await paper(from, "p1", ["What does ARP do?"]);
    await paper(from, "p2", ["Define a socket."]);
    await regroup(from);
    const saved = await mark(students[0], from, await groupOf(from, "What does ARP do?"));
    await db.courseFile.update({ where: { id: moved }, data: { courseId: to } });
    await regroup(from, to);
    expect((await getCourseProgress(students[0], from)).size).toBe(0);
    expect((await getCourseProgress(students[0], to)).size).toBe(0);
    expect(await row(saved.id)).toEqual({ groupId: null, courseId: from });
  });
  it("drops an unlinked mark whose new group is already marked, so the question shows done once", async () => {
    const id = await course("dup");
    await paper(id, "p2", ["Explain the TCP three-way handshake."]);
    await paper(id, "p3", ["Explain the TCP three-way hanshake."]);
    await regroup(id);
    const group = await groupOf(id, "Explain the TCP three-way handshake.");
    const kept = await mark(students[0], id, group);
    // An unlinked mark from an earlier regroup that points at the same questions.
    const stale = await db.questionProgress.create({ data: { userId: students[0], courseId: id, groupId: null, sourceQuestionIds: kept.sourceQuestionIds } });
    const progress = await getCourseProgress(students[0], id);
    expect([...progress.entries()]).toEqual([[group, { doneAt: kept.doneAt }]]);
    expect(await row(stale.id)).toBeNull();
  });
});

describe("marking questions done (US-21)", () => {
  beforeEach(() => resetRateLimits());
  async function examCourse(name: string) {
    const id = await course(name);
    await paper(id, "p1", ["Explain the TCP three-way handshake.", "Define a socket."]);
    await paper(id, "p2", ["Explain the TCP three-way handshake."]);
    await db.courseFile.updateMany({ where: { courseId: id }, data: { topic: "TCP" } });
    await regroup(id);
    return { id, group: await groupOf(id, "Explain the TCP three-way handshake.") };
  }
  const marks = (student: string, courseId: string) => db.questionProgress.count({ where: { userId: student, courseId } });

  it("keeps the mark after the student comes back, and shows it to no one else", async () => {
    const { id, group } = await examCourse("keep");
    expect(await markQuestion(students[0], { groupId: group, choice: "DONE" })).toEqual({ ok: true, courseId: id, done: true });
    // A later read, as after logging out and back in, sees the same mark.
    expect([...(await getCourseProgress(students[0], id)).keys()]).toEqual([group]);
    expect((await getCourseProgress(students[1], id)).size).toBe(0);
  });
  it("marks and undoes a question any number of times, ending with one mark or none", async () => {
    const { id, group } = await examCourse("seq");
    for (const choice of ["DONE", "DONE", "UNDO", "UNDO", "DONE"]) {
      expect(await markQuestion(students[0], { groupId: group, choice })).toMatchObject({ ok: true, done: choice === "DONE" });
    }
    expect(await marks(students[0], id)).toBe(1);
    await markQuestion(students[0], { groupId: group, choice: "UNDO" });
    expect(await marks(students[0], id)).toBe(0);
  });
  it("gives one mark for a burst of clicks, and every click gets an answer", async () => {
    const { id, group } = await examCourse("double");
    const results = await Promise.all(Array.from({ length: 10 }, () => markQuestion(students[0], { groupId: group, choice: "DONE" })));
    expect(results.every(result => result.ok)).toBe(true);
    expect(await marks(students[0], id)).toBe(1);
    // Should two clicks ever race past the lock, the database still refuses a second mark of the question.
    await expect(db.questionProgress.create({ data: { userId: students[0], courseId: id, groupId: group, sourceQuestionIds: [] } }))
      .rejects.toMatchObject({ code: "P2002" });
  });
  it("never changes the learning profile", async () => {
    const { id, group } = await examCourse("profile");
    await markQuestion(students[0], { groupId: group, choice: "DONE" });
    await markQuestion(students[0], { groupId: group, choice: "UNDO" });
    await markQuestion(students[0], { groupId: group, choice: "DONE" });
    expect(await db.learningTopic.count({ where: { userId: students[0], courseId: id } })).toBe(0);
  });
  it("refuses a question that only a pending submission contains", async () => {
    const id = await course("pending");
    await paper(id, "p1", ["What does ARP do?"]);
    await regroup(id);
    const group = await groupOf(id, "What does ARP do?");
    await db.courseFile.updateMany({ where: { courseId: id }, data: { status: "PENDING" } });
    expect(await markQuestion(students[0], { groupId: group, choice: "DONE" })).toEqual({ ok: false, error: "not_found" });
    expect(await marks(students[0], id)).toBe(0);
  });
  it("undoing a question also clears its old unlinked mark, so it does not come back as done", async () => {
    const { id, group: before } = await examCourse("adopt");
    await markQuestion(students[0], { groupId: before, choice: "DONE" });
    await paper(id, "p0", ["Explain the TCP three-way hanshake."]);
    await regroup(id);
    const after = await groupOf(id, "Explain the TCP three-way handshake.");
    expect(after).not.toBe(before);
    // Undone before any page load re-linked the old mark.
    expect(await markQuestion(students[0], { groupId: after, choice: "UNDO" })).toMatchObject({ ok: true, done: false });
    expect(await marks(students[0], id)).toBe(0);
    expect((await getCourseProgress(students[0], id)).size).toBe(0);
  });
});
