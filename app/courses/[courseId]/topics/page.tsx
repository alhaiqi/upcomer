import Link from "next/link";
import { notFound } from "next/navigation";
import { CoveredTopicsSection } from "@/components/covered-topics";
import { TopicStrengthsSection } from "@/components/topic-strengths";
import { requireUser } from "@/lib/auth";
import { getCourseById } from "@/lib/courses";
import { StudyNextSection } from "@/components/study-next";
import { getStudyNext } from "@/lib/study-next";
import { coveredMessage, savedMessage } from "@/lib/topic-covered-rules";
import { getTopicStrengths, readTopicInputs } from "@/lib/topic-strengths";

export const dynamic = "force-dynamic";

// A student's topics in one course, read from this course's learning profile only: the topic to study next (US-30), their
// strongest and weakest topics (US-26), and the topics they marked as already covered (US-32), which are left out of the
// recommendation and labelled in the lists. After a covered save the page shows a notice from the `covered` or `error`
// query parameter; it never shows the parameter's value.
export default async function CourseTopicsPage({ params, searchParams }: {
  params: Promise<{ courseId: string }>; searchParams?: Promise<{ covered?: string | string[]; error?: string | string[] }>;
}) {
  const { courseId } = await params;
  const user = await requireUser(`/courses/${encodeURIComponent(courseId)}/topics`);
  const course = await getCourseById(courseId);
  if (!course) notFound();
  // One read for both sections, fresh on every page load, so recorded practice shows the next time the page opens.
  const inputs = readTopicInputs(user.id, courseId);
  const [next, strengths] = await Promise.all([getStudyNext(user.id, courseId, inputs), getTopicStrengths(user.id, courseId, inputs)]);
  // The read succeeded, or the line above has thrown. Every topic of the course in name order, with its covered state.
  const { courseTopics, covered } = await inputs;
  const topics = [...courseTopics].map(([topicKey, topic]) => ({ topicKey, topic: topic.topic, covered: covered.has(topicKey) }))
    .sort((a, b) => (a.topicKey < b.topicKey ? -1 : a.topicKey > b.topicKey ? 1 : 0));
  const query = await searchParams;
  const error = typeof query?.error === "string" ? coveredMessage(query.error) : query?.error ? coveredMessage("unexpected") : null;
  const saved = error ? null : savedMessage(typeof query?.covered === "string" ? query.covered : undefined);
  return <><Link className="back" href={`/courses/${courseId}`}>← Back to {course.code}</Link><span className="eyebrow">{course.code}</span><h1>Your topics</h1>
    <p className="muted">Where you stand in each topic of {course.code}, from your confidence ratings and recorded practice. It sets your personal order of the <Link href={`/courses/${courseId}/exam?order=personal`}>Upcomer Exam</Link>.</p>
    {error && <p className="notice error" role="alert" data-covered-notice>{error}</p>}
    {saved && <p className="notice" role="status" data-covered-notice>{saved}</p>}
    <StudyNextSection courseId={courseId} next={next} />
    <TopicStrengthsSection courseId={courseId} strengths={strengths} />
    <CoveredTopicsSection courseId={courseId} topics={topics} />
  </>;
}
