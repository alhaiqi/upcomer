import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// US-74 against a real database: the queue order and pages, reviews racing each other, what reaches each page,
// and a published exam entering the question pipeline (rebuildQuestionBank, US-15a and US-16).

import { db } from "@/lib/db";
import { getCourseExams, getCourseMaterials } from "@/lib/courses";
import { getQuestionBank } from "@/lib/question-bank";
import { resetRateLimits } from "@/lib/rate-limit";
import { getReviewQueue, REVIEW_PAGE_SIZE, reviewSubmission } from "@/lib/submission-review";
import { getMySubmissions } from "@/lib/submissions";

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const faculty = { id: `it-rev-faculty-${stamp}`, code: `IRF${stamp}`.toUpperCase().slice(0, 20), name: "Review Faculty" };
const course = { id: `it-rev-course-${stamp}`, code: `IRC${stamp}`.toUpperCase().slice(0, 20), name: "Review Course", facultyId: faculty.id };
const students = [`it-rev-s1-${stamp}`, `it-rev-s2-${stamp}`];
const admins = [`it-rev-a1-${stamp}`, `it-rev-a2-${stamp}`];
const base = new Date("2020-01-01T00:00:00Z").getTime();
let counter = 0;

async function submission(fields: { minutesAfterBase: number; category?: "EXAM" | "MATERIAL"; studentIndex?: number; id?: string; status?: "PENDING" | "PUBLISHED"; questions?: string[] }) {
  counter++;
  return db.courseFile.create({
    data: {
      id: fields.id ?? `it-rev-file-${stamp}-${counter}`, courseId: course.id, title: `Submission ${counter}`, category: fields.category ?? "EXAM",
      status: fields.status ?? "PENDING", submittedById: fields.status === "PUBLISHED" ? null : students[fields.studentIndex ?? 0],
      createdAt: new Date(base + fields.minutesAfterBase * 60_000), year: 2020 + (counter % 6),
      originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf",
      // Extracted questions, as US-14 will store them for the paper.
      questions: fields.questions && { create: fields.questions.map((text, index) => ({ number: index + 1, text })) },
    },
  });
}
const publish = (fileId: string, admin = admins[0]) => reviewSubmission(admin, "publish", fileId);
const reject = (fileId: string, reason: string, admin = admins[0]) => reviewSubmission(admin, "reject", fileId, reason);
// Other tests or demo data may have pending files too; these helpers only look at this run's course.
const ours = <T extends { courseId: string }>(items: T[]) => items.filter(item => item.courseId === course.id);
const bankTexts = async () => (await getQuestionBank(course.id)).groups.map(group => [group.text, group.paperCount]);

beforeAll(async () => {
  await db.faculty.create({ data: faculty });
  await db.course.create({ data: course });
  await db.user.createMany({ data: [...students, ...admins].map((id, index) => ({ id, email: `${id}@review.test`, name: `User ${index}`, passwordHash: "x", role: id.includes("-a") ? "ADMIN" as const : "STUDENT" as const })) });
});
afterAll(async () => {
  try {
    // Deleting the course deletes its files, their questions, and its question groups.
    await db.course.deleteMany({ where: { id: course.id } });
    await db.faculty.deleteMany({ where: { id: faculty.id } });
    await db.user.deleteMany({ where: { id: { in: [...students, ...admins] } } });
  } finally {
    await db.$disconnect();
  }
});
beforeEach(async () => {
  resetRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.questionGroup.deleteMany({ where: { courseId: course.id } });
  await db.courseFile.deleteMany({ where: { courseId: course.id } });
});
afterEach(() => vi.restoreAllMocks());

