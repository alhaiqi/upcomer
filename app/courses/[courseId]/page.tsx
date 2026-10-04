import Link from "next/link";
import { notFound } from "next/navigation";
import { CourseHeader } from "@/components/course-header";
import { getCourseById } from "@/lib/courses";
import { addCourseAction } from "@/lib/my-courses-actions";

export default async function CoursePage({ params, searchParams }: { params: Promise<{ courseId: string }>; searchParams?: Promise<{ added?: string }> }) {
  const { courseId } = await params;
  const { added } = (await searchParams) ?? {};
  const course = await getCourseById(courseId);
  if (!course) notFound();
  return <><CourseHeader course={course} />
    <form className="inline-form" action={addCourseAction}>
      <input type="hidden" name="courseId" value={course.id} />
      <button className="button" type="submit">Add to My Courses</button>
    </form>
    {added && <p className="notice" role="status">{added === "already" ? "Already in My Courses." : "Added to My Courses."} <Link href="/my-courses">Open My Courses</Link></p>}
    <h2>Course Resources</h2><div className="grid">
    <section className="card"><h2>Previous Exams</h2><p className="muted">Browse exams from earlier terms.</p><Link className="button" href={`/courses/${course.id}/exams`}>Browse Previous Exams</Link></section>
    <section className="card"><h2>Course Materials</h2><p className="muted">Find notes, slides, and readings.</p><Link className="button" href={`/courses/${course.id}/materials`}>Browse Course Materials</Link></section>
  </div></>;
}
