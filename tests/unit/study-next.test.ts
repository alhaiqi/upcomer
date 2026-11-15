import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningProfile, ProfileTopic } from "@/lib/learning-profile";

const { courseFile, learningTopic } = vi.hoisted(() => ({ courseFile: { findMany: vi.fn() }, learningTopic: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: { courseFile, learningTopic } }));
import { NEUTRAL_WEAKNESS } from "@/lib/learning-profile";
import { checkedPriority, explainPriority, PRIORITY_TIE, WEAKNESS_WEIGHT } from "@/lib/personal-order";
import { NO_TOPICS_TO_RECOMMEND, recommendNext } from "@/lib/study-next-rules";
import type { CourseTopicCount } from "@/lib/topic-strengths-rules";

// US-30: the topic to study next follows weakness and exam importance by the personal order's own priority rule.

type Row = Partial<ProfileTopic> & { weakness: number };
const profile = (rows: Record<string, Row> = {}): LearningProfile =>
  new Map(Object.entries(rows).map(([topicKey, row]) => [topicKey, { topicKey, topic: `profile ${topicKey}`, confidence: null, correctCount: 0, incorrectCount: 0, ...row }]));
// Course topics by key, each with its number of papers.
const course = (papers: Record<string, number>): Map<string, CourseTopicCount> =>
  new Map(Object.entries(papers).map(([key, paperCount]) => [key, { topic: key.toUpperCase(), paperCount }]));
const keys = (topics: Array<{ topicKey: string }>) => topics.map(topic => topic.topicKey);

describe("the recommended topic", () => {
  it("is a rare but weak topic over a frequent but strong one", () => {
    // DNS 1/5 × (1 + 2 × 1) = 0.6; TCP 2/5 × (1 + 0) = 0.4.
    const result = recommendNext(profile({ dns: { weakness: 1, confidence: 1 }, tcp: { weakness: 0, confidence: 5 } }), course({ tcp: 2, dns: 1 }), 5);
    expect(result.state).toBe("ok");
    expect(result.recommended).toMatchObject({ topicKey: "dns", topic: "DNS", paperCount: 1, totalPapers: 5, weakness: 1, rated: true });
    expect(result.recommended!.priority).toBeCloseTo(0.6, 10);
    expect(keys(result.ranked)).toEqual(["dns", "tcp"]);
  });
  it("is a frequent topic the student never touched over a rare weak one (the neutral default)", () => {
    // TCP 3/5 × (1 + 2 × 0.5) = 1.2; DNS 1/5 × 3 = 0.6.
    const result = recommendNext(profile({ dns: { weakness: 1, confidence: 1 } }), course({ dns: 1, tcp: 3 }), 5);
    expect(result.recommended).toMatchObject({ topicKey: "tcp", weakness: NEUTRAL_WEAKNESS, rated: false });
    expect(result.recommended!.priority).toBeCloseTo(1.2, 10);
  });
  it("is the most frequent topic for a student without a profile", () => {
    const result = recommendNext(profile(), course({ dns: 1, tcp: 3, routing: 2 }), 6);
    expect(keys(result.ranked)).toEqual(["tcp", "routing", "dns"]);
    expect(result.ranked.every(topic => topic.weakness === NEUTRAL_WEAKNESS && !topic.rated)).toBe(true);
  });
  it("treats a skipped topic like one never rated", () => {
    const skipped = recommendNext(profile({ tcp: { weakness: NEUTRAL_WEAKNESS, confidence: null } }), course({ tcp: 2, dns: 2 }), 4);
    const untouched = recommendNext(profile(), course({ tcp: 2, dns: 2 }), 4);
    expect(skipped.ranked.map(topic => topic.priority)).toEqual(untouched.ranked.map(topic => topic.priority));
    expect(skipped.ranked.find(topic => topic.topicKey === "tcp")!.reason).toBe(untouched.ranked.find(topic => topic.topicKey === "tcp")!.reason);
  });
  it("uses the personal order's priority, not a second formula", () => {
    const rows = { a: { weakness: 0.85 }, b: { weakness: 0.1 }, c: { weakness: 0.33 } };
    const papers = { a: 1, b: 4, c: 2, d: 3 };
    for (const topic of recommendNext(profile(rows), course(papers), 7).ranked) {
      const weakness = rows[topic.topicKey as keyof typeof rows]?.weakness ?? NEUTRAL_WEAKNESS;
      expect(topic.priority).toBe(checkedPriority(papers[topic.topicKey as keyof typeof papers], 7, weakness).priority);
      expect(topic.priority).toBe((topic.paperCount / 7) * (1 + WEAKNESS_WEIGHT * weakness));
    }
  });
  it("counts the share against all the course's papers, tagged or not", () => {
    const result = recommendNext(profile(), course({ tcp: 2 }), 8);
    expect(result.recommended).toMatchObject({ paperCount: 2, totalPapers: 8, priority: 0.5 });
  });
  it("changes when practice changes a weakness", () => {
    const papers = course({ tcp: 2, routing: 2, dns: 1 });
    expect(recommendNext(profile({ tcp: { weakness: 0.2 }, routing: { weakness: 0.4 } }), papers, 5).recommended!.topicKey).toBe("routing");
    expect(recommendNext(profile({ tcp: { weakness: 0.6, incorrectCount: 3 }, routing: { weakness: 0.4 } }), papers, 5).recommended!.topicKey).toBe("tcp");
  });
  it("ignores a profile row for a topic that is not in the course's papers", () => {
    const result = recommendNext(profile({ "operating systems": { weakness: 1, confidence: 1 }, dns: { weakness: 0.2, confidence: 4 } }), course({ dns: 1, tcp: 1 }), 2);
    expect(keys(result.ranked)).toEqual(["tcp", "dns"]);
  });
  it("is null with a clear message when the course has no topics", () => {
    const result = recommendNext(profile({ tcp: { weakness: 1 } }), new Map(), 3);
    expect(result).toEqual({ state: "no_topics", recommended: null, ranked: [], invalidTopics: 0, reasons: [] });
    expect(NO_TOPICS_TO_RECOMMEND).toBe("This course's exam papers have no topics yet, so there is no topic to recommend.");
  });
});

