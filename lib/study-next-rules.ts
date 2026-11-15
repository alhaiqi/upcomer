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
  state: "ok" | "no_topics";
  // The first topic of `ranked`; null without topics.
  recommended: StudyTopic | null;
  // Every topic of the course, highest priority first. US-32 leaves covered topics out of this list before the pick.
  ranked: StudyTopic[];
  // Topics whose priority inputs were invalid and replaced by safe values, and why (for one log line).
  invalidTopics: number;
  reasons: PriorityReason[];
};

const byName = (a: StudyTopic, b: StudyTopic) => (a.topicKey < b.topicKey ? -1 : a.topicKey > b.topicKey ? 1 : 0);

// `profile` is the student's profile in this course (getLearningProfile), `courseTopics` the course's published
// exam-paper topics by topic key, and `totalPapers` the number of the course's published exam papers, tagged or not.
// A profile row for any other topic is ignored.
export function recommendNext(profile: LearningProfile, courseTopics: ReadonlyMap<string, CourseTopicCount>, totalPapers: number): StudyNext {
  const reasons = new Set<PriorityReason>();
  let invalidTopics = 0;
  const topics = [...courseTopics].map(([topicKey, course]): StudyTopic => {
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
  return { state: ranked.length ? "ok" : "no_topics", recommended: ranked[0] ?? null, ranked, invalidTopics, reasons: [...reasons].sort() };
}

export const NO_TOPICS_TO_RECOMMEND = "This course's exam papers have no topics yet, so there is no topic to recommend.";
