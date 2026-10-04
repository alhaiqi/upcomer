import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogNotice } from "@/components/catalog-notice";
import { CourseFields } from "@/components/course-fields";
import { requireAdmin } from "@/lib/auth";
import { saveCourseAction } from "@/lib/catalog-admin-actions";
import { getCatalogAdminData, getCourse } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function EditCoursePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; value?: string }> }) {
  await requireAdmin("/admin/catalog/courses");
  const [{ id }, notice] = await Promise.all([params, searchParams]);
  const [course, { faculties, professors }] = await Promise.all([getCourse(id), getCatalogAdminData()]);
  if (!course) notFound();
  return <><Link className="back" href="/admin/catalog/courses">← Back to courses</Link><span className="eyebrow">Admin</span><h1>Edit Course</h1>
    <CatalogNotice entity="course" {...notice} />
    <form className="card form" action={saveCourseAction}>
      <input type="hidden" name="id" value={course.id} />
      <CourseFields faculties={faculties} professors={professors}
        course={{ code: course.code, name: course.name, facultyId: course.facultyId, professorIds: course.professors.map(item => item.professorId) }} />
      <button className="button" type="submit">Save course</button>
    </form>
  </>;
}
