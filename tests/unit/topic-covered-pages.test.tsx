import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudyNext, StudyTopic } from "@/lib/study-next-rules";
import type { RankedTopic, TopicStrengths } from "@/lib/topic-strengths-rules";

// US-32 on the course topics page: the "Covered topics" section and its forms, the label in the strongest and weakest
// lists, the button and the messages in "Study next", and the notices after a save.

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), getCourseById: vi.fn(), getStudyNext: vi.fn(), getTopicStrengths: vi.fn(), readTopicInputs: vi.fn(), action: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/courses", () => ({ getCourseById: mocks.getCourseById }));
vi.mock("@/lib/study-next", () => ({ getStudyNext: mocks.getStudyNext }));
vi.mock("@/lib/topic-strengths", () => ({ getTopicStrengths: mocks.getTopicStrengths, readTopicInputs: mocks.readTopicInputs }));
vi.mock("@/lib/topic-covered-actions", () => ({ setTopicCoveredAction: mocks.action }));
import CourseTopicsPage from "@/app/courses/[courseId]/topics/page";

const course = { id: "course-a", code: "EECE350", name: "Computer Networks", faculty: { name: "Engineering" }, professors: [] };
const page = (query: Record<string, string | string[]> = {}) =>
  CourseTopicsPage({ params: Promise.resolve({ courseId: course.id }), searchParams: Promise.resolve(query) }).then(renderToStaticMarkup);
const studyTopic = (name: string): StudyTopic => ({
  topicKey: name.toLowerCase(), topic: name, paperCount: 2, totalPapers: 5, weakness: 0.5, priority: 0.8, rated: true,
  reason: "In 2 of this course's 5 published exam papers. Rated 3 of 5, no practice recorded.", explanation: "Topic sum.",
});
const next = (recommended: StudyTopic | null, more: Partial<StudyNext> = {}): StudyNext =>
  ({ state: recommended ? "ok" : "no_topics", recommended, ranked: recommended ? [recommended] : [], coveredTopics: 0, invalidTopics: 0, reasons: [], ...more });
const ranked = (name: string, weakness: number, covered: boolean): RankedTopic =>
  ({ topicKey: name.toLowerCase(), topic: name, weakness, confidence: 3, correctCount: 0, incorrectCount: 0, paperCount: 1, evidence: `Evidence of ${name}`, covered });
const strengths = (lists: Partial<TopicStrengths> = {}): TopicStrengths => ({ state: "no_profile", ranked: [], strongest: [], weakest: [], invalidRows: 0, ...lists });
// The course's topics arrive newest paper first; the section sorts them by name.
const inputs = (covered: string[] = [], names = ["TCP", "DNS", "Routing"]) => ({
  profile: new Map(), totalPapers: 5, covered: new Set(covered),
  courseTopics: new Map(names.map(name => [name.toLowerCase(), { topic: name, paperCount: 1 }])),
});
const sectionOf = (html: string, id: string) => new RegExp(`<section[^>]*aria-labelledby="${id}">(.*?)</section>`).exec(html)?.[1] ?? "";
const coveredSection = (html: string) => sectionOf(html, "covered-topics");
// One topic's row of the "Covered topics" section.
const row = (html: string, topicKey: string) => new RegExp(`<li[^>]*data-topic="${topicKey}"[^>]*>(.*?)</li>`).exec(coveredSection(html))?.[0] ?? "";
const hidden = (html: string, name: string) => new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"`).exec(html)?.[1];
const notices = (html: string) => [...html.matchAll(/<p class="notice[^"]*" role="(status|alert)" data-covered-notice="true">(.*?)<\/p>/g)].map(match => [match[1], match[2]]);

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue({ id: "student-1", role: "STUDENT" });
  mocks.getCourseById.mockReset().mockResolvedValue(course);
  mocks.readTopicInputs.mockReset().mockResolvedValue(inputs());
  mocks.getStudyNext.mockReset().mockResolvedValue(next(studyTopic("TCP")));
  mocks.getTopicStrengths.mockReset().mockResolvedValue(strengths());
});

