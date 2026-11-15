import { isWeakness, type LearningProfile, type ProfileTopic } from "@/lib/learning-profile";

// US-26: which of a course's topics are a student's strongest and weakest, and what that rests on. Pure: nothing here
// reads the database, and the same profile always gives the same result. The stored weakness (0 strong .. 1 weak, US-25)
// is read as it is, never recomputed.

// Fewer topics with evidence than this cannot be compared.
export const MIN_TOPICS_TO_COMPARE = 2;
// At most this many topics in each list.
export const MAX_LISTED = 3;
// Two weaknesses this close are equal (the same idea as PRIORITY_TIE in personal-order.ts).
export const WEAKNESS_TIE = 1e-9;

// A course topic: its name as the course's newest paper writes it, and how many published exam papers carry it.
export type CourseTopicCount = { topic: string; paperCount: number };
export type RankedTopic = {
  topicKey: string; topic: string; weakness: number; confidence: number | null; correctCount: number; incorrectCount: number;
  paperCount: number; evidence: string;
};
// ok: there is something to show. level: enough topics, but none differs from the others. The rest are insufficient data.
export type StrengthState = "ok" | "level" | "no_topics" | "no_profile" | "no_evidence" | "too_few";
export type TopicStrengths = {
  state: StrengthState;
  // Every topic with evidence, weakest first. US-30 and US-32 build on this list.
  ranked: RankedTopic[];
  // Strongest first; empty unless the state is "ok". No topic here ties a topic in `weakest`.
  strongest: RankedTopic[];
  // Weakest first; empty unless the state is "ok".
  weakest: RankedTopic[];
  // Profile rows left out because their stored weakness is not a number from 0 to 1.
  invalidRows: number;
};

type Evidence = Pick<ProfileTopic, "confidence" | "correctCount" | "incorrectCount">;
const outcomes = (row: Evidence) => (row.correctCount ?? 0) + (row.incorrectCount ?? 0);

// Real evidence: a saved confidence rating, or at least one recorded practice outcome. A topic that was skipped and never
// practised has neither, so it is never called a strength or a weakness.
export const hasEvidence = (row: Evidence) => row.confidence != null || outcomes(row) > 0;

// What a topic's result rests on, for example "Rated 2 of 5, 3 correct and 1 incorrect". It states the inputs only.
export function describeEvidence(row: Evidence): string {
  const rating = row.confidence != null ? `Rated ${row.confidence} of 5` : "Not rated";
  const practice = outcomes(row) > 0 ? `${row.correctCount ?? 0} correct and ${row.incorrectCount ?? 0} incorrect` : "no practice recorded";
  return `${rating}, ${practice}`;
}

// The topics weakest first, each with its tie group. Topics whose weakness is within WEAKNESS_TIE of their group's first
// are tied; inside a group the topic in more exam papers comes first, then the topic name. Sorting by the exact weakness
// before grouping keeps the result independent of the order the rows arrive in.
function rank(topics: RankedTopic[]): Array<{ topic: RankedTopic; group: number }> {
  const sorted = [...topics].sort((a, b) => b.weakness - a.weakness || (a.topicKey < b.topicKey ? -1 : a.topicKey > b.topicKey ? 1 : 0));
  const groups: RankedTopic[][] = [];
  for (const topic of sorted) {
    const last = groups.at(-1);
    if (last && last[0].weakness - topic.weakness <= WEAKNESS_TIE) last.push(topic);
    else groups.push([topic]);
  }
  return groups.flatMap((members, group) => members
    .sort((a, b) => b.paperCount - a.paperCount || (a.topicKey < b.topicKey ? -1 : a.topicKey > b.topicKey ? 1 : 0))
    .map(topic => ({ topic, group })));
}

// The student's strongest and weakest topics in one course. `profile` is that course's profile (getLearningProfile) and
// `courseTopics` the course's published exam-paper topics by topic key; a profile row for any other topic is ignored.
export function selectStrengths(profile: LearningProfile, courseTopics: ReadonlyMap<string, CourseTopicCount>): TopicStrengths {
  const none = (state: StrengthState, ranked: RankedTopic[] = [], invalidRows = 0): TopicStrengths => ({ state, ranked, strongest: [], weakest: [], invalidRows });
  if (!courseTopics.size) return none("no_topics");
  const rows = [...profile.values()].filter(row => courseTopics.has(row.topicKey));
  if (!rows.length) return none("no_profile");
  const valid = rows.filter(row => isWeakness(row.weakness));
  const invalidRows = rows.length - valid.length;
  const ranked = rank(valid.filter(hasEvidence).map(row => {
    const course = courseTopics.get(row.topicKey)!;
    return {
      topicKey: row.topicKey, topic: course.topic, weakness: row.weakness, confidence: row.confidence ?? null,
      correctCount: row.correctCount ?? 0, incorrectCount: row.incorrectCount ?? 0, paperCount: course.paperCount, evidence: describeEvidence(row),
    };
  }));
  const topics = ranked.map(item => item.topic);
  if (!ranked.length) return none("no_evidence", [], invalidRows);
  if (ranked.length < MIN_TOPICS_TO_COMPARE) return none("too_few", topics, invalidRows);
  if (ranked.at(-1)!.group === 0) return none("level", topics, invalidRows);
  const size = Math.min(MAX_LISTED, Math.floor(ranked.length / 2));
  let weakest = ranked.slice(0, size);
  let strongest = ranked.slice(-size);
  // A tie is never split between the lists: when it reaches across the boundary, its topics are in neither.
  const boundary = weakest.at(-1)!.group;
  if (boundary === strongest[0].group) {
    weakest = weakest.filter(item => item.group !== boundary);
    strongest = strongest.filter(item => item.group !== boundary);
  }
  return {
    state: "ok", ranked: topics, invalidRows,
    weakest: weakest.map(item => item.topic),
    // Strongest first; tied topics keep their order (more exam papers, then name).
    strongest: strongest.map((item, index) => ({ ...item, index })).sort((a, b) => b.group - a.group || a.index - b.index).map(item => item.topic),
  };
}

// The message for a state without lists. `count` is the number of topics with evidence.
export function strengthMessage(state: Exclude<StrengthState, "ok">, count: number): string {
  switch (state) {
    case "no_topics": return "This course's exam papers have no topics yet, so there are no strongest or weakest topics to show.";
    case "no_profile": return "You have no learning profile for this course yet, so there is nothing to compare.";
    case "no_evidence": return "You skipped every topic and have no recorded practice, so there is nothing to compare yet.";
    case "too_few": return `Only 1 topic has a rating or recorded practice. At least ${MIN_TOPICS_TO_COMPARE} are needed to compare.`;
    case "level": return `Your ${count} topics with a rating or recorded practice are level so far, so none stands out as strongest or weakest.`;
  }
}