describe("ties", () => {
  it("go to the topic in more exam papers", () => {
    // TCP 3/5 × 1 = 0.6 and DNS 1/5 × 3 = 0.6.
    const result = recommendNext(profile({ tcp: { weakness: 0, confidence: 5 }, dns: { weakness: 1, confidence: 1 } }), course({ dns: 1, tcp: 3 }), 5);
    expect(Math.abs(result.ranked[0].priority - result.ranked[1].priority)).toBeLessThanOrEqual(PRIORITY_TIE);
    expect(keys(result.ranked)).toEqual(["tcp", "dns"]);
  });
  it("then to the topic name", () => {
    expect(keys(recommendNext(profile(), course({ tcp: 2, dns: 2, routing: 2, arp: 1 }), 7).ranked)).toEqual(["dns", "routing", "tcp", "arp"]);
  });
  it("treat priorities within the tolerance as equal, and others as different", () => {
    const papers = course({ a: 1, b: 2 });
    // b is twice as frequent; a's weakness makes the priorities meet: 1 × (1 + 2w) = 2 × (1 + 0) at w = 0.5.
    const within = recommendNext(profile({ a: { weakness: 0.5 + 1e-11 }, b: { weakness: 0 } }), papers, 4);
    expect(keys(within.ranked)).toEqual(["b", "a"]);
    const above = recommendNext(profile({ a: { weakness: 0.5 + 1e-6 }, b: { weakness: 0 } }), papers, 4);
    expect(keys(above.ranked)).toEqual(["a", "b"]);
  });
  it("never depend on the order the topics or the profile rows arrive in", () => {
    const rows: Record<string, Row> = { a: { weakness: 0.5 }, b: { weakness: 0 }, c: { weakness: 1 }, d: { weakness: 0.5 }, e: { weakness: 0.25 } };
    const papers: Record<string, number> = { a: 2, b: 4, c: 1, d: 2, e: 3, f: 2, g: 1 };
    const expected = keys(recommendNext(profile(rows), course(papers), 9).ranked);
    let seed = 7;
    const shuffle = <T,>(items: T[]) => items.map(item => [(seed = (seed * 16807) % 2147483647), item] as const).sort((x, y) => x[0] - y[0]).map(([, item]) => item);
    for (let round = 0; round < 50; round++) {
      const result = recommendNext(profile(Object.fromEntries(shuffle(Object.entries(rows)))), course(Object.fromEntries(shuffle(Object.entries(papers)))), 9);
      expect(keys(result.ranked)).toEqual(expected);
    }
  });
});

