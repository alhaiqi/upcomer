// US-25: the same evidence rule is used after practice and after a confidence change.
export const PRIOR_OBSERVATIONS = 2;
export function evidenceWeakness(baseline: number, correct: number, incorrect: number) {
  return (PRIOR_OBSERVATIONS * baseline + incorrect) / (PRIOR_OBSERVATIONS + correct + incorrect);
}

export const learningSources = ["QUESTION_BANK", "MOCK_EXAM", "FLASHCARD", "AI_INTERACTION"] as const;
export type LearningSource = typeof learningSources[number];
// Trusted server producers supply stable event IDs. Browser callers may submit question-bank outcomes only.
export type LearningEventInput = {
  eventId: string;
  source: LearningSource;
  questionId?: string;
  generatedQuestionId?: string;
  // Future E5 producers need an explicit topic; current question/mock producers derive it from stored sources.
  topic?: string;
  correct: boolean;
};
export type PracticeError = "invalid_outcome" | "not_found" | "topic_required" | "duplicate_conflict" | "rate_limited" | "unexpected";
const messages: Record<PracticeError, string> = {
  invalid_outcome: "Choose correct or incorrect for a valid practice attempt.",
  not_found: "That practice question is no longer available in this course. Reload and try again.",
  topic_required: "This question has no topic yet. An admin must tag its source paper before it can update your profile.",
  duplicate_conflict: "This attempt already has a different outcome. Start a new practice attempt.",
  rate_limited: "Too many practice updates. Wait a minute and try again.",
  unexpected: "Your practice outcome could not be saved. Please try again.",
};
export const practiceMessage = (reason: string) => messages[reason as PracticeError] ?? messages.unexpected;
