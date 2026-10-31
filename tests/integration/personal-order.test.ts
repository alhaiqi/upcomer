import { afterAll, beforeAll, describe, expect, it } from "vitest";

// US-28 against a real database: the real regroup, the real Upcomer Exam, and profiles written with setTopicWeakness (the
// call US-24 and US-25 will make; neither exists yet). Two students with different profiles get different orders of the
// same course, a student without a profile gets the frequency order, and another course's profile changes nothing.

import { getConsolidatedExam } from "@/lib/consolidated-exam";
import { db } from "@/lib/db";
import { setTopicWeakness } from "@/lib/learning-profile";
import { getPersonalOrder } from "@/lib/personal-order";
import { rebuildQuestionBank } from "@/lib/question-bank";

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const faculty = { id: `it-po-faculty-${stamp}`, code: `IPF${stamp}`.toUpperCase().slice(0, 20), name: "Order Faculty" };
const courses = ["main", "other"].map(name => ({ id: `it-po-${name}-${stamp}`, code: `IP${name}${stamp}`.toUpperCase().slice(0, 20), name: `Order ${name}`, facultyId: faculty.id }));
const course = courses[0].id;
const students = ["a", "b", "c"].map(name => `it-po-${name}-${stamp}`);
// Four papers: TCP questions in three of them, a routing question in two, a DNS question in one.
const papers: Array<[string, string, string[]]> = [
  ["p1", "TCP", ["Explain the TCP three-way handshake."]],
  ["p2", "TCP", ["Explain the TCP three-way handshake."]],
  ["p3", "Routing", ["Explain the TCP three-way handshake.", "Describe link-state routing."]],
  ["p4", "Routing", ["Describe link-state routing.", "Explain how DNS resolves a host name."]],
];
const texts = async (studentId: string) => {
  const exam = await getConsolidatedExam(course);
  return (await getPersonalOrder(studentId, course, exam.questions)).questions.map(question => question.text);
};

beforeAll(async () => {
  await db.faculty.create({ data: faculty });
  await db.course.createMany({ data: courses });
  await db.user.createMany({ data: students.map((id, index) => ({ id, email: `${id}@order.test`, name: `Student ${index}`, passwordHash: "x" })) });
  for (const [name, topic, questions] of papers) {
    await db.courseFile.create({ data: {
      id: `${course}-${name}`, courseId: course, title: `Paper ${name}`, category: "EXAM", year: 2024, topic,
      originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf",
      questions: { create: questions.map((text, index) => ({ number: index + 1, text })) },
    } });
  }
  expect(await rebuildQuestionBank(course)).toMatchObject({ ok: true, groupCount: 3 });
});
afterAll(async () => {
  try {
    await db.course.deleteMany({ where: { id: { in: courses.map(item => item.id) } } });
    await db.user.deleteMany({ where: { id: { in: students } } });
    await db.faculty.deleteMany({ where: { id: faculty.id } });
    expect(await db.learningTopic.count({ where: { userId: { in: students } } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});

describe("personal order of the Upcomer Exam (US-28)", () => {
  const frequency = ["Explain the TCP three-way handshake.", "Describe link-state routing.", "Explain how DNS resolves a host name."];

  it("a student without a learning profile in the course gets the frequency order", async () => {
    expect(await texts(students[2])).toEqual(frequency);
  });
  it("a student with a profile gets the questions reordered by their priorities", async () => {
    await setTopicWeakness(students[0], course, "TCP", 0);
    await setTopicWeakness(students[0], course, "routing", 1);
    expect(await texts(students[0])).toEqual(["Describe link-state routing.", "Explain the TCP three-way handshake.", "Explain how DNS resolves a host name."]);
  });
  it("two students with different profiles see different orders of the same course", async () => {
    await setTopicWeakness(students[1], course, "tcp", 1);
    await setTopicWeakness(students[1], course, "Routing", 0);
    expect(await texts(students[1])).toEqual(frequency);
    expect(await texts(students[1])).not.toEqual(await texts(students[0]));
  });
  it("a profile in another course with the same topic names does not change this course's order", async () => {
    await setTopicWeakness(students[2], courses[1].id, "Routing", 1);
    await setTopicWeakness(students[2], courses[1].id, "TCP", 0);
    expect(await texts(students[2])).toEqual(frequency);
  });
});