describe.sequential("submission review with a real database", () => {
  it("lists only pending submissions, oldest first, with ties broken by ID", async () => {
    await submission({ minutesAfterBase: 30, id: `it-rev-${stamp}-c` });
    await submission({ minutesAfterBase: 10, id: `it-rev-${stamp}-b` });
    await submission({ minutesAfterBase: 10, id: `it-rev-${stamp}-a` });
    await submission({ minutesAfterBase: 0, status: "PUBLISHED" });

    const { items } = await getReviewQueue();
    expect(ours(items).map(item => item.id)).toEqual([`it-rev-${stamp}-a`, `it-rev-${stamp}-b`, `it-rev-${stamp}-c`]);
  });

  it("splits a long queue into pages that keep the oldest-first order", async () => {
    for (let index = 0; index < REVIEW_PAGE_SIZE + 5; index++) await submission({ minutesAfterBase: index });
    const first = await getReviewQueue(1);
    const all = [...first.items];
    for (let page = 2; page <= first.totalPages; page++) all.push(...(await getReviewQueue(page)).items);
    // A page past the end falls back to the last page instead of showing nothing.
    expect((await getReviewQueue(first.totalPages + 1)).page).toBe(first.totalPages);
    const times = ours(all).map(item => item.createdAt.getTime());
    expect(times).toHaveLength(REVIEW_PAGE_SIZE + 5);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(first.items).toHaveLength(REVIEW_PAGE_SIZE);
    expect(new Set(all.map(item => item.id)).size).toBe(all.length);
  });

  it("lets only one of two admins publishing at the same moment succeed", async () => {
    const file = await submission({ minutesAfterBase: 0 });
    const results = await Promise.all([publish(file.id, admins[0]), publish(file.id, admins[1])]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => !result.ok)).toEqual({ ok: false, error: "not_pending" });
    expect(await db.courseFile.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ status: "PUBLISHED", reviewedAt: expect.any(Date) });
  });

  it("keeps the first decision when a publish and a reject race", async () => {
    const file = await submission({ minutesAfterBase: 0 });
    const [published, rejected] = await Promise.all([publish(file.id, admins[0]), reject(file.id, "Duplicate of another exam", admins[1])]);
    expect([published.ok, rejected.ok].filter(Boolean)).toHaveLength(1);
    const saved = await db.courseFile.findUniqueOrThrow({ where: { id: file.id } });
    if (published.ok) expect(saved).toMatchObject({ status: "PUBLISHED", rejectionReason: null });
    else expect(saved).toMatchObject({ status: "REJECTED", rejectionReason: "Duplicate of another exam" });
  });

  it("puts a published exam on the exams page and a published material on the materials page, and nothing else", async () => {
    const exam = await submission({ minutesAfterBase: 0, category: "EXAM" });
    const material = await submission({ minutesAfterBase: 1, category: "MATERIAL" });
    const rejected = await submission({ minutesAfterBase: 2, category: "EXAM" });
    const pending = await submission({ minutesAfterBase: 3, category: "EXAM" });
    expect(await getCourseExams(course.id)).toEqual([]);

    await publish(exam.id);
    await publish(material.id);
    await reject(rejected.id, "Unreadable scan");

    expect((await getCourseExams(course.id)).map(file => file.id)).toEqual([exam.id]);
    expect((await getCourseMaterials(course.id)).map(file => file.id)).toEqual([material.id]);
    expect(ours((await getReviewQueue()).items).map(file => file.id)).toEqual([pending.id]);
  });

  it("enters a published exam into the question pipeline: its questions are grouped and ranked with the course's others", async () => {
    await submission({ minutesAfterBase: 0, status: "PUBLISHED", questions: ["Explain TCP congestion control.", "Define a subnet mask."] });
    const exam = await submission({ minutesAfterBase: 1, questions: ["Explain TCP congestion control.", "What is ARP?"] });
    const { rebuildQuestionBank } = await import("@/lib/question-bank");
    await rebuildQuestionBank(course.id);
    // While pending, the paper is not in the question bank.
    expect((await getQuestionBank(course.id)).totalPapers).toBe(1);
    expect(await bankTexts()).not.toContainEqual(["What is ARP?", 1]);

    expect(await publish(exam.id)).toEqual({ ok: true });

    const bank = await getQuestionBank(course.id);
    expect(bank.totalPapers).toBe(2);
    // The repeated question now counts both papers and ranks first.
    expect(bank.groups[0]).toMatchObject({ text: "Explain TCP congestion control.", paperCount: 2, rank: 1 });
    expect(bank.groups[0].papers.map(paper => paper.id)).toContain(exam.id);
    expect(await bankTexts()).toEqual(expect.arrayContaining([["What is ARP?", 1], ["Define a subnet mask.", 1]]));
  });

  it("keeps rejected and pending exams out of the question pipeline", async () => {
    await submission({ minutesAfterBase: 0, status: "PUBLISHED", questions: ["Explain TCP congestion control."] });
    const rejected = await submission({ minutesAfterBase: 1, questions: ["Explain TCP congestion control.", "What is ARP?"] });
    await submission({ minutesAfterBase: 2, questions: ["What is ARP?"] });
    await publish((await submission({ minutesAfterBase: 3, category: "MATERIAL" })).id);
    await reject(rejected.id, "Not this course");
    // Regroup as an admin would from /admin/questions; still only the published paper counts.
    const { rebuildQuestionBank } = await import("@/lib/question-bank");
    await rebuildQuestionBank(course.id);
    expect(await bankTexts()).toEqual([["Explain TCP congestion control.", 1]]);
  });

  it("shows each student only their own submissions, with the reason on a rejected one", async () => {
    const mine = await submission({ minutesAfterBase: 0, studentIndex: 0 });
    const theirs = await submission({ minutesAfterBase: 1, studentIndex: 1 });
    await reject(mine.id, "  Missing pages 3 to 5  ");

    const first = await getMySubmissions(students[0]);
    expect(first.map(file => [file.id, file.status, file.rejectionReason])).toEqual([[mine.id, "REJECTED", "Missing pages 3 to 5"]]);
    expect((await getMySubmissions(students[1])).map(file => file.id)).toEqual([theirs.id]);
  });

  it("refuses to review again after a decision, and keeps the stored reason", async () => {
    const file = await submission({ minutesAfterBase: 0 });
    await reject(file.id, "Wrong course");
    expect(await publish(file.id, admins[1])).toEqual({ ok: false, error: "not_pending" });
    expect(await reject(file.id, "Another reason", admins[1])).toEqual({ ok: false, error: "not_pending" });
    expect(await db.courseFile.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ status: "REJECTED", rejectionReason: "Wrong course" });
  });

  it("refuses a missing reason, an overlong reason, and an unknown file without changing anything", async () => {
    const file = await submission({ minutesAfterBase: 0 });
    expect(await reject(file.id, " \n\t ")).toEqual({ ok: false, error: "reason_required" });
    expect(await reject(file.id, "x".repeat(501))).toEqual({ ok: false, error: "reason_too_long" });
    expect(await publish(`it-rev-nope-${stamp}`)).toEqual({ ok: false, error: "not_found" });
    expect(await db.courseFile.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ status: "PENDING", rejectionReason: null, reviewedAt: null });
    expect(await reject(file.id, "x".repeat(500))).toEqual({ ok: true });
  });

  it("keeps a submission whose student account was deleted, without a submitter", async () => {
    const extra = `it-rev-gone-${stamp}`;
    await db.user.create({ data: { id: extra, email: `${extra}@review.test`, name: "Gone", passwordHash: "x" } });
    const file = await db.courseFile.create({
      data: { courseId: course.id, title: "Orphan", category: "EXAM", status: "PENDING", submittedById: extra, originalFileName: "a.pdf", storageKey: "eece350-final-2025.pdf" },
    });
    await db.user.delete({ where: { id: extra } });
    const listed = ours((await getReviewQueue()).items).find(item => item.id === file.id);
    expect(listed).toMatchObject({ submittedById: null, submittedBy: null });
    expect(await publish(file.id)).toEqual({ ok: true });
  });

  it("publishes a 60-question exam into a course with 20 papers, regrouping included, within the 1 s target", async () => {
    const topics = Array.from({ length: 60 }, (_, index) => `Question about topic number ${index} in computer networks?`);
    for (let paper = 0; paper < 20; paper++) await submission({ minutesAfterBase: paper, status: "PUBLISHED", questions: topics.slice(paper, paper + 30) });
    const exam = await submission({ minutesAfterBase: 30, questions: topics });

    const started = performance.now();
    expect(await publish(exam.id)).toEqual({ ok: true });
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(1000);
    const bank = await getQuestionBank(course.id);
    expect(bank.totalPapers).toBe(21);
    expect(bank.groups).toHaveLength(60);
  });
});
