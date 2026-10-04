import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { getCourseById, addCourseAction } = vi.hoisted(() => ({ getCourseById: vi.fn(), addCourseAction: vi.fn() }));
vi.mock("@/lib/courses", () => ({ getCourseById }));
vi.mock("@/lib/my-courses-actions", () => ({ addCourseAction }));
import CoursePage from "@/app/courses/[courseId]/page";

const course = {
  id: "course-eece350", code: "EECE350", name: "Computer Networks",
  faculty: { name: "Faculty of Engineering" }, professors: [{ professor: { name: "Professor A" } }],
};
const props = (added?: string) => ({
  params: Promise.resolve({ courseId: course.id }),
  ...(added === undefined ? {} : { searchParams: Promise.resolve({ added }) }),
});

beforeEach(() => { getCourseById.mockReset().mockResolvedValue(course); });

describe("add to My Courses on the course page", () => {
  it("offers a submit button inside a form, so adding is never a prefetchable link", async () => {
    const html = renderToStaticMarkup(await CoursePage(props()));
    expect(html).toContain("Add to My Courses");
    expect(html).toContain('type="hidden" name="courseId" value="course-eece350"');
    expect(html).toMatch(/<form[^>]*>[\s\S]*Add to My Courses[\s\S]*<\/form>/);
    expect(html).not.toMatch(/<a[^>]*>\s*Add to My Courses/);
  });
  it("still shows the course resources Member 3's page provides", async () => {
    const html = renderToStaticMarkup(await CoursePage(props()));
    expect(html).toContain("Computer Networks");
    expect(html).toContain("Browse Previous Exams");
    expect(html).toContain("Browse Course Materials");
  });
  it.each([
    ["1", "Added to My Courses."],
    ["already", "Already in My Courses."],
  ])("confirms added=%s with %j and a link to My Courses", async (added, message) => {
    const html = renderToStaticMarkup(await CoursePage(props(added)));
    expect(html).toContain(message);
    expect(html).toContain('href="/my-courses"');
  });
  it("shows no confirmation on a plain visit", async () => {
    const html = renderToStaticMarkup(await CoursePage(props()));
    expect(html).not.toContain("Added to My Courses.");
    expect(html).not.toContain("Already in My Courses.");
  });
});
