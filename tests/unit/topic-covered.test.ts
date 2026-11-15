import { describe, expect, it } from "vitest";
import type { LearningProfile, ProfileTopic } from "@/lib/learning-profile";
import { ALL_TOPICS_COVERED, coveredLeftOut, recommendNext } from "@/lib/study-next-rules";
import { COVERED, COVERED_FIELD, coveredMessage, NOT_COVERED, parseCovered, savedMessage, TOPIC_FIELD } from "@/lib/topic-covered-rules";
import { selectStrengths, type CourseTopicCount } from "@/lib/topic-strengths-rules";

// US-32: a topic marked as covered is left out of "Study next" and labelled in the strongest and weakest topics. It is
// never evidence.

type Row = Partial<ProfileTopic> & { weakness: number };
const profile = (rows: Record<string, Row> = {}): LearningProfile =>
  new Map(Object.entries(rows).map(([topicKey, row]) => [topicKey, { topicKey, topic: `profile ${topicKey}`, confidence: null, correctCount: 0, incorrectCount: 0, ...row }]));
const course = (papers: Record<string, number>): Map<string, CourseTopicCount> =>
  new Map(Object.entries(papers).map(([key, paperCount]) => [key, { topic: key.toUpperCase(), paperCount }]));
const keys = (topics: Array<{ topicKey: string }>) => topics.map(topic => topic.topicKey);
const covered = (...topicKeys: string[]) => new Set(topicKeys);

describe("Study next without covered topics", () => {
  const rows = { routing: { weakness: 1, confidence: 1 }, dns: { weakness: 0.5, confidence: 3 }, tcp: { weakness: 0, confidence: 5 } };
  const papers = { tcp: 2, routing: 2, dns: 1 };
  it("leaves a covered topic out and recommends the next one", () => {
    const before = recommendNext(profile(rows), course(papers), 5);
    expect(before.recommended!.topicKey).toBe("routing");
    expect(before.coveredTopics).toBe(0);
    const after = recommendNext(profile(rows), course(papers), 5, covered("routing"));
    expect(after.state).toBe("ok");
    // TCP 0.4 × 1 and DNS 0.2 × 2 tie at 0.4; TCP is in more papers.
    expect(after.recommended!.topicKey).toBe("tcp");
    expect(keys(after.ranked)).toEqual(["tcp", "dns"]);
    expect(after.coveredTopics).toBe(1);
  });
  it("changes nothing about the topics that are left", () => {
    const before = recommendNext(profile(rows), course(papers), 5);
    const after = recommendNext(profile(rows), course(papers), 5, covered("routing"));
    expect(after.ranked).toEqual(before.ranked.filter(topic => topic.topicKey !== "routing"));
  });
  it("leaves out a covered topic the student never rated or practised", () => {
    const result = recommendNext(profile(), course({ tcp: 3, dns: 1 }), 4, covered("tcp"));
    expect(result.recommended!.topicKey).toBe("dns");
    expect(result.coveredTopics).toBe(1);
  });
  it("says so when every topic is covered", () => {
    const result = recommendNext(profile(rows), course(papers), 5, covered("tcp", "routing", "dns"));
    expect(result).toMatchObject({ state: "all_covered", recommended: null, ranked: [], coveredTopics: 3, invalidTopics: 0 });
    expect(ALL_TOPICS_COVERED).toMatch(/every topic of this course as covered/);
  });
  it("ignores a covered key that is not a topic of the course", () => {
    const result = recommendNext(profile(rows), course(papers), 5, covered("sorting"));
    expect(result).toEqual(recommendNext(profile(rows), course(papers), 5));
    expect(result.coveredTopics).toBe(0);
  });
  it("still reports a course without topics as having none", () => {
    expect(recommendNext(profile(), course({}), 0, covered("tcp"))).toMatchObject({ state: "no_topics", coveredTopics: 0 });
  });
  it("does not count a covered topic's invalid inputs", () => {
    const bad = profile({ tcp: { weakness: 7 } });
    expect(recommendNext(bad, course({ tcp: 1, dns: 1 }), 2).invalidTopics).toBe(1);
    expect(recommendNext(bad, course({ tcp: 1, dns: 1 }), 2, covered("tcp")).invalidTopics).toBe(0);
  });
  it("words the left-out line for one and for several, with no claim of mastery", () => {
    expect(coveredLeftOut(1)).toBe("1 topic you marked as covered is left out.");
    expect(coveredLeftOut(3)).toBe("3 topics you marked as covered are left out.");
    expect(`${coveredLeftOut(2)} ${ALL_TOPICS_COVERED}`).not.toMatch(/master/i);
  });
});

