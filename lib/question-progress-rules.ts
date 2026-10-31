// Choices and messages for marking questions done (US-21), shared by the service, the action, and the exam page.

// What a student can send for one question: mark it done, or undo the mark.
export type ProgressChoice = "DONE" | "UNDO";

export const isProgressChoice = (value: string): value is ProgressChoice => value === "DONE" || value === "UNDO";

export type ProgressRefusal = "invalid_choice" | "not_found" | "rate_limited" | "unexpected";

const MESSAGES: Record<ProgressRefusal, string> = {
  invalid_choice: "Choose whether to mark the question done or undo it.",
  not_found: "That question isn't on this exam anymore. Reload the page and try again.",
  rate_limited: "Too many changes in a minute. Wait a moment and try again.",
  unexpected: "Your progress could not be saved. Please try again.",
};

// Any other value (for example one typed into the URL) gets the general message, never the value itself.
export const progressMessage = (error: string) => (Object.hasOwn(MESSAGES, error) ? MESSAGES[error as ProgressRefusal] : MESSAGES.unexpected);
