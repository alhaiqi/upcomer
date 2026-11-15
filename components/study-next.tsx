import Link from "next/link";
import { CoveredButton } from "@/components/covered-topics";
import { ALL_TOPICS_COVERED, coveredLeftOut, NO_TOPICS_TO_RECOMMEND, type StudyNext } from "@/lib/study-next-rules";
import styles from "./study-next.module.css";

// The "Study next" section of a course's topics page (US-30): the one topic to study next, why (its exam share and what
// its weakness rests on), and where to practise. Neither the practice page nor the Upcomer Exam can show one topic only,
// so the links open the pages themselves. Topics the student marked as covered (US-32) are left out, and the card's
// button marks the recommended one. Nothing here claims mastery or promises what the next exam covers.
export function StudyNextSection({ courseId, next }: { courseId: string; next: StudyNext }) {
  const topic = next.recommended;
  return <section className={styles.section} aria-labelledby="study-next">
    <h2 id="study-next">Study next</h2>
    {!topic ? <p className="notice" role="note" data-state={next.state}>{next.state === "all_covered" ? ALL_TOPICS_COVERED : NO_TOPICS_TO_RECOMMEND}</p> : <>
      <p className="muted">A suggestion from past papers and your own results so far. It is not a guarantee of what the next exam will cover.</p>
      <div className={`card ${styles.topic}`} data-recommended={topic.topicKey}>
        <h3>{topic.topic}</h3>
        <p data-reason>{topic.reason}</p>
        <details><summary>How this is worked out</summary><p className="muted">{topic.explanation}</p></details>
        <p className="catalog-links">
          <Link href={`/courses/${courseId}/practice`}>Practise questions</Link>
          <Link href={`/courses/${courseId}/exam?order=personal`}>See the Upcomer Exam in your personal order</Link>
          {!topic.rated && <Link href={`/courses/${courseId}/confidence`}>Rate your topics</Link>}
        </p>
        <CoveredButton courseId={courseId} topicKey={topic.topicKey} topic={topic.topic} covered={false} />
      </div>
      {next.coveredTopics > 0 && <p className="muted" data-left-out>{coveredLeftOut(next.coveredTopics)}</p>}
    </>}
  </section>;
}
