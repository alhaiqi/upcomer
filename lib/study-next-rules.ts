import { NEUTRAL_WEAKNESS, type LearningProfile } from "@/lib/learning-profile";
import { checkedPriority, explainPriority, PRIORITY_TIE, type PriorityReason } from "@/lib/personal-order";
import { describeEvidence, hasEvidence, type CourseTopicCount } from "@/lib/topic-strengths-rules";

// US-30: which topic of a course a student should study next. A topic's priority is the personal order's own rule
// (US-27, checkedPriority): its exam share × (1 + WEAKNESS_WEIGHT × weakness), where the exam share is the share of the
// course's published exam papers tagged with the topic. A topic the student never rated or practised uses the neutral
// weakness, so a frequent topic they never touched can still be recommended. Nothing here reads the database, and the
// same inputs always give the same recommendation.

export type StudyTopic = {
  topicKey: string; topic: string; paperCount: number; totalPapers: number;
  // The weakness the priority rests on: the stored one, or the neutral default without a profile row.
  weakness: number; priority: number;
  // Whether the student saved a confidence rating for the topic.
  rated: boolean;
  // Short and visible: the topic's exam share and what its weakness rests on.
  reason: string;
  // The full sum, in the personal order's own words (explainPriority, US-29).
  explanation: string;
};
export type StudyNext = {
  // all_covered: the course has topics, and the student marked every one as covered (US-32).
  state: "ok" | "no_topics" | "all_covered";
  // The first topic of `ranked`; null when that list is empty.
  recommended: StudyTopic | null;
  // Every topic of the course the student has not marked as covered, highest priority first.
  ranked: StudyTopic[];
  // How many of the course's topics were left out because the student marked them as covered (US-32).
  coveredTopics: number;
  // Topics whose priority inputs were invalid and replaced by safe values, and why (for one log line).
  invalidTopics: number;
  reasons: PriorityReason[];
};

const byName = (a: StudyTopic, b: StudyTopic) => (a.topicKey < b.topicKey ? -1 : a.topicKey > b.topicKey ? 1 : 0);

// `profile` is the student's profile in this course (getLearningProfile), `courseTopics` the course's published
// exam-paper topics by topic key, and `totalPapers` the number of the course's published exam papers, tagged or not.
// A profile row for any other topic is ignored. `covered` is the topic keys the student marked as already covered in
// this course (US-32): those topics are left out before the pick, and nothing else about the others changes. A covered
// key that is not a course topic is ignored.
export function recommendNext(
  profile: LearningProfile, courseTopics: ReadonlyMap<string, CourseTopicCount>, totalPapers: number, covered: ReadonlySet<string> = new Set(),
): StudyNext {
  const reasons = new Set<PriorityReason>();
  let invalidTopics = 0;
  const candidates = [...courseTopics].filter(([topicKey]) => !covered.has(topicKey));
  const coveredTopics = courseTopics.size - candidates.length;
  const topics = candidates.map(([topicKey, course]): StudyTopic => {
    const row = profile.get(topicKey);
    const weakness = row?.weakness ?? NEUTRAL_WEAKNESS;
    const checked = checkedPriority(course.paperCount, totalPapers, weakness);
    if (checked.reasons.length) invalidTopics++;
    checked.reasons.forEach(reason => reasons.add(reason));
    const share = `In ${course.paperCount} of this course's ${totalPapers} published exam ${totalPapers === 1 ? "paper" : "papers"}.`;
    const rests = checked.reasons.length ? "Some of this topic's inputs are invalid, so safe defaults are used."
      : row && hasEvidence(row) ? `${describeEvidence(row)}.`
        : weakness === NEUTRAL_WEAKNESS ? "Not rated and no practice recorded, so a neutral weakness is used."
          : "Not rated and no practice recorded, so the weakness saved in your course profile is used.";
    return {
      topicKey, topic: course.topic, paperCount: course.paperCount, totalPapers, weakness, priority: checked.priority, rated: row?.confidence != null,
      reason: `${share} ${rests}`, explanation: explainPriority({ paperCount: course.paperCount, totalPapers }, course.topic, row),
    };
  });
  // Highest priority first. Priorities within PRIORITY_TIE of their group's first are tied; inside a group the topic in
  // more exam papers comes first, then the topic name. Sorting by the exact priority before grouping keeps the result
  // independent of the order the topics arrive in.
  topics.sort((a, b) => b.priority - a.priority || byName(a, b));
  const groups: StudyTopic[][] = [];
  for (const topic of topics) {
    const last = groups.at(-1);
    if (last && last[0].priority - topic.priority <= PRIORITY_TIE) last.push(topic);
    else groups.push([topic]);
  }
  const ranked = groups.flatMap(group => group.sort((a, b) => b.paperCount - a.paperCount || byName(a, b)));
  const state = ranked.length ? "ok" : courseTopics.size ? "all_covered" : "no_topics";
  return { state, recommended: ranked[0] ?? null, ranked, coveredTopics, invalidTopics, reasons: [...reasons].sort() };
}

export const NO_TOPICS_TO_RECOMMEND = "This course's exam papers have no topics yet, so there is no topic to recommend.";
export const ALL_TOPICS_COVERED = "You marked every topic of this course as covered, so there is no topic to recommend. Undo one below to get a recommendation again.";
// The line under a recommendation when some topics are left out.
export const coveredLeftOut = (count: number) => `${count} ${count === 1 ? "topic" : "topics"} you marked as covered ${count === 1 ? "is" : "are"} left out.`;
