import { setTopicCoveredAction } from "@/lib/topic-covered-actions";
import { COVERED, COVERED_FIELD, NOT_COVERED, TOPIC_FIELD } from "@/lib/topic-covered-rules";
import styles from "./covered-topics.module.css";

// US-32: a student marks a topic of a course as already covered, or undoes it. Covered only leaves the topic out of
// "Study next"; nothing here claims the student has mastered it.

export type CoveredTopicRow = { topicKey: string; topic: string; covered: boolean };

// The small "Covered" label, also used in the strongest and weakest lists.
export function CoveredLabel() {
  return <em className={styles.label} data-covered>Covered</em>;
}

// One plain POST form with one button: it sets the topic to the opposite of `covered`. The form says which state it
// asks for (1 or 0), so a double submit or a stale page gives the same result. The server checks the topic again.
export function CoveredButton({ courseId, topicKey, topic, covered }: { courseId: string } & CoveredTopicRow) {
  const text = covered ? "Undo covered" : "Mark as covered";
  return <form className={styles.form} action={setTopicCoveredAction}>
    <input type="hidden" name="courseId" value={courseId} />
    <input type="hidden" name={TOPIC_FIELD} value={topicKey} />
    <input type="hidden" name={COVERED_FIELD} value={covered ? NOT_COVERED : COVERED} />
    <button className="button" type="submit" aria-label={`${text}: ${topic}`}>{text}</button>
  </form>;
}

// Every topic of the course, in name order, with its state and its one button.
export function CoveredTopicsSection({ courseId, topics }: { courseId: string; topics: CoveredTopicRow[] }) {
  return <section className={styles.section} aria-labelledby="covered-topics">
    <h2 id="covered-topics">Covered topics</h2>
    {!topics.length ? <p className="notice" role="note">This course&apos;s exam papers have no topics yet, so there is nothing to mark as covered.</p> : <>
      <p className="muted">Mark a topic you have already covered to leave it out of Study next. It does not change your ratings, your practice results or your personal order of the Upcomer Exam, and it does not mean you have mastered the topic.</p>
      <ul className={styles.topics}>
        {topics.map(row => <li key={row.topicKey} className="card" data-topic={row.topicKey} data-state={row.covered ? "covered" : "not-covered"}>
          <span className={styles.name}><strong>{row.topic}</strong>{row.covered ? <CoveredLabel /> : <span className="muted">Not covered</span>}</span>
          <CoveredButton courseId={courseId} {...row} />
        </li>)}
      </ul>
    </>}
  </section>;
}
