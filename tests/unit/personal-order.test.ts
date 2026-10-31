import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamQuestion } from "@/lib/consolidated-exam";
import type { LearningProfile } from "@/lib/learning-profile";

const { courseFile, learningTopic } = vi.hoisted(() => ({ courseFile: { findMany: vi.fn() }, learningTopic: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: { courseFile, learningTopic } }));
import { getPersonalOrder, NEUTRAL_WEAKNESS, personalizeQuestions, personalPriority } from "@/lib/personal-order";

let errors: ReturnType<typeof vi.spyOn>;
const logged = () => errors.mock.calls.map(call => JSON.parse(String(call[0])));
// A question in `paperIds`, out of `total` papers, numbered by its place in the frequency order.
const question = (position: number, paperIds: string[], total = 4): ExamQuestion => ({
  id: `g${position}`, position, rank: position, text: `Question ${position}.`, paperCount: paperIds.length, totalPapers: total, tier: "LIKELY",
  papers: paperIds.map(id => ({ id, title: `Paper ${id}`, year: 2024, examType: null, term: null, professor: null })),
});
const profile = (weaknesses: Record<string, number>): LearningProfile =>
  new Map(Object.entries(weaknesses).map(([topicKey, weakness]) => [topicKey, { topicKey, topic: topicKey, weakness }]));
// Papers p1-p4: p1 and p2 are about TCP, p3 about routing, p4 has no topic.
const topics = new Map<string, string | null>([["p1", "TCP"], ["p2", " tcp "], ["p3", "Routing"], ["p4", null]]);
// The frequency order: a TCP question in 3 papers, a routing question in 2, a TCP question in 1, an untagged one in 1.
const exam = [question(1, ["p1", "p2", "p3"]), question(2, ["p3", "p4"]), question(3, ["p2"]), question(4, ["p4"])];
const order = (questions: ExamQuestion[]) => questions.map(item => item.position);

beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  courseFile.findMany.mockReset().mockResolvedValue([...topics].map(([id, topic]) => ({ id, topic })));
  learningTopic.findMany.mockReset().mockResolvedValue([]);
});

describe("personalPriority (placeholder for US-27)", () => {
  it("ranks the more frequent of two equally weak questions higher, and the weaker of two equally frequent ones", () => {
    expect(personalPriority(3, 4, 0.5)).toBeGreaterThan(personalPriority(2, 4, 0.5));
    expect(personalPriority(2, 4, 0.9)).toBeGreaterThan(personalPriority(2, 4, 0.1));
  });
  it("gives the same priority for the same inputs, and none without papers", () => {
    expect(personalPriority(2, 5, 0.3)).toBe(personalPriority(2, 5, 0.3));
    expect(personalPriority(0, 0, 1)).toBe(0);
  });
  it("uses a neutral weakness of one half for a topic without a score (placeholder for US-24)", () => {
    expect(NEUTRAL_WEAKNESS).toBe(0.5);
  });
});

describe("personalizeQuestions (US-28)", () => {
  it("reorders by the student's priorities: a weak topic moves its questions up", () => {
    // Weak in routing, strong in TCP: the routing question (2 papers) passes the TCP one (3 papers).
    const { questions, hasProfile } = personalizeQuestions(exam, topics, profile({ routing: 1, tcp: 0 }));
    expect(hasProfile).toBe(true);
    expect(order(questions)).toEqual([2, 1, 4, 3]);
  });
  it("gives two students with different profiles different orders of the same course", () => {
    const weakInTcp = order(personalizeQuestions(exam, topics, profile({ tcp: 1, routing: 0 })).questions);
    const weakInRouting = order(personalizeQuestions(exam, topics, profile({ tcp: 0, routing: 1 })).questions);
    expect(weakInTcp).toEqual([1, 3, 2, 4]);
    expect(weakInRouting).not.toEqual(weakInTcp);
  });
  it("returns the frequency order unchanged for a student without a profile in the course", () => {
    const result = personalizeQuestions(exam, topics, new Map());
    expect(result).toEqual({ questions: exam, hasProfile: false });
  });
  it("keeps the frequency order for ties, and uses the neutral weakness for an untagged question or an unscored topic", () => {
    // Every topic neutral: the order is the frequency order (priority follows the paper count, ties keep their place).
    expect(order(personalizeQuestions(exam, topics, profile({ other: 0.5 })).questions)).toEqual([1, 2, 3, 4]);
    // Question 4 has no topic: it ranks as neutral, above a 1-paper TCP question the student is strong in.
    expect(order(personalizeQuestions(exam, topics, profile({ tcp: 0 })).questions)).toEqual([2, 1, 4, 3]);
  });
  it("treats priorities that are equal but for rounding as a tie, so the frequency order decides", () => {
    // 3/5 × (0.5 + 0) and 1/5 × (0.5 + 1) are both 0.3, but the second is 0.30000000000000004 in floating point.
    expect(personalPriority(1, 5, 1)).not.toBe(personalPriority(3, 5, 0));
    const tied = [question(1, ["p1", "p2", "p3"], 5), question(2, ["p5"], 5)];
    const paperTopics = new Map([["p1", "TCP"], ["p2", "TCP"], ["p3", "TCP"], ["p5", "DNS"]]);
    expect(order(personalizeQuestions(tied, paperTopics, profile({ tcp: 0, dns: 1 })).questions)).toEqual([1, 2]);
  });
  it("keeps every question once, with its own number, and does not change the questions", () => {
    const before = structuredClone(exam);
    const { questions } = personalizeQuestions(exam, topics, profile({ routing: 1 }));
    expect([...order(questions)].sort()).toEqual([1, 2, 3, 4]);
    expect(questions.find(item => item.id === "g2")?.position).toBe(2);
    expect(exam).toEqual(before);
  });
  it("gives the same order every time for the same profile and exam", () => {
    const runs = Array.from({ length: 5 }, () => order(personalizeQuestions([...exam].reverse(), topics, profile({ routing: 0.7, tcp: 0.4 })).questions));
    expect(new Set(runs.map(run => run.join())).size).toBe(1);
  });
});

describe("getPersonalOrder (US-28)", () => {
  it("reads the student's profile in this course only, and this course's published papers' topics", async () => {
    learningTopic.findMany.mockResolvedValue([{ topicKey: "routing", topic: "Routing", weakness: 1 }, { topicKey: "tcp", topic: "TCP", weakness: 0 }]);
    const result = await getPersonalOrder("student-1", "course-a", exam);
    expect(learningTopic.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "student-1", courseId: "course-a" } }));
    expect(courseFile.findMany).toHaveBeenCalledWith({ where: { id: { in: ["p1", "p2", "p3", "p4"] }, courseId: "course-a", status: "PUBLISHED" }, select: { id: true, topic: true } });
    expect(order(result.questions)).toEqual([2, 1, 4, 3]);
    expect(result.hasProfile).toBe(true);
  });
  it("logs a failed read of the paper topics with IDs only, and rethrows", async () => {
    courseFile.findMany.mockRejectedValue(new TypeError("connection lost"));
    await expect(getPersonalOrder("student-1", "course-a", exam)).rejects.toThrow("connection lost");
    expect(logged()).toEqual([expect.objectContaining({ event: "learning_profile_retrieval_failed", userId: "student-1", courseId: "course-a", source: "personal_order", errorType: "TypeError" })]);
  });
});
