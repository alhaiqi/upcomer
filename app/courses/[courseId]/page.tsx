import Link from "next/link";
import { notFound } from "next/navigation";
import { CourseHeader } from "@/components/course-header";
import { getCourseById } from "@/lib/courses";

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const course = await getCourseById(courseId);
  if (!course) notFound();
  return <><CourseHeader course={course} /><h2>Course Resources</h2><div className="grid">
    <section className="card"><h2>Previous Exams</h2><p className="muted">Browse exams from earlier terms.</p><Link className="button" href={`/courses/${course.id}/exams`}>Browse Previous Exams</Link></section>
    <section className="card"><h2>Course Materials</h2><p className="muted">Find notes, slides, and readings.</p><Link className="button" href={`/courses/${course.id}/materials`}>Browse Course Materials</Link></section>
  </div></>;
}