describe("invalid inputs", () => {
  it("are replaced by safe values and counted, never thrown", () => {
    const result = recommendNext(profile({ tcp: { weakness: 7 }, dns: { weakness: Number.NaN }, routing: { weakness: 0.5 } }), course({ tcp: 1, dns: 1, routing: 1 }), 3);
    expect(result.state).toBe("ok");
    expect(result.invalidTopics).toBe(2);
    expect(result.reasons).toEqual(["invalid_weakness"]);
    // 7 is clamped to 1 (the weakest), NaN falls back to neutral.
    expect(keys(result.ranked)).toEqual(["tcp", "dns", "routing"]);
    expect(result.ranked[0].reason).toBe("In 1 of this course's 3 published exam papers. Some of this topic's inputs are invalid, so safe defaults are used.");
    expect(result.ranked.every(topic => Number.isFinite(topic.priority))).toBe(true);
  });
  it("cover a topic in more papers than the course has", () => {
    const result = recommendNext(profile(), course({ tcp: 5 }), 2);
    expect(result).toMatchObject({ invalidTopics: 1, reasons: ["paper_count_exceeds_total"] });
    expect(result.recommended!.priority).toBe(2);
  });
});

describe("the reason", () => {
  const papers = course({ tcp: 2, dns: 1 });
  it("gives the exam share and what the weakness rests on", () => {
    const result = recommendNext(profile({ tcp: { weakness: 0.85, confidence: 2, baselineWeakness: 0.75, correctCount: 0, incorrectCount: 3 }, dns: { weakness: 0.25, confidence: 4 } }), papers, 5);
    expect(result.recommended!.reason).toBe("In 2 of this course's 5 published exam papers. Rated 2 of 5, 0 correct and 3 incorrect.");
    expect(result.ranked[1].reason).toBe("In 1 of this course's 5 published exam papers. Rated 4 of 5, no practice recorded.");
  });
  it("says a neutral weakness is used for a topic never rated or practised", () => {
    expect(recommendNext(profile(), papers, 5).recommended!.reason).toBe("In 2 of this course's 5 published exam papers. Not rated and no practice recorded, so a neutral weakness is used.");
    expect(recommendNext(profile(), course({ tcp: 1 }), 1).recommended!.reason).toContain("In 1 of this course's 1 published exam paper.");
  });
  it("says the saved weakness is used when a row has one without a rating or practice", () => {
    expect(recommendNext(profile({ tcp: { weakness: 0.9 } }), papers, 5).recommended!.reason).toContain("so the weakness saved in your course profile is used.");
  });
  it("explains the sum in the personal order's own words", () => {
    const row = { weakness: 0.85, confidence: 2, baselineWeakness: 0.75, correctCount: 0, incorrectCount: 3 };
    const result = recommendNext(profile({ tcp: row }), papers, 5);
    expect(result.recommended!.explanation).toBe(explainPriority({ paperCount: 2, totalPapers: 5 }, "TCP", profile({ tcp: row }).get("tcp")));
    expect(result.recommended!.explanation).toContain("Appeared in 2 of 5 published exam papers");
    expect(result.recommended!.explanation).toContain("Historical frequency is not a guarantee of future exams.");
    expect(result.ranked[1].explanation).toContain("Neutral weakness is used; your strength is unknown");
  });
  it("never claims mastery or promises anything about the next exam", () => {
    for (const topic of recommendNext(profile({ tcp: { weakness: 0, confidence: 5, correctCount: 9 } }), papers, 5).ranked) {
      expect(topic.reason).not.toMatch(/master|will be on|guarantee/i);
      expect(topic.explanation).not.toMatch(/mastered|will be on/i);
    }
  });
});
