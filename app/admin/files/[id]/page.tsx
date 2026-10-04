import Link from "next/link";
import { notFound } from "next/navigation";
import { FileMetadataFields } from "@/components/file-metadata-fields";
import { FileMetadataNotice } from "@/components/file-metadata-notice";
import { requireAdmin } from "@/lib/auth";
import { getAdminFile, getTermOptions } from "@/lib/file-metadata";
import { saveFileMetadataAction } from "@/lib/file-metadata-actions";
import { getUploadOptions } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export default async function EditFilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireAdmin("/admin/files");
  const [{ id }, notice] = await Promise.all([params, searchParams]);
  const [file, courses, terms] = await Promise.all([getAdminFile(id), getUploadOptions(), getTermOptions()]);
  if (!file) notFound();
  return <><Link className="back" href={`/admin/files?courseId=${encodeURIComponent(file.courseId)}`}>← Back to files</Link>
    <span className="eyebrow">Admin · {file.category === "EXAM" ? "Exam" : "Material"}</span><h1>Edit File Details</h1>
    <p className="muted">{file.title} <a href={`/files/${encodeURIComponent(file.id)}`} target="_blank" rel="noopener noreferrer">Open Original File</a></p>
    <FileMetadataNotice {...notice} />
    <form className="card form" action={saveFileMetadataAction}>
      <input type="hidden" name="id" value={file.id} />
      <FileMetadataFields category={file.category} courses={courses} terms={terms} file={file} />
      <button className="button" type="submit">Save file details</button>
    </form>
  </>;
}
