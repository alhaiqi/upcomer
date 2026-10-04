import Link from "next/link";
import { UploadForm } from "@/components/upload-form";
import { getUploadOptions } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export default async function UploadExamPage({ searchParams }: { searchParams: Promise<{ courseId?: string }> }) {
  const { courseId } = await searchParams;
  const courses = await getUploadOptions();
  return <><Link className="back" href="/admin/uploads">← Back to uploads</Link><span className="eyebrow">Admin</span><h1>Upload Previous Exam</h1><UploadForm category="EXAM" courses={courses} initialCourseId={courseId} /></>;
}
