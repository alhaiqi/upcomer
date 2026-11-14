import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({ regroup: false, pauseNextExtraction: null as (() => Promise<void>) | null }));
vi.mock("@/lib/exam-extraction", async importOriginal => {
  const real = await importOriginal<typeof import("@/lib/exam-extraction")>();
  return { ...real, extractExamQuestions: async (...args: Parameters<typeof real.extractExamQuestions>) => {
    const pause = fault.pauseNextExtraction;
    fault.pauseNextExtraction = null;
    if (pause) await pause();
    return real.extractExamQuestions(...args);
  } };
});
vi.mock("@/lib/question-bank", async importOriginal => {
  const real = await importOriginal<typeof import("@/lib/question-bank")>();
  return { ...real, regroupCourseInTransaction: (...args: Parameters<typeof real.regroupCourseInTransaction>) => {
    if (fault.regroup) throw new Error("simulated grouping failure with private content");
    return real.regroupCourseInTransaction(...args);
  } };
});
import { db } from "@/lib/db";
import { getConsolidatedExam } from "@/lib/consolidated-exam";
import { getOriginalFile, resolveStoragePath } from "@/lib/files";
import { manageFile } from "@/lib/file-management";
import { recordLearningEvents, recordMockOutcomes, recordPracticeOutcome } from "@/lib/learning-evidence";
import { generatePracticeQuestions, getGeneratedPracticeQuestions } from "@/lib/practice-generation";
import { getPersonalOrder } from "@/lib/personal-order";
import { processExamFile } from "@/lib/exam-processing";
import { resetRateLimits } from "@/lib/rate-limit";
import { saveTopicConfidence } from "@/lib/topic-confidence";
import { contentHash } from "@/lib/practice-generation-rules";
import { imageOnlyPdf, textPdf } from "./fixtures/pdf";
import { createRng } from "../reliability/rng";

const run = `s4-${randomUUID().slice(0, 8)}`;
let faculty: string;
const courses: string[] = [];
const students: string[] = [];
const keys = new Set<string>();
let admin: string;
let questionA: string;
let questionB: string;
let pendingQuestion: string;
const row = (userId = students[0], courseId = courses[0], topicKey = "tcp") => db.learningTopic.findUnique({ where: { userId_courseId_topicKey: { userId, courseId, topicKey } } });

async function paper(courseId: string, topic = "TCP", lines = ["1. Explain the reliability guarantees of TCP.", "2. Describe how TCP flow control protects a receiver."], status: "PUBLISHED" | "PENDING" = "PUBLISHED") {
  const key = `exams/${run}-${randomUUID()}.pdf`;
  keys.add(key);
  await mkdir(path.dirname(resolveStoragePath(key)), { recursive: true });
  const bytes = textPdf([lines]);
  await writeFile(resolveStoragePath(key), bytes);
  const file = await db.courseFile.create({ data: { courseId, topic, title: `Paper ${run}`, originalFileName: "paper.pdf", storageKey: key, category: "EXAM", status, mimeType: "application/pdf", sizeBytes: bytes.length, year: 2025 } });
  if (status === "PUBLISHED") expect(await processExamFile(file.id)).toMatchObject({ ok: true });
  return file;
}

