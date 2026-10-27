import { beforeEach, describe, expect, it, vi } from "vitest";

const { questionProgress, question, tx, transaction, requireUser, redirect } = vi.hoisted(() => ({
  questionProgress: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  question: { findMany: vi.fn() },
  tx: {
    $executeRaw: vi.fn(),
    questionGroup: { findUnique: vi.fn() },
    question: { findMany: vi.fn() },
    questionProgress: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  },
  transaction: vi.fn(),
  requireUser: vi.fn(),
  redirect: vi.fn((location: string) => { throw new Error(`NEXT_REDIRECT ${location}`); }),
}));
vi.mock("@/lib/db", () => ({ db: { questionProgress, question, $transaction: transaction } }));
vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("next/navigation", () => ({ redirect }));
import { getCourseProgress, markQuestion, progressLimit, relinkTarget } from "@/lib/question-progress";
import { markQuestionAction } from "@/lib/question-progress-actions";
import { progressMessage } from "@/lib/question-progress-rules";
import { resetRateLimits } from "@/lib/rate-limit";

let errors: ReturnType<typeof vi.spyOn>;
const logged = () => errors.mock.calls.map(call => JSON.parse(String(call[0])));
const earlier = new Date("2026-10-20T10:00:00Z");
const doneAt = new Date("2026-10-27T10:00:00Z");
const mark = (id: string, groupId: string | null, sourceQuestionIds: string[] = [], at = doneAt) => ({ id, groupId, sourceQuestionIds, doneAt: at });
// The group's source questions from published exam papers of its course, first question first.
const sources = [{ id: "q1" }, { id: "q2" }, { id: "q3" }];
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const redirectedTo = async (run: Promise<unknown>) => {
  await expect(run).rejects.toThrow("NEXT_REDIRECT");
  return redirect.mock.calls.at(-1)?.[0];
};

beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  questionProgress.findMany.mockReset().mockResolvedValue([]);
  questionProgress.updateMany.mockReset().mockResolvedValue({ count: 1 });
  questionProgress.deleteMany.mockReset().mockResolvedValue({ count: 1 });
  question.findMany.mockReset().mockResolvedValue([]);
  resetRateLimits();
  transaction.mockReset().mockImplementation((work: (client: typeof tx) => unknown) => work(tx));
  tx.$executeRaw.mockReset().mockResolvedValue(1);
  tx.questionGroup.findUnique.mockReset().mockResolvedValue({ id: "group-1", courseId: "course-a" });
  tx.question.findMany.mockReset().mockResolvedValue(sources);
  for (const mock of Object.values(tx.questionProgress)) mock.mockReset().mockResolvedValue({});
  tx.questionProgress.findMany.mockResolvedValue([]);
  tx.questionProgress.findUnique.mockResolvedValue(null);
  requireUser.mockReset().mockResolvedValue({ id: "student-1", role: "STUDENT" });
  redirect.mockClear();
});

describe("relinkTarget (US-21 after a regroup)", () => {
  const groups = new Map([["q1", "g-new"], ["q2", "g-other"], ["q3", "g-other"], ["q4", "g-new"]]);
  it("follows the first source question, the one the student saw", () => {
    expect(relinkTarget(["q1", "q2", "q3"], groups)).toBe("g-new");
  });
  it("falls back to the group holding most of the other source questions, a tie going to the one listed first", () => {
    expect(relinkTarget(["gone", "q2", "q4", "q3"], groups)).toBe("g-other");
    expect(relinkTarget(["gone", "q4", "q2"], groups)).toBe("g-new");
  });
  it("gives no target when none of the questions is in a group, rather than guessing", () => {
    expect(relinkTarget(["gone", "also-gone"], groups)).toBeNull();
    expect(relinkTarget([], groups)).toBeNull();
  });
});

