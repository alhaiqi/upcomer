import { ResumeScroll } from "./resume-scroll";
import styles from "./question-progress.module.css";

type Positions = Array<{ id: string; position: number }>;

// How far a student is down the Upcomer Exam (US-21), and where to continue: the first question, in the order shown,
// not marked done. Shown to the logged-in student only, from their own marks. "at" is the question the student just
// marked or undid; the page scrolls back to it, and otherwise to the place to continue.
export function ProgressSummary({ positions, done, at }: { positions: Positions; done: ReadonlySet<string>; at?: number }) {
  const doneCount = positions.filter(question => done.has(question.id)).length;
  const next = positions.find(question => !done.has(question.id));
  const back = at !== undefined && positions.some(question => question.position === at) ? at : undefined;
  const scrollTo = back ?? (doneCount && next ? next.position : undefined);
  return <>
    {scrollTo !== undefined && <ResumeScroll key={scrollTo} targetId={`question-${scrollTo}`} />}
    {doneCount > 0 && (next
      ? <p className={styles.progress} role="status">{doneCount} of {positions.length} questions done. <a href={`#question-${next.position}`}>Continue at question {next.position}</a></p>
      : <p className={styles.progress} role="status">You marked all {positions.length} questions done.</p>)}
  </>;
}
