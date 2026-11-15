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

// Shown on a new exam when the difficulty could not choose between the questions.
export const SAME_QUESTIONS_NOTE = "Your topics have just enough past-paper questions for this exam, so the difficulty could not choose between them. Any difficulty gives these questions.";

export function sittingMessage(error: string) {
  switch (error) {
    case "not_found": return "That mock exam doesn't exist.";
    case "already_submitted": return "This exam was already submitted, so its answers can't change.";
    case "answer_too_long": return `Keep each answer to ${MOCK_ANSWER_MAX_LENGTH} characters or fewer.`;
    default: return "Your answers could not be saved. Please try again.";
  }
}

// `generated` is how many of the student's generated practice questions (US-44) an exam could use; 0 for a visitor.
export type MockExamOptions = { total: number; topics: { key: string; label: string; count: number }[]; generated: number };
export type MockExamFormValues = { length: string; difficulty: string; topics: string[]; includeGenerated: boolean };

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
  // The question's papers in the question bank's order (newest year, then title, then ID).
  papers: { id?: string; title: string; year: number | null }[];
};

// One of the student's generated practice questions (US-44) an exam can include. The service reads them only through
// getGeneratedPracticeQuestions, so every one is the student's own and still matches a published source.
export type GeneratedCandidate = {
  // The generated item's ID.
  id: string;
  topicKey: string;
  topic: string;
  // The difficulty the item was generated at; it has no MIXED.
  difficulty: Exclude<MockExamDifficultyName, "MIXED">;
  // The task, shown as the question.
  text: string;
  // The title of the past paper the task is based on.
  sourcePaper: string;
};

// `includeGenerated` is off unless the student ticks it, so an exam is past-paper questions only by default.
export type MockConfig = { topicKeys: string[]; length: number; difficulty: MockExamDifficultyName; includeGenerated?: boolean };

// At most this share of an exam comes from generated questions: half, rounded down.
export const generatedShare = (length: number) => Math.floor(length / 2);

const normalizeTopicKey = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

// Checks the settings as typed in the form. Topic keys are only normalized here; whether they exist is checked against the
// course's questions by selectMockQuestions.
export function parseMockExamConfig(input: { length: string; difficulty: string; topics: string[]; includeGenerated?: boolean }):
  { ok: true; config: MockConfig } | { ok: false; error: "length_invalid" | "difficulty_invalid" } {
  const raw = input.length.trim();
  const length = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(length) || length < MOCK_EXAM_MIN_LENGTH || length > MOCK_EXAM_MAX_LENGTH) return { ok: false, error: "length_invalid" };
  const difficulty = input.difficulty.trim().toUpperCase();
  if (!isDifficultyName(difficulty)) return { ok: false, error: "difficulty_invalid" };
  const topicKeys = [...new Set(input.topics.slice(0, 200).map(normalizeTopicKey).filter(Boolean))];
  return { ok: true, config: { topicKeys, length, difficulty, includeGenerated: input.includeGenerated === true } };
}

// The source question that stands for a question-bank group in a mock exam, for US-49's learning events. A fixed rule, so
// the same exam always records the same question: the group's question in the first of its papers, lowest number first,
// then ID. `papers` is the group's papers in the question bank's order (papersOf in lib/question-bank.ts: newest year,
// then title, then ID), which is the order recordLearningEvents (US-25) uses to attribute the topic. Papers without one
// of the given questions are skipped; null when no question is left.
export function sourceQuestionOf(papers: Array<{ id: string }>, questions: Array<{ id: string; number: number; fileId: string }>): string | null {
  for (const paper of papers) {
    const own = questions.filter(question => question.fileId === paper.id).sort((a, b) => a.number - b.number || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (own.length) return own[0].id;
  }
  return null;
}

// The estimated complexity of a question: its length, plus a fixed amount for every sub-part after the first.
export function complexityOf(text: string) {
  const parts = text.split("\n").filter(line => line.trim()).length || 1;
  return text.length + 80 * (parts - 1);
}

export type Selection =
  // `questions` are the past-paper picks in the Upcomer Exam's order; `generated` follow them in the exam. `narrowed` is
  // false when every matching past-paper question was needed, so the difficulty could not choose between them.
  | { ok: true; questions: PoolQuestion[]; generated: GeneratedCandidate[]; narrowed: boolean }
  | { ok: false; error: "topic_invalid" | "not_enough_questions"; available: number };

export type SelectOptions = {
  // The student's generated practice questions, newest first (US-44). Used only when the settings ask for them.
  generated?: GeneratedCandidate[];
  // IDs (question-bank groups or generated items) to leave out, for an alternative version of an exam (US-46).
  exclude?: ReadonlySet<string>;
  // Reserved for US-47 (weighting by weakness and importance, by topic key). Not read yet.
  weights?: ReadonlyMap<string, number>;
};

// Picks exactly `length` questions of the chosen topics (every topic when none is chosen), by difficulty:
// the questions are sorted by complexity (ties: more frequent first, then the Upcomer Exam's order, then ID), and
// EASY takes the first, HARD the last, MEDIUM the middle, and MIXED questions spread evenly over the whole range. The
// picks come back in the Upcomer Exam's order, so the exam reads like it. Pure: the same pool and settings always give
// the same questions, whatever order the pool is in.
//
// Generated questions (US-44) are included only when the settings say so. Then up to half of the exam (generatedShare)
// comes from `options.generated`: those of the chosen topics, generated at the chosen difficulty (any, for MIXED), in the
// order given. The rest are past-paper questions picked by the rule above. With fewer generated questions than the share,
// past papers fill the rest, so the exam always has exactly `length` questions.
export function selectMockQuestions(pool: PoolQuestion[], { topicKeys, length: total, difficulty, includeGenerated }: MockConfig, options: SelectOptions = {}): Selection {
  const known = new Set(pool.flatMap(question => (question.topicKey ? [question.topicKey] : [])));
  if (topicKeys.some(key => !known.has(key))) return { ok: false, error: "topic_invalid", available: 0 };
  const chosen = new Set(topicKeys);
  const left = (id: string) => !options.exclude?.has(id);
  const eligible = (chosen.size ? pool.filter(question => question.topicKey !== null && chosen.has(question.topicKey)) : pool).filter(question => left(question.id));
  const candidates = !includeGenerated ? [] : (options.generated ?? []).filter(item =>
    left(item.id) && (!chosen.size || chosen.has(item.topicKey)) && (difficulty === "MIXED" || item.difficulty === difficulty));
  const generated = candidates.slice(0, generatedShare(total));
  const length = total - generated.length;
  // The longest exam these questions can make: every past-paper question, and as many generated ones again at most.
  if (eligible.length < length) return { ok: false, error: "not_enough_questions", available: eligible.length + Math.min(candidates.length, eligible.length) };
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
  return { ok: true, questions: indexes.map(index => ranked[index].question).sort((a, b) => a.position - b.position), generated, narrowed: count > length };
}
