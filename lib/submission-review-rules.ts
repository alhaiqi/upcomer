import { MAX_REJECTION_REASON_LENGTH, type ReviewError } from "@/lib/submissions";

// Messages for the admin review page (US-74), shared by the actions and the page.

export type ReviewRefusal = ReviewError | "rate_limited";

const MESSAGES: Record<ReviewRefusal, string> = {
  not_found: "That submission doesn't exist anymore.",
  not_pending: "That submission was already reviewed.",
  reason_required: "Enter a reason so the student knows why it was rejected.",
  reason_too_long: `Keep the reason to ${MAX_REJECTION_REASON_LENGTH} characters or fewer.`,
  rate_limited: "Too many reviews in a minute. Wait a moment and try again.",
};

// Any other value (for example one typed into the URL) gets the general message, never the value itself.
export const reviewMessage = (error: string) => (Object.hasOwn(MESSAGES, error) ? MESSAGES[error as ReviewRefusal] : "Something went wrong. Please try again.");
