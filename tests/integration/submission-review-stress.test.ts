import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// US-74 under pressure, against a real database: many admins reviewing at random at the same time, many exams published
// into one course at once, the rate limit, and submissions that change or disappear while they wait.

import { db } from "@/lib/db";
import { getQuestionBank, rebuildQuestionBank } from "@/lib/question-bank";
import { resetRateLimits } from "@/lib/rate-limit";
import { getReviewQueue, reviewSubmission } from "@/lib/submission-review";

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const faculty = { id: `it-str-faculty-${stamp}`, code: `ISF${stamp}`.toUpperCase().slice(0, 20), name: "Stress Faculty" };
const courses = [0, 1].map(index => ({ id: `it-str-course${index}-${stamp}`, code: `IS${index}${stamp}`.toUpperCase().slice(0, 20), name: `Stress Course ${index}`, facultyId: faculty.id }));
const student = `it-str-student-${stamp}`;
const admins = [0, 1, 2, 3].map(index => `it-str-admin${index}-${stamp}`);
let counter = 0;

async function pending(fields: { courseIndex?: number; category?: "EXAM" | "MATERIAL"; questions?: string[]; status?: "PENDING" | "PUBLISHED" } = {}) {
  counter++;
  return db.courseFile.create({
    data: {
      id: `it-str-file-${stamp}-${counter}`, courseId: courses[fields.courseIndex ?? 0].id, title: `Stress ${counter}`, category: fields.category ?? "EXAM",
      status: fields.status ?? "PENDING", submittedById: student, createdAt: new Date(Date.UTC(2019, 0, 1, 0, counter)), year: 2018 + (counter % 7),
      originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf",
      questions: fields.questions && { create: fields.questions.map((text, index) => ({ number: index + 1, text })) },
    },
  });
}

// A small seeded generator, so a failing run can be repeated exactly.
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

