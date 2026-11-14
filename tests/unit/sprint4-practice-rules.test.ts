import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { evidenceWeakness, practiceMessage } from "@/lib/learning-evidence-rules";
import { contentHash, groundedPrompts, parseGenerationSettings, sourceFingerprint, generationMessage } from "@/lib/practice-generation-rules";
import { checkedPriority, explainPriority, personalizeQuestions } from "@/lib/personal-order";
import type { ExamQuestion } from "@/lib/consolidated-exam";

describe("performance and explanation contracts", () => {
  it("combines the confidence prior with actual outcomes without inventing evidence", () => {
    expect(evidenceWeakness(0.5, 0, 0)).toBe(0.5);
    expect(evidenceWeakness(0.5, 1, 0)).toBeCloseTo(1 / 3);
    expect(evidenceWeakness(0.5, 0, 1)).toBeCloseTo(2 / 3);
    expect(evidenceWeakness(0, 0, 2)).toBe(0.5);
    expect(evidenceWeakness(1, 2, 0)).toBe(0.5);
  });
  it("explanations show saved confidence, both outcome counts, and the score actually used", () => {
    const question = { paperCount: 3, totalPapers: 5 };
    const profile = { topic: "TCP", topicKey: "tcp", weakness: 0.6, confidence: 2, correctCount: 1, incorrectCount: 4, baselineWeakness: 0.75 };
    const text = explainPriority(question, "TCP", profile);
    expect(text).toContain("Saved confidence: 2 of 5");
    expect(text).toContain("1 correct and 4 incorrect");
    expect(text).toContain(checkedPriority(3, 5, 0.6).priority.toFixed(3));
    expect(text).toContain("two prior observations (0.75)");
    expect(explainPriority(question, null)).toContain("your strength is unknown");
    expect(explainPriority({ paperCount: 7, totalPapers: 5 }, null)).toContain("safe defaults");
  });
  it("50 fixed valid/invalid trials preserve ranking rationale, bounds, and unknown states", () => {
    for (let i = 0; i < 50; i++) {
      const baseline = (i % 11) / 10;
      const weakness = evidenceWeakness(baseline, i % 7, i % 5);
      expect(weakness).toBeGreaterThanOrEqual(0);
      expect(weakness).toBeLessThanOrEqual(1);
      const q: ExamQuestion = { id: `q${i}`, text: "Explain TCP.", position: 1, rank: 1, paperCount: 1 + i % 3, totalPapers: 5, papers: [{ id: "p", title: "Source", year: 2025, term: null, professor: null, examType: null }], tier: "LIKELY" };
      const profile = new Map([["tcp", { topicKey: "tcp", topic: "TCP", weakness }]]);
      const result = personalizeQuestions([q], new Map([["p", "TCP"]]), profile);
      expect(result.questions[0].priorityExplanation).toContain(checkedPriority(q.paperCount, 5, weakness).priority.toFixed(3));
      expect(q.priorityExplanation).toBeUndefined();
      expect(practiceMessage(`untrusted-${i}`)).not.toContain(`untrusted-${i}`);
    }
  });
});

describe("grounded generation", () => {
  it("creates distinct tasks grounded in the exact source, without answer keys or arbitrary claims", () => {
    const source = "Compare TCP and UDP in a packet-switched network.";
    const all = (["EASY", "MEDIUM", "HARD"] as const).flatMap(difficulty => groundedPrompts(source, difficulty));
    expect(new Set(all.map(contentHash)).size).toBe(9);
    for (const prompt of all) {
      expect(prompt).toContain(source);
      expect(contentHash(prompt)).not.toBe(contentHash(source));
      expect(prompt).toContain("Practice task:");
    }
    expect(groundedPrompts(source, "MEDIUM")).toEqual(groundedPrompts(source, "MEDIUM"));
    expect(sourceFingerprint(source)).not.toBe(sourceFingerprint(source + " changed"));
  });
  it("validates count/difficulty/topic and does not expose untrusted error text", () => {
    const form = new FormData(); form.set("count", "3"); form.set("difficulty", "HARD"); form.set("topicKey", "tcp");
    expect(parseGenerationSettings(form)).toEqual({ count: 3, difficulty: "HARD", topicKey: "tcp" });
    for (const invalid of ["0", "11", "1.5", "3junk", "-1", "Infinity"]) { form.set("count", invalid); expect(parseGenerationSettings(form)).toBeNull(); }
    form.set("count", "1"); form.set("difficulty", "untrusted"); expect(parseGenerationSettings(form)).toBeNull();
    expect(generationMessage("<script>bad</script>")).not.toContain("script");
  });
  it("50 distinct course contexts have deterministic, novel tasks at every requested difficulty", () => {
    for (let i = 0; i < 50; i++) {
      const source = `Analyze course context ${i}: ${i + 2} nodes exchange ${i + 10} packets.`;
      for (const difficulty of ["EASY", "MEDIUM", "HARD"] as const) {
        const prompts = groundedPrompts(source, difficulty);
        expect(prompts.every(prompt => prompt.includes(source))).toBe(true);
        expect(new Set(prompts.map(contentHash)).size).toBe(3);
      }
    }
  });
});
