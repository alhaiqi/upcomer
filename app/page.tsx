import Link from "next/link";
import { CourseList } from "@/components/course-list";
import { getCatalogCourses, paginateCourses } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: requestedPage } = await searchParams;
  const { courses, page, totalPages } = paginateCourses(await getCatalogCourses(), requestedPage);
  return <><h1>Browse Courses</h1><p className="muted">Open a course to see its previous exams and materials.</p><CourseList courses={courses} emptyMessage="No courses are available yet." />
    {totalPages > 1 && <nav className="pagination" aria-label="Course pages">
      {page > 1 && <Link className="button" href={`/?page=${page - 1}`}>← Previous</Link>}
      <span className="muted">Page {page} of {totalPages}</span>
      {page < totalPages && <Link className="button" href={`/?page=${page + 1}`}>Next →</Link>}
    </nav>}
  </>;
}