beforeAll(async () => {
  await db.faculty.create({ data: faculty });
  await db.course.createMany({ data: courses });
  await db.user.createMany({ data: [student, ...admins].map(id => ({ id, email: `${id}@stress.test`, name: id, passwordHash: "x", role: id.includes("admin") ? "ADMIN" as const : "STUDENT" as const })) });
});
afterAll(async () => {
  try {
    await db.course.deleteMany({ where: { id: { in: courses.map(course => course.id) } } });
    await db.faculty.deleteMany({ where: { id: faculty.id } });
    await db.user.deleteMany({ where: { id: { in: [student, ...admins] } } });
  } finally {
    await db.$disconnect();
  }
});
beforeEach(async () => {
  resetRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.questionGroup.deleteMany({ where: { courseId: { in: courses.map(course => course.id) } } });
  await db.courseFile.deleteMany({ where: { courseId: { in: courses.map(course => course.id) } } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.sequential("submission review under pressure", () => {
  for (const seed of [1, 2, 3]) {
    it(`keeps every submission reviewed exactly once when 4 admins act at random at the same time (seed ${seed})`, async () => {
      const next = random(seed);
      const files: Awaited<ReturnType<typeof pending>>[] = [];
      for (let index = 0; index < 24; index++) {
        files.push(await pending({ category: next() < 0.7 ? "EXAM" : "MATERIAL", questions: next() < 0.5 ? [`Shared question ${index % 4}?`, `Own question ${index}?`] : undefined }));
      }
      // 120 reviews in waves of 20 that run at the same time; about a quarter of the rejections have a blank reason.
      const operations = Array.from({ length: 120 }, (_, index) => {
        const file = files[Math.floor(next() * files.length)];
        const admin = admins[Math.floor(next() * admins.length)];
        const publish = next() < 0.5;
        const reason = next() < 0.25 ? "   " : `Reason ${index} from ${admin}`;
        return { index, fileId: file.id, admin, publish, reason };
      });
      const results: Array<{ op: (typeof operations)[number]; result: Awaited<ReturnType<typeof reviewSubmission>> }> = [];
      for (let start = 0; start < operations.length; start += 20) {
        const wave = operations.slice(start, start + 20);
        results.push(...await Promise.all(wave.map(async op => ({ op, result: await reviewSubmission(op.admin, op.publish ? "publish" : "reject", op.fileId, op.reason) }))));
      }

      const saved = new Map((await db.courseFile.findMany({ where: { id: { in: files.map(file => file.id) } } })).map(file => [file.id, file]));
      for (const file of files) {
        const mine = results.filter(({ op }) => op.fileId === file.id);
        const winners = mine.filter(({ result }) => result.ok);
        const valid = mine.filter(({ op }) => op.publish || op.reason.trim());
        const row = saved.get(file.id)!;
        // At most one decision per file, and exactly one if any valid review reached it.
        expect(winners).toHaveLength(valid.length ? 1 : 0);
        if (!winners.length) {
          expect(row).toMatchObject({ status: "PENDING", rejectionReason: null, reviewedAt: null });
          continue;
        }
        const { op } = winners[0];
        // The stored state is the winner's, never a mix of two decisions.
        expect(row).toMatchObject(op.publish ? { status: "PUBLISHED", rejectionReason: null } : { status: "REJECTED", rejectionReason: op.reason });
        expect(row.reviewedAt).toBeInstanceOf(Date);
        // Every other valid review of the file was told it was already reviewed, not silently accepted.
        for (const { result } of valid.filter(item => item !== winners[0])) expect(result).toEqual({ ok: false, error: "not_pending" });
      }
      for (const { result } of results.filter(({ op }) => !op.publish && !op.reason.trim())) expect(result).toEqual({ ok: false, error: "reason_required" });

      // The queue shows exactly the files nobody decided on.
      const first = await getReviewQueue(1);
      const queue = [...first.items];
      for (let page = 2; page <= first.totalPages; page++) queue.push(...(await getReviewQueue(page)).items);
      expect(new Set(queue.map(item => item.id)).size).toBe(queue.length);
      queue.splice(0, queue.length, ...queue.filter(item => item.courseId === courses[0].id));
      expect(queue.map(item => item.id).sort()).toEqual(files.filter(file => saved.get(file.id)!.status === "PENDING").map(file => file.id).sort());

      // The question bank the concurrent publishes left behind is the same as a fresh rebuild, and counts published exams only.
      const before = await getQuestionBank(courses[0].id);
      await rebuildQuestionBank(courses[0].id);
      const after = await getQuestionBank(courses[0].id);
      const shape = (bank: typeof before) => bank.groups.map(group => [group.text, group.paperCount, group.rank, group.papers.map(paper => paper.id).sort()]);
      expect(shape(before)).toEqual(shape(after));
      for (const group of after.groups) for (const paper of group.papers) expect(saved.get(paper.id)).toMatchObject({ status: "PUBLISHED", category: "EXAM" });
      const papersWithQuestions = await db.courseFile.count({ where: { id: { in: files.map(file => file.id) }, status: "PUBLISHED", category: "EXAM", questions: { some: {} } } });
      expect(after.totalPapers).toBe(papersWithQuestions);
    });
  }

  it("groups correctly when 12 exams sharing a question are published into one course at the same moment", async () => {
    const exams: Awaited<ReturnType<typeof pending>>[] = [];
    for (let index = 0; index < 12; index++) exams.push(await pending({ questions: ["Explain the sliding window protocol.", `Unique question ${index}?`] }));
    const started = performance.now();
    const results = await Promise.all(exams.map((exam, index) => reviewSubmission(admins[index % admins.length], "publish", exam.id)));
    const elapsed = performance.now() - started;
    expect(results.every(result => result.ok)).toBe(true);

    const bank = await getQuestionBank(courses[0].id);
    expect(bank.totalPapers).toBe(12);
    expect(bank.groups[0]).toMatchObject({ text: "Explain the sliding window protocol.", paperCount: 12, rank: 1 });
    expect(bank.groups).toHaveLength(13);
    // Twelve course-wide regroups run one after another under the course lock; all of them together stay within a few seconds.
    expect(elapsed).toBeLessThan(5000);
  });

  it("stops an admin at the rate limit without changing the database, and lets another admin continue", async () => {
    vi.stubEnv("REVIEW_RATE_LIMIT_PER_MINUTE", "5");
    const files: Awaited<ReturnType<typeof pending>>[] = [];
    for (let index = 0; index < 7; index++) files.push(await pending({ category: "MATERIAL" }));
    const results = await Promise.all(files.slice(0, 6).map(file => reviewSubmission(admins[0], "publish", file.id)));
    expect(results.filter(result => result.ok)).toHaveLength(5);
    expect(results.filter(result => !result.ok)).toEqual([{ ok: false, error: "rate_limited" }]);
    expect(await db.courseFile.count({ where: { id: { in: files.map(file => file.id) }, status: "PUBLISHED" } })).toBe(5);
    expect(await reviewSubmission(admins[1], "publish", files[6].id)).toEqual({ ok: true });
  });

  it("regroups the course a submission was moved to while it waited, and leaves the old course alone", async () => {
    await pending({ courseIndex: 1, status: "PUBLISHED", questions: ["Define latency."] });
    await rebuildQuestionBank(courses[1].id);
    const file = await pending({ courseIndex: 0, questions: ["Define latency.", "Define jitter."] });
    // An admin fixes the course on /admin/files before reviewing it.
    await db.courseFile.update({ where: { id: file.id }, data: { courseId: courses[1].id } });

    expect(await reviewSubmission(admins[0], "publish", file.id)).toEqual({ ok: true });
    expect((await getQuestionBank(courses[1].id)).groups.map(group => [group.text, group.paperCount])).toEqual([["Define latency.", 2], ["Define jitter.", 1]]);
    expect((await getQuestionBank(courses[0].id)).groups).toEqual([]);
  });

  it("answers not found when a submission or its course is deleted between opening the queue and reviewing", async () => {
    const file = await pending();
    const other = await pending({ courseIndex: 1 });
    expect((await getReviewQueue()).items.map(item => item.id)).toEqual(expect.arrayContaining([file.id, other.id]));
    await db.courseFile.delete({ where: { id: file.id } });
    expect(await reviewSubmission(admins[0], "publish", file.id)).toEqual({ ok: false, error: "not_found" });
    expect(await reviewSubmission(admins[0], "reject", file.id, "Too late")).toEqual({ ok: false, error: "not_found" });

    const course = await db.course.create({ data: { id: `it-str-temp-${stamp}`, code: `IST${stamp}`.toUpperCase().slice(0, 20), name: "Temp", facultyId: faculty.id } });
    const doomed = await db.courseFile.create({ data: { courseId: course.id, title: "Doomed", category: "EXAM", status: "PENDING", submittedById: student, originalFileName: "a.pdf", storageKey: "eece350-final-2025.pdf" } });
    await db.course.delete({ where: { id: course.id } });
    expect(await reviewSubmission(admins[0], "publish", doomed.id)).toEqual({ ok: false, error: "not_found" });
  });
});
