import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConsolidatedExam, ExamQuestion } from "@/lib/consolidated-exam";

// The Upcomer Exam for a logged-in student (US-21): the mark and undo forms, the progress line, the place to continue,
// and the progress error notice. Ali's report form (US-23) stays under every question.

const mocks = vi.hoisted(() => ({
  getCourseById: vi.fn(), getConsolidatedExam: vi.fn(), getCurrentUser: vi.fn(), getCourseProgress: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser, requireUser: vi.fn() }));
vi.mock("@/lib/courses", () => ({ getCourseById: mocks.getCourseById }));
vi.mock("@/lib/consolidated-exam", () => ({ getConsolidatedExam: mocks.getConsolidatedExam }));
vi.mock("@/lib/question-progress", () => ({ getCourseProgress: mocks.getCourseProgress }));
vi.mock("@/lib/question-progress-actions", () => ({ markQuestionAction: vi.fn() }));
vi.mock("@/lib/question-report-actions", () => ({ reportQuestionAction: vi.fn() }));
import ConsolidatedExamPage from "@/app/courses/[courseId]/exam/page";
import { ProgressSummary } from "@/components/question-progress";

const course = { id: "course-a", code: "EECE350", name: "Computer Networks", faculty: { name: "Engineering" }, professors: [] };
const question = (position: number): ExamQuestion => ({
  id: `g${position}`, position, rank: position, text: `Question text ${position}.`, paperCount: 1, totalPapers: 2, tier: "VERY_LIKELY",
  papers: [{ id: `p${position}`, title: `Exam ${position}`, year: 2024, examType: "FINAL", term: null, professor: null }],
});
const questions = [1, 2, 3].map(question);
const exam: ConsolidatedExam = { totalPapers: 2, lowConfidence: true, questions, sections: [{ tier: "VERY_LIKELY", questions }] };
const marks = (...ids: string[]) => new Map(ids.map(id => [id, { doneAt: new Date("2026-10-27T10:00:00Z") }]));
const page = (searchParams: Record<string, string> = {}) =>
  ConsolidatedExamPage({ params: Promise.resolve({ courseId: course.id }), searchParams: Promise.resolve(searchParams) }).then(renderToStaticMarkup);
const card = (html: string, position: number) => html.slice(html.indexOf(`id="question-${position}"`), html.indexOf(`id="question-${position + 1}"`) >>> 0);

beforeEach(() => {
  mocks.getCourseById.mockReset().mockResolvedValue(course);
  mocks.getConsolidatedExam.mockReset().mockResolvedValue(exam);
  mocks.getCurrentUser.mockReset().mockResolvedValue({ id: "student-1", role: "STUDENT" });
  mocks.getCourseProgress.mockReset().mockResolvedValue(marks());
});

describe("marking questions done on the Upcomer Exam (US-21)", () => {
  it("reads the session student's own marks for this course only", async () => {
    await page();
    expect(mocks.getCourseProgress).toHaveBeenCalledWith("student-1", "course-a");
  });
  it("gives every question a Mark done form for its group, and keeps the report form under it", async () => {
    const html = await page();
    for (const position of [1, 2, 3]) {
      const one = card(html, position);
      expect(one).toContain(`aria-label="Mark question ${position} done"`);
      expect(one).toContain(`name="groupId" value="g${position}"`);
      expect(one).toContain('name="choice" value="DONE"');
      expect(one).toContain(`Report a problem with question ${position}`);
      expect(one.indexOf("Mark done")).toBeLessThan(one.indexOf("Report a problem"));
    }
    expect(html).not.toContain("questions done.");
  });
  it("shows a done question as done, with Undo, and the others with Mark done", async () => {
    mocks.getCourseProgress.mockResolvedValue(marks("g1"));
    const html = await page();
    expect(card(html, 1)).toContain("✓ Done");
    expect(card(html, 1)).toContain('aria-label="Undo done on question 1"');
    expect(card(html, 1)).toContain('name="choice" value="UNDO"');
    expect(card(html, 2)).not.toContain("✓ Done");
    expect(card(html, 2)).toContain('aria-label="Mark question 2 done"');
  });
  it("says how far the student is and continues at the first question not yet done, in page order", async () => {
    mocks.getCourseProgress.mockResolvedValue(marks("g1", "g3"));
    const html = await page();
    expect(html).toContain("2 of 3 questions done.");
    expect(html).toContain('<a href="#question-2">Continue at question 2</a>');
  });
  it("says when every question is done, with nothing to continue", async () => {
    mocks.getCourseProgress.mockResolvedValue(marks("g1", "g2", "g3"));
    const html = await page();
    expect(html).toContain("You marked all 3 questions done.");
    expect(html).not.toContain("Continue at question");
  });
  it("shows a visitor no forms and no progress, and keeps the report log-in link as the last log-in link", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const html = await page();
    expect(mocks.getCourseProgress).not.toHaveBeenCalled();
    expect(html).not.toContain("Mark done");
    expect(html).toContain("Logged-in students can mark questions done, continue where they stopped, and see a personal order.");
    expect(html.match(/>Log in</g)).toHaveLength(1);
  });
  it("does not read progress for a course with nothing to mark", async () => {
    mocks.getConsolidatedExam.mockResolvedValue({ totalPapers: 0, lowConfidence: false, questions: [], sections: [] });
    await page();
    expect(mocks.getCourseProgress).not.toHaveBeenCalled();
  });
  it("shows a progress error as a known message only", async () => {
    expect(await page({ progress_error: "rate_limited" })).toContain("Too many changes in a minute.");
    const html = await page({ progress_error: "<img src=x onerror=alert(1)>" });
    expect(html).toContain("Your progress could not be saved.");
    expect(html).not.toContain("<img src=x");
  });
});

describe("ProgressSummary", () => {
  const positions = [{ id: "a", position: 1 }, { id: "b", position: 2 }];
  it("scrolls back to the question just marked, or else to the place to continue, and never to a position not on the page", () => {
    const scroll = (done: string[], at?: number) => {
      const element = ProgressSummary({ positions, done: new Set(done), at });
      const target = element.props.children[0];
      return target ? target.props.targetId : null;
    };
    expect(scroll(["a"], 1)).toBe("question-1");
    expect(scroll(["a"])).toBe("question-2");
    expect(scroll(["a", "b"], 2)).toBe("question-2");
    expect(scroll(["a", "b"])).toBeNull();
    expect(scroll([])).toBeNull();
    expect(scroll(["a"], 9)).toBe("question-2");
  });
  it("shows nothing before the first mark", () => {
    expect(renderToStaticMarkup(<ProgressSummary positions={positions} done={new Set()} />)).toBe("");
  });
  it("ignores marks of questions that are not on the page", () => {
    const html = renderToStaticMarkup(<ProgressSummary positions={positions} done={new Set(["b", "gone"])} />);
    expect(html).toContain("1 of 2 questions done.");
    expect(html).toContain("Continue at question 1");
  });
});
