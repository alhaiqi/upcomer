import Link from "next/link";
import { UploadForm } from "@/components/upload-form";
import { requireAdmin } from "@/lib/auth";
import { getTermOptions } from "@/lib/file-metadata";
import { getUploadOptions } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export default async function UploadMaterialPage({ searchParams }: { searchParams: Promise<{ courseId?: string }> }) {
  await requireAdmin("/admin/uploads/materials");
  const { courseId } = await searchParams;
  const [courses, terms] = await Promise.all([getUploadOptions(), getTermOptions()]);
  return <><Link className="back" href="/admin/uploads">← Back to uploads</Link><span className="eyebrow">Admin</span><h1>Upload Course Material</h1><UploadForm category="MATERIAL" courses={courses} terms={terms} initialCourseId={courseId} /></>;
}
