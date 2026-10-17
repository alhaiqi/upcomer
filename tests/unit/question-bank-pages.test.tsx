import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), getCourseById: vi.fn(), getQuestionBank: vi.fn(), getQuestionBankFilterOptions: vi.fn(), getQuestionBankOverview: vi.fn(),
  rebuildQuestionBank: vi.fn(), redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/courses", () => ({ getCourseById: mocks.getCourseById }));
vi.mock("@/lib/question-bank", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/question-bank")>()),
  getQuestionBank: mocks.getQuestionBank, getQuestionBankFilterOptions: mocks.getQuestionBankFilterOptions,
  getQuestionBankOverview: mocks.getQuestionBankOverview, rebuildQuestionBank: mocks.rebuildQuestionBank,
}));
import QuestionBankPage from "@/app/courses/[courseId]/questions/page";
import AdminQuestionsPage from "@/app/admin/questions/page";
import { rebuildQuestionBankAction } from "@/lib/question-bank-actions";

const course = { id: "course-eece350", code: "EECE350", name: "Computer Networks", faculty: { name: "Engineering" }, professors: [] };
const group = (id: string, rank: number, text: string, paperCount: number) =>
  ({ id, rank, text, paperCount, course: { id: course.id, code: course.code, name: course.name }, questions: [], papers: [] });
const options = {
  years: [2025, 2024], examTypes: ["MIDTERM", "FINAL"],
  terms: [{ id: "term-fall", name: "Fall" }], professors: [{ id: "prof-a", name: "Professor A" }],
};
const page = async (params: Record<string, string> = {}, courseId = course.id) =>
  renderToStaticMarkup(await QuestionBankPage({ params: Promise.resolve({ courseId }), searchParams: Promise.resolve(params) }));

beforeEach(() => {
  Object.values(mocks).forEach(mock => "mockClear" in mock && mock.mockClear());
  mocks.requireAdmin.mockReset().mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  mocks.getCourseById.mockReset().mockResolvedValue(course);
  mocks.getQuestionBankFilterOptions.mockReset().mockResolvedValue(options);
  mocks.getQuestionBank.mockReset().mockResolvedValue({ totalPapers: 3, groups: [group("g1", 1, "Define a socket.", 3), group("g2", 2, "Explain ARP.", 1)] });
});

describe("question bank page (US-20)", () => {
  it("lists the questions in ranking order with their rank and paper count", async () => {
    const html = await page();
    expect(html).toContain("Question Bank");
    expect(html).toContain("Questions from 3 previous exams");
    expect(html.indexOf("Define a socket.")).toBeLessThan(html.indexOf("Explain ARP."));
    expect(html).toContain("Rank 1");
    expect(html).toContain("Appeared in 3 papers");
    expect(html).toContain("Appeared in 1 paper<");
  });
  it("passes the keyword and filters through together and keeps them selected", async () => {
    const html = await page({ q: "socket", year: "2024", termId: "term-fall", examType: "FINAL", professorId: "prof-a" });
    expect(mocks.getQuestionBank).toHaveBeenCalledWith(course.id, { query: "socket", year: "2024", termId: "term-fall", examType: "FINAL", professorId: "prof-a" });
    expect(html).toContain('value="socket"');
    expect(html).toMatch(/<option value="2024" selected="">2024<\/option>/);
    expect(html).toMatch(/<option value="term-fall" selected="">Fall<\/option>/);
    expect(html).toMatch(/<option value="FINAL" selected="">Final<\/option>/);
    expect(html).toMatch(/<option value="prof-a" selected="">Professor A<\/option>/);
    expect(html).toContain("Clear search and filters");
  });
  it("shows a no-match message when the search finds nothing", async () => {
    mocks.getQuestionBank.mockResolvedValue({ totalPapers: 3, groups: [] });
    expect(await page({ q: "zzz" })).toContain("No questions match your search.");
  });
  it("shows an empty-course message and no search form when nothing was extracted", async () => {
    mocks.getQuestionBank.mockResolvedValue({ totalPapers: 0, groups: [] });
    const html = await page();
    expect(html).toContain("No questions have been extracted for this course yet.");
    expect(html).not.toContain('role="search"');
  });
  it("returns not found for an unknown course", async () => {
    mocks.getCourseById.mockResolvedValue(null);
    await expect(page({}, "course-x")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getQuestionBank).not.toHaveBeenCalled();
  });
});

describe("admin question bank page", () => {
  const overview = [{ id: course.id, code: course.code, name: course.name, groupCount: 4, papers: 2, questions: 9 }];
  const admin = async (params: Record<string, string> = {}) => renderToStaticMarkup(await AdminQuestionsPage({ searchParams: Promise.resolve(params) }));

  it("checks the admin first and lists each course's counts with a regroup button", async () => {
    mocks.getQuestionBankOverview.mockResolvedValue(overview);
    const html = await admin();
    expect(mocks.requireAdmin).toHaveBeenCalledWith("/admin/questions");
    expect(html).toContain("9 questions from 2 papers · 4 distinct");
    expect(html).toContain('aria-label="Regroup and rank EECE350"');
  });
  it("shows the result of a regroup and the errors", async () => {
    mocks.getQuestionBankOverview.mockResolvedValue(overview);
    expect(await admin({ rebuilt: course.id, groups: "4" })).toContain("Regrouped EECE350: 4 distinct questions.");
    expect(await admin({ error: "not_found" })).toContain("That course doesn&#x27;t exist anymore.");
    expect(await admin({ error: "other" })).toContain("The questions could not be grouped.");
  });
  it("does not load anything for a non-admin", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(admin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getQuestionBankOverview).not.toHaveBeenCalled();
  });
  it("shows an empty message when no questions exist", async () => {
    mocks.getQuestionBankOverview.mockResolvedValue([]);
    expect(await admin()).toContain("No questions have been extracted yet.");
  });
});

describe("rebuildQuestionBankAction", () => {
  const form = (courseId: string) => { const data = new FormData(); data.set("courseId", courseId); return data; };
  it("checks the admin before regrouping, then reports the result", async () => {
    mocks.rebuildQuestionBank.mockResolvedValue({ ok: true, groupCount: 4, questionCount: 9 });
    await expect(rebuildQuestionBankAction(form(course.id))).rejects.toThrow(`NEXT_REDIRECT /admin/questions?rebuilt=${course.id}&groups=4`);
    expect(mocks.requireAdmin.mock.invocationCallOrder[0]).toBeLessThan(mocks.rebuildQuestionBank.mock.invocationCallOrder[0]);
  });
  it("reports a failure", async () => {
    mocks.rebuildQuestionBank.mockResolvedValue({ ok: false, error: "not_found" });
    await expect(rebuildQuestionBankAction(form("course-x"))).rejects.toThrow("NEXT_REDIRECT /admin/questions?error=not_found");
  });
  it("never regroups for a non-admin", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(rebuildQuestionBankAction(form(course.id))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.rebuildQuestionBank).not.toHaveBeenCalled();
  });
});
