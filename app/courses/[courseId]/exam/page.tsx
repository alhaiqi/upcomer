import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolidatedExamView } from "@/components/consolidated-exam";
import { getConsolidatedExam } from "@/lib/consolidated-exam";
import { getCourseById } from "@/lib/courses";
import { MIN_CONFIDENT_PAPERS } from "@/lib/likelihood-tiers";

export const dynamic = "force-dynamic";

export default async function ConsolidatedExamPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const course = await getCourseById(courseId);
  if (!course) notFound();
  const exam = await getConsolidatedExam(courseId);
  const papers = `${exam.totalPapers} previous ${exam.totalPapers === 1 ? "exam" : "exams"}`;
  return <><Link className="back" href={`/courses/${courseId}`}>← Back to {course.code}</Link><span className="eyebrow">{course.code}</span><h1>Upcomer Exam</h1>
    {exam.totalPapers === 0
      ? <p className="card muted">No exam papers have been processed for this course yet. Once they are, every distinct question will appear here once, the most likely first.</p>
      : !exam.questions.length
        ? <p className="card muted">This course&apos;s questions are still being prepared. Please check back later.</p>
        : <>
          <p className="muted">{exam.questions.length} distinct {exam.questions.length === 1 ? "question" : "questions"} from {papers}, the most likely first. Each question is listed once.</p>
          {exam.lowConfidence && <p className="notice" role="note">Low confidence: these tiers are based on only {papers}. They become more reliable from {MIN_CONFIDENT_PAPERS} papers.</p>}
          <ConsolidatedExamView sections={exam.sections} />
        </>}
  </>;
}
