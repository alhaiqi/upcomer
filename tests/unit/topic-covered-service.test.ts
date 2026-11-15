import { beforeEach, describe, expect, it, vi } from "vitest";

// US-32: saving and reading the covered topics, with the database mocked. The transaction client has no learningTopic
// and no learningEvent on purpose: a covered save that touched the learning profile would throw here.
const mocks = vi.hoisted(() => {
  const tx = { $executeRaw: vi.fn(), coveredTopic: { createMany: vi.fn(), deleteMany: vi.fn() } };
  return {
    tx, courseFile: { findMany: vi.fn() }, learningTopic: { findMany: vi.fn() }, coveredTopic: { findMany: vi.fn() },
    transaction: vi.fn(), requireUser: vi.fn(), getCourseById: vi.fn(),
    notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
    redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); }),
  };
});
vi.mock("@/lib/db", () => ({ db: { courseFile: mocks.courseFile, learningTopic: mocks.learningTopic, coveredTopic: mocks.coveredTopic, $transaction: mocks.transaction } }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/courses", () => ({ getCourseById: mocks.getCourseById }));
import { resetRateLimits } from "@/lib/rate-limit";
import { getStudyNext } from "@/lib/study-next";
import { getCoveredTopics, setTopicCovered } from "@/lib/topic-covered";
import { setTopicCoveredAction } from "@/lib/topic-covered-actions";
import { getTopicStrengths, readTopicInputs } from "@/lib/topic-strengths";

const { tx } = mocks;
let errors: ReturnType<typeof vi.spyOn>;
let infos: ReturnType<typeof vi.spyOn>;
const logged = () => [...errors.mock.calls, ...infos.mock.calls].map(call => JSON.parse(String(call[0])));
const form = (topicKey: string, covered: string): Array<[string, string]> => [["courseId", "course-a"], ["topicKey", topicKey], ["covered", covered]];
class DatabaseDown extends Error { name = "DatabaseDown"; }

beforeEach(() => {
  resetRateLimits();
  delete process.env.TOPIC_COVERED_RATE_LIMIT_PER_MINUTE;
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  infos = vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.courseFile.findMany.mockReset().mockResolvedValue([{ topic: "Secret Routing" }, { topic: "TCP" }, { topic: "TCP" }]);
  mocks.learningTopic.findMany.mockReset().mockResolvedValue([]);
  mocks.coveredTopic.findMany.mockReset().mockResolvedValue([]);
  mocks.transaction.mockReset().mockImplementation(async (run: (client: typeof tx) => unknown) => run(tx));
  tx.$executeRaw.mockReset().mockResolvedValue(1);
  tx.coveredTopic.createMany.mockReset().mockResolvedValue({ count: 1 });
  tx.coveredTopic.deleteMany.mockReset().mockResolvedValue({ count: 1 });
  mocks.requireUser.mockReset().mockResolvedValue({ id: "student-1", role: "STUDENT" });
  mocks.getCourseById.mockReset().mockResolvedValue({ id: "course-a" });
});

describe("setTopicCovered", () => {
  it("marks a topic of the course for this student in this course, under the course profile's lock", async () => {
    expect(await setTopicCovered("student-1", "course-a", form("secret routing", "1"))).toEqual({ ok: true, covered: true, changed: true });
    // Only published exam papers define the course's topics.
    expect(mocks.courseFile.findMany.mock.calls[0][0].where).toMatchObject({ courseId: "course-a", category: "EXAM", status: "PUBLISHED" });
    expect(tx.coveredTopic.createMany).toHaveBeenCalledWith({ data: [{ userId: "student-1", courseId: "course-a", topicKey: "secret routing" }], skipDuplicates: true });
    expect(tx.coveredTopic.deleteMany).not.toHaveBeenCalled();
    // The same lock key as a confidence save and a practice outcome, taken before the write.
    expect(tx.$executeRaw.mock.calls[0][1]).toBe("learning-profile:student-1:course-a");
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.coveredTopic.createMany.mock.invocationCallOrder[0]);
  });
  it("undoes a mark by deleting only that student's row for that topic in that course", async () => {
    expect(await setTopicCovered("student-1", "course-a", form("tcp", "0"))).toEqual({ ok: true, covered: false, changed: true });
    expect(tx.coveredTopic.deleteMany).toHaveBeenCalledWith({ where: { userId: "student-1", courseId: "course-a", topicKey: "tcp" } });
    expect(tx.coveredTopic.createMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw.mock.calls[0][1]).toBe("learning-profile:student-1:course-a");
  });
  it("succeeds without a change when the topic already is as asked", async () => {
    tx.coveredTopic.createMany.mockResolvedValue({ count: 0 });
    tx.coveredTopic.deleteMany.mockResolvedValue({ count: 0 });
    expect(await setTopicCovered("student-1", "course-a", form("tcp", "1"))).toEqual({ ok: true, covered: true, changed: false });
    expect(await setTopicCovered("student-1", "course-a", form("tcp", "0"))).toEqual({ ok: true, covered: false, changed: false });
  });
  it("logs a save with IDs and the new state only", async () => {
    await setTopicCovered("student-1", "course-a", form("secret routing", "1"));
    expect(logged()).toMatchObject([{ event: "topic_covered_saved", level: "info", userId: "student-1", courseId: "course-a", covered: "true", changed: "true" }]);
    expect(JSON.stringify(logged())).not.toMatch(/secret|routing/i);
  });
  it("refuses a topic of another course or an unknown one, saves nothing, and logs the reason only", async () => {
    expect(await setTopicCovered("student-1", "course-a", form("secret dns", "1"))).toEqual({ ok: false, error: "unknown_topic" });
    // A course without published topics (or an unknown course) has no topic to mark.
    mocks.courseFile.findMany.mockResolvedValue([]);
    expect(await setTopicCovered("student-1", "course-b", form("secret routing", "1"))).toEqual({ ok: false, error: "unknown_topic" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(logged()).toMatchObject([
      { event: "topic_covered_refused", level: "warn", userId: "student-1", courseId: "course-a", reason: "unknown_topic" },
      { event: "topic_covered_refused", courseId: "course-b", reason: "unknown_topic" },
    ]);
    expect(JSON.stringify(logged())).not.toMatch(/secret|dns|routing/i);
  });
  it("refuses a tampered value and saves nothing", async () => {
    expect(await setTopicCovered("student-1", "course-a", form("tcp", "yes"))).toEqual({ ok: false, error: "invalid_value" });
    expect(await setTopicCovered("student-1", "course-a", [["topicKey", "tcp"], ["topicKey", "secret routing"], ["covered", "1"]])).toEqual({ ok: false, error: "invalid_value" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(logged().map(line => line.reason)).toEqual(["invalid_value", "invalid_value"]);
  });
  it("limits changes per student per minute, before reading anything", async () => {
    for (let i = 0; i < 30; i++) expect((await setTopicCovered("student-1", "course-a", form("tcp", i % 2 ? "0" : "1"))).ok).toBe(true);
    mocks.courseFile.findMany.mockClear();
    mocks.transaction.mockClear();
    errors.mockClear();
    infos.mockClear();
    expect(await setTopicCovered("student-1", "course-a", form("tcp", "1"))).toEqual({ ok: false, error: "rate_limited" });
    expect(mocks.courseFile.findMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(logged()).toMatchObject([{ event: "topic_covered_rate_limited", level: "warn", userId: "student-1" }]);
    expect(Number(logged()[0].retryAfterSeconds)).toBeGreaterThan(0);
    // Another student is not held back.
    expect((await setTopicCovered("student-2", "course-a", form("tcp", "1"))).ok).toBe(true);
  });
  it("takes the limit from the environment", async () => {
    process.env.TOPIC_COVERED_RATE_LIMIT_PER_MINUTE = "2";
    expect((await setTopicCovered("student-1", "course-a", form("tcp", "1"))).ok).toBe(true);
    expect((await setTopicCovered("student-1", "course-a", form("tcp", "0"))).ok).toBe(true);
    expect(await setTopicCovered("student-1", "course-a", form("tcp", "1"))).toEqual({ ok: false, error: "rate_limited" });
  });
  it("reports a failed save with the error's type, never its message or a topic", async () => {
    tx.coveredTopic.createMany.mockRejectedValue(new DatabaseDown("could not write secret routing"));
    expect(await setTopicCovered("student-1", "course-a", form("secret routing", "1"))).toEqual({ ok: false, error: "unexpected" });
    expect(logged().filter(line => line.event === "topic_covered_save_failed")).toMatchObject([{ level: "error", userId: "student-1", courseId: "course-a", errorType: "DatabaseDown" }]);
    expect(JSON.stringify(logged())).not.toMatch(/secret|routing/i);
  });
});

describe("reading the covered topics", () => {
  it("reads this student's rows in this course only", async () => {
    mocks.coveredTopic.findMany.mockResolvedValue([{ topicKey: "tcp" }]);
    expect(await getCoveredTopics("student-1", "course-a")).toEqual(new Set(["tcp"]));
    expect(mocks.coveredTopic.findMany).toHaveBeenCalledWith({ where: { userId: "student-1", courseId: "course-a" }, select: { topicKey: true } });
  });
  it("is part of the page's one shared read, and leaves the covered topic out of Study next", async () => {
    // TCP 2/3 × 2 beats Secret Routing 1/3 × 2 until TCP is covered.
    expect((await getStudyNext("student-1", "course-a")).recommended!.topicKey).toBe("tcp");
    mocks.coveredTopic.findMany.mockResolvedValue([{ topicKey: "tcp" }]);
    const inputs = readTopicInputs("student-1", "course-a");
    const [next, strengths] = await Promise.all([getStudyNext("student-1", "course-a", inputs), getTopicStrengths("student-1", "course-a", inputs)]);
    expect(next).toMatchObject({ state: "ok", coveredTopics: 1 });
    expect(next.recommended!.topicKey).toBe("secret routing");
    // Covered is not a profile: the student still has none.
    expect(strengths.state).toBe("no_profile");
    expect(mocks.coveredTopic.findMany).toHaveBeenCalledTimes(2);
  });
  it("names the covered read when it fails, in both sections' events, without a topic", async () => {
    mocks.coveredTopic.findMany.mockRejectedValue(new DatabaseDown("could not read secret routing"));
    const inputs = readTopicInputs("student-1", "course-a");
    await expect(Promise.all([getStudyNext("student-1", "course-a", inputs), getTopicStrengths("student-1", "course-a", inputs)])).rejects.toThrow(DatabaseDown);
    await expect(getTopicStrengths("student-1", "course-a", inputs)).rejects.toThrow(DatabaseDown);
    expect(logged().find(line => line.event === "study_recommendation_failed")).toMatchObject({ step: "covered", errorType: "DatabaseDown", userId: "student-1", courseId: "course-a" });
    expect(logged().find(line => line.event === "topic_strengths_retrieval_failed")).toMatchObject({ source: "covered", errorType: "DatabaseDown" });
    expect(JSON.stringify(logged())).not.toMatch(/secret|routing|tcp/i);
  });
});

describe("the covered action", () => {
  const data = (fields: Record<string, string>) => {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) formData.set(name, value);
    return formData;
  };
  it("asks for the session first and never reads a user ID from the form", async () => {
    await expect(setTopicCoveredAction(data({ courseId: "course-a", topicKey: "tcp", covered: "1", userId: "student-2" }))).rejects.toThrow("NEXT_REDIRECT /courses/course-a/topics?covered=1");
    expect(mocks.requireUser).toHaveBeenCalledWith("/courses/course-a/topics");
    expect(tx.coveredTopic.createMany.mock.calls[0][0].data).toEqual([{ userId: "student-1", courseId: "course-a", topicKey: "tcp" }]);
  });
  it("saves nothing for a visitor", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /login"));
    await expect(setTopicCoveredAction(data({ courseId: "course-a", topicKey: "tcp", covered: "1" }))).rejects.toThrow("NEXT_REDIRECT /login");
    expect(mocks.getCourseById).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("shows the not-found page for an unknown course", async () => {
    mocks.getCourseById.mockResolvedValue(null);
    await expect(setTopicCoveredAction(data({ courseId: "nope", topicKey: "tcp", covered: "1" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("comes back with the undo, or with the refusal's code", async () => {
    await expect(setTopicCoveredAction(data({ courseId: "course-a", topicKey: "tcp", covered: "0" }))).rejects.toThrow("NEXT_REDIRECT /courses/course-a/topics?covered=0");
    await expect(setTopicCoveredAction(data({ courseId: "course-a", topicKey: "secret dns", covered: "1" }))).rejects.toThrow("NEXT_REDIRECT /courses/course-a/topics?error=unknown_topic");
  });
});
