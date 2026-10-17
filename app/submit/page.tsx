import Link from "next/link";
import { SubmissionForm } from "@/components/submission-form";
import { requireUser } from "@/lib/auth";
import { getTermOptions } from "@/lib/file-metadata";
import { submissionMessage } from "@/lib/submissions";
import { getUploadOptions } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export default async function SubmitPage({ searchParams }: { searchParams: Promise<{ error?: string; courseId?: string; category?: string }> }) {
  await requireUser("/submit");
  const { error, courseId, category } = await searchParams;
  const [courses, terms] = await Promise.all([getUploadOptions(), getTermOptions()]);
  return <><Link className="back" href="/my-submissions">← My Submissions</Link>
    <h1>Submit an Exam or Material</h1>
    <p className="muted">Share a past exam or course material you have. An admin reviews it before other students can see it.</p>
    {error && <p className="notice error" role="alert">{submissionMessage(error)}</p>}
    <SubmissionForm courses={courses} terms={terms} initialCourseId={courseId} initialCategory={category === "MATERIAL" ? "MATERIAL" : "EXAM"} />
  </>;
}