describe("the Covered topics section (US-32)", () => {
  it("lists every topic of the course in name order, below the other sections, from the page's one read", async () => {
    const html = await page();
    expect(mocks.readTopicInputs).toHaveBeenCalledTimes(1);
    expect(mocks.readTopicInputs).toHaveBeenCalledWith("student-1", "course-a");
    expect([...coveredSection(html).matchAll(/data-topic="([^"]*)"/g)].map(match => match[1])).toEqual(["dns", "routing", "tcp"]);
    expect(html.indexOf("Strongest and weakest topics</h2>")).toBeLessThan(html.indexOf("Covered topics</h2>"));
  });
  it("says what covered does and does not do, without claiming mastery", async () => {
    const html = coveredSection(await page());
    expect(html).toContain("Mark a topic you have already covered to leave it out of Study next.");
    expect(html).toContain("It does not change your ratings, your practice results or your personal order of the Upcomer Exam, and it does not mean you have mastered the topic.");
  });
  it("gives a topic that is not covered a form that marks it", async () => {
    const html = row(await page(), "routing");
    expect(html).toContain('data-state="not-covered"');
    expect(html).toContain("Not covered");
    expect(html).toContain('<button class="button" type="submit" aria-label="Mark as covered: Routing">Mark as covered</button>');
    expect(hidden(html, "courseId")).toBe("course-a");
    expect(hidden(html, "topicKey")).toBe("routing");
    expect(hidden(html, "covered")).toBe("1");
    expect(html).not.toContain("Undo covered");
  });
  it("gives a covered topic the label and a form that undoes it", async () => {
    mocks.readTopicInputs.mockResolvedValue(inputs(["routing"]));
    const html = await page();
    expect(row(html, "routing")).toContain('data-state="covered"');
    expect(row(html, "routing")).toMatch(/<em[^>]*data-covered="true">Covered<\/em>/);
    expect(row(html, "routing")).toContain('aria-label="Undo covered: Routing">Undo covered</button>');
    expect(hidden(row(html, "routing"), "covered")).toBe("0");
    expect(row(html, "routing")).not.toContain("Mark as covered");
    // The other topics are as they were.
    expect(hidden(row(html, "tcp"), "covered")).toBe("1");
    expect(row(html, "dns")).toContain("Not covered");
  });
  it("posts every form as a plain form, and never sends a user ID", async () => {
    const html = await page();
    expect(html.match(/<form/g)).toHaveLength(4);
    expect(html).not.toContain("student-1");
    expect(html).not.toContain('name="userId"');
  });
  it("ignores a covered flag for a topic the course no longer has", async () => {
    mocks.readTopicInputs.mockResolvedValue(inputs(["sorting"]));
    const html = coveredSection(await page());
    expect(html).not.toContain("sorting");
    expect(html).not.toContain("Undo covered");
  });
  it("shows a message and no form for a course without topics", async () => {
    mocks.readTopicInputs.mockResolvedValue(inputs([], []));
    mocks.getStudyNext.mockResolvedValue(next(null));
    const html = await page();
    expect(coveredSection(html)).toContain("so there is nothing to mark as covered.");
    expect(html).not.toContain("<form");
  });
  it("escapes a topic's name in the text, the label and the form", async () => {
    mocks.readTopicInputs.mockResolvedValue(inputs([], ['<b>"C" & C++</b>']));
    mocks.getStudyNext.mockResolvedValue(next(null));
    const html = coveredSection(await page());
    expect(html).toContain("<strong>&lt;b&gt;&quot;C&quot; &amp; C++&lt;/b&gt;</strong>");
    expect(html).not.toContain("<b>");
  });
});

describe("Study next with covered topics (US-32)", () => {
  const section = (html: string) => sectionOf(html, "study-next");
  it("has a button that marks the recommended topic as covered", async () => {
    const html = section(await page());
    expect(html).toContain('aria-label="Mark as covered: TCP">Mark as covered</button>');
    expect(hidden(html, "topicKey")).toBe("tcp");
    expect(hidden(html, "covered")).toBe("1");
    expect(html).not.toContain("left out");
  });
  it("says how many covered topics are left out", async () => {
    mocks.getStudyNext.mockResolvedValue(next(studyTopic("TCP"), { coveredTopics: 1 }));
    expect(section(await page())).toContain("1 topic you marked as covered is left out.");
    mocks.getStudyNext.mockResolvedValue(next(studyTopic("TCP"), { coveredTopics: 2 }));
    expect(section(await page())).toContain("2 topics you marked as covered are left out.");
  });
  it("shows the all-covered message instead of a recommendation", async () => {
    mocks.readTopicInputs.mockResolvedValue(inputs(["tcp", "dns", "routing"]));
    mocks.getStudyNext.mockResolvedValue(next(null, { state: "all_covered", coveredTopics: 3 }));
    const html = await page();
    expect(section(html)).toContain("You marked every topic of this course as covered, so there is no topic to recommend. Undo one below to get a recommendation again.");
    expect(section(html)).not.toContain("<h3>");
    expect(section(html)).not.toContain("<form");
    expect(section(html)).not.toContain("exam papers have no topics yet");
    // Every topic can be undone below.
    expect(coveredSection(html).match(/Undo covered<\/button>/g)).toHaveLength(3);
    expect(html).not.toMatch(/you have mastered the topic[^.]*\..*mastered/i);
  });
});

describe("strongest and weakest topics with covered topics (US-32)", () => {
  const section = (html: string) => sectionOf(html, "topic-strengths");
  const dns = ranked("DNS", 0.9, true);
  const routing = ranked("Routing", 0.5, false);
  const tcp = ranked("TCP", 0.1, false);
  it("labels a covered topic where it stands, and only that topic", async () => {
    mocks.getTopicStrengths.mockResolvedValue(strengths({ state: "ok", ranked: [dns, routing, tcp], weakest: [dns], strongest: [tcp] }));
    const html = section(await page());
    const weakest = /data-list="weakest">(.*?)<\/div>/.exec(html)![1];
    const strongest = /data-list="strongest">(.*?)<\/div>/.exec(html)![1];
    expect(weakest).toMatch(/<li><strong>DNS<\/strong><em[^>]*data-covered="true">Covered<\/em><span>Evidence of DNS<\/span><\/li>/);
    expect(strongest).toContain("<li><strong>TCP</strong><span>Evidence of TCP</span></li>");
    expect(strongest).not.toContain("Covered");
    expect(html).not.toMatch(/mastered/i);
  });
  it("labels a covered topic in the level list too", async () => {
    mocks.getTopicStrengths.mockResolvedValue(strengths({ state: "level", ranked: [dns, routing] }));
    const html = section(await page());
    expect(html.match(/data-covered="true"/g)).toHaveLength(1);
    expect(html).toMatch(/<strong>DNS<\/strong><em[^>]*>Covered<\/em>/);
  });
  it("shows no label without covered topics", async () => {
    mocks.getTopicStrengths.mockResolvedValue(strengths({ state: "ok", ranked: [routing, tcp], weakest: [routing], strongest: [tcp] }));
    expect(section(await page())).not.toContain("Covered");
  });
});

describe("the notice after a covered save (US-32)", () => {
  it("is absent on a plain visit", async () => {
    expect(notices(await page())).toEqual([]);
  });
  it("confirms a mark and an undo as a status", async () => {
    expect(notices(await page({ covered: "1" }))).toEqual([["status", "Marked as covered. It is left out of Study next."]]);
    expect(notices(await page({ covered: "0" }))).toEqual([["status", "No longer marked as covered."]]);
  });
  it("shows each refusal as an alert, above the sections", async () => {
    expect(notices(await page({ error: "unknown_topic" }))).toEqual([["alert", "That topic isn&#x27;t part of this course. Reload the page and try again."]]);
    expect(notices(await page({ error: "invalid_value" }))).toEqual([["alert", "That change could not be read. Reload the page and try again."]]);
    expect(notices(await page({ error: "rate_limited" }))).toEqual([["alert", "Too many changes in a minute. Wait a moment and try again."]]);
    const html = await page({ error: "unexpected" });
    expect(notices(html)).toEqual([["alert", "Your change could not be saved. Please try again."]]);
    expect(html.indexOf("data-covered-notice")).toBeLessThan(html.indexOf("Study next</h2>"));
  });
  it("shows the error alone when both parameters are there", async () => {
    expect(notices(await page({ covered: "1", error: "rate_limited" }))).toEqual([["alert", "Too many changes in a minute. Wait a moment and try again."]]);
  });
  it("never echoes a value typed into the URL", async () => {
    const html = await page({ error: "<script>alert(1)</script>" });
    expect(notices(html)).toEqual([["alert", "Your change could not be saved. Please try again."]]);
    expect(html).not.toContain("alert(1)");
    expect(notices(await page({ covered: "<script>alert(2)</script>" }))).toEqual([]);
    expect(notices(await page({ covered: ["1", "0"] }))).toEqual([]);
    expect(notices(await page({ error: ["rate_limited", "x"] }))).toEqual([["alert", "Your change could not be saved. Please try again."]]);
  });
});
