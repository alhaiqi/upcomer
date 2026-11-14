import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), getAdminUser: vi.fn(), record: vi.fn(), generate: vi.fn(), manage: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser, getAdminUser: mocks.getAdminUser }));
vi.mock("@/lib/learning-evidence", () => ({ recordPracticeOutcome: mocks.record }));
vi.mock("@/lib/practice-generation", () => ({ generatePracticeQuestions: mocks.generate }));
vi.mock("@/lib/file-management", () => ({ manageFile: mocks.manage }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { recordPracticeAction, generatePracticeAction } from "@/app/courses/[courseId]/practice/actions";
import { POST } from "@/app/api/admin/files/[fileId]/route";
import { resetRateLimits } from "@/lib/rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  mocks.requireUser.mockResolvedValue({ id: "session-student" });
  mocks.getAdminUser.mockResolvedValue({ id: "admin", role: "ADMIN" });
  mocks.record.mockResolvedValue({ ok: true }); mocks.generate.mockResolvedValue({ ok: true, questions: [{ id: "generated" }] });
  mocks.manage.mockResolvedValue({ ok: true, courseId: "course-a", cleanupPending: false });
});
const practiceForm = () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ courseId: "course-a", userId: "forged-user", questionId: "question-a", eventId: "attempt-a", outcome: "CORRECT", source: "MOCK_EXAM" })) form.set(key, value);
  return form;
};
describe("session-bound practice actions", () => {
  it("takes the user exclusively from the session and cannot accept forged mock grades", async () => {
    await expect(recordPracticeAction(practiceForm())).rejects.toThrow("redirect:/courses/course-a/practice?saved=1");
    expect(mocks.record).toHaveBeenCalledWith("session-student", "course-a", { questionId: "question-a", eventId: "attempt-a", outcome: "CORRECT" });
  });
  it("requires login before invoking either mutation", async () => {
    mocks.requireUser.mockRejectedValue(new Error("login required"));
    await expect(recordPracticeAction(practiceForm())).rejects.toThrow("login required");
    await expect(generatePracticeAction(practiceForm())).rejects.toThrow("login required");
    expect(mocks.record).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("rejects invalid generation settings and derives library ownership from the session", async () => {
    const form = practiceForm(); form.set("count", "99"); form.set("difficulty", "HARD");
    await expect(generatePracticeAction(form)).rejects.toThrow("error=invalid_settings");
    expect(mocks.generate).not.toHaveBeenCalled();
    form.set("count", "1");
    await expect(generatePracticeAction(form)).rejects.toThrow("generated=1");
    expect(mocks.generate).toHaveBeenCalledWith("session-student", "course-a", { count: 1, difficulty: "HARD", topicKey: undefined });
  });
});

describe("admin file management endpoint", () => {
  const context = { params: Promise.resolve({ fileId: "file-a" }) };
  const request = (over: RequestInit = {}) => {
    const form = new FormData(); form.set("operation", "remove"); form.set("confirm", "yes"); form.set("version", "2026-01-01T00:00:00.000Z");
    return new Request("http://localhost/api/admin/files/file-a", { method: "POST", body: form, ...over });
  };
  it("blocks visitors and students before reading the multipart payload", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    const req = request(); const read = vi.spyOn(req, "formData");
    expect((await POST(req, context)).status).toBe(403);
    expect(read).not.toHaveBeenCalled(); expect(mocks.manage).not.toHaveBeenCalled();
  });
  it("blocks cross-origin mutations", async () => {
    expect((await POST(request({ headers: { origin: "https://attacker.invalid" } }), context)).status).toBe(403);
    expect(mocks.manage).not.toHaveBeenCalled();
  });
  it("uses the browser Host behind Next's internal URL for origin validation and redirects", async () => {
    const response = await POST(request({ headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } }), context);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/admin/files?courseId=course-a&saved=1");
    const proxied = await POST(request({ headers: { host: "upcomer.test", "x-forwarded-proto": "https", origin: "https://upcomer.test" } }), context);
    expect(proxied.headers.get("location")).toMatch(/^https:\/\/upcomer.test\//);
  });
  it("forwards version/confirmation and redirects after a successful removal", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(303);
    expect(mocks.manage).toHaveBeenCalledWith("admin", "file-a", "2026-01-01T00:00:00.000Z", { operation: "remove", confirmed: true });
    expect(response.headers.get("location")).toContain("/admin/files?courseId=course-a&saved=1");
  });
  it("reports invalid input and oversized requests without mutation", async () => {
    const form = new FormData(); form.set("operation", "arbitrary");
    const bad = await POST(request({ body: form }), context);
    expect(bad.headers.get("location")).toContain("error=invalid_file");
    const large = await POST(request({ headers: { "content-length": "99999999" } }), context);
    expect(large.headers.get("location")).toContain("error=invalid_file");
    expect(mocks.manage).not.toHaveBeenCalled();
  });
});
