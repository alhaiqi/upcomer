import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/logger", () => ({ logError: mocks.log }));
import { recordLearningEvents, recordMockOutcomes } from "@/lib/learning-evidence";
import { isLearningEvent } from "@/lib/learning-evidence-rules";

beforeEach(() => vi.clearAllMocks());
const event = { source: "QUESTION_BANK", eventId: "attempt", questionId: "question", correct: true };
it.each([
  null, {}, [], [null], [{ ...event, eventId: 42 }], [{ ...event, questionId: "" }],
  [{ ...event, correct: "true" }], [{ ...event, source: "OTHER" }],
  [{ ...event, source: "FLASHCARD", generatedQuestionId: "also-a-target", topic: "TCP" }],
  [{ source: "AI_INTERACTION", eventId: "future", correct: true, topic: "  " }],
])("refuses malformed event batches before opening a transaction: %j", async value => {
  expect(await recordLearningEvents("student", "course", value as Parameters<typeof recordLearningEvents>[2])).toEqual({ ok: false, error: "invalid_outcome" });
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.log).toHaveBeenCalledWith("learning_evidence_refused", { userId: "student", courseId: "course", reason: "invalid_outcome" });
});
it("checks producer shapes without allowing ambiguous targets", () => {
  expect(isLearningEvent(event)).toBe(true);
  expect(isLearningEvent({ ...event, source: "MOCK_EXAM" })).toBe(true);
  expect(isLearningEvent({ eventId: "future", source: "FLASHCARD", correct: false, topic: "TCP" })).toBe(true);
  expect(isLearningEvent({ ...event, generatedQuestionId: "another" })).toBe(false);
});
it("rejects missing/empty mock producer identifiers before database work", async () => {
  for (const attempt of ["", null, 12]) expect(await recordMockOutcomes("student", "course", attempt as string, [{ itemId: "one", generatedQuestionId: "g", correct: true }])).toEqual({ ok: false, error: "invalid_outcome" });
  expect(await recordMockOutcomes("student", "course", "attempt", [null] as unknown as Parameters<typeof recordMockOutcomes>[3])).toEqual({ ok: false, error: "invalid_outcome" });
  expect(mocks.transaction).not.toHaveBeenCalled();
});
