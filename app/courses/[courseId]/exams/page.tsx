import Link from "next/link";
import { notFound } from "next/navigation";
import { ResourceList } from "@/components/resource-list";
import { getCourseById, getCourseExams } from "@/lib/courses";

export default async function ExamsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const course = await getCourseById(courseId);
  if (!course) notFound();
  const exams = await getCourseExams(courseId);
  return <><Link className="back" href={`/courses/${courseId}`}>← Back to {course.code}</Link><span className="eyebrow">{course.code}</span><h1>Previous Exams</h1><ResourceList resources={exams} emptyMessage="No previous exams are available for this course yet." /></>;
}
