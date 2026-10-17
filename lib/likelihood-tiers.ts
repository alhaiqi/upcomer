// Likelihood tiers (US-19). A question's tier depends only on the share of the course's papers it appeared in, so a course
// with 3 papers and a course with 10 follow the same rule. No database access.

export type LikelihoodTier = "VERY_LIKELY" | "LIKELY" | "RARE";

// Tier order on the page, most likely first.
export const LIKELIHOOD_TIERS: LikelihoodTier[] = ["VERY_LIKELY", "LIKELY", "RARE"];

// Cut-offs as a share of the course's papers: very likely from half of the papers, likely from a quarter, rare below.
export const VERY_LIKELY_SHARE = 1 / 2;
export const LIKELY_SHARE = 1 / 4;
// Below this many papers the share says little, so the tiers carry a low-confidence note.
export const MIN_CONFIDENT_PAPERS = 5;

export const TIER_LABELS: Record<LikelihoodTier, string> = { VERY_LIKELY: "Very likely", LIKELY: "Likely", RARE: "Rare" };
export const TIER_DESCRIPTIONS: Record<LikelihoodTier, string> = {
  VERY_LIKELY: "Appeared in at least half of the papers.",
  LIKELY: "Appeared in at least a quarter of the papers.",
  RARE: "Appeared in less than a quarter of the papers.",
};

// Compared as paperCount >= share * totalPapers, so 1 of 4 is exactly a quarter and 2 of 4 exactly half.
// A count above the total (counts out of date until the next regroup) is still very likely; a missing or negative count is rare.
export function tierFor(paperCount: number, totalPapers: number): LikelihoodTier {
  if (!(paperCount > 0) || !(totalPapers > 0)) return "RARE";
  if (paperCount >= VERY_LIKELY_SHARE * totalPapers) return "VERY_LIKELY";
  if (paperCount >= LIKELY_SHARE * totalPapers) return "LIKELY";
  return "RARE";
}

// A course with papers but fewer than the minimum. A course with no papers has no tiers to qualify.
export const isLowConfidence = (totalPapers: number) => totalPapers > 0 && totalPapers < MIN_CONFIDENT_PAPERS;
