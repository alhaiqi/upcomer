// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

const { getUploadOptions, getTermOptions, requireUser, getMySubmissions } = vi.hoisted(() => ({
  getUploadOptions: vi.fn(), getTermOptions: vi.fn(), requireUser: vi.fn(), getMySubmissions: vi.fn(),
}));
vi.mock("@/lib/uploads", () => ({ getUploadOptions }));
vi.mock("@/lib/file-metadata", () => ({ getTermOptions }));
vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/submissions", async original => ({ ...(await original<typeof import("@/lib/submissions")>()), getMySubmissions }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/question-bank", () => ({ rebuildQuestionBank: vi.fn() }));
import SubmitPage from "@/app/submit/page";
import MySubmissionsPage from "@/app/my-submissions/page";
import { SubmissionForm } from "@/components/submission-form";

const courses = [
  { id: "course-a", code: "EECE350", name: "Computer Networks", professors: [{ id: "prof-a", name: "Professor A" }] },
  { id: "course-b", code: "EECE330", name: "Data Structures", professors: [] },
];
const terms = [{ id: "term-fall", name: "Fall" }];
const course = { id: "course-a", code: "EECE350", name: "Computer Networks" };
const submission = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Title ${id}`, status, category: "EXAM", rejectionReason: null, course, createdAt: new Date("2026-10-17T10:00:00Z"), ...extra,
});

beforeEach(() => {
  getUploadOptions.mockReset().mockResolvedValue(courses);
  getTermOptions.mockReset().mockResolvedValue(terms);
  requireUser.mockReset().mockResolvedValue({ id: "student-a", role: "STUDENT" });
  getMySubmissions.mockReset().mockResolvedValue([]);
});

describe("submit page", () => {
  it("needs a login and posts a plain multipart form", async () => {
    const html = renderToStaticMarkup(await SubmitPage({ searchParams: Promise.resolve({}) }));
    expect(requireUser).toHaveBeenCalledWith("/submit");
    expect(html).toContain("Submit an Exam or Material");
    expect(html).toContain('action="/api/submissions"');
    expect(html).toContain('method="post"');
    expect(html).toMatch(/enctype="multipart\/form-data"/i);
    expect(html).toContain('accept=".pdf,application/pdf"');
    expect(html).toContain("PDF only, up to 20 MB.");
    expect(html).toContain("EECE350 — Computer Networks");
    expect(html).toContain('<option value="term-fall">Fall</option>');
    expect(html).toContain('name="examType"');
    expect(html).toContain("An admin reviews it before other students can see it.");
  });
  it("shows the reason for a refused file and keeps the course and category", async () => {
    const html = renderToStaticMarkup(await SubmitPage({ searchParams: Promise.resolve({ error: "empty_file", courseId: "course-b", category: "MATERIAL" }) }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("The selected file is empty.");
    expect(html).toMatch(/<option value="course-b" selected="">/);
    expect(html).toMatch(/checked="" value="MATERIAL"/);
    expect(html).not.toContain('name="examType"');
  });
  it("shows a type only for exams", () => {
    render(<SubmissionForm courses={courses} terms={terms} />);
    expect(screen.getByLabelText("Type (optional)")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Course material"));
    expect(screen.queryByLabelText("Type (optional)")).toBeNull();
    fireEvent.click(screen.getByLabelText("A past exam"));
    expect(screen.getByLabelText("Type (optional)")).toBeTruthy();
  });
});

describe("My Submissions page", () => {
  it("needs a login and lists only the student's own submissions", async () => {
    await MySubmissionsPage({ searchParams: Promise.resolve({}) });
    expect(requireUser).toHaveBeenCalledWith("/my-submissions");
    expect(getMySubmissions).toHaveBeenCalledWith("student-a");
  });
  it("shows each status, and the reason when rejected (acceptance test 2)", async () => {
    getMySubmissions.mockResolvedValue([
      submission("file-p", "PENDING"),
      submission("file-ok", "PUBLISHED", { category: "MATERIAL" }),
      submission("file-no", "REJECTED", { rejectionReason: "Wrong course <b>bold</b>" }),
    ]);
    const html = renderToStaticMarkup(await MySubmissionsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('class="status-tag status-pending">Pending review<');
    expect(html).toContain('class="status-tag status-published">Published<');
    expect(html).toContain('class="status-tag status-rejected">Rejected<');
    expect(html).toContain("Reason: Wrong course &lt;b&gt;bold&lt;/b&gt;");
    expect(html.match(/Reason:/g)).toHaveLength(1);
    expect(html).toContain('href="/files/file-p"');
    expect(html).toContain('href="/courses/course-a"');
    expect(html).toContain("Submitted Oct 17, 2026");
  });
  it("confirms a new submission and has an empty state", async () => {
    const html = renderToStaticMarkup(await MySubmissionsPage({ searchParams: Promise.resolve({ submitted: "1" }) }));
    expect(html).toContain("Submitted for review.");
    expect(html).toContain("You haven&#x27;t submitted anything yet.");
    expect(html).toContain('href="/submit"');
  });
});
