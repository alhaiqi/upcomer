import Link from "next/link";
import { CourseList } from "@/components/course-list";
import { getCatalogCourses, getCatalogFilterOptions, paginateCourses } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string; facultyId?: string; professorId?: string }> }) {
  const { page: requestedPage, ...params } = await searchParams;
  const filters = { query: params.q?.trim() ?? "", facultyId: params.facultyId?.trim() ?? "", professorId: params.professorId?.trim() ?? "" };
  const [allCourses, { faculties, professors }] = await Promise.all([getCatalogCourses(filters), getCatalogFilterOptions()]);
  const { courses, page, totalPages } = paginateCourses(allCourses, requestedPage);
  const filtered = Boolean(filters.query || filters.facultyId || filters.professorId);
  const unknownFaculty = Boolean(filters.facultyId) && !faculties.some(faculty => faculty.id === filters.facultyId);
  const unknownProfessor = Boolean(filters.professorId) && !professors.some(professor => professor.id === filters.professorId);
  const pageHref = (number: number) => `/?${new URLSearchParams({
    ...(filters.query ? { q: filters.query } : {}),
    ...(filters.facultyId ? { facultyId: filters.facultyId } : {}),
    ...(filters.professorId ? { professorId: filters.professorId } : {}),
    page: String(number),
  })}`;
  return <><h1>Browse Courses</h1><p className="muted">Open a course to see its previous exams and materials.</p>
    <form className="search" action="/" method="get" role="search">
      <input type="search" name="q" defaultValue={filters.query} placeholder="Search by course code or name" aria-label="Search courses" />
      <select name="facultyId" defaultValue={filters.facultyId} aria-label="Filter by faculty">
        <option value="">All faculties</option>        {faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
      </select>
      <select name="professorId" defaultValue={filters.professorId} aria-label="Filter by professor">
        <option value="">All professors</option>        {professors.map(professor => <option key={professor.id} value={professor.id}>{professor.name}</option>)}
      </select>
      <button className="button" type="submit">Search</button>
    </form>
    {unknownFaculty && <p className="muted" role="status">The selected faculty doesn&apos;t exist.</p>}
    {unknownProfessor && <p className="muted" role="status">The selected professor doesn&apos;t exist.</p>}
    <CourseList courses={courses} emptyMessage={filtered ? "No courses found." : "No courses are available yet."} />
    {totalPages > 1 && <nav className="pagination" aria-label="Course pages">
      {page > 1 && <Link className="button" href={pageHref(page - 1)}>← Previous</Link>}
      <span className="muted">Page {page} of {totalPages}</span>
      {page < totalPages && <Link className="button" href={pageHref(page + 1)}>Next →</Link>}
    </nav>}
  </>;
}
