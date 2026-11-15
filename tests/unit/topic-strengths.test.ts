import { describe, expect, it, vi } from "vitest";
import type { LearningProfile, ProfileTopic } from "@/lib/learning-profile";

vi.mock("@/lib/db", () => ({ db: {} }));
import { describeEvidence, hasEvidence, MAX_LISTED, selectStrengths, strengthMessage, WEAKNESS_TIE, type CourseTopicCount } from "@/lib/topic-strengths-rules";

// US-26: the strongest/weakest selection, the evidence rule, ties, and every insufficient-data state.

type Row = Partial<ProfileTopic> & { weakness: number };
// A rated topic by default (confidence 3), so it has evidence; pass confidence: null for a skipped one.
const profile = (rows: Record<string, Row>): LearningProfile =>
  new Map(Object.entries(rows).map(([topicKey, row]) => [topicKey, { topicKey, topic: `profile ${topicKey}`, confidence: 3, correctCount: 0, incorrectCount: 0, ...row }]));
// Course topics a..j, each in one paper unless `papers` says otherwise.
const course = (keys: string[], papers: Record<string, number> = {}): Map<string, CourseTopicCount> =>
  new Map(keys.map(key => [key, { topic: key.toUpperCase(), paperCount: papers[key] ?? 1 }]));
const letters = "abcdefghij".split("");
const keys = (topics: Array<{ topicKey: string }>) => topics.map(topic => topic.topicKey);
// Topics a, b, c, ... with the given weaknesses.
const select = (weaknesses: number[], papers: Record<string, number> = {}) =>
  selectStrengths(profile(Object.fromEntries(weaknesses.map((weakness, index) => [letters[index], { weakness }]))), course(letters, papers));

describe("the evidence rule", () => {
  it("counts a saved rating or at least one recorded outcome", () => {
    expect(hasEvidence({ confidence: 4, correctCount: 0, incorrectCount: 0 })).toBe(true);
    expect(hasEvidence({ confidence: null, correctCount: 1, incorrectCount: 0 })).toBe(true);
    expect(hasEvidence({ confidence: null, correctCount: 0, incorrectCount: 1 })).toBe(true);
    expect(hasEvidence({ confidence: 1 })).toBe(true);
  });
  it("does not count a topic that was skipped and never practised", () => {
    expect(hasEvidence({ confidence: null, correctCount: 0, incorrectCount: 0 })).toBe(false);
    expect(hasEvidence({})).toBe(false);
  });
  it("leaves a skipped, unpractised topic out of the lists, and lets a skipped but practised one in", () => {
    const result = selectStrengths(profile({
      a: { weakness: 1, confidence: 1 }, b: { weakness: 0, confidence: 5 },
      // Skipped: the neutral 0.5 says nothing about the student.
      c: { weakness: 0.5, confidence: null },
      d: { weakness: 0.25, confidence: null, correctCount: 2, incorrectCount: 0 },
    }), course(letters));
    expect(keys(result.ranked)).toEqual(["a", "d", "b"]);
    expect(keys(result.weakest)).toEqual(["a"]);
    expect(keys(result.strongest)).toEqual(["b"]);
  });
  it("says what a result rests on without claiming mastery", () => {
    expect(describeEvidence({ confidence: 2, correctCount: 3, incorrectCount: 1 })).toBe("Rated 2 of 5, 3 correct and 1 incorrect");
    expect(describeEvidence({ confidence: null, correctCount: 1, incorrectCount: 0 })).toBe("Not rated, 1 correct and 0 incorrect");
    expect(describeEvidence({ confidence: 4, correctCount: 0, incorrectCount: 0 })).toBe("Rated 4 of 5, no practice recorded");
    const [topic] = selectStrengths(profile({ a: { weakness: 0.7, confidence: 2, correctCount: 3, incorrectCount: 1 }, b: { weakness: 0.1 } }), course(letters)).weakest;
    expect(topic).toMatchObject({ topicKey: "a", topic: "A", confidence: 2, correctCount: 3, incorrectCount: 1, evidence: "Rated 2 of 5, 3 correct and 1 incorrect" });
  });
});

