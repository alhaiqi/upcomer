import Link from "next/link";
import { notFound } from "next/navigation";
import { MockExamSitting } from "@/components/mock-exam-sitting";
import { requireUser } from "@/lib/auth";
import { getCourseById } from "@/lib/courses";
import { getMockExam } from "@/lib/mock-exams";
import { markMockExam } from "@/lib/mock-marking";
import { DIFFICULTY_LABELS, SAME_QUESTIONS_NOTE, sittingMessage } from "@/lib/mock-exam-rules";

export const dynamic = "force-dynamic";

// One mock exam, sat by its own student (US-45). The notices come from fixed query parameters; their values are never shown.
export default async function MockExamPage({ params, searchParams }: {
  params: Promise<{ courseId: string; mockExamId: string }>; searchParams: Promise<{ saved?: string; submitted?: string; error?: string; same?: string }>;
}) {
  const { courseId, mockExamId } = await params;
  const { saved, submitted, error, same } = await searchParams;
  const user = await requireUser(`/courses/${encodeURIComponent(courseId)}/mock-exams/${encodeURIComponent(mockExamId)}`);
  const [course, found] = await Promise.all([getCourseById(courseId), getMockExam(user.id, mockExamId)]);
  // Another student's exam, or one of another course, looks the same as one that doesn't exist.
  if (!course || !found || found.courseId !== courseId) notFound();
  // US-49: a submitted exam that is not marked yet (submitted before marking existed, or marking failed) is marked now.
  let exam = found;
  if (exam.status === "SUBMITTED" && !exam.markedAt) {
    const marked = await markMockExam(user.id, exam.id);
    if (marked.ok) exam = (await getMockExam(user.id, mockExamId)) ?? exam;
  }
  return <><Link className="back" href={`/courses/${courseId}/mock-exams`}>← Back to Mock Exams</Link><span className="eyebrow">{course.code}</span><h1>Mock Exam</h1>
    <p className="muted">{exam.length} questions · {DIFFICULTY_LABELS[exam.difficulty]} · {exam.topics.length ? exam.topics.join(", ") : "All topics"}{exam.includeGenerated ? " · with generated questions" : ""}</p>
    {same && !error && !saved && !submitted && <p className="notice" role="status">{SAME_QUESTIONS_NOTE}</p>}
    {saved && !error && <p className="notice" role="status">Your answers were saved.</p>}
    {submitted && !error && <p className="notice" role="status">Your exam was submitted.</p>}
    {error && <p className="notice error" role="alert">{sittingMessage(error)}</p>}
    {/* US-49: whether the answers were marked. */}
    {exam.status === "SUBMITTED" && <p className="muted" data-marked={exam.markedAt ? "yes" : "no"}>{exam.markedAt
      ? <>Your answers were marked against the answer keys. See each question below, or <Link href={`/courses/${encodeURIComponent(courseId)}/mock-exams/${encodeURIComponent(exam.id)}/results`}>See your results</Link>.</>
      : "Your answers could not be marked yet. Reload the page to try again."}</p>}
    <MockExamSitting exam={exam} />
  </>;
}
