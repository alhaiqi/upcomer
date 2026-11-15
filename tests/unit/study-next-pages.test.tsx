import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudyNext, StudyTopic } from "@/lib/study-next-rules";

// The "Study next" section of the course topics page (US-30).

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), getCourseById: vi.fn(), getStudyNext: vi.fn(), getTopicStrengths: vi.fn(), readTopicInputs: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/courses", () => ({ getCourseById: mocks.getCourseById }));
vi.mock("@/lib/study-next", () => ({ getStudyNext: mocks.getStudyNext }));
vi.mock("@/lib/topic-strengths", () => ({ getTopicStrengths: mocks.getTopicStrengths, readTopicInputs: mocks.readTopicInputs }));
import CourseTopicsPage from "@/app/courses/[courseId]/topics/page";

const course = { id: "course-a", code: "EECE350", name: "Computer Networks", faculty: { name: "Engineering" }, professors: [] };
const page = (courseId = course.id) => CourseTopicsPage({ params: Promise.resolve({ courseId }) }).then(renderToStaticMarkup);
const explanation = "Topic: Routing. Appeared in 2 of 5 published exam papers. Priority = exam share × (1 + 2 × weakness 0.80) = 1.040. Historical frequency is not a guarantee of future exams.";
const routing: StudyTopic = {
  topicKey: "routing", topic: "Routing", paperCount: 2, totalPapers: 5, weakness: 0.8, priority: 1.04, rated: true,
  reason: "In 2 of this course's 5 published exam papers. Rated 3 of 5, 0 correct and 3 incorrect.", explanation,
};
const next = (recommended: StudyTopic | null): StudyNext => ({ state: recommended ? "ok" : "no_topics", recommended, ranked: recommended ? [recommended] : [], coveredTopics: 0, invalidTopics: 0, reasons: [] });
// The "Study next" section alone.
const section = (html: string) => /<section[^>]*aria-labelledby="study-next">(.*?)<\/section>/.exec(html)?.[1] ?? "";

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue({ id: "student-1", role: "STUDENT" });
  mocks.getCourseById.mockReset().mockResolvedValue(course);
  mocks.readTopicInputs.mockReset().mockResolvedValue({ profile: new Map(), courseTopics: new Map(), totalPapers: 0 });
  mocks.getStudyNext.mockReset().mockResolvedValue(next(routing));
  mocks.getTopicStrengths.mockReset().mockResolvedValue({ state: "no_profile", ranked: [], strongest: [], weakest: [], invalidRows: 0 });
});

describe("the Study next section (US-30)", () => {
  it("reads once for the session student in this course, and gives both sections that read", async () => {
    await page();
    expect(mocks.readTopicInputs).toHaveBeenCalledTimes(1);
    expect(mocks.readTopicInputs).toHaveBeenCalledWith("student-1", "course-a");
    const inputs = mocks.readTopicInputs.mock.results[0].value;
    expect(mocks.getStudyNext).toHaveBeenCalledWith("student-1", "course-a", inputs);
    expect(mocks.getTopicStrengths).toHaveBeenCalledWith("student-1", "course-a", inputs);
  });
  it("reads nothing for a visitor or an unknown course", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(page()).rejects.toThrow("NEXT_REDIRECT");
    mocks.requireUser.mockResolvedValue({ id: "student-1", role: "STUDENT" });
    mocks.getCourseById.mockResolvedValue(null);
    await expect(page("no-such-course")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.readTopicInputs).not.toHaveBeenCalled();
    expect(mocks.getStudyNext).not.toHaveBeenCalled();
  });
  it("recommends the topic with its reason and how it is worked out, above the strongest and weakest topics", async () => {
    const html = await page();
    expect(section(html)).toContain("Study next</h2>");
    expect(section(html)).toContain("<h3>Routing</h3>");
    expect(section(html)).toContain("In 2 of this course&#x27;s 5 published exam papers. Rated 3 of 5, 0 correct and 3 incorrect.");
    expect(section(html)).toContain("<summary>How this is worked out</summary>");
    expect(section(html)).toContain("Historical frequency is not a guarantee of future exams.");
    expect(section(html)).toContain("It is not a guarantee of what the next exam will cover.");
    expect(html.indexOf("Study next</h2>")).toBeLessThan(html.indexOf("Strongest and weakest topics</h2>"));
  });
  it("gives the next actions: practice and the Upcomer Exam in the personal order", async () => {
    const html = section(await page());
    expect(html).toContain('<a href="/courses/course-a/practice">Practise questions</a>');
    expect(html).toContain('<a href="/courses/course-a/exam?order=personal">See the Upcomer Exam in your personal order</a>');
  });
  it("links to the ratings only for a topic the student has not rated", async () => {
    expect(section(await page())).not.toContain("/courses/course-a/confidence");
    mocks.getStudyNext.mockResolvedValue(next({ ...routing, rated: false }));
    expect(section(await page())).toContain('<a href="/courses/course-a/confidence">Rate your topics</a>');
  });
  it("shows a clear message instead of a recommendation when the course has no topics", async () => {
    mocks.getStudyNext.mockResolvedValue(next(null));
    const html = section(await page());
    expect(html).toContain("This course&#x27;s exam papers have no topics yet, so there is no topic to recommend.");
    expect(html).not.toContain("<h3>");
    expect(html).not.toContain("/practice");
  });
  it("never claims mastery, and never shows the student's ID or the topic's key attribute as text", async () => {
    const html = section(await page());
    expect(html).not.toMatch(/mastered|you have mastered|will be on the exam/i);
    expect(html).not.toContain("student-1");
  });
  it("escapes a topic's name", async () => {
    mocks.getStudyNext.mockResolvedValue(next({ ...routing, topic: "<b>C & C++</b>" }));
    expect(section(await page())).toContain("<h3>&lt;b&gt;C &amp; C++&lt;/b&gt;</h3>");
  });
});
