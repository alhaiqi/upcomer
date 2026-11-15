import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RankedTopic, StrengthState, TopicStrengths } from "@/lib/topic-strengths-rules";

// The course topics page (US-26) and the links to it from the confidence page and the Upcomer Exam.

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), getCurrentUser: vi.fn(), getCourseById: vi.fn(), getTopicStrengths: vi.fn(), getCourseTopics: vi.fn(), getTopicConfidence: vi.fn(),
  getConsolidatedExam: vi.fn(), getCourseProgress: vi.fn(), getPersonalOrder: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser, getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/courses", () => ({ getCourseById: mocks.getCourseById }));
// The page's one shared read, and the "Study next" section (US-30, tested in study-next-pages.test.tsx), are stubbed.
vi.mock("@/lib/topic-strengths", () => ({ getTopicStrengths: mocks.getTopicStrengths, readTopicInputs: vi.fn(async () => ({ profile: new Map(), courseTopics: new Map(), totalPapers: 0, covered: new Set() })) }));
// The covered form's action (US-32, tested in topic-covered-pages.test.tsx) is stubbed.
vi.mock("@/lib/topic-covered-actions", () => ({ setTopicCoveredAction: vi.fn() }));
vi.mock("@/lib/study-next", () => ({ getStudyNext: vi.fn(async () => ({ state: "no_topics", recommended: null, ranked: [], coveredTopics: 0, invalidTopics: 0, reasons: [] })) }));
vi.mock("@/lib/topic-confidence", () => ({ getCourseTopics: mocks.getCourseTopics, getTopicConfidence: mocks.getTopicConfidence, saveTopicConfidence: vi.fn() }));
vi.mock("@/lib/consolidated-exam", () => ({ getConsolidatedExam: mocks.getConsolidatedExam }));
vi.mock("@/lib/question-progress", () => ({ getCourseProgress: mocks.getCourseProgress }));
vi.mock("@/lib/personal-order", () => ({ getPersonalOrder: mocks.getPersonalOrder }));
vi.mock("@/lib/question-progress-actions", () => ({ markQuestionAction: vi.fn() }));
vi.mock("@/lib/question-report-actions", () => ({ reportQuestionAction: vi.fn() }));
import TopicConfidencePage from "@/app/courses/[courseId]/confidence/page";
import ConsolidatedExamPage from "@/app/courses/[courseId]/exam/page";
import CourseTopicsPage from "@/app/courses/[courseId]/topics/page";

const course = { id: "course-a", code: "EECE350", name: "Computer Networks", faculty: { name: "Engineering" }, professors: [] };
const student = { id: "student-1", role: "STUDENT" };
const page = (courseId = course.id) => CourseTopicsPage({ params: Promise.resolve({ courseId }) }).then(renderToStaticMarkup);
const topic = (name: string, weakness: number, evidence: string): RankedTopic =>
  ({ topicKey: name.toLowerCase(), topic: name, weakness, confidence: 3, correctCount: 0, incorrectCount: 0, paperCount: 1, evidence, covered: false });
const dns = topic("DNS", 0.9, "Rated 1 of 5, 0 correct and 2 incorrect");
const routing = topic("Routing", 0.5, "Not rated, 1 correct and 1 incorrect");
const tcp = topic("TCP", 0.1, "Rated 5 of 5, no practice recorded");
const strengths = (state: StrengthState, lists: Partial<TopicStrengths> = {}): TopicStrengths => ({ state, ranked: [], strongest: [], weakest: [], invalidRows: 0, ...lists });
// The text of one list's card.
const list = (html: string, name: string) => new RegExp(`<div class="card[^"]*" data-list="${name}">(.*?)</div>`).exec(html)?.[1] ?? "";
const rateLink = '<a href="/courses/course-a/confidence">Rate your topics</a>';
const topicsHref = 'href="/courses/course-a/topics"';

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(student);
  mocks.getCurrentUser.mockReset().mockResolvedValue(student);
  mocks.getCourseById.mockReset().mockResolvedValue(course);
  mocks.getTopicStrengths.mockReset().mockResolvedValue(strengths("ok", { ranked: [dns, routing, tcp], strongest: [tcp], weakest: [dns] }));
  mocks.notFound.mockClear();
});

