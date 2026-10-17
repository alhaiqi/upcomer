import { describe, expect, it } from "vitest";
import { isLowConfidence, LIKELIHOOD_TIERS, MIN_CONFIDENT_PAPERS, TIER_LABELS, tierFor } from "@/lib/likelihood-tiers";

describe("likelihood tiers (US-19)", () => {
  it("puts a question in at least half of the papers in very likely", () => {
    expect(tierFor(5, 10)).toBe("VERY_LIKELY");
    expect(tierFor(10, 10)).toBe("VERY_LIKELY");
    expect(tierFor(2, 4)).toBe("VERY_LIKELY");
  });
  it("puts a question in at least a quarter but less than half in likely", () => {
    expect(tierFor(4, 10)).toBe("LIKELY");
    expect(tierFor(3, 10)).toBe("LIKELY");
    expect(tierFor(1, 4)).toBe("LIKELY");
  });
  it("puts a question in less than a quarter in rare", () => {
    expect(tierFor(2, 10)).toBe("RARE");
    expect(tierFor(1, 10)).toBe("RARE");
    expect(tierFor(1, 5)).toBe("RARE");
  });
  it("applies the same rule to a course with 3 papers and one with 10", () => {
    expect([3, 2, 1].map(count => tierFor(count, 3))).toEqual(["VERY_LIKELY", "VERY_LIKELY", "LIKELY"]);
    expect([10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(count => tierFor(count, 10))).toEqual([
      "VERY_LIKELY", "VERY_LIKELY", "VERY_LIKELY", "VERY_LIKELY", "VERY_LIKELY", "VERY_LIKELY", "LIKELY", "LIKELY", "RARE", "RARE",
    ]);
    // The same share gives the same tier whatever the course size.
    for (const [count, total] of [[1, 2], [3, 6], [5, 10], [50, 100]]) expect(tierFor(count, total)).toBe("VERY_LIKELY");
    for (const [count, total] of [[1, 4], [3, 12], [25, 100]]) expect(tierFor(count, total)).toBe("LIKELY");
    for (const [count, total] of [[1, 5], [2, 9], [24, 100]]) expect(tierFor(count, total)).toBe("RARE");
  });
  it("puts every question in exactly one tier, never moving up as its paper count drops", () => {
    for (let total = 1; total <= 30; total++) {
      let previous = 0;
      for (let count = total; count >= 1; count--) {
        const tier = tierFor(count, total);
        expect(LIKELIHOOD_TIERS).toContain(tier);
        const position = LIKELIHOOD_TIERS.indexOf(tier);
        expect(position).toBeGreaterThanOrEqual(previous);
        previous = position;
      }
    }
  });
  it("handles counts that are out of date or missing", () => {
    expect(tierFor(4, 3)).toBe("VERY_LIKELY");
    expect(tierFor(0, 10)).toBe("RARE");
    expect(tierFor(-1, 10)).toBe("RARE");
    expect(tierFor(1, 0)).toBe("RARE");
    expect(tierFor(Number.NaN, 10)).toBe("RARE");
  });
  it("marks a course with papers but fewer than the minimum as low confidence", () => {
    expect(MIN_CONFIDENT_PAPERS).toBe(5);
    expect([1, 2, 3, 4].every(isLowConfidence)).toBe(true);
    expect(isLowConfidence(5)).toBe(false);
    expect(isLowConfidence(10)).toBe(false);
    expect(isLowConfidence(0)).toBe(false);
  });
  it("has a label for every tier", () => {
    expect(LIKELIHOOD_TIERS.map(tier => TIER_LABELS[tier])).toEqual(["Very likely", "Likely", "Rare"]);
  });
});