beforeAll(async () => {
  faculty = (await db.faculty.create({ data: { code: run.toUpperCase(), name: "Sprint 4 test" } })).id;
  for (const suffix of ["a", "b"]) courses.push((await db.course.create({ data: { code: `${run}${suffix}`.toUpperCase(), name: `Course ${suffix}`, facultyId: faculty } })).id);
  for (const suffix of ["a", "b", "c"]) students.push((await db.user.create({ data: { email: `${run}-${suffix}@test.invalid`, name: "Private student", passwordHash: "x" } })).id);
  admin = (await db.user.create({ data: { email: `${run}-admin@test.invalid`, name: "Admin", passwordHash: "x", role: "ADMIN" } })).id;
  const a = await paper(courses[0]);
  const b = await paper(courses[1]);
  questionA = (await db.question.findFirstOrThrow({ where: { fileId: a.id } })).id;
  questionB = (await db.question.findFirstOrThrow({ where: { fileId: b.id } })).id;
  const pending = await paper(courses[0], "TCP", undefined, "PENDING");
  pendingQuestion = (await db.question.create({ data: { fileId: pending.id, number: 1, text: "Private pending question." } })).id;
});
beforeEach(() => { fault.regroup = false; fault.pauseNextExtraction = null; resetRateLimits(); });
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  const stored = await db.courseFile.findMany({ where: { courseId: { in: courses } }, select: { storageKey: true } });
  stored.forEach(file => keys.add(file.storageKey));
  await db.user.deleteMany({ where: { id: { in: [...students, admin] } } });
  await db.course.deleteMany({ where: { id: { in: courses } } });
  if (faculty) await db.faculty.delete({ where: { id: faculty } });
  for (const key of keys) await unlink(resolveStoragePath(key)).catch(() => {});
  await db.$disconnect();
});

