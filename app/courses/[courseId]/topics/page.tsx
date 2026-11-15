import Link from "next/link";
import { notFound } from "next/navigation";
import { TopicStrengthsSection } from "@/components/topic-strengths";
import { requireUser } from "@/lib/auth";
import { getCourseById } from "@/lib/courses";
import { getTopicStrengths } from "@/lib/topic-strengths";

export const dynamic = "force-dynamic";

// A student's topics in one course. Today it has one section, their strongest and weakest topics (US-26), read from
// this course's learning profile only. Each later story about the student's topics (what to study next, US-30; topics
// already covered, US-32) adds its own section below, built on the same `strengths.ranked` list.
export default async function CourseTopicsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const user = await requireUser(`/courses/${encodeURIComponent(courseId)}/topics`);
  const course = await getCourseById(courseId);
  if (!course) notFound();
  const strengths = await getTopicStrengths(user.id, courseId);
  return <><Link className="back" href={`/courses/${courseId}`}>← Back to {course.code}</Link><span className="eyebrow">{course.code}</span><h1>Your topics</h1>
    <p className="muted">Where you stand in each topic of {course.code}, from your confidence ratings and recorded practice. It sets your personal order of the <Link href={`/courses/${courseId}/exam?order=personal`}>Upcomer Exam</Link>.</p>
    <TopicStrengthsSection courseId={courseId} strengths={strengths} />
  </>;
}
