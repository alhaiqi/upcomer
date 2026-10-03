import Link from "next/link";
import type { getCatalogCourses } from "@/lib/catalog";

type Courses = Awaited<ReturnType<typeof getCatalogCourses>>;
export function CourseList({ courses, emptyMessage }: { courses: Courses; emptyMessage: string }) {
  if (!courses.length) return <p className="card muted">{emptyMessage}</p>;
  return <div className="list">{courses.map(course => <article className="card" key={course.id}>
    <span className="eyebrow">{course.code}</span>
    <h3>{course.name}</h3>
    <p className="muted">{course.faculty.name}</p>
    {course.professors.length > 0 && <p className="muted">{course.professors.map(item => item.professor.name).join(", ")}</p>}
    <Link className="button" href={`/courses/${course.id}`}>Open Course</Link>
  </article>)}</div>;
}
