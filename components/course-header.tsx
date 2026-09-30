import type { getCourseById } from "@/lib/courses";

type Course = NonNullable<Awaited<ReturnType<typeof getCourseById>>>;
export function CourseHeader({ course }: { course: Course }) {
  return <header><span className="eyebrow">{course.code}</span><h1>{course.name}</h1><p className="muted">{course.faculty.name}</p>{course.professors.length > 0 && <p className="muted">{course.professors.map(item => item.professor.name).join(", ")}</p>}</header>;
}
