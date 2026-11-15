import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCourseById } from "@/lib/courses";
import { getConsolidatedExam } from "@/lib/consolidated-exam";
import { getLearningProfile, questionTopic } from "@/lib/learning-profile";
import { explainPriority, personalizeQuestions } from "@/lib/personal-order";
import { PUBLISHED_FILES } from "@/lib/file-visibility";
import { practiceMessage } from "@/lib/learning-evidence-rules";
import { recordPracticeAction } from "./actions";
import styles from "@/components/practice.module.css";

export const dynamic = "force-dynamic";

export default async function PracticePage({ params, searchParams }: {
  params: Promise<{ courseId: string }>; searchParams: Promise<{ saved?: string; error?: string; page?: string }>;
}) {
  const { courseId } = await params;
  const route = `/courses/${encodeURIComponent(courseId)}/practice`;
  const user = await requireUser(route);
  const [course, exam, profile, sources, notice] = await Promise.all([
    getCourseById(courseId), getConsolidatedExam(courseId), getLearningProfile(user.id, courseId),
    db.question.findMany({ where: { groupId: { not: null }, file: { courseId, category: "EXAM", ...PUBLISHED_FILES } }, select: { id: true, groupId: true, file: { select: { id: true, topic: true } } }, orderBy: [{ file: { year: "desc" } }, { file: { createdAt: "desc" } }, { id: "asc" }] }), searchParams,
  ]);
  if (!course) notFound();
  const paperTopics = new Map(sources.map(item => [item.file.id, item.file.topic]));
  const questions = personalizeQuestions(exam.questions, paperTopics, profile).questions;
  const pages = Math.max(1, Math.ceil(questions.length / 20));
  const page = Math.min(pages, Math.max(1, Number.parseInt(notice.page ?? "1", 10) || 1));
  return <><Link className="back" href={`/courses/${courseId}`}>Back to {course.code}</Link>
    <span className="eyebrow">{course.code}</span><h1>Question practice</h1>
    <p className="muted">Attempt a question, check your work, then record how you did. Outcomes are self-reported, not automatically graded. Marking a question done is separate.</p>
    <p className="catalog-links"><Link href={`/courses/${courseId}/exam?order=personal`}>Your exam order</Link><Link href={`/courses/${courseId}/confidence`}>Rate your topics</Link><Link href={`/courses/${courseId}/topics`}>Your topics</Link><Link href={`${route}/generated`}>Generate practice questions</Link></p>
    {notice.saved === "1" && <p className="notice" role="status">Practice outcome saved. Your course profile and priorities are updated.</p>}
    {notice.error && <p className="notice error" role="alert">{practiceMessage(notice.error)}</p>}
    {!questions.length && <p className="card muted">No published questions are ready for practice yet.</p>}
    <ol className="list" start={(page - 1) * 20 + 1}>{questions.slice((page - 1) * 20, page * 20).map(question => {
      const topic = questionTopic(question.papers.map(paper => ({ topic: paperTopics.get(paper.id) ?? null })));
      const source = sources.find(item => item.groupId === question.id);
      const explanation = question.priorityExplanation ?? explainPriority(question, topic?.topic ?? null, topic ? profile.get(topic.topicKey) : undefined);
      return <li className="card" key={question.id}>
        <h2>Question {question.position}</h2><p className={styles.prompt}>{question.text}</p>
        <details><summary>Why this priority?</summary><p className="muted">{explanation}</p></details>
        {topic && source ? <form action={recordPracticeAction} className="form">
          <input type="hidden" name="courseId" value={courseId} /><input type="hidden" name="questionId" value={source.id} /><input type="hidden" name="eventId" value={randomUUID()} />
          <fieldset className={styles.choices}><legend>How did your attempt go?</legend><label><input type="radio" name="outcome" value="CORRECT" required /> Correct</label><label><input type="radio" name="outcome" value="INCORRECT" required /> Incorrect</label></fieldset>
          <button className="button" type="submit">Save practice outcome</button>
        </form> : <p className="muted">No topic assigned. This question cannot update a topic profile until its source paper is tagged.</p>}
      </li>;
    })}</ol>
    {pages > 1 && <nav className="pagination" aria-label="Practice pages">{page > 1 && <Link href={`${route}?page=${page - 1}`}>Previous</Link>}<span>Page {page} of {pages}</span>{page < pages && <Link href={`${route}?page=${page + 1}`}>Next</Link>}</nav>}
  </>;
}