describe("the strongest and weakest selection", () => {
  it("lists min(3, half the topics with evidence) in each list, the weakest and the strongest first", () => {
    const sizes = new Map([[2, 1], [3, 1], [4, 2], [5, 2], [6, 3], [7, 3], [10, 3]]);
    for (const [count, size] of sizes) {
      // a is the weakest, the last letter the strongest.
      const result = select(Array.from({ length: count }, (_, index) => 1 - index / count));
      expect(result.state).toBe("ok");
      expect(keys(result.weakest)).toEqual(letters.slice(0, size));
      expect(keys(result.strongest)).toEqual(letters.slice(count - size, count).reverse());
      expect(keys(result.ranked)).toEqual(letters.slice(0, count));
      expect(size).toBeLessThanOrEqual(MAX_LISTED);
    }
  });
  it("reads the stored weakness as it is: ratings and counts never reorder the lists", () => {
    const result = selectStrengths(profile({
      a: { weakness: 0.2, confidence: 1, correctCount: 0, incorrectCount: 9 },
      b: { weakness: 0.9, confidence: 5, correctCount: 9, incorrectCount: 0 },
    }), course(letters));
    expect(keys(result.weakest)).toEqual(["b"]);
    expect(keys(result.strongest)).toEqual(["a"]);
  });
  it("gives the same result whatever order the rows arrive in", () => {
    const rows: Array<[string, Row]> = [["a", { weakness: 0.9 }], ["b", { weakness: 0.5 }], ["c", { weakness: 0.5 }], ["d", { weakness: 0.3 }], ["e", { weakness: 0.3 }], ["f", { weakness: 0.1 }]];
    const expected = selectStrengths(profile(Object.fromEntries(rows)), course(letters, { c: 4, e: 2 }));
    for (const shuffled of [[...rows].reverse(), [rows[3], rows[0], rows[5], rows[2], rows[4], rows[1]]]) {
      expect(selectStrengths(profile(Object.fromEntries(shuffled)), course(letters, { c: 4, e: 2 }))).toEqual(expected);
    }
    expect(keys(expected.ranked)).toEqual(["a", "c", "b", "e", "d", "f"]);
  });
  it("ignores a profile topic that is no longer one of the course's topics", () => {
    const result = selectStrengths(profile({ a: { weakness: 0.9 }, b: { weakness: 0.1 }, gone: { weakness: 1 } }), course(["a", "b"]));
    expect(keys(result.ranked)).toEqual(["a", "b"]);
    expect(selectStrengths(profile({ gone: { weakness: 1 }, other: { weakness: 0 } }), course(["a", "b"])).state).toBe("no_profile");
  });
  it("leaves out a row whose stored weakness is not a number from 0 to 1, and counts it", () => {
    const result = selectStrengths(profile({ a: { weakness: 0.9 }, b: { weakness: 0.1 }, c: { weakness: Number.NaN }, d: { weakness: 1.5 }, e: { weakness: -0.1 } }), course(letters));
    expect(keys(result.ranked)).toEqual(["a", "b"]);
    expect(result.invalidRows).toBe(3);
    expect(select([0.9, 0.1]).invalidRows).toBe(0);
  });
});

