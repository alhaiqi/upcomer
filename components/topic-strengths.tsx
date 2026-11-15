import Link from "next/link";
import { CoveredLabel } from "@/components/covered-topics";
import { strengthMessage, type RankedTopic, type TopicStrengths } from "@/lib/topic-strengths-rules";
import styles from "./topic-strengths.module.css";

// The "Strongest and weakest topics" section of a course's topics page (US-26). Each topic shows what its place rests
// on (its rating and recorded practice results); nothing here claims mastery. Without enough evidence it shows a clear
// message and a link to the ratings instead of a list. A topic the student marked as covered (US-32) keeps its place and
// gets a "Covered" label only.

function Topics({ topics }: { topics: RankedTopic[] }) {
  return <ol className={styles.topics}>
    {topics.map(topic => <li key={topic.topicKey}><strong>{topic.topic}</strong>{topic.covered && <CoveredLabel />}<span>{topic.evidence}</span></li>)}
  </ol>;
}

export function TopicStrengthsSection({ courseId, strengths }: { courseId: string; strengths: TopicStrengths }) {
  const { state, ranked, strongest, weakest } = strengths;
  const rate = <Link href={`/courses/${courseId}/confidence`}>Rate your topics</Link>;
  const practice = <Link href={`/courses/${courseId}/practice`}>practice questions</Link>;
  return <section className={styles.section} aria-labelledby="topic-strengths">
    <h2 id="topic-strengths">Strongest and weakest topics</h2>
    {state === "ok" ? <>
      <p className="muted">Based on your ratings and recorded practice results in this course. It is a guide, not a measure of mastery.</p>
      <div className={`grid ${styles.lists}`}>
        <div className="card" data-list="strongest"><h3>Strongest so far</h3>
          {strongest.length ? <Topics topics={strongest} /> : <p className="muted">No topic stands out as stronger than the rest yet.</p>}
        </div>
        <div className="card" data-list="weakest"><h3>Weakest so far</h3>
          {weakest.length ? <Topics topics={weakest} /> : <p className="muted">No topic stands out as weaker than the rest yet.</p>}
        </div>
      </div>
      <p className="muted">{rate} or {practice} to keep this up to date.</p>
    </> : <>
      <p className="notice" role="note">{strengthMessage(state, ranked.length)}{state !== "no_topics" && <> {rate} or {practice} to see your strongest and weakest topics here.</>}</p>
      {state === "level" && <div className={`card ${styles.level}`} data-list="level"><h3>Your topics so far</h3><Topics topics={ranked} /></div>}
    </>}
  </section>;
}