describe("the course topics page (US-26)", () => {
  it("sends a visitor to log in and back to this page", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(page()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.requireUser).toHaveBeenCalledWith("/courses/course-a/topics");
    expect(mocks.getTopicStrengths).not.toHaveBeenCalled();
  });
  it("shows the not-found page for an unknown course", async () => {
    mocks.getCourseById.mockResolvedValue(null);
    await expect(page("no-such-course")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getTopicStrengths).not.toHaveBeenCalled();
  });
  it("reads the session student's strengths in this course", async () => {
    await page();
    expect(mocks.getTopicStrengths).toHaveBeenCalledWith("student-1", "course-a", expect.any(Promise));
  });
  it("lists the strongest and the weakest topics, each with what it rests on", async () => {
    const html = await page();
    expect(html).toContain("<h1>Your topics</h1>");
    expect(html).toContain("Strongest and weakest topics</h2>");
    // The list's class comes from a CSS module, so its name is hashed.
    expect(list(html, "strongest")).toMatch(/^<h3>Strongest so far<\/h3><ol class="[^"]*"><li><strong>TCP<\/strong><span>Rated 5 of 5, no practice recorded<\/span><\/li><\/ol>$/);
    expect(list(html, "weakest")).toContain("<h3>Weakest so far</h3>");
    expect(list(html, "weakest")).toContain("<li><strong>DNS</strong><span>Rated 1 of 5, 0 correct and 2 incorrect</span></li>");
    // The middle topic is in neither list.
    expect(html).not.toContain("Routing");
    expect(html).toContain("Based on your ratings and recorded practice results in this course. It is a guide, not a measure of mastery.");
    expect(html).toContain(rateLink);
  });
  it("never claims mastery, and never shows the student's ID or a raw score", async () => {
    const html = await page();
    expect(html).not.toMatch(/mastered|you have mastered|self-reported|0\.9|0\.1/i);
    expect(html).not.toContain("student-1");
  });
  it("keeps the order it is given: strongest first and weakest first", async () => {
    mocks.getTopicStrengths.mockResolvedValue(strengths("ok", { strongest: [tcp, routing], weakest: [dns, routing] }));
    const html = await page();
    expect(list(html, "strongest").indexOf("TCP")).toBeLessThan(list(html, "strongest").indexOf("Routing"));
    expect(list(html, "weakest").indexOf("DNS")).toBeLessThan(list(html, "weakest").indexOf("Routing"));
  });
  it("says so when one side has no topic that stands out", async () => {
    mocks.getTopicStrengths.mockResolvedValue(strengths("ok", { ranked: [dns, routing, routing], strongest: [], weakest: [dns] }));
    const html = await page();
    expect(list(html, "strongest")).toContain("No topic stands out as stronger than the rest yet.");
    expect(list(html, "weakest")).toContain("DNS");
  });
  it("escapes a topic's name", async () => {
    mocks.getTopicStrengths.mockResolvedValue(strengths("ok", { strongest: [topic("<b>C & C++</b>", 0, "Rated 5 of 5, no practice recorded")], weakest: [dns] }));
    expect(await page()).toContain("&lt;b&gt;C &amp; C++&lt;/b&gt;");
  });

  const insufficient: Array<[StrengthState, RankedTopic[], string]> = [
    ["no_profile", [], "You have no learning profile for this course yet, so there is nothing to compare."],
    ["no_evidence", [], "You skipped every topic and have no recorded practice, so there is nothing to compare yet."],
    ["too_few", [dns], "Only 1 topic has a rating or recorded practice. At least 2 are needed to compare."],
  ];
  it.each(insufficient)("%s: a clear message and a link to the ratings instead of a list", async (state, ranked, message) => {
    mocks.getTopicStrengths.mockResolvedValue(strengths(state as StrengthState, { ranked }));
    const html = await page();
    expect(html).toContain(message);
    expect(html).toContain(rateLink);
    expect(html).not.toContain("so far</h3>");
    expect(html).not.toContain("<ol");
    expect(html).not.toContain("DNS");
  });
  it("no_topics: says the course has no topics, with nothing to rate", async () => {
    mocks.getTopicStrengths.mockResolvedValue(strengths("no_topics"));
    const html = await page();
    expect(html).toContain("This course&#x27;s exam papers have no topics yet");
    expect(html).not.toContain(rateLink);
    expect(html).not.toContain("<ol");
  });
  it("level: says the topics are level and shows them without calling any strongest or weakest", async () => {
    mocks.getTopicStrengths.mockResolvedValue(strengths("level", { ranked: [dns, tcp] }));
    const html = await page();
    expect(html).toContain("Your 2 topics with a rating or recorded practice are level so far, so none stands out as strongest or weakest.");
    expect(html).toContain(rateLink);
    expect(html).not.toContain("Strongest so far");
    expect(html).not.toContain("Weakest so far");
    expect(list(html, "level")).toContain("<h3>Your topics so far</h3>");
    expect(list(html, "level")).toContain("DNS");
    expect(list(html, "level")).toContain("TCP");
  });
});

describe("links to the course topics page (US-26)", () => {
  const question = { id: "g1", position: 1, rank: 1, text: "Question 1.", paperCount: 1, totalPapers: 1, tier: "LIKELY", papers: [] };
  const exam = (searchParams: Record<string, string> = {}) =>
    ConsolidatedExamPage({ params: Promise.resolve({ courseId: course.id }), searchParams: Promise.resolve(searchParams) }).then(renderToStaticMarkup);
  const confidence = (searchParams: Record<string, string> = {}) =>
    TopicConfidencePage({ params: Promise.resolve({ courseId: course.id }), searchParams: Promise.resolve(searchParams) }).then(renderToStaticMarkup);
  beforeEach(() => {
    mocks.getCourseTopics.mockReset().mockResolvedValue([{ topicKey: "tcp", topic: "TCP" }]);
    mocks.getTopicConfidence.mockReset().mockResolvedValue(new Map());
    mocks.getConsolidatedExam.mockReset().mockResolvedValue({ totalPapers: 5, lowConfidence: false, questions: [question], sections: [{ tier: "LIKELY", questions: [question] }] });
    mocks.getCourseProgress.mockReset().mockResolvedValue(new Map());
    mocks.getPersonalOrder.mockReset().mockResolvedValue({ questions: [question], hasProfile: true });
  });
  it("from the confidence page, and from its saved notice", async () => {
    expect(await confidence()).toContain(`<a ${topicsHref}>See your strongest and weakest topics</a>`);
    expect((await confidence()).split(topicsHref)).toHaveLength(2);
    const saved = await confidence({ saved: "1" });
    expect(saved).toContain(`<a ${topicsHref}>your strongest and weakest topics</a>`);
    expect(saved.split(topicsHref)).toHaveLength(3);
  });
  it("from the Upcomer Exam for a logged-in student, once, in either order", async () => {
    for (const order of [{}, { order: "personal" }] as Array<Record<string, string>>) {
      const html = await exam(order);
      expect(html).toContain(`<a ${topicsHref}>See your strongest and weakest topics</a>`);
      expect(html.split(topicsHref)).toHaveLength(2);
    }
  });
  it("not from the Upcomer Exam for a visitor", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect(await exam()).not.toContain(topicsHref);
  });
});
