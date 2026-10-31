import { beforeEach, describe, expect, it, vi } from "vitest";

const { learningTopic } = vi.hoisted(() => ({ learningTopic: { findMany: vi.fn(), upsert: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: { learningTopic } }));
import { getLearningProfile, isWeakness, questionTopic, setTopicWeakness, topicKey } from "@/lib/learning-profile";

let errors: ReturnType<typeof vi.spyOn>;
const logged = () => errors.mock.calls.map(call => JSON.parse(String(call[0])));

beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  learningTopic.findMany.mockReset().mockResolvedValue([]);
  learningTopic.upsert.mockReset().mockResolvedValue({});
});

describe("topics (US-33)", () => {
  it("makes one key per topic, ignoring case and spacing", () => {
    expect(topicKey("  Congestion   Control ")).toBe("congestion control");
    expect(topicKey("TCP")).toBe(topicKey("tcp"));
    expect(topicKey(null)).toBe("");
    expect(topicKey("   ")).toBe("");
  });
  it("takes a question's topic from its papers: the most common, a tie going to the newest paper, untagged papers ignored", () => {
    expect(questionTopic([{ topic: "Routing" }, { topic: " tcp" }, { topic: "TCP" }, { topic: null }])).toEqual({ topicKey: "tcp", topic: "tcp" });
    expect(questionTopic([{ topic: "Routing" }, { topic: "TCP" }])).toEqual({ topicKey: "routing", topic: "Routing" });
    expect(questionTopic([{ topic: null }, { topic: "  " }])).toBeNull();
    expect(questionTopic([])).toBeNull();
  });
});

describe("getLearningProfile (US-33)", () => {
  it("reads one course's profile for one student", async () => {
    learningTopic.findMany.mockResolvedValue([{ topicKey: "tcp", topic: "TCP", weakness: 0.8 }]);
    const profile = await getLearningProfile("student-1", "course-a");
    expect(learningTopic.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "student-1", courseId: "course-a" } }));
    expect([...profile.entries()]).toEqual([["tcp", { topicKey: "tcp", topic: "TCP", weakness: 0.8 }]]);
  });
  it("logs a failed read with IDs only and rethrows", async () => {
    learningTopic.findMany.mockRejectedValue(new TypeError("connection lost"));
    await expect(getLearningProfile("student-1", "course-a")).rejects.toThrow("connection lost");
    expect(logged()).toEqual([expect.objectContaining({ event: "learning_profile_retrieval_failed", level: "error", userId: "student-1", courseId: "course-a", errorType: "TypeError" })]);
  });
});

describe("setTopicWeakness (US-33)", () => {
  it("writes only the row of the given student, course, and topic", async () => {
    expect(await setTopicWeakness("student-1", "course-a", "  Congestion   Control ", 0.75)).toEqual({ ok: true });
    expect(learningTopic.upsert).toHaveBeenCalledWith({
      where: { userId_courseId_topicKey: { userId: "student-1", courseId: "course-a", topicKey: "congestion control" } },
      create: { userId: "student-1", courseId: "course-a", topicKey: "congestion control", topic: "Congestion Control", weakness: 0.75 },
      update: { weakness: 0.75 },
    });
  });
  it("accepts 0 to 1 only, and needs a topic", async () => {
    expect([0, 0.5, 1].every(isWeakness)).toBe(true);
    for (const value of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await setTopicWeakness("student-1", "course-a", "TCP", value)).toEqual({ ok: false, error: "invalid_weakness" });
    }
    expect(await setTopicWeakness("student-1", "course-a", "  ", 0.5)).toEqual({ ok: false, error: "topic_required" });
    expect(learningTopic.upsert).not.toHaveBeenCalled();
  });
  it("logs a failed write with IDs only, never the topic", async () => {
    learningTopic.upsert.mockRejectedValue(new Error("down"));
    expect(await setTopicWeakness("student-1", "course-a", "Secret Topic Name", 0.5)).toEqual({ ok: false, error: "unexpected" });
    expect(logged()).toEqual([expect.objectContaining({ event: "learning_profile_update_failed", level: "error", userId: "student-1", courseId: "course-a" })]);
    expect(JSON.stringify(logged())).not.toMatch(/secret topic/i);
  });
});
