import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { requireAdmin, getReviewQueue } = vi.hoisted(() => ({ requireAdmin: vi.fn(), getReviewQueue: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/submission-review", () => ({ getReviewQueue }));
vi.mock("@/lib/submission-review-actions", () => ({ publishSubmissionAction: vi.fn(), rejectSubmissionAction: vi.fn() }));
import SubmissionQueuePage from "@/app/admin/submissions/page";

const course = { id: "course-eece350", code: "EECE350", name: "Computer Networks" };
const older = { id: "file-old", title: "Old Midterm", category: "EXAM", courseId: course.id, course, createdAt: new Date("2026-10-01T08:00:00Z"),
  submittedBy: { id: "student-1", name: "Student One" }, professor: null, term: { id: "term-fall", name: "Fall 2025" }, year: 2025, topic: null, examType: "MIDTERM" };
const newer = { ...older, id: "file-new", title: "New Notes", category: "MATERIAL", createdAt: new Date("2026-10-02T08:00:00Z"), examType: null, year: null, term: null, submittedBy: null };
const query = (params: Record<string, string> = {}) => ({ searchParams: Promise.resolve(params) });
const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await SubmissionQueuePage(query(params)));

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  getReviewQueue.mockReset().mockResolvedValue({ items: [older, newer], total: 2, page: 1, totalPages: 1 });
});

describe("review queue page", () => {
  it("checks admin access before reading the queue", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(SubmissionQueuePage(query())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(requireAdmin).toHaveBeenCalledWith("/admin/submissions");
    expect(getReviewQueue).not.toHaveBeenCalled();
  });
  it("lists submissions in queue order with their details and both review forms", async () => {
    const html = await render();
    expect(html.indexOf("Old Midterm")).toBeLessThan(html.indexOf("New Notes"));
    expect(html).toContain("Submitted by Student One on 2026-10-01 08:00 UTC");
    expect(html).toContain("Submitted by a deleted account");
    expect(html).toContain("Midterm · Fall 2025 · 2025");
    expect(html).toContain('href="/files/file-old"');
    expect(html).toContain('aria-label="Publish Old Midterm"');
    expect(html).toContain('aria-label="Reject New Notes"');
    expect(html).toMatch(/<textarea name="reason" required="" maxLength="500"/);
  });
  it("asks for the requested page, keeps it in the forms, and links to the others", async () => {
    getReviewQueue.mockResolvedValue({ items: [older], total: 45, page: 2, totalPages: 3 });
    const html = await render({ page: "2" });
    expect(getReviewQueue).toHaveBeenCalledWith(2);
    expect(html).toContain("45 submissions are waiting.");
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain('href="/admin/submissions?page=1"');
    expect(html).toContain('href="/admin/submissions?page=3"');
    expect(html).toContain('<input type="hidden" name="page" value="2"/>');
  });
  it("shows an empty queue without page links", async () => {
    getReviewQueue.mockResolvedValue({ items: [], total: 0, page: 1, totalPages: 1 });
    const html = await render();
    expect(html).toContain("No submissions are waiting for review.");
    expect(html).not.toContain("Page 1 of");
  });
  it("shows the outcome of the last review, and only known messages for errors", async () => {
    expect(await render({ published: "1" })).toContain("Published.");
    expect(await render({ rejected: "1" })).toContain("The student can see the reason.");
    expect(await render({ error: "rate_limited" })).toContain("Too many reviews in a minute.");
    const hostile = await render({ error: "<img src=x onerror=alert(1)>" });
    expect(hostile).toContain("Something went wrong.");
    expect(hostile).not.toContain("<img");
  });
  it("escapes titles and names from students", async () => {
    getReviewQueue.mockResolvedValue({ items: [{ ...older, title: "<script>alert(1)</script>", submittedBy: { id: "s", name: "<b>Eve</b>" } }], total: 1, page: 1, totalPages: 1 });
    const html = await render();
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<b>Eve</b>");
    expect(html).toContain("&lt;script&gt;");
  });
});