describe("getCourseProgress (US-21)", () => {
  it("reads only the given student's marks in the given course", async () => {
    questionProgress.findMany.mockResolvedValue([mark("m1", "g1"), mark("m2", "g2", [], earlier)]);
    const progress = await getCourseProgress("student-1", "course-a");
    expect(questionProgress.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "student-1", courseId: "course-a" } }));
    expect([...progress.entries()]).toEqual([["g1", { doneAt }], ["g2", { doneAt: earlier }]]);
    expect(question.findMany).not.toHaveBeenCalled();
  });
  it("re-links an unlinked mark using only this course's published exam questions, while it is still unlinked", async () => {
    questionProgress.findMany.mockResolvedValue([mark("m1", null, ["q1", "q2"])]);
    question.findMany.mockResolvedValue([{ id: "q1", groupId: "g-new" }]);
    const progress = await getCourseProgress("student-1", "course-a");
    expect(question.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["q1", "q2"] }, groupId: { not: null }, file: { courseId: "course-a", category: "EXAM", status: "PUBLISHED" } },
    }));
    expect(questionProgress.updateMany).toHaveBeenCalledWith({ where: { id: "m1", userId: "student-1", groupId: null }, data: { groupId: "g-new" } });
    expect(progress.get("g-new")).toEqual({ doneAt });
  });
  it("removes an unlinked mark whose new group is already marked, keeping the linked one", async () => {
    questionProgress.findMany.mockResolvedValue([mark("m1", "g-new", [], earlier), mark("m2", null, ["q1"])]);
    question.findMany.mockResolvedValue([{ id: "q1", groupId: "g-new" }]);
    const progress = await getCourseProgress("student-1", "course-a");
    expect(questionProgress.deleteMany).toHaveBeenCalledWith({ where: { id: "m2", userId: "student-1", groupId: null } });
    expect(questionProgress.updateMany).not.toHaveBeenCalled();
    expect([...progress.entries()]).toEqual([["g-new", { doneAt: earlier }]]);
  });
  it("re-links only one of two unlinked marks that now point at the same group", async () => {
    questionProgress.findMany.mockResolvedValue([mark("m1", null, ["q1"], earlier), mark("m2", null, ["q2"])]);
    question.findMany.mockResolvedValue([{ id: "q1", groupId: "g" }, { id: "q2", groupId: "g" }]);
    const progress = await getCourseProgress("student-1", "course-a");
    expect(questionProgress.updateMany).toHaveBeenCalledTimes(1);
    expect(questionProgress.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "m2" }) }));
    expect(progress.get("g")).toEqual({ doneAt: earlier });
  });
  it("leaves a mark unlinked and hidden when none of its questions is in a group", async () => {
    questionProgress.findMany.mockResolvedValue([mark("m1", null, ["gone"])]);
    expect((await getCourseProgress("student-1", "course-a")).size).toBe(0);
    expect(questionProgress.updateMany).not.toHaveBeenCalled();
    expect(questionProgress.deleteMany).not.toHaveBeenCalled();
  });
  it("treats a mark another request re-linked first as a duplicate", async () => {
    questionProgress.findMany.mockResolvedValue([mark("m1", null, ["q1"])]);
    question.findMany.mockResolvedValue([{ id: "q1", groupId: "g" }]);
    questionProgress.updateMany.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const progress = await getCourseProgress("student-1", "course-a");
    expect(questionProgress.deleteMany).toHaveBeenCalledWith({ where: { id: "m1", userId: "student-1", groupId: null } });
    expect(progress.size).toBe(0);
    expect(logged()).toEqual([]);
  });
  it("still returns the linked marks when re-linking fails, and logs the failure with IDs only", async () => {
    questionProgress.findMany.mockResolvedValue([mark("m1", "g1"), mark("m2", null, ["q1"])]);
    question.findMany.mockRejectedValue(new TypeError("connection lost"));
    const progress = await getCourseProgress("student-1", "course-a");
    expect([...progress.keys()]).toEqual(["g1"]);
    expect(logged()).toEqual([expect.objectContaining({ event: "question_progress_failed", level: "error", userId: "student-1", courseId: "course-a", operation: "relink", errorType: "TypeError" })]);
  });
  it("logs a failed read and rethrows", async () => {
    questionProgress.findMany.mockRejectedValue(new TypeError("connection lost"));
    await expect(getCourseProgress("student-1", "course-a")).rejects.toThrow("connection lost");
    expect(logged()).toEqual([expect.objectContaining({ event: "question_progress_retrieval_failed", userId: "student-1", courseId: "course-a", errorType: "TypeError" })]);
  });
});

