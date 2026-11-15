import { randomUUID } from "node:crypto";
import { AdviceStatus, FileCategory, FileStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAdviceOptions, publishAdvice, searchAdvice, type PublishInput } from "@/lib/advice";
import { db } from "@/lib/db";

// Advice (US-34, US-35, US-37, US-39) against a real, migrated database. Every record is created here with a unique suffix
// and deleted in afterAll, so the test can run next to other data. The services take the user ID directly, so no session is needed.

// This file publishes more advice than the default per-hour limit (20) allows.
process.env.ADVICE_RATE_LIMIT_PER_HOUR = "1000";

const run = randomUUID().slice(0, 8);
const ids = {} as {
  faculty: string; courseA: string; courseB: string; term: string; examA: string; examB: string; pendingExam: string;
  groupA: string; author: string; reader: string;
};

const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  courseId: ids.courseA, scopeKind: "COURSE", scopeValue: "", title: `Advice ${run}`, body: `Start the labs early ${run}.`,
  resourceUrl: "", resourceTitle: "", isAnonymous: false, ...over,
});

const publish = async (over: Partial<PublishInput> = {}) => {
  const result = await publishAdvice(ids.author, input(over));
  if (!result.ok) throw new Error(`publish failed: ${result.error}`);
  return result.id;
};

beforeAll(async () => {
  const faculty = await db.faculty.create({ data: { code: `F${run}`, name: `Faculty ${run}` } });
  const [courseA, courseB, term, author, reader] = await Promise.all([
    db.course.create({ data: { code: `AA${run}`, name: "Course A", facultyId: faculty.id } }),
    db.course.create({ data: { code: `BB${run}`, name: "Course B", facultyId: faculty.id } }),
    db.term.create({ data: { name: `Fall ${run}` } }),
    db.user.create({ data: { email: `author-${run}@example.com`, passwordHash: "x", name: `Secret Author ${run}` } }),
    db.user.create({ data: { email: `reader-${run}@example.com`, passwordHash: "x", name: `Reader ${run}` } }),
  ]);
  const paper = (courseId: string, title: string, over: Record<string, unknown> = {}) => db.courseFile.create({
    data: { courseId, title, originalFileName: `${title}.pdf`, storageKey: `test/${run}/${title}`, category: FileCategory.EXAM, year: 2025, ...over },
  });
  const [examA, examB, pendingExam] = await Promise.all([
    paper(courseA.id, `Final A ${run}`, { termId: term.id, topic: "TCP Basics" }),
    paper(courseB.id, `Final B ${run}`),
    paper(courseA.id, `Pending ${run}`, { status: FileStatus.PENDING }),
  ]);
  const groupA = await db.questionGroup.create({ data: { courseId: courseA.id, text: `Explain TCP ${run}`, normalizedText: `explain tcp ${run}`, paperCount: 1, rank: 1 } });
  await db.question.create({ data: { fileId: examA.id, number: 1, text: `Explain TCP ${run}`, groupId: groupA.id } });
  Object.assign(ids, {
    faculty: faculty.id, courseA: courseA.id, courseB: courseB.id, term: term.id, examA: examA.id, examB: examB.id,
    pendingExam: pendingExam.id, groupA: groupA.id, author: author.id, reader: reader.id,
  });
});

afterAll(async () => {
  // Advice and files go with their course; users, term, and faculty are removed after.
  await db.course.deleteMany({ where: { id: { in: [ids.courseA, ids.courseB].filter(Boolean) } } });
  await db.user.deleteMany({ where: { id: { in: [ids.author, ids.reader].filter(Boolean) } } });
  if (ids.term) await db.term.deleteMany({ where: { id: ids.term } });
  if (ids.faculty) await db.faculty.deleteMany({ where: { id: ids.faculty } });
  await db.$disconnect();
});

