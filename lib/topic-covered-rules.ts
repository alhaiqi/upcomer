// US-32: the form that marks one topic of a course as already covered, or undoes it. Shared by the service, the action,
// and the page. Nothing here reads the database. Covered only leaves a topic out of the "Study next" recommendation; it
// is not evidence and says nothing about mastery.

// The form's fields: the topic's key, and "1" (covered) or "0" (not covered). The form states the wanted result instead
// of toggling, so a double submit or a stale page gives the same result.
export const TOPIC_FIELD = "topicKey";
export const COVERED_FIELD = "covered";
export const COVERED = "1";
export const NOT_COVERED = "0";

export type CoveredRefusal = "unknown_topic" | "invalid_value" | "rate_limited" | "unexpected";
export type ParsedCovered = { ok: true; topicKey: string; covered: boolean } | { ok: false; error: "unknown_topic" | "invalid_value" };

// Reads the form. Each field must be there exactly once, as text; the topic must be a topic of this course (so a topic
// of another course is refused too) and the value "1" or "0". Otherwise the form is refused and nothing is saved. Other
// fields (courseId, Next.js's own) are ignored.
export function parseCovered(entries: Iterable<[string, FormDataEntryValue]>, courseTopicKeys: ReadonlySet<string>): ParsedCovered {
  const topics: FormDataEntryValue[] = [];
  const values: FormDataEntryValue[] = [];
  for (const [name, value] of entries) {
    if (name === TOPIC_FIELD) topics.push(value);
    else if (name === COVERED_FIELD) values.push(value);
  }
  const [topicKey] = topics;
  const [value] = values;
  if (topics.length !== 1 || values.length !== 1 || typeof topicKey !== "string" || typeof value !== "string") return { ok: false, error: "invalid_value" };
  if (!courseTopicKeys.has(topicKey)) return { ok: false, error: "unknown_topic" };
  if (value !== COVERED && value !== NOT_COVERED) return { ok: false, error: "invalid_value" };
  return { ok: true, topicKey, covered: value === COVERED };
}

const MESSAGES: Record<CoveredRefusal, string> = {
  unknown_topic: "That topic isn't part of this course. Reload the page and try again.",
  invalid_value: "That change could not be read. Reload the page and try again.",
  rate_limited: "Too many changes in a minute. Wait a moment and try again.",
  unexpected: "Your change could not be saved. Please try again.",
};

// Any other value (for example one typed into the URL) gets the general message, never the value itself.
export const coveredMessage = (error: string) => (Object.hasOwn(MESSAGES, error) ? MESSAGES[error as CoveredRefusal] : MESSAGES.unexpected);

// The notice after a save, from the page's `covered` query parameter; null for any other value.
export const savedMessage = (covered: string | undefined) =>
  covered === COVERED ? "Marked as covered. It is left out of Study next." : covered === NOT_COVERED ? "No longer marked as covered." : null;