describe("markQuestion (US-21)", () => {
  it("marks a question done for the student, with its course and source questions, under a per-student lock", async () => {
    expect(await markQuestion("student-1", { groupId: "group-1", choice: "DONE" })).toEqual({ ok: true, courseId: "course-a", done: true });
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual(["question-progress:student-1"]);
    expect(tx.question.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { groupId: "group-1", file: { courseId: "course-a", category: "EXAM", status: "PUBLISHED" } },
      orderBy: [{ fileId: "asc" }, { number: "asc" }],
    }));
    expect(tx.questionProgress.create).toHaveBeenCalledWith({ data: { userId: "student-1", courseId: "course-a", groupId: "group-1", sourceQuestionIds: ["q1", "q2", "q3"] } });
  });
  it("undoes a mark", async () => {
    tx.questionProgress.findUnique.mockResolvedValue({ id: "mark-1" });
    expect(await markQuestion("student-1", { groupId: "group-1", choice: "UNDO" })).toEqual({ ok: true, courseId: "course-a", done: false });
    expect(tx.questionProgress.delete).toHaveBeenCalledWith({ where: { id: "mark-1" } });
    expect(tx.questionProgress.create).not.toHaveBeenCalled();
  });
  it("changes nothing when a done question is marked again, or a question that is not done is undone", async () => {
    tx.questionProgress.findUnique.mockResolvedValue({ id: "mark-1" });
    expect(await markQuestion("student-1", { groupId: "group-1", choice: "DONE" })).toMatchObject({ ok: true, done: true });
    tx.questionProgress.findUnique.mockResolvedValue(null);
    expect(await markQuestion("student-1", { groupId: "group-1", choice: "UNDO" })).toMatchObject({ ok: true, done: false });
    expect(tx.questionProgress.create).not.toHaveBeenCalled();
    expect(tx.questionProgress.delete).not.toHaveBeenCalled();
    expect(logged()).toEqual([]);
  });
  it("re-links the student's unlinked marks first, so an undo also clears an old mark of the question", async () => {
    tx.questionProgress.findMany.mockResolvedValue([{ id: "old", groupId: null, sourceQuestionIds: ["q1"] }, { id: "other", groupId: "group-2", sourceQuestionIds: [] }]);
    tx.question.findMany.mockResolvedValueOnce(sources).mockResolvedValueOnce([{ id: "q1", groupId: "group-1" }]);
    tx.questionProgress.updateMany.mockResolvedValue({ count: 1 });
    tx.questionProgress.findUnique.mockResolvedValue({ id: "old" });
    await markQuestion("student-1", { groupId: "group-1", choice: "UNDO" });
    expect(tx.questionProgress.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "student-1", courseId: "course-a" } }));
    expect(tx.questionProgress.updateMany).toHaveBeenCalledWith({ where: { id: "old", userId: "student-1", groupId: null }, data: { groupId: "group-1" } });
    expect(tx.questionProgress.delete).toHaveBeenCalledWith({ where: { id: "old" } });
  });
  it("refuses an unknown choice, an unknown group, and a question with no published exam paper", async () => {
    for (const choice of ["GOT_IT", "STRUGGLED", "done", ""]) {
      expect(await markQuestion("student-1", { groupId: "group-1", choice })).toEqual({ ok: false, error: "invalid_choice" });
    }
    expect(await markQuestion("student-1", { groupId: " ", choice: "DONE" })).toEqual({ ok: false, error: "not_found" });
    tx.questionGroup.findUnique.mockResolvedValueOnce(null);
    expect(await markQuestion("student-1", { groupId: "group-x", choice: "DONE" })).toEqual({ ok: false, error: "not_found" });
    tx.question.findMany.mockResolvedValueOnce([]);
    expect(await markQuestion("student-1", { groupId: "group-1", choice: "DONE" })).toEqual({ ok: false, error: "not_found" });
    expect(tx.questionProgress.create).not.toHaveBeenCalled();
    expect(logged().map(line => [line.event, line.reason])).toEqual([
      ...Array(4).fill(["question_progress_refused", "invalid_choice"]),
      ["question_progress_refused", "not_found"], ["question_progress_refused", "not_found"], ["question_progress_refused", "not_found"],
    ]);
  });
  it("limits marks per student per minute without touching the database, and not for other students", async () => {
    for (let i = 0; i < progressLimit(); i++) await markQuestion("student-1", { groupId: "group-1", choice: "DONE" });
    transaction.mockClear();
    expect(await markQuestion("student-1", { groupId: "group-1", choice: "DONE" })).toEqual({ ok: false, error: "rate_limited" });
    expect(transaction).not.toHaveBeenCalled();
    expect(logged().at(-1)).toMatchObject({ event: "question_progress_rate_limited", level: "warn", userId: "student-1" });
    expect(await markQuestion("student-2", { groupId: "group-1", choice: "DONE" })).toMatchObject({ ok: true });
  });
  it("logs a saved mark with IDs and the operation only", async () => {
    await markQuestion("student-1", { groupId: "group-1", choice: "DONE" });
    expect(logged()).toEqual([{ event: "question_progress_saved", level: "info", timestamp: expect.any(String), userId: "student-1", courseId: "course-a", groupId: "group-1", operation: "mark" }]);
  });
  it("logs a failure with its error type and saves nothing", async () => {
    transaction.mockRejectedValue(new TypeError("connection lost"));
    expect(await markQuestion("student-1", { groupId: "group-1", choice: "DONE" })).toEqual({ ok: false, error: "unexpected" });
    expect(logged()).toEqual([expect.objectContaining({ event: "question_progress_failed", level: "error", userId: "student-1", groupId: "group-1", operation: "mark", errorType: "TypeError" })]);
  });
});