describe("strongest and weakest topics with covered topics", () => {
  const rows = {
    a: { weakness: 0.9, confidence: 1 }, b: { weakness: 0.7, confidence: 2 }, c: { weakness: 0.5, confidence: 3 },
    d: { weakness: 0.3, confidence: 4 }, e: { weakness: 0.1, confidence: 5 }, f: { weakness: 0.5 },
  };
  const papers = { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 };
  const plain = <T extends { covered: boolean }>(topics: T[]) => topics.map(topic => ({ ...topic, covered: false }));
  it("are the same topics in the same order, apart from the label", () => {
    const before = selectStrengths(profile(rows), course(papers));
    for (const set of [covered("a"), covered("e"), covered("a", "e", "c"), covered("a", "b", "c", "d", "e", "f")]) {
      const after = selectStrengths(profile(rows), course(papers), set);
      expect(after.state).toBe(before.state);
      expect(plain(after.ranked)).toEqual(before.ranked);
      expect(plain(after.weakest)).toEqual(before.weakest);
      expect(plain(after.strongest)).toEqual(before.strongest);
      for (const topic of after.ranked) expect(topic.covered).toBe(set.has(topic.topicKey));
    }
  });
  it("label a covered weak topic without calling it strong", () => {
    const result = selectStrengths(profile(rows), course(papers), covered("a"));
    expect(result.weakest[0]).toMatchObject({ topicKey: "a", covered: true });
    expect(keys(result.strongest)).not.toContain("a");
  });
  it("never count covered as evidence", () => {
    // f has a row but no rating and no practice; covered or not, it is in no list.
    expect(keys(selectStrengths(profile(rows), course(papers), covered("f")).ranked)).not.toContain("f");
    // A covered topic with no profile row leaves a student without a profile without one.
    expect(selectStrengths(profile(), course(papers), covered("a")).state).toBe("no_profile");
    expect(selectStrengths(profile({ f: { weakness: 0.5 } }), course(papers), covered("f")).state).toBe("no_evidence");
  });
  it("are unlabelled without a covered set", () => {
    expect(selectStrengths(profile(rows), course(papers)).ranked.every(topic => topic.covered === false)).toBe(true);
  });
});

describe("the covered form", () => {
  const topics = new Set(["tcp", "link-state routing"]);
  const form = (...entries: Array<[string, FormDataEntryValue]>) => entries;
  it("reads a mark and an undo", () => {
    expect(parseCovered(form(["courseId", "c1"], [TOPIC_FIELD, "tcp"], [COVERED_FIELD, COVERED]), topics)).toEqual({ ok: true, topicKey: "tcp", covered: true });
    expect(parseCovered(form([COVERED_FIELD, NOT_COVERED], [TOPIC_FIELD, "link-state routing"]), topics)).toEqual({ ok: true, topicKey: "link-state routing", covered: false });
  });
  it("refuses a topic that is not in this course", () => {
    for (const key of ["dns", "TCP", " tcp", ""]) {
      expect(parseCovered(form([TOPIC_FIELD, key], [COVERED_FIELD, COVERED]), topics)).toEqual({ ok: false, error: "unknown_topic" });
    }
    expect(parseCovered(form([TOPIC_FIELD, "tcp"], [COVERED_FIELD, COVERED]), new Set())).toEqual({ ok: false, error: "unknown_topic" });
  });
  it("refuses any value but 1 or 0", () => {
    for (const value of ["", "true", "2", "01", "1 ", "on"]) {
      expect(parseCovered(form([TOPIC_FIELD, "tcp"], [COVERED_FIELD, value]), topics)).toEqual({ ok: false, error: "invalid_value" });
    }
  });
  it("refuses a missing, repeated or non-text field", () => {
    const invalid = { ok: false, error: "invalid_value" };
    expect(parseCovered(form(), topics)).toEqual(invalid);
    expect(parseCovered(form([TOPIC_FIELD, "tcp"]), topics)).toEqual(invalid);
    expect(parseCovered(form([COVERED_FIELD, COVERED]), topics)).toEqual(invalid);
    expect(parseCovered(form([TOPIC_FIELD, "tcp"], [TOPIC_FIELD, "link-state routing"], [COVERED_FIELD, COVERED]), topics)).toEqual(invalid);
    expect(parseCovered(form([TOPIC_FIELD, "tcp"], [COVERED_FIELD, COVERED], [COVERED_FIELD, NOT_COVERED]), topics)).toEqual(invalid);
    expect(parseCovered(form([TOPIC_FIELD, new File(["x"], "tcp")], [COVERED_FIELD, COVERED]), topics)).toEqual(invalid);
  });
  it("has a message for each refusal and never echoes a value from the URL", () => {
    expect(coveredMessage("unknown_topic")).toBe("That topic isn't part of this course. Reload the page and try again.");
    expect(coveredMessage("rate_limited")).toMatch(/Too many changes/);
    expect(coveredMessage("<script>alert(1)</script>")).toBe(coveredMessage("unexpected"));
    expect(coveredMessage("constructor")).toBe(coveredMessage("unexpected"));
  });
  it("has a notice for a mark and for an undo only, with no claim of mastery", () => {
    expect(savedMessage("1")).toBe("Marked as covered. It is left out of Study next.");
    expect(savedMessage("0")).toBe("No longer marked as covered.");
    expect(savedMessage("yes")).toBeNull();
    expect(savedMessage(undefined)).toBeNull();
    expect(`${savedMessage("1")} ${savedMessage("0")}`).not.toMatch(/master/i);
  });
});
