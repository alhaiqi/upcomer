import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { saveSubmission, getCurrentUser } = vi.hoisted(() => ({ saveSubmission: vi.fn(), getCurrentUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/submissions", () => ({ saveSubmission }));
import { POST } from "@/app/api/submissions/route";
import { UploadError } from "@/lib/uploads";

const pdf = Buffer.from("%PDF-1.4\nexample");
function submit(fields: Record<string, string> = {}, file: File | null = new File([pdf], "my-final.pdf")) {
  const form = new FormData();
  for (const [name, value] of Object.entries({ category: "EXAM", courseId: "course-a", title: "Secret Title", ...fields })) form.set(name, value);
  if (file) form.set("file", file);
  return new Request("http://localhost/api/submissions", { method: "POST", body: form });
}
// Relative, so the browser keeps the host it used.
const location = (response: Response) => response.headers.get("location");

let errors: ReturnType<typeof vi.spyOn>;
const logged = () => errors.mock.calls.map(call => JSON.parse(String(call[0])));
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  getCurrentUser.mockReset().mockResolvedValue({ id: "student-a", role: "STUDENT" });
  saveSubmission.mockReset().mockResolvedValue({ id: "file-new" });
});
afterEach(() => errors.mockRestore());

describe("submission route", () => {
  it("saves the submission for the logged-in student and goes to My Submissions", async () => {
    const response = await POST(submit({ professorId: "prof-a", year: "2025", termId: "term-fall", examType: "FINAL" }));
    expect(response.status).toBe(303);
    expect(location(response)).toBe("/my-submissions?submitted=1");
    const [userId, input] = saveSubmission.mock.calls[0];
    expect(userId).toBe("student-a");
    expect(input).toMatchObject({ courseId: "course-a", category: "EXAM", title: "Secret Title", fileName: "my-final.pdf", professorId: "prof-a", year: 2025, termId: "term-fall", examType: "FINAL" });
    expect(Buffer.from(input.bytes)).toEqual(pdf);
  });
  it("sends a visitor to log in without reading the form", async () => {
    getCurrentUser.mockResolvedValue(null);
    const response = await POST(submit());
    expect(location(response)).toBe("/login?next=%2Fsubmit");
    expect(saveSubmission).not.toHaveBeenCalled();
    expect(logged()).toContainEqual(expect.objectContaining({ event: "unauthorized_access", route: "POST /api/submissions", role: "anonymous" }));
  });
  it("goes back to the form with the reason, course, and category when the file is refused", async () => {
    saveSubmission.mockRejectedValue(new UploadError("unsupported_type", "Only PDF files can be submitted."));
    const response = await POST(submit({ category: "MATERIAL", courseId: "course-b" }, new File([pdf], "notes.docx")));
    expect(location(response)).toBe("/submit?error=unsupported_type&courseId=course-b&category=MATERIAL");
    expect(logged()).toEqual([expect.objectContaining({ event: "submission_refused", level: "warn", reason: "unsupported_type", courseId: "course-b", resourceCategory: "MATERIAL", userId: "student-a" })]);
    expect(JSON.stringify(logged())).not.toMatch(/Secret Title|notes\.docx/);
  });
  it("refuses a missing file or title before saving", async () => {
    expect(location(await POST(submit({}, null)))).toContain("/submit?error=invalid_fields");
    expect(location(await POST(submit({ title: "" })))).toContain("/submit?error=invalid_fields");
    expect(saveSubmission).not.toHaveBeenCalled();
  });
  it("refuses an oversized request from its length", async () => {
    const request = new Request("http://localhost/api/submissions", { method: "POST", headers: { "content-length": String(30 * 1024 * 1024) }, body: "x" });
    expect(location(await POST(request))).toBe("/submit?error=file_too_large");
    expect(logged()).toContainEqual(expect.objectContaining({ event: "submission_refused", reason: "file_too_large" }));
  });
  it("does not log storage failures twice", async () => {
    saveSubmission.mockRejectedValue(new UploadError("storage_failed", "The file could not be stored."));
    expect(location(await POST(submit()))).toBe("/submit?error=storage_failed&courseId=course-a&category=EXAM");
    expect(logged()).toEqual([]);
  });
  it("logs an unexpected failure as a failed submission", async () => {
    saveSubmission.mockRejectedValue(new TypeError("boom"));
    expect(location(await POST(submit()))).toBe("/submit?error=submission_failed&courseId=course-a&category=EXAM");
    expect(logged()).toEqual([expect.objectContaining({ event: "submission_failed", level: "error", errorType: "TypeError", userId: "student-a" })]);
  });
  it("never echoes an unknown category back", async () => {
    saveSubmission.mockRejectedValue(new UploadError("invalid_fields", "Choose whether this is an exam or a material."));
    expect(location(await POST(submit({ category: "<script>" })))).toBe("/submit?error=invalid_fields&courseId=course-a");
  });
});