describe("ties", () => {
  it("orders tied topics by exam frequency, then by topic name", () => {
    // b, c, d, and e are tied: d is in 3 papers, c in 2, b and e in 1.
    const result = select([0.9, 0.5, 0.5, 0.5, 0.5, 0.1], { c: 2, d: 3 });
    expect(keys(result.ranked)).toEqual(["a", "d", "c", "b", "e", "f"]);
  });
  it("keeps a tie inside one list, in the same order in both lists", () => {
    // Weakest: a and b tied (b in more papers). Strongest: e and f tied (f in more papers).
    const result = select([0.9, 0.9, 0.6, 0.4, 0.1, 0.1], { b: 2, f: 2 });
    expect(keys(result.weakest)).toEqual(["b", "a", "c"]);
    expect(keys(result.strongest)).toEqual(["f", "e", "d"]);
  });
  it("never splits a tie between the lists: 0.8, 0.5, 0.5, 0.2 lists only 0.8 and 0.2", () => {
    const result = select([0.8, 0.5, 0.5, 0.2]);
    expect(result.state).toBe("ok");
    expect(keys(result.weakest)).toEqual(["a"]);
    expect(keys(result.strongest)).toEqual(["d"]);
    expect(keys(result.ranked)).toEqual(["a", "b", "c", "d"]);
  });
  it("drops every topic of a boundary tie, even those well inside a list", () => {
    // b to f are tied and reach from the weakest list into the strongest one.
    const result = select([0.9, 0.5, 0.5, 0.5, 0.5, 0.5, 0.1]);
    expect(keys(result.weakest)).toEqual(["a"]);
    expect(keys(result.strongest)).toEqual(["g"]);
  });
  it("can leave one list empty when the tie takes all of it", () => {
    const weak = select([0.8, 0.5, 0.5, 0.5]);
    expect(weak.state).toBe("ok");
    expect(keys(weak.weakest)).toEqual(["a"]);
    expect(weak.strongest).toEqual([]);
    const strong = select([0.5, 0.5, 0.5, 0.2]);
    expect(strong.weakest).toEqual([]);
    expect(keys(strong.strongest)).toEqual(["d"]);
  });
  it("drops a tie that sits exactly on the boundary, and leaves the lists alone when no tie crosses it", () => {
    // c and d are tied in the middle of six topics: with three per list they would be on opposite sides.
    const crossing = select([0.9, 0.8, 0.5, 0.5, 0.2, 0.1]);
    expect(keys(crossing.weakest)).toEqual(["a", "b"]);
    expect(keys(crossing.strongest)).toEqual(["f", "e"]);
    // Five topics, two per list: the middle topic is in neither list and nothing is dropped.
    const middle = select([0.9, 0.8, 0.5, 0.2, 0.1]);
    expect(keys(middle.weakest)).toEqual(["a", "b"]);
    expect(keys(middle.strongest)).toEqual(["e", "d"]);
  });
  it("treats weaknesses within the tolerance as tied, and just outside it as different", () => {
    const inside = select([0.8, 0.5 + WEAKNESS_TIE / 2, 0.5, 0.2]);
    expect(keys(inside.weakest)).toEqual(["a"]);
    expect(keys(inside.strongest)).toEqual(["d"]);
    const outside = select([0.8, 0.5 + WEAKNESS_TIE * 10, 0.5, 0.2]);
    expect(keys(outside.weakest)).toEqual(["a", "b"]);
    expect(keys(outside.strongest)).toEqual(["d", "c"]);
    // 1/3 computed two ways (evidenceWeakness rounding) is one value.
    expect(select([1 / 3, (2 * 0 + 1) / (2 + 0 + 1)]).state).toBe("level");
  });
  it("never lists a strongest topic that ties a weakest one, and never lists a topic twice (generated profiles)", () => {
    // A fixed linear congruential sequence: the same profiles on every run.
    let seed = 26;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 500; trial++) {
      const count = 2 + Math.floor(next() * 9);
      // Few distinct values, so ties are common.
      const weaknesses = Array.from({ length: count }, () => Math.floor(next() * 4) / 4);
      const papers = Object.fromEntries(letters.map(letter => [letter, 1 + Math.floor(next() * 3)]));
      const result = select(weaknesses, papers);
      for (const strong of result.strongest) {
        for (const weak of result.weakest) {
          expect(weak.topicKey).not.toBe(strong.topicKey);
          expect(weak.weakness - strong.weakness).toBeGreaterThan(WEAKNESS_TIE);
        }
      }
      expect(result.strongest.length).toBeLessThanOrEqual(MAX_LISTED);
      expect(result.weakest.length).toBeLessThanOrEqual(MAX_LISTED);
      if (new Set(weaknesses).size === 1) expect(result.state).toBe("level");
      else expect(result.strongest.length + result.weakest.length).toBeGreaterThan(0);
    }
  });
});

describe("insufficient data", () => {
  const empty = { strongest: [], weakest: [] };
  it("no_topics: the course's papers have no topics", () => {
    expect(selectStrengths(profile({ a: { weakness: 0.9 } }), new Map())).toMatchObject({ state: "no_topics", ranked: [], ...empty });
  });
  it("no_profile: the student has no profile in this course", () => {
    expect(selectStrengths(new Map(), course(letters))).toMatchObject({ state: "no_profile", ranked: [], ...empty });
  });
  it("no_evidence: every topic was skipped and none practised", () => {
    const result = selectStrengths(profile({ a: { weakness: 0.5, confidence: null }, b: { weakness: 0.5, confidence: null }, c: { weakness: 0.5, confidence: null } }), course(letters));
    expect(result).toMatchObject({ state: "no_evidence", ranked: [], ...empty });
  });
  it("too_few: only one topic has evidence", () => {
    const result = selectStrengths(profile({ a: { weakness: 1, confidence: 1 }, b: { weakness: 0.5, confidence: null } }), course(letters));
    expect(result).toMatchObject({ state: "too_few", ...empty });
    expect(keys(result.ranked)).toEqual(["a"]);
  });
  it("level: every topic with evidence has the same weakness", () => {
    for (const weaknesses of [[0.5, 0.5], [0, 0, 0], [1, 1, 1, 1]]) {
      const result = select(weaknesses);
      expect(result).toMatchObject({ state: "level", ...empty });
      expect(result.ranked).toHaveLength(weaknesses.length);
    }
  });
  it("has a clear message for each state", () => {
    expect(strengthMessage("no_topics", 0)).toContain("no topics yet");
    expect(strengthMessage("no_profile", 0)).toBe("You have no learning profile for this course yet, so there is nothing to compare.");
    expect(strengthMessage("no_evidence", 0)).toBe("You skipped every topic and have no recorded practice, so there is nothing to compare yet.");
    expect(strengthMessage("too_few", 1)).toBe("Only 1 topic has a rating or recorded practice. At least 2 are needed to compare.");
    expect(strengthMessage("level", 3)).toBe("Your 3 topics with a rating or recorded practice are level so far, so none stands out as strongest or weakest.");
  });
});