describe("US-25 and US-29 integrated evidence", () => {
  it("records an outcome, preserves confidence, changes personal priority and explains real evidence", async () => {
    expect(await saveTopicConfidence(students[0], courses[0], [["rating:tcp", "5"]])).toMatchObject({ ok: true });
    const exam = await getConsolidatedExam(courses[0]);
    const before = await getPersonalOrder(students[0], courses[0], exam.questions);
    expect(before.questions[0].priorityExplanation).toContain("No recorded performance evidence");
    expect(await recordPracticeOutcome(students[0], courses[0], { eventId: "first", questionId: questionA, outcome: "INCORRECT" })).toEqual({ ok: true, recorded: 1, duplicates: 0 });
    expect(await row()).toMatchObject({ confidence: 5, baselineWeakness: 0, correctCount: 0, incorrectCount: 1, weakness: 1 / 3 });
    const after = await getPersonalOrder(students[0], courses[0], exam.questions);
    expect(after.questions[0].priorityExplanation).toContain("0 correct and 1 incorrect recorded outcomes");
    expect(after.questions[0].priorityExplanation).toContain("Saved confidence: 5 of 5");
    expect(await row(students[1])).toBeNull();
    expect(await row(students[0], courses[1])).toBeNull();
  });
  it("deduplicates simultaneous delivery and refuses changed payloads", async () => {
    const event = { source: "QUESTION_BANK" as const, eventId: "concurrent", questionId: questionA, correct: true };
    const results = await Promise.all(Array.from({ length: 10 }, () => recordLearningEvents(students[0], courses[0], [event])));
    expect(results.every(result => result.ok)).toBe(true);
    expect(await db.learningEvent.count({ where: { userId: students[0], eventId: "concurrent" } })).toBe(1);
    expect((await row())?.correctCount).toBe(1);
    expect(await recordLearningEvents(students[0], courses[0], [{ ...event, correct: false }])).toEqual({ ok: false, error: "duplicate_conflict" });
    expect(await recordLearningEvents(students[0], courses[1], [{ ...event, questionId: questionB }])).toEqual({ ok: false, error: "duplicate_conflict" });
  });
  it("confidence changes preserve all performance evidence and Skip does not claim mastery", async () => {
    expect(await saveTopicConfidence(students[0], courses[0], [["rating:tcp", "1"]])).toMatchObject({ ok: true });
    expect(await row()).toMatchObject({ baselineWeakness: 1, correctCount: 1, incorrectCount: 1, weakness: 0.75 });
    expect(await saveTopicConfidence(students[0], courses[0], [["rating:tcp", "skip"]])).toMatchObject({ ok: true });
    expect(await row()).toMatchObject({ confidence: null, baselineWeakness: 0.5, correctCount: 1, incorrectCount: 1, weakness: 0.5 });
  });
  it("rolls back a batch when any question is private, missing or from another course", async () => {
    for (const invalid of [questionB, pendingQuestion, "missing"]) {
      const eventId = `rollback-${invalid}`;
      expect(await recordLearningEvents(students[1], courses[0], [
        { source: "QUESTION_BANK", eventId, questionId: questionA, correct: true },
        { source: "QUESTION_BANK", eventId: `${eventId}:bad`, questionId: invalid, correct: false },
      ])).toEqual({ ok: false, error: "not_found" });
      expect(await db.learningEvent.count({ where: { userId: students[1] } })).toBe(0);
      expect(await row(students[1])).toBeNull();
    }
  });
  it("topic ties use the same published-paper order as the displayed rationale", async () => {
    const first = await paper(courses[0], "Tie alpha", ["1. Explain the unique tie-breaking topic selection mechanism."]);
    await db.courseFile.update({ where: { id: first.id }, data: { title: "Alpha tie paper" } });
    const second = await paper(courses[0], "Tie zeta", ["1. Explain the unique tie-breaking topic selection mechanism."]);
    await db.courseFile.update({ where: { id: second.id }, data: { title: "Zeta tie paper" } });
    const source = await db.question.findFirstOrThrow({ where: { fileId: second.id } });
    expect(await recordLearningEvents(students[1], courses[0], [{ source: "QUESTION_BANK", eventId: "topic-tie", questionId: source.id, correct: false }])).toMatchObject({ ok: true });
    expect(await row(students[1], courses[0], "tie alpha")).toMatchObject({ incorrectCount: 1 });
    expect(await row(students[1], courses[0], "tie zeta")).toBeNull();
    const exam = await getPersonalOrder(students[1], courses[0], (await getConsolidatedExam(courses[0])).questions);
    expect(exam.questions.find(question => question.text.includes("unique tie-breaking"))?.priorityExplanation).toContain("Topic: Tie alpha");
  });
  it("a confidence save racing a practice update preserves both inputs", async () => {
    const source = await db.question.findFirstOrThrow({ where: { id: questionB } });
    const results = await Promise.all([
      saveTopicConfidence(students[1], courses[1], [["rating:tcp", "5"]]),
      recordLearningEvents(students[1], courses[1], [{ source: "QUESTION_BANK", eventId: "confidence-race", questionId: source.id, correct: false }]),
    ]);
    expect(results.every(result => result.ok)).toBe(true);
    expect(await row(students[1], courses[1])).toMatchObject({ confidence: 5, baselineWeakness: 0, incorrectCount: 1, weakness: 1 / 3 });
  });
  it("handles 50 seeded valid/invalid outcomes with exact student/course counts and idempotent replays", async () => {
    const rng = createRng(271025);
    let correct = 0; let incorrect = 0;
    let refused = 0;
    for (let i = 0; i < 50; i++) {
      const valid = rng.chance(0.75);
      const event = { source: "QUESTION_BANK" as const, eventId: `trial-${i}`, questionId: valid ? questionB : questionA, correct: rng.chance(0.5) };
      const result = await recordLearningEvents(students[2], courses[1], [event]);
      if (valid) {
        expect(result).toEqual({ ok: true, recorded: 1, duplicates: 0 });
        expect(await recordLearningEvents(students[2], courses[1], [event])).toEqual({ ok: true, recorded: 0, duplicates: 1 });
        if (event.correct) correct++; else incorrect++;
      } else { expect(result).toEqual({ ok: false, error: "not_found" }); refused++; }
    }
    expect(await row(students[2], courses[1])).toMatchObject({ correctCount: correct, incorrectCount: incorrect });
    expect((await row(students[2], courses[1]))?.weakness).toBeCloseTo((1 + incorrect) / (2 + correct + incorrect));
    expect(await row(students[2], courses[0])).toBeNull();
    console.log(`US-25 reliability seed 271025: 50/50; ${correct + incorrect} accepted, ${refused} refused; ${correct} correct, ${incorrect} incorrect; all accepted events replayed safely.`);
  });
  it("refuses untagged practice and enforces the browser rate limit", async () => {
    const file = await paper(courses[0], "", ["1. Derive an untagged proof about a unique algebraic structure."]);
    const question = await db.question.findFirstOrThrow({ where: { fileId: file.id } });
    expect(await recordPracticeOutcome(students[0], courses[0], { eventId: "untagged", questionId: question.id, outcome: "CORRECT" })).toEqual({ ok: false, error: "topic_required" });
    expect(await recordPracticeOutcome(students[0], courses[0], { eventId: "tampered", questionId: questionA, outcome: "GRADED_CORRECT" })).toEqual({ ok: false, error: "invalid_outcome" });
    resetRateLimits(); vi.stubEnv("PRACTICE_RATE_LIMIT_PER_MINUTE", "1");
    expect(await recordPracticeOutcome(students[0], courses[0], { eventId: "limited-1", questionId: questionA, outcome: "CORRECT" })).toMatchObject({ ok: true });
    expect(await recordPracticeOutcome(students[0], courses[0], { eventId: "limited-2", questionId: questionA, outcome: "CORRECT" })).toEqual({ ok: false, error: "rate_limited" });
  });
});

