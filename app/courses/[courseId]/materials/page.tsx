import Link from "next/link";
import { notFound } from "next/navigation";
import { ResourceList } from "@/components/resource-list";
import { getCourseById, getCourseMaterials } from "@/lib/courses";

export default async function MaterialsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const course = await getCourseById(courseId);
  if (!course) notFound();
  const materials = await getCourseMaterials(courseId);
  return <><Link className="back" href={`/courses/${courseId}`}>← Back to {course.code}</Link><span className="eyebrow">{course.code}</span><h1>Course Materials</h1><ResourceList resources={materials} emptyMessage="No course materials are available yet." /></>;
}
