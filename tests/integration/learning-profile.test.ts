import { afterAll, beforeAll, describe, expect, it } from "vitest";

// US-33 against a real database: one student in two courses that share a topic name. A change to one course's profile
// never changes the other's, and each course tracks the shared topic in its own row. Practising is US-25, which does
// not exist yet, so the tests change the profile through setTopicWeakness, the call US-25 will make.

import { db } from "@/lib/db";
import { getLearningProfile, setTopicWeakness } from "@/lib/learning-profile";

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const faculty = { id: `it-lp-faculty-${stamp}`, code: `ILF${stamp}`.toUpperCase().slice(0, 20), name: "Profile Faculty" };
const courses = ["a", "b"].map(name => ({ id: `it-lp-course-${name}-${stamp}`, code: `ILC${name}${stamp}`.toUpperCase().slice(0, 20), name: `Profile Course ${name}`, facultyId: faculty.id }));
const student = `it-lp-student-${stamp}`;
const profileOf = async (courseId: string) => [...(await getLearningProfile(student, courseId)).values()].map(row => [row.topicKey, row.weakness]);

beforeAll(async () => {
  await db.faculty.create({ data: faculty });
  await db.course.createMany({ data: courses });
  await db.user.create({ data: { id: student, email: `${student}@profile.test`, name: "Profile Student", passwordHash: "x" } });
});
afterAll(async () => {
  try {
    // Deleting the user and the courses deletes their profile rows.
    await db.user.deleteMany({ where: { id: student } });
    await db.course.deleteMany({ where: { id: { in: courses.map(course => course.id) } } });
    await db.faculty.deleteMany({ where: { id: faculty.id } });
    expect(await db.learningTopic.count({ where: { userId: student } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});

describe("learning profile kept per course (US-33)", () => {
  it("a change in one course does not change the other course's profile", async () => {
    expect(await setTopicWeakness(student, courses[1].id, "TCP", 0.2)).toEqual({ ok: true });
    const before = await profileOf(courses[1].id);
    await setTopicWeakness(student, courses[0].id, "TCP", 0.9);
    await setTopicWeakness(student, courses[0].id, "Routing", 0.6);
    await setTopicWeakness(student, courses[0].id, "tcp", 0.7);
    expect(await profileOf(courses[1].id)).toEqual(before);
    expect(await profileOf(courses[0].id)).toEqual(expect.arrayContaining([["tcp", 0.7], ["routing", 0.6]]));
  });
  it("two courses sharing a topic name track it in separate rows, each updated on its own", async () => {
    await setTopicWeakness(student, courses[1].id, " TCP ", 0.1);
    const rows = await db.learningTopic.findMany({ where: { userId: student, topicKey: "tcp" }, orderBy: { courseId: "asc" } });
    expect(rows.map(row => [row.courseId, row.weakness])).toEqual([[courses[0].id, 0.7], [courses[1].id, 0.1]]);
  });
});