describe("US-44 generated practice and US-49 evidence adapter", () => {
  it("50 seeded generation trials retain exact constraints, private provenance, and no partial writes", async () => {
    await paper(courses[0], "Reliability generation", Array.from({ length: 20 }, (_, i) => `${i + 1}. Analyze reliable packet delivery on path ${i + 2} with ${i + 7} intermediate routers.`));
    vi.stubEnv("PRACTICE_GENERATION_RATE_LIMIT_PER_MINUTE", "100");
    const rng = createRng(271044);
    let accepted = 0; let refused = 0;
    for (let i = 0; i < 50; i++) {
      const valid = rng.chance(0.7);
      const difficulty = rng.pick(["EASY", "MEDIUM", "HARD"] as const);
      const count = rng.int(1, 3);
      const before = await db.generatedPracticeQuestion.count({ where: { userId: students[2], courseId: courses[0] } });
      const result = await generatePracticeQuestions(students[2], courses[0], { count: valid ? count : 11, difficulty, topicKey: "reliability generation" });
      if (valid) {
        expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.error);
        expect(result.questions).toHaveLength(count);
        for (const item of result.questions) expect(item).toMatchObject({ difficulty, topicKey: "reliability generation", courseId: courses[0], userId: students[2], rubric: null });
        expect(await db.generatedPracticeQuestion.count({ where: { userId: students[2], courseId: courses[0] } })).toBe(before + count);
        accepted++;
      } else {
        expect(result).toEqual({ ok: false, error: "invalid_settings" });
        expect(await db.generatedPracticeQuestion.count({ where: { userId: students[2], courseId: courses[0] } })).toBe(before);
        refused++;
      }
    }
    console.log(`US-44 reliability seed 271044: 50/50; ${accepted} accepted, ${refused} refused.`);
  });
  it("persists exact count/difficulty/provenance, isolates libraries, and leaves exam statistics unchanged", async () => {
    const before = await getConsolidatedExam(courses[0]);
    const result = await generatePracticeQuestions(students[0], courses[0], { count: 3, difficulty: "MEDIUM", topicKey: "tcp" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions).toHaveLength(3);
    for (const question of result.questions) {
      expect(question).toMatchObject({ difficulty: "MEDIUM", courseId: courses[0], userId: students[0], topicKey: "tcp", rubric: null });
      const source = await db.question.findUniqueOrThrow({ where: { id: question.sourceQuestionId } });
      expect(question.prompt).toContain(source.text);
      expect(contentHash(question.prompt)).not.toBe(contentHash(source.text));
    }
    expect(await getConsolidatedExam(courses[0])).toEqual(before);
    expect(await getGeneratedPracticeQuestions(students[1], courses[0])).toHaveLength(0);
    expect(await getGeneratedPracticeQuestions(students[0], courses[1])).toHaveLength(0);
    const graded = [{ itemId: "item1", generatedQuestionId: result.questions[0].id, correct: true }];
    expect(await recordMockOutcomes(students[0], courses[0], "graded-attempt", graded)).toEqual({ ok: true, recorded: 1, duplicates: 0 });
    expect(await recordMockOutcomes(students[0], courses[0], "graded-attempt", graded)).toEqual({ ok: true, recorded: 0, duplicates: 1 });
    expect(await recordMockOutcomes(students[1], courses[0], "stolen-attempt", graded)).toEqual({ ok: false, error: "not_found" });
  });
  it("concurrent generation produces unique IDs/content and exhaustion saves no partial batch", async () => {
    const results = await Promise.all([1, 2].map(() => generatePracticeQuestions(students[1], courses[1], { count: 3, difficulty: "EASY" })));
    expect(results.every(result => result.ok)).toBe(true);
    const library = await getGeneratedPracticeQuestions(students[1], courses[1]);
    expect(library).toHaveLength(6);
    expect(new Set(library.map(item => item.contentHash)).size).toBe(6);
    expect(await generatePracticeQuestions(students[1], courses[1], { count: 1, difficulty: "EASY" })).toEqual({ ok: false, error: "insufficient_novel_questions" });
    expect(await getGeneratedPracticeQuestions(students[1], courses[1])).toHaveLength(6);
    expect(await generatePracticeQuestions(students[1], courses[1], { count: 1, difficulty: "EASY", topicKey: "foreign" })).toEqual({ ok: false, error: "no_sources" });
  });
  it("source corrections invalidate generated items and prevent using stale mock evidence", async () => {
    const created = await generatePracticeQuestions(students[2], courses[0], { count: 1, difficulty: "HARD" });
    expect(created.ok).toBe(true); if (!created.ok) return;
    const item = created.questions[0];
    const source = await db.question.findUniqueOrThrow({ where: { id: item.sourceQuestionId } });
    await db.question.update({ where: { id: source.id }, data: { text: source.text + " Explain all assumptions." } });
    expect((await getGeneratedPracticeQuestions(students[2], courses[0])).some(question => question.id === item.id)).toBe(false);
    expect(await recordMockOutcomes(students[2], courses[0], "stale-attempt", [{ itemId: "one", generatedQuestionId: item.id, correct: true }])).toEqual({ ok: false, error: "not_found" });
    await db.question.update({ where: { id: source.id }, data: { text: source.text } });
  });
});

