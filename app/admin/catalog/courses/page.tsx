import Link from "next/link";
import { CatalogNotice } from "@/components/catalog-notice";
import { CourseFields } from "@/components/course-fields";
import { requireAdmin } from "@/lib/auth";
import { saveCourseAction } from "@/lib/catalog-admin-actions";
import { getCatalogAdminData } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; value?: string }> }) {
  await requireAdmin("/admin/catalog/courses");
  const notice = await searchParams;
  const { courses, faculties, professors } = await getCatalogAdminData();
  return <><Link className="back" href="/admin/catalog">← Back to catalog</Link><span className="eyebrow">Admin</span><h1>Courses</h1>
    <CatalogNotice entity="course" {...notice} />
    {faculties.length ? <form className="card form" action={saveCourseAction}>
      <h2>Add a course</h2>
      <CourseFields faculties={faculties} professors={professors} />
      <button className="button" type="submit">Add course</button>
    </form> : <p className="card muted">Add a <Link href="/admin/catalog/faculties">faculty</Link> before adding courses.</p>}
    <h2>All courses</h2>
    {courses.length ? <ul className="list catalog-list">{courses.map(course => <li className="card" key={course.id}>
      <span className="eyebrow">{course.code}</span><h3>{course.name}</h3>
      <p className="muted">{course.faculty.name}{course.professors.length > 0 && ` · ${course.professors.map(item => item.professor.name).join(", ")}`}</p>
      <p className="catalog-links">
        <Link href={`/admin/catalog/courses/${course.id}`} aria-label={`Edit ${course.code}`}>Edit</Link>
        <Link href={`/admin/uploads/exams?courseId=${encodeURIComponent(course.id)}`}>Upload exam</Link>
        <Link href={`/courses/${course.id}`}>Open course</Link>
      </p>
    </li>)}</ul> : <p className="card muted">No courses yet.</p>}
  </>;
}
