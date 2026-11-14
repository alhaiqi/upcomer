// Advice rules shared by the server, the actions, and the browser form (US-34, US-35, US-37); no database access here.

export const ADVICE_TITLE_MAX_LENGTH = 120;
export const ADVICE_BODY_MAX_LENGTH = 2000;
export const ADVICE_LINK_MAX_LENGTH = 2000;
export const ADVICE_LINK_TITLE_MAX_LENGTH = 100;
export const ADVICE_QUERY_MAX_LENGTH = 100;

// Shown wherever the author of an anonymous post would be named (US-37).
export const ANONYMOUS_AUTHOR_LABEL = "Anonymous student";
export const FORMER_STUDENT_LABEL = "Former student";

export const ADVICE_SCOPE_KINDS = ["COURSE", "EXAM", "SESSION", "TOPIC", "QUESTION"] as const;
export type AdviceScopeName = (typeof ADVICE_SCOPE_KINDS)[number];
export const isScopeName = (value: string): value is AdviceScopeName => (ADVICE_SCOPE_KINDS as readonly string[]).includes(value);

export const SCOPE_LABELS: Record<AdviceScopeName, string> = {
  COURSE: "The whole course", EXAM: "An exam paper", SESSION: "A session (term)", TOPIC: "A topic", QUESTION: "A question",
};

export type AdviceError =
  | "course_not_found" | "scope_invalid" | "title_required" | "title_too_long" | "body_required" | "body_too_long"
  | "link_invalid" | "link_title_too_long" | "rate_limited" | "unexpected";

const MESSAGES: Record<AdviceError, string> = {
  course_not_found: "That course doesn't exist anymore.",
  scope_invalid: "The exam, session, topic, or question you picked doesn't belong to this course. Choose it again.",
  title_required: "Enter a title for your advice.",
  title_too_long: `Keep the title to ${ADVICE_TITLE_MAX_LENGTH} characters or fewer.`,
  body_required: "Write your advice.",
  body_too_long: `Keep your advice to ${ADVICE_BODY_MAX_LENGTH} characters or fewer.`,
  link_invalid: "Enter a full link that starts with https:// (other kinds of links are not allowed).",
  link_title_too_long: `Keep the link's name to ${ADVICE_LINK_TITLE_MAX_LENGTH} characters or fewer.`,
  rate_limited: "You have published a lot of advice in a short time. Wait a while and try again.",
  unexpected: "Your advice could not be published. Please try again.",
};

// Any other value (for example one typed into the URL) gets the general message, never the value itself.
export const adviceMessage = (error: string) => (Object.hasOwn(MESSAGES, error) ? MESSAGES[error as AdviceError] : MESSAGES.unexpected);

export const collapseSpaces = (value: string) => value.replace(/\s+/g, " ").trim();
// Same idea as LearningTopic.topicKey: trimmed, spacing collapsed, lower case.
export const topicKeyOf = (value: string) => collapseSpaces(value).toLowerCase();
// Line endings differ between browsers, so text is stored with "\n" only.
export const cleanAdviceBody = (value: string) => value.replace(/\r\n?/g, "\n").trim();

export type ResourceLink = { ok: true; url: string | null } | { ok: false };

// US-35: only an https:// link with a real host is accepted. javascript:, data:, http:, ftp:, file:, links with a
// username or password, and links with spaces are all refused. An empty value means "no link". Returns the normalized link.
export function parseResourceLink(raw: string): ResourceLink {
  const value = raw.trim();
  if (!value) return { ok: true, url: null };
  if (value.length > ADVICE_LINK_MAX_LENGTH || /[\s\u0000-\u001f\u007f]/.test(value) || !/^https:\/\//i.test(value)) return { ok: false };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return { ok: false };
  return url.href.length <= ADVICE_LINK_MAX_LENGTH ? { ok: true, url: url.href } : { ok: false };
}

export type AdviceFormValues = {
  scopeKind: string; scopeValue: string; title: string; body: string; resourceUrl: string; resourceTitle: string; isAnonymous: boolean;
};
