import Link from "next/link";
import { FileMetadataNotice } from "@/components/file-metadata-notice";
import { requireAdmin } from "@/lib/auth";
import { getAdminFiles } from "@/lib/file-metadata";
import { examTypeLabel } from "@/lib/file-metadata-rules";
import { getUploadOptions } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export default async function AdminFilesPage({ searchParams }: { searchParams: Promise<{ courseId?: string; saved?: string; error?: string }> }) {
  await requireAdmin("/admin/files");
  const { courseId: requested, ...notice } = await searchParams;
  const courseId = requested?.trim() ?? "";
  const [files, courses] = await Promise.all([getAdminFiles(courseId || undefined), getUploadOptions()]);
  const unknownCourse = Boolean(courseId) && !courses.some(course => course.id === courseId);
  return <><Link className="back" href="/admin/catalog">← Back to catalog</Link><span className="eyebrow">Admin</span><h1>Files</h1>
    <p className="muted">Tag each exam and material with its course, professor, year, term, topic, and type.</p>
    <FileMetadataNotice {...notice} />
    <form className="search" action="/admin/files" method="get" role="search">
      <select name="courseId" defaultValue={courseId} aria-label="Filter by course">
        <option value="">All courses</option>
        {courses.map(course => <option key={course.id} value={course.id}>{course.code} — {course.name}</option>)}
      </select>
      <button className="button" type="submit">Filter</button>
    </form>
    {unknownCourse && <p className="muted" role="status">The selected course doesn&apos;t exist.</p>}
    {files.length ? <ul className="list catalog-list">{files.map(file => <li className="card" key={file.id}>
      <span className="eyebrow">{file.course.code} · {file.category === "EXAM" ? "Exam" : "Material"}</span><h3>{file.title}</h3>
      <p className="muted">{[
        file.examType && examTypeLabel(file.examType), file.term?.name, file.year, file.professor?.name, file.topic,
      ].filter(Boolean).join(" · ") || "No details yet."}</p>
      <p className="catalog-links">
        <Link href={`/admin/files/${encodeURIComponent(file.id)}`} aria-label={`Edit ${file.title}`}>Edit</Link>
        <Link href={`/courses/${file.courseId}/${file.category === "EXAM" ? "exams" : "materials"}`}>Open course page</Link>
      </p>
    </li>)}</ul> : <p className="card muted">{courseId ? "No files for this course yet." : "No files yet."}</p>}
  </>;
}
