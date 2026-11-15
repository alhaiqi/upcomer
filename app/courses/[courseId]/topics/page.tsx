import Link from "next/link";
import { notFound } from "next/navigation";
import { TopicStrengthsSection } from "@/components/topic-strengths";
import { requireUser } from "@/lib/auth";
import { getCourseById } from "@/lib/courses";
import { StudyNextSection } from "@/components/study-next";
import { getStudyNext } from "@/lib/study-next";
import { getTopicStrengths, readTopicInputs } from "@/lib/topic-strengths";

export const dynamic = "force-dynamic";

// A student's topics in one course, read from this course's learning profile only: the topic to study next (US-30), then
// their strongest and weakest topics (US-26). Topics already covered (US-32) will be left out of the recommendation's
// `ranked` list and get their own section.
export default async function CourseTopicsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const user = await requireUser(`/courses/${encodeURIComponent(courseId)}/topics`);
  const course = await getCourseById(courseId);
  if (!course) notFound();
  // One read for both sections, fresh on every page load, so recorded practice shows the next time the page opens.
  const inputs = readTopicInputs(user.id, courseId);
  const [next, strengths] = await Promise.all([getStudyNext(user.id, courseId, inputs), getTopicStrengths(user.id, courseId, inputs)]);
  return <><Link className="back" href={`/courses/${courseId}`}>← Back to {course.code}</Link><span className="eyebrow">{course.code}</span><h1>Your topics</h1>
    <p className="muted">Where you stand in each topic of {course.code}, from your confidence ratings and recorded practice. It sets your personal order of the <Link href={`/courses/${courseId}/exam?order=personal`}>Upcomer Exam</Link>.</p>
    <StudyNextSection courseId={courseId} next={next} />
    <TopicStrengthsSection courseId={courseId} strengths={strengths} />
  </>;
}