describe("markQuestionAction (US-21)", () => {
  it("asks for a login first, coming back to the course's exam", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /login"));
    await expect(markQuestionAction(form({ courseId: "course-a", groupId: "group-1", choice: "DONE" }))).rejects.toThrow("NEXT_REDIRECT /login");
    expect(requireUser).toHaveBeenCalledWith("/courses/course-a/exam");
    expect(transaction).not.toHaveBeenCalled();
  });
  it("saves the mark for the session's student only, ignoring a user ID in the form", async () => {
    const location = await redirectedTo(markQuestionAction(form({ courseId: "course-a", groupId: "group-1", choice: "DONE", position: "3", userId: "student-9" })));
    expect(location).toBe("/courses/course-a/exam?at=3#question-3");
    expect(tx.questionProgress.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "student-1" }) });
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual(["question-progress:student-1"]);
  });
  it("comes back to the personal order (US-28) when the mark was made there, and ignores any other order value", async () => {
    expect(await redirectedTo(markQuestionAction(form({ courseId: "course-a", groupId: "group-1", choice: "DONE", position: "4", order: "personal" }))))
      .toBe("/courses/course-a/exam?order=personal&at=4#question-4");
    expect(await redirectedTo(markQuestionAction(form({ courseId: "course-a", groupId: "group-1", choice: "MAYBE", position: "4", order: "personal" }))))
      .toBe("/courses/course-a/exam?order=personal&progress_error=invalid_choice#question-4");
    expect(await redirectedTo(markQuestionAction(form({ courseId: "course-a", groupId: "group-1", choice: "DONE", position: "4", order: "evil" }))))
      .toBe("/courses/course-a/exam?at=4#question-4");
  });
  it("returns to the question with the reason when refused, and drops an invalid position", async () => {
    expect(await redirectedTo(markQuestionAction(form({ courseId: "course-a", groupId: "group-1", choice: "MAYBE", position: "2" }))))
      .toBe("/courses/course-a/exam?progress_error=invalid_choice#question-2");
    expect(await redirectedTo(markQuestionAction(form({ courseId: "course-a", groupId: "group-1", choice: "DONE", position: "-1" }))))
      .toBe("/courses/course-a/exam");
  });
  it("shows a known message for every refusal and never echoes an unknown value", () => {
    for (const error of ["invalid_choice", "not_found", "rate_limited", "unexpected"]) expect(progressMessage(error)).toMatch(/\.$/);
    expect(progressMessage("<script>alert(1)</script>")).toBe(progressMessage("unexpected"));
  });
});
