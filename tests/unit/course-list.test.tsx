// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CourseList } from "@/components/course-list";

type Courses = React.ComponentProps<typeof CourseList>["courses"];
afterEach(cleanup);

describe("course list", () => {
  it("shows the empty state", () => {
    render(<CourseList courses={[]} emptyMessage="No courses yet" />);
    expect(screen.getByText("No courses yet")).toBeInTheDocument();
  });
  it("shows each course's code, name, faculty and professors and links to its page", () => {
    const course = {
      id: "course-a", code: "EECE350", name: "Computer Networks", faculty: { name: "Faculty of Engineering" },
      professors: [{ professor: { name: "Professor A" } }, { professor: { name: "Professor B" } }],
    };
    render(<CourseList courses={[course] as Courses} emptyMessage="No courses yet" />);
    expect(screen.getByText("EECE350")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Computer Networks" })).toBeInTheDocument();
    expect(screen.getByText("Faculty of Engineering")).toBeInTheDocument();
    expect(screen.getByText("Professor A, Professor B")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Course" })).toHaveAttribute("href", "/courses/course-a");
    expect(screen.queryByText("No courses yet")).not.toBeInTheDocument();
  });
  it("lists every course it is given and leaves out the professor line when there are none", () => {
    const courses = [
      { id: "course-a", code: "EECE350", name: "Computer Networks", faculty: { name: "Faculty of Engineering" }, professors: [] },
      { id: "course-b", code: "MATH201", name: "Calculus III", faculty: { name: "Faculty of Arts and Sciences" }, professors: [] },
    ];
    const { container } = render(<CourseList courses={courses as unknown as Courses} emptyMessage="No courses yet" />);
    expect(screen.getAllByRole("link", { name: "Open Course" }).map(link => link.getAttribute("href"))).toEqual(["/courses/course-a", "/courses/course-b"]);
    expect(container.querySelectorAll("article")[0].querySelectorAll("p")).toHaveLength(1);
  });
});
