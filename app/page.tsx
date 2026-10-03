import Link from "next/link";
import { CourseList } from "@/components/course-list";
import { getCatalogCourses, paginateCourses } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const { page: requestedPage, q = "" } = await searchParams;
  const query = q.trim();
  const { courses, page, totalPages } = paginateCourses(await getCatalogCourses({ query }), requestedPage);
  const pageHref = (number: number) => `/?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(number) })}`;
  return <><h1>Browse Courses</h1><p className="muted">Open a course to see its previous exams and materials.</p>
    <form className="search" action="/" method="get" role="search">
      <input type="search" name="q" defaultValue={query} placeholder="Search by course code or name" aria-label="Search courses" />
      <button className="button" type="submit">Search</button>
    </form>
    <CourseList courses={courses} emptyMessage={query ? "No courses found." : "No courses are available yet."} />
    {totalPages > 1 && <nav className="pagination" aria-label="Course pages">
      {page > 1 && <Link className="button" href={pageHref(page - 1)}>← Previous</Link>}
      <span className="muted">Page {page} of {totalPages}</span>
      {page < totalPages && <Link className="button" href={pageHref(page + 1)}>Next →</Link>}
    </nav>}
  </>;
}