describe("US-34: scoped advice", () => {
  it("saves advice for every valid scope with a readable label", async () => {
    const scopes = [
      { scopeKind: "COURSE", scopeValue: "", label: `AA${run}` },
      { scopeKind: "EXAM", scopeValue: ids.examA, label: `Final A ${run}` },
      { scopeKind: "SESSION", scopeValue: ids.term, label: `Fall ${run}` },
      { scopeKind: "TOPIC", scopeValue: " tcp  BASICS ", label: "TCP Basics" },
      { scopeKind: "QUESTION", scopeValue: ids.groupA, label: `Explain TCP ${run}` },
    ];
    for (const scope of scopes) {
      const row = await db.advice.findUniqueOrThrow({ where: { id: await publish(scope) } });
      expect(row).toMatchObject({ courseId: ids.courseA, authorId: ids.author, scopeKind: scope.scopeKind, scopeLabel: scope.label, status: AdviceStatus.VISIBLE });
    }
  });

  it("rejects a scope from another course, an unpublished paper, an unknown topic, and a missing target", async () => {
    const before = await db.advice.count({ where: { courseId: ids.courseA } });
    const bad = [
      { scopeKind: "EXAM", scopeValue: ids.examB },
      { scopeKind: "EXAM", scopeValue: ids.pendingExam },
      { scopeKind: "EXAM", scopeValue: "does-not-exist" },
      { scopeKind: "SESSION", scopeValue: "does-not-exist" },
      { scopeKind: "TOPIC", scopeValue: "quantum" },
      { scopeKind: "QUESTION", scopeValue: "does-not-exist" },
      { scopeKind: "EXAM", scopeValue: "" },
    ];
    for (const scope of bad) expect(await publishAdvice(ids.author, input(scope))).toEqual({ ok: false, error: "scope_invalid" });
    expect(await publishAdvice(ids.author, input({ courseId: "no-such-course" }))).toEqual({ ok: false, error: "course_not_found" });
    expect(await db.advice.count({ where: { courseId: ids.courseA } })).toBe(before);
  });

  it("keeps the advice and its label when the exam it was about is deleted", async () => {
    const paper = await db.courseFile.create({ data: { courseId: ids.courseA, title: `Temp ${run}`, originalFileName: "t.pdf", storageKey: `test/${run}/temp`, category: FileCategory.EXAM } });
    const id = await publish({ scopeKind: "EXAM", scopeValue: paper.id, title: `Orphan ${run}` });
    await db.courseFile.delete({ where: { id: paper.id } });
    expect(await db.advice.findUniqueOrThrow({ where: { id } })).toMatchObject({ fileId: null, scopeLabel: `Temp ${run}` });
  });
});

describe("US-35: external links", () => {
  it("saves a valid https link and refuses unsafe ones", async () => {
    const id = await publish({ resourceUrl: "https://example.com/guide", resourceTitle: "Guide" });
    expect(await db.advice.findUniqueOrThrow({ where: { id } })).toMatchObject({ resourceUrl: "https://example.com/guide", resourceTitle: "Guide" });
    const before = await db.advice.count({ where: { courseId: ids.courseA } });
    for (const resourceUrl of ["javascript:alert(1)", "data:text/html,x", "http://example.com", "https://user:pw@example.com"]) {
      expect(await publishAdvice(ids.author, input({ resourceUrl }))).toEqual({ ok: false, error: "link_invalid" });
    }
    expect(await db.advice.count({ where: { courseId: ids.courseA } })).toBe(before);
  });
});

describe("US-37: anonymous advice", () => {
  it("hides the author in the feed, in search results, and in filtered results, but keeps the author for admins", async () => {
    const id = await publish({ isAnonymous: true, scopeKind: "EXAM", scopeValue: ids.examA, title: `Anon ${run}`, body: `Anonymous tip ${run}` });
    const views = [
      await searchAdvice(ids.courseA, ids.reader),
      await searchAdvice(ids.courseA, ids.reader, { query: `Anonymous tip ${run}` }),
      await searchAdvice(ids.courseA, ids.reader, { examId: ids.examA }),
      await searchAdvice(ids.courseA, ids.reader, { topic: "tcp basics", termId: ids.term }),
    ];
    for (const view of views) {
      const json = JSON.stringify(view);
      expect(json).not.toContain(`Secret Author ${run}`);
      expect(json).not.toContain(ids.author);
    }
    const found = views[1].items.find(item => item.id === id);
    expect(found).toMatchObject({ authorLabel: "Anonymous student", isAnonymous: true, isMine: false });
    expect((await searchAdvice(ids.courseA, ids.author, { query: `Anonymous tip ${run}` })).items[0].isMine).toBe(true);
    expect((await db.advice.findUniqueOrThrow({ where: { id } })).authorId).toBe(ids.author);
  });

  it("shows the author's name on advice that is not anonymous", async () => {
    await publish({ title: `Named ${run}`, body: `Named tip ${run}` });
    const page = await searchAdvice(ids.courseA, ids.reader, { query: `Named tip ${run}` });
    expect(page.items[0].authorLabel).toBe(`Secret Author ${run}`);
  });
});

