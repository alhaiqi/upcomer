import { CourseList } from "@/components/course-list";
import { getCatalogCourses } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const courses = await getCatalogCourses();
  return <><h1>Browse Courses</h1><p className="muted">Open a course to see its previous exams and materials.</p><CourseList courses={courses} emptyMessage="No courses are available yet." /></>;
}
