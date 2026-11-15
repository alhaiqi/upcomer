// Mock exam rules shared by the server, the actions, and the browser form (US-45), including the pure question selection.
// No database access here, so the same pool and settings always give the same exam.

export const MOCK_EXAM_MIN_LENGTH = 3;
export const MOCK_EXAM_MAX_LENGTH = 50;
export const MOCK_EXAM_DEFAULT_LENGTH = 10;
export const MOCK_ANSWER_MAX_LENGTH = 5000;
// An answer as it is stored and measured: browsers post line breaks as "\r\n", which count once, and outer space is dropped.
export const cleanAnswer = (value: string) => value.replace(/\r\n?/g, "\n").trim();

export const MOCK_EXAM_DIFFICULTIES = ["EASY", "MEDIUM", "HARD", "MIXED"] as const;
export type MockExamDifficultyName = (typeof MOCK_EXAM_DIFFICULTIES)[number];
export const isDifficultyName = (value: string): value is MockExamDifficultyName => (MOCK_EXAM_DIFFICULTIES as readonly string[]).includes(value);
export const DIFFICULTY_LABELS: Record<MockExamDifficultyName, string> = { EASY: "Easier", MEDIUM: "Medium", HARD: "Harder", MIXED: "Mixed" };
// Past papers carry no difficulty rating, so difficulty is an estimate. Say so wherever it is chosen.
export const DIFFICULTY_HELP = "Difficulty is estimated from each question's length and number of parts, because past papers carry no difficulty rating.";

export type MockExamError =
  | "course_not_found" | "no_questions" | "topic_invalid" | "length_invalid" | "difficulty_invalid" | "not_enough_questions" | "rate_limited" | "unexpected";
export type SittingError = "not_found" | "already_submitted" | "answer_too_long" | "unexpected";

export function mockExamMessage(error: string, available?: number) {
  switch (error) {
    case "course_not_found": return "That course doesn't exist anymore.";
    case "no_questions": return "This course has no questions yet, so a mock exam can't be made.";
    case "topic_invalid": return "One of the topics you picked isn't a topic of this course. Choose again.";
    case "length_invalid": return `Choose between ${MOCK_EXAM_MIN_LENGTH} and ${MOCK_EXAM_MAX_LENGTH} questions.`;
    case "difficulty_invalid": return "Choose a difficulty from the list.";
    case "not_enough_questions":
      return available === undefined ? "There are not enough questions for that exam. Choose a shorter exam or more topics."
        : available < MOCK_EXAM_MIN_LENGTH ? `Only ${available} ${available === 1 ? "question matches" : "questions match"} your topics. Choose more topics.`
        : `Only ${available} questions match your topics. Choose a shorter exam (${MOCK_EXAM_MIN_LENGTH} to ${available}) or more topics.`;
    case "rate_limited": return "You have generated a lot of mock exams in a short time. Wait a while and try again.";
    default: return "Your mock exam could not be made. Please try again.";
  }
}

export function sittingMessage(error: string) {
  switch (error) {
    case "not_found": return "That mock exam doesn't exist.";
    case "already_submitted": return "This exam was already submitted, so its answers can't change.";
    case "answer_too_long": return `Keep each answer to ${MOCK_ANSWER_MAX_LENGTH} characters or fewer.`;
    default: return "Your answers could not be saved. Please try again.";
  }
}

export type MockExamOptions = { total: number; topics: { key: string; label: string; count: number }[] };
export type MockExamFormValues = { length: string; difficulty: string; topics: string[] };

// One question the exam can be drawn from: a question of the course's consolidated exam with its topic.
export type PoolQuestion = {
  // The question-bank group ID.
  id: string;
  // Place in the Upcomer Exam's frequency order, from 1.
  position: number;
  text: string;
  paperCount: number;
  totalPapers: number;
  topicKey: string | null;
  topic: string | null;
  papers: { title: string; year: number | null }[];
};

export type MockConfig = { topicKeys: string[]; length: number; difficulty: MockExamDifficultyName };

const normalizeTopicKey = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

// Checks the settings as typed in the form. Topic keys are only normalized here; whether they exist is checked against the
// course's questions by selectMockQuestions.
export function parseMockExamConfig(input: { length: string; difficulty: string; topics: string[] }):
  { ok: true; config: MockConfig } | { ok: false; error: "length_invalid" | "difficulty_invalid" } {
  const raw = input.length.trim();
  const length = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(length) || length < MOCK_EXAM_MIN_LENGTH || length > MOCK_EXAM_MAX_LENGTH) return { ok: false, error: "length_invalid" };
  const difficulty = input.difficulty.trim().toUpperCase();
  if (!isDifficultyName(difficulty)) return { ok: false, error: "difficulty_invalid" };
  const topicKeys = [...new Set(input.topics.slice(0, 200).map(normalizeTopicKey).filter(Boolean))];
  return { ok: true, config: { topicKeys, length, difficulty } };
}

// The estimated complexity of a question: its length, plus a fixed amount for every sub-part after the first.
export function complexityOf(text: string) {
  const parts = text.split("\n").filter(line => line.trim()).length || 1;
  return text.length + 80 * (parts - 1);
}

export type Selection =
  | { ok: true; questions: PoolQuestion[] }
  | { ok: false; error: "topic_invalid" | "not_enough_questions"; available: number };

// Picks exactly `length` questions of the chosen topics (every topic when none is chosen), by difficulty:
// the questions are sorted by complexity (ties: more frequent first, then the Upcomer Exam's order, then ID), and
// EASY takes the first `length`, HARD the last `length`, MEDIUM the middle `length`, and MIXED `length` questions spread
// evenly over the whole range. The picks come back in the Upcomer Exam's order, so the exam reads like it. Pure: the same
// pool and settings always give the same questions, whatever order the pool is in.
// Weakness-aware picking (US-47) and generated questions (US-44) are meant to plug in here.
export function selectMockQuestions(pool: PoolQuestion[], { topicKeys, length, difficulty }: MockConfig): Selection {
  const known = new Set(pool.flatMap(question => (question.topicKey ? [question.topicKey] : [])));
  if (topicKeys.some(key => !known.has(key))) return { ok: false, error: "topic_invalid", available: 0 };
  const chosen = new Set(topicKeys);
  const eligible = chosen.size ? pool.filter(question => question.topicKey !== null && chosen.has(question.topicKey)) : pool;
  if (eligible.length < length) return { ok: false, error: "not_enough_questions", available: eligible.length };
  const ranked = eligible.map(question => ({ question, complexity: complexityOf(question.text) })).sort((a, b) =>
    a.complexity - b.complexity || b.question.paperCount - a.question.paperCount || a.question.position - b.question.position
    || (a.question.id < b.question.id ? -1 : a.question.id > b.question.id ? 1 : 0));
  const count = ranked.length;
  const window = (start: number) => Array.from({ length }, (_, index) => start + index);
  const indexes = difficulty === "EASY" ? window(0)
    : difficulty === "HARD" ? window(count - length)
    : difficulty === "MEDIUM" ? window(Math.floor((count - length) / 2))
    : length === 1 ? [Math.floor((count - 1) / 2)]
    : Array.from({ length }, (_, index) => Math.round((index * (count - 1)) / (length - 1)));
  return { ok: true, questions: indexes.map(index => ranked[index].question).sort((a, b) => a.position - b.position) };
}