describe("US-39: search and filter", () => {
  it("returns only the advice of the course asked for", async () => {
    await publishAdvice(ids.author, input({ courseId: ids.courseB, title: `B only ${run}`, body: `Course B tip ${run}` }));
    const inA = await searchAdvice(ids.courseA, ids.reader, { query: `Course B tip ${run}` });
    const inB = await searchAdvice(ids.courseB, ids.reader, { query: `Course B tip ${run}` });
    expect(inA.total).toBe(0);
    expect(inB.total).toBe(1);
    for (const item of (await searchAdvice(ids.courseA, ids.reader)).items) expect(item.courseId).toBe(ids.courseA);
  });

  it("ignores an exam or session of another course", async () => {
    await publishAdvice(ids.author, input({ courseId: ids.courseB, title: `B exam ${run}` }));
    expect((await searchAdvice(ids.courseA, ids.reader, { examId: ids.examB })).total).toBe(0);
    expect((await searchAdvice(ids.courseB, ids.reader, { termId: ids.term })).total).toBe(0);
  });

  it("filters by text (any case), topic, exam, and session, and combines them", async () => {
    await publish({ scopeKind: "TOPIC", scopeValue: "TCP Basics", title: `Topic tip ${run}`, body: `About sockets ${run}` });
    expect((await searchAdvice(ids.courseA, null, { query: `SOCKETS ${run}`.toLowerCase() })).total).toBe(1);
    expect((await searchAdvice(ids.courseA, null, { topic: "tcp basics" })).items.every(item => item.scope.topic === "TCP Basics")).toBe(true);
    expect((await searchAdvice(ids.courseA, null, { examId: ids.examA })).items.every(item => item.scope.fileId === ids.examA)).toBe(true);
    expect((await searchAdvice(ids.courseA, null, { termId: ids.term })).items.every(item => item.scope.termId === ids.term)).toBe(true);
    expect((await searchAdvice(ids.courseA, null, { topic: "tcp basics", query: `SOCKETS ${run}` })).total).toBe(1);
    expect((await searchAdvice(ids.courseA, null, { topic: "tcp basics", examId: ids.examA, query: `SOCKETS ${run}` })).total).toBe(0);
  });

  it("treats % and _ in the keyword as plain characters", async () => {
    await publish({ title: `Percent ${run}`, body: `Worth 100% of the grade ${run}` });
    expect((await searchAdvice(ids.courseA, null, { query: `100% of the grade ${run}` })).total).toBe(1);
    expect((await searchAdvice(ids.courseA, null, { query: "%" })).items.every(item => `${item.title}${item.body}${item.scope.topic ?? ""}`.includes("%"))).toBe(true);
  });

  it("never returns removed advice", async () => {
    const id = await publish({ title: `Removed ${run}`, body: `Remove me ${run}` });
    expect((await searchAdvice(ids.courseA, null, { query: `Remove me ${run}` })).total).toBe(1);
    await db.advice.update({ where: { id }, data: { status: AdviceStatus.REMOVED, removedAt: new Date() } });
    expect((await searchAdvice(ids.courseA, null, { query: `Remove me ${run}` })).total).toBe(0);
    expect((await searchAdvice(ids.courseA, null)).items.some(item => item.id === id)).toBe(false);
  });

  it("pages the results and falls back to a valid page", async () => {
    const first = await searchAdvice(ids.courseA, null, { page: 1 });
    const last = await searchAdvice(ids.courseA, null, { page: 9999 });
    expect(last.page).toBe(first.totalPages);
    expect((await searchAdvice(ids.courseA, null, { page: -1 })).page).toBe(1);
  });
});

describe("form options", () => {
  it("lists only published papers, terms, topics, and questions of the course", async () => {
    const options = await getAdviceOptions(ids.courseA);
    expect(options.exams.map(exam => exam.id)).toContain(ids.examA);
    expect(options.exams.map(exam => exam.id)).not.toContain(ids.pendingExam);
    expect(options.exams.map(exam => exam.id)).not.toContain(ids.examB);
    expect(options.terms.map(term => term.id)).toEqual([ids.term]);
    expect(options.topics).toEqual(["TCP Basics"]);
    expect(options.questions.map(question => question.id)).toEqual([ids.groupA]);
  });
});
