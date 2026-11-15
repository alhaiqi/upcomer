import Link from "next/link";
import { notFound } from "next/navigation";
import { MockExamSitting } from "@/components/mock-exam-sitting";
import { requireUser } from "@/lib/auth";
import { getCourseById } from "@/lib/courses";
import { getMockExam } from "@/lib/mock-exams";
import { DIFFICULTY_LABELS, sittingMessage } from "@/lib/mock-exam-rules";

export const dynamic = "force-dynamic";

export default async function MockExamPage({ params, searchParams }: {
  params: Promise<{ courseId: string; mockExamId: string }>; searchParams: Promise<{ saved?: string; submitted?: string; error?: string }>;
}) {
  const { courseId, mockExamId } = await params;
  const { saved, submitted, error } = await searchParams;
  const user = await requireUser(`/courses/${encodeURIComponent(courseId)}/mock-exams/${encodeURIComponent(mockExamId)}`);
  const [course, exam] = await Promise.all([getCourseById(courseId), getMockExam(user.id, mockExamId)]);
  // Another student's exam, or one of another course, looks the same as one that doesn't exist.
  if (!course || !exam || exam.courseId !== courseId) notFound();
  return <><Link className="back" href={`/courses/${courseId}/mock-exams`}>← Back to Mock Exams</Link><span className="eyebrow">{course.code}</span><h1>Mock Exam</h1>
    <p className="muted">{exam.length} questions · {DIFFICULTY_LABELS[exam.difficulty]} · {exam.topics.length ? exam.topics.join(", ") : "All topics"}</p>
    {saved && <p className="notice" role="status">Your answers were saved.</p>}
    {submitted && <p className="notice" role="status">Your exam was submitted.</p>}
    {error && <p className="notice error" role="alert">{sittingMessage(error)}</p>}
    <MockExamSitting exam={exam} />
  </>;
}