describe("US-73 atomic file replacement/removal", () => {
  it("50 seeded file mutations preserve rankings, original data on refusals, and valid storage links", async () => {
    const rng = createRng(271073);
    let file = await paper(courses[0], "File reliability", ["1. Explain reliable file handling with atomic changes."]);
    const counts = { replace: 0, remove: 0, invalid: 0, stale: 0, unconfirmed: 0 };
    for (let i = 0; i < 50; i++) {
      const mode = rng.pick(["replace", "remove", "invalid", "stale", "unconfirmed"] as const);
      counts[mode]++;
      const previousBytes = await readFile(resolveStoragePath(file.storageKey));
      const version = mode === "stale" ? "2000-01-01T00:00:00.000Z" : file.updatedAt.toISOString();
      const mutation = mode === "replace" || mode === "invalid"
        ? { operation: "replace" as const, fileName: "trial.pdf", bytes: mode === "invalid" ? imageOnlyPdf() : textPdf([[`1. Analyze atomic replacement for delivery route ${i + 100}.`]]) }
        : { operation: "remove" as const, confirmed: mode !== "unconfirmed" };
      const result = await manageFile(admin, file.id, version, mutation);
      if (mode === "remove") {
        expect(result).toMatchObject({ ok: true, cleanupPending: false });
        expect(await db.courseFile.findUnique({ where: { id: file.id } })).toBeNull();
        expect((await getConsolidatedExam(courses[0])).questions.flatMap(question => question.papers).some(paper => paper.id === file.id)).toBe(false);
        file = await paper(courses[0], "File reliability", [`1. Explain recovery after file removal in trial ${i + 100}.`]);
      } else if (mode === "replace") {
        expect(result).toMatchObject({ ok: true, cleanupPending: false });
        file = await db.courseFile.findUniqueOrThrow({ where: { id: file.id } }); keys.add(file.storageKey);
        expect(await db.question.count({ where: { fileId: file.id } })).toBe(1);
        expect((await getOriginalFile(file.id)).bytes).not.toEqual(previousBytes);
        expect((await getConsolidatedExam(courses[0])).questions.some(question => question.text.includes(`route ${i + 100}`))).toBe(true);
      } else {
        expect(result).toEqual({ ok: false, error: mode === "stale" ? "stale" : mode === "unconfirmed" ? "confirmation_required" : "invalid_file" });
        expect((await getOriginalFile(file.id)).bytes).toEqual(previousBytes);
        expect((await db.courseFile.findUniqueOrThrow({ where: { id: file.id } })).updatedAt).toEqual(file.updatedAt);
      }
    }
    console.log(`US-73 reliability seed 271073: 50/50; ${JSON.stringify(counts)}`);
  }, 60_000);
  it("replaces bytes/questions, removes old generated items, refreshes ranks, and rejects stale forms", async () => {
    const file = await paper(courses[0], "Replacement", ["1. Describe the old replacement protocol."]);
    const oldQuestion = await db.question.findFirstOrThrow({ where: { fileId: file.id } });
    const generated = await generatePracticeQuestions(students[0], courses[0], { count: 1, difficulty: "EASY", topicKey: "replacement" });
    expect(generated.ok).toBe(true);
    expect(await recordLearningEvents(students[0], courses[0], [{ source: "QUESTION_BANK", eventId: "before-replace", questionId: oldQuestion.id, correct: true }])).toMatchObject({ ok: true });
    const bytes = textPdf([["1. Explain the new replacement protocol.", "2. Compare packet delivery strategies."]]);
    expect(await manageFile(admin, file.id, file.updatedAt.toISOString(), { operation: "replace", fileName: "new.pdf", bytes })).toMatchObject({ ok: true, cleanupPending: false });
    const current = await db.courseFile.findUniqueOrThrow({ where: { id: file.id } }); keys.add(current.storageKey);
    expect(current.storageKey).not.toBe(file.storageKey);
    expect((await getOriginalFile(file.id)).bytes).toEqual(Buffer.from(bytes));
    expect(await db.question.count({ where: { id: oldQuestion.id } })).toBe(0);
    expect(await db.question.count({ where: { fileId: file.id } })).toBe(2);
    expect(await db.generatedPracticeQuestion.count({ where: { sourceQuestionId: oldQuestion.id } })).toBe(0);
    expect(await db.learningEvent.findFirst({ where: { eventId: "before-replace" } })).toMatchObject({ questionId: null, topicKey: "replacement", correct: true });
    const exam = await getConsolidatedExam(courses[0]);
    expect(exam.questions.some(question => question.text.includes("old replacement"))).toBe(false);
    expect(exam.questions.some(question => question.text.includes("new replacement"))).toBe(true);
    expect(await manageFile(admin, file.id, file.updatedAt.toISOString(), { operation: "remove", confirmed: true })).toEqual({ ok: false, error: "stale" });
    expect(await manageFile(admin, file.id, current.updatedAt.toISOString(), { operation: "remove", confirmed: true })).toMatchObject({ ok: true });
    expect(await db.courseFile.findUnique({ where: { id: file.id } })).toBeNull();
    await expect(getOriginalFile(file.id)).rejects.toMatchObject({ reason: "missing_record" });
    expect((await getConsolidatedExam(courses[0])).questions.some(question => question.text.includes("new replacement"))).toBe(false);
  });
  it("invalid PDF and failed regroup leave original bytes, questions and rankings intact", async () => {
    const file = await paper(courses[0], "Rollback", ["1. Explain the rollback protocol."]);
    const before = await getConsolidatedExam(courses[0]);
    const oldBytes = await readFile(resolveStoragePath(file.storageKey));
    expect(await manageFile(admin, file.id, file.updatedAt.toISOString(), { operation: "replace", fileName: "scan.pdf", bytes: imageOnlyPdf() })).toEqual({ ok: false, error: "invalid_file" });
    fault.regroup = true;
    expect(await manageFile(admin, file.id, file.updatedAt.toISOString(), { operation: "replace", fileName: "valid.pdf", bytes: textPdf([["1. Explain the replacement that must roll back."]]) })).toEqual({ ok: false, error: "unexpected" });
    fault.regroup = false;
    expect(await getConsolidatedExam(courses[0])).toEqual(before);
    expect((await db.courseFile.findUniqueOrThrow({ where: { id: file.id } })).storageKey).toBe(file.storageKey);
    expect(await readFile(resolveStoragePath(file.storageKey))).toEqual(oldBytes);
    expect(await manageFile(admin, file.id, file.updatedAt.toISOString(), { operation: "remove", confirmed: false })).toEqual({ ok: false, error: "confirmation_required" });
  });
  it("blocks active processing, races safely, and preserves shared physical files", async () => {
    const file = await paper(courses[0], "Race", ["1. Explain concurrency control."]);
    const active = await db.fileProcessingRun.create({ data: { fileId: file.id } });
    expect(await manageFile(admin, file.id, file.updatedAt.toISOString(), { operation: "remove", confirmed: true })).toEqual({ ok: false, error: "busy" });
    await db.fileProcessingRun.update({ where: { id: active.id }, data: { status: "FAILED" } });
    const shared = await db.courseFile.create({ data: { courseId: courses[1], title: "Shared bytes", originalFileName: "shared.pdf", category: "MATERIAL", storageKey: file.storageKey, mimeType: "application/pdf" } });
    const results = await Promise.all([1, 2].map(() => manageFile(admin, file.id, file.updatedAt.toISOString(), { operation: "remove", confirmed: true })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect((await getOriginalFile(shared.id)).bytes.length).toBeGreaterThan(0);
  });
});

describe("second-pass integration regressions", () => {
  it("removing a paper moved between courses also repairs its former course's stored counts", async () => {
    const text = "1. Describe preserving provenance when an exam paper changes its course.";
    const moved = await paper(courses[0], "Review moved", [text]);
    await paper(courses[0], "Review moved", [text]);
    const original = await db.question.findFirstOrThrow({ where: { fileId: moved.id } });
    expect(await db.questionGroup.findUnique({ where: { id: original.groupId! } })).toMatchObject({ courseId: courses[0], paperCount: 2 });
    const updated = await db.courseFile.update({ where: { id: moved.id }, data: { courseId: courses[1] } });
    expect(await manageFile(admin, moved.id, updated.updatedAt.toISOString(), { operation: "remove", confirmed: true })).toMatchObject({ ok: true });
    expect(await db.questionGroup.findUnique({ where: { id: original.groupId! } })).toMatchObject({ courseId: courses[0], paperCount: 1 });
  });
  it("cross-course deliveries with one student event ID return a controlled conflict", async () => {
    for (let i = 0; i < 5; i++) {
      const results = await Promise.all([
        recordLearningEvents(students[2], courses[0], [{ source: "QUESTION_BANK", eventId: `cross-course-${i}`, questionId: questionA, correct: true }]),
        recordLearningEvents(students[2], courses[1], [{ source: "QUESTION_BANK", eventId: `cross-course-${i}`, questionId: questionB, correct: true }]),
      ]);
      expect(results.filter(result => result.ok)).toHaveLength(1);
      expect(results.find(result => !result.ok)).toEqual({ ok: false, error: "duplicate_conflict" });
      expect(await db.learningEvent.count({ where: { userId: students[2], eventId: `cross-course-${i}` } })).toBe(1);
    }
  });
  it("distinct mock attempt/item pairs cannot collide, and empty producer IDs are refused", async () => {
    const generated = await generatePracticeQuestions(students[2], courses[1], { count: 1, difficulty: "HARD" });
    expect(generated.ok).toBe(true); if (!generated.ok) throw new Error(generated.error);
    const generatedQuestionId = generated.questions[0].id;
    expect(await recordMockOutcomes(students[2], courses[1], "attempt:part", [{ itemId: "one", generatedQuestionId, correct: true }])).toEqual({ ok: true, recorded: 1, duplicates: 0 });
    expect(await recordMockOutcomes(students[2], courses[1], "attempt", [{ itemId: "part:one", generatedQuestionId, correct: true }])).toEqual({ ok: true, recorded: 1, duplicates: 0 });
    expect(await recordMockOutcomes(students[2], courses[1], "attempt:part", [{ itemId: "one", generatedQuestionId, correct: true }])).toEqual({ ok: true, recorded: 0, duplicates: 1 });
    expect(await recordMockOutcomes(students[2], courses[1], "", [{ itemId: "one", generatedQuestionId, correct: true }])).toEqual({ ok: false, error: "invalid_outcome" });
    expect(await recordMockOutcomes(students[2], courses[1], "valid-attempt", [{ itemId: "", generatedQuestionId, correct: true }])).toEqual({ ok: false, error: "invalid_outcome" });
  });
  it("a retagged source can regenerate a full library without stale hashes blocking every variant", async () => {
    const file = await paper(courses[0], "Review old topic", ["1. Explain why stable provenance matters for a directed graph."]);
    const original = await generatePracticeQuestions(students[2], courses[0], { count: 3, difficulty: "EASY", topicKey: "review old topic" });
    expect(original.ok).toBe(true); if (!original.ok) throw new Error(original.error);
    await recordMockOutcomes(students[2], courses[0], "before-retag", [{ itemId: "one", generatedQuestionId: original.questions[0].id, correct: false }]);
    await db.courseFile.update({ where: { id: file.id }, data: { topic: "Review new topic" } });
    expect(await getGeneratedPracticeQuestions(students[2], courses[0], { topicKey: "review old topic" })).toHaveLength(0);
    const refreshed = await generatePracticeQuestions(students[2], courses[0], { count: 3, difficulty: "EASY", topicKey: "review new topic" });
    expect(refreshed.ok).toBe(true); if (!refreshed.ok) throw new Error(refreshed.error);
    expect(refreshed.questions.every(question => question.topicKey === "review new topic")).toBe(true);
    expect(refreshed.questions.every(question => !original.questions.some(old => old.id === question.id))).toBe(true);
    expect(await db.learningEvent.findFirst({ where: { generatedQuestionId: original.questions[0].id } })).toBeNull();
    expect(await db.learningEvent.findFirst({ where: { userId: students[2], topicKey: "review old topic" } })).toMatchObject({ correct: false, generatedQuestionId: null });
  });
  it("an old extraction resuming after replacement cannot overwrite new questions or rankings", async () => {
    const file = await paper(courses[0], "Review processing", ["1. Explain the obsolete delivery algorithm before replacement."]);
    await db.question.deleteMany({ where: { fileId: file.id } });
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { entered = resolve; });
    fault.pauseNextExtraction = async () => { entered(); await held; };
    const oldProcessing = processExamFile(file.id);
    await reached;
    try {
      const active = await db.fileProcessingRun.findFirstOrThrow({ where: { fileId: file.id, status: "RUNNING" }, orderBy: { createdAt: "desc" } });
      await db.fileProcessingRun.update({ where: { id: active.id }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
      expect(await manageFile(admin, file.id, file.updatedAt.toISOString(), { operation: "replace", fileName: "new.pdf", bytes: textPdf([["1. Explain the replacement delivery algorithm with acknowledgements."]]) })).toMatchObject({ ok: true });
    } finally { release(); }
    expect(await oldProcessing).toMatchObject({ ok: false, reason: "superseded" });
    const current = await db.courseFile.findUniqueOrThrow({ where: { id: file.id } }); keys.add(current.storageKey);
    const stored = await db.question.findMany({ where: { fileId: file.id } });
    expect(stored).toHaveLength(1); expect(stored[0].text).toContain("replacement delivery");
    const exam = await getConsolidatedExam(courses[0]);
    expect(exam.questions.some(question => question.text.includes("obsolete delivery"))).toBe(false);
    expect(exam.questions.some(question => question.text.includes("replacement delivery"))).toBe(true);
  });
});
