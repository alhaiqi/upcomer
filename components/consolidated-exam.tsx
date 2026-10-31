import type { ExamPaper, ExamQuestion, ExamSection } from "@/lib/consolidated-exam";
import { examTypeLabel } from "@/lib/file-metadata-rules";
import { TIER_DESCRIPTIONS, TIER_LABELS } from "@/lib/likelihood-tiers";
import { MarkDoneForm } from "./mark-done";
import { ReportQuestionForm } from "./report-question";
import styles from "./consolidated-exam.module.css";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// Year and session are always shown, so a paper missing either is visible; type and professor only when set.
function paperDetails(paper: ExamPaper) {
  return [
    paper.year ? String(paper.year) : "Year unknown",
    paper.term?.name ?? "Session unknown",
    paper.examType && examTypeLabel(paper.examType),
    paper.professor?.name,
  ].filter(Boolean).join(" · ");
}

// Set when the viewer can report a question (US-23): logged in, on the course's exam.
type ReportTarget = { courseId: string } | null | undefined;
// Set when the viewer is a logged-in student (US-21): the course, the questions they marked done, and whether the page
// shows their personal order (US-28).
type ProgressTarget = { courseId: string; done: ReadonlySet<string>; personal?: boolean } | null | undefined;

function Question({ question, report, progress }: { question: ExamQuestion; report: ReportTarget; progress?: ProgressTarget }) {
  return <li className="card" id={`question-${question.position}`} data-tier={question.tier}>
    <span className="eyebrow">Question {question.position}{" "}<span className={`${styles.badge} ${styles[question.tier]}`}>{TIER_LABELS[question.tier]}</span></span>
    <p className={styles.text}>{question.text}</p>
    <p className="muted">Appeared in {question.paperCount} of {plural(question.totalPapers, "paper")}</p>
    <details className={styles.sources}>
      <summary>Show the {question.paperCount === 1 ? "source paper" : `${question.paperCount} source papers`}</summary>
      <ul aria-label={`Source papers of question ${question.position}`}>{question.papers.map(paper => <li key={paper.id}>
        <a href={`/files/${encodeURIComponent(paper.id)}`} target="_blank" rel="noopener noreferrer">{paper.title}</a>{" "}
        <span className="muted">{paperDetails(paper)}</span>
      </li>)}</ul>
    </details>
    {progress && <MarkDoneForm courseId={progress.courseId} groupId={question.id} position={question.position} done={progress.done.has(question.id)} personal={progress.personal} />}
    {report && <ReportQuestionForm courseId={report.courseId} groupId={question.id} position={question.position} />}
  </li>;
}

export function ConsolidatedExamView({ sections, report, progress }: { sections: ExamSection[]; report?: ReportTarget; progress?: ProgressTarget }) {
  return <>{sections.map(section => {
    const first = section.questions[0].position;
    const headingId = `tier-${section.tier}-${first}`;
    return <section className={styles.section} key={headingId} aria-labelledby={headingId}>
      <h2 id={headingId}>{TIER_LABELS[section.tier]} <span className={styles.count}>· {plural(section.questions.length, "question")}</span></h2>
      <p className="muted">{TIER_DESCRIPTIONS[section.tier]}</p>
      <ol className={`list ${styles.questions}`} start={first}>{section.questions.map(question => <Question key={question.id} question={question} report={report} progress={progress} />)}</ol>
    </section>;
  })}</>;
}

// The student's personal order (US-28): one list, their priorities first. Each question keeps its number and its tier
// badge from the frequency order, and the same mark and report forms.
export function PersonalExamView({ questions, report, progress }: { questions: ExamQuestion[]; report?: ReportTarget; progress?: ProgressTarget }) {
  return <section className={styles.section} aria-labelledby="personal-order">
    <h2 id="personal-order">Your order <span className={styles.count}>· {plural(questions.length, "question")}</span></h2>
    <p className="muted">Ordered with your learning profile for this course. Each question keeps its number from the frequency order.</p>
    <ol className={`list ${styles.questions}`}>{questions.map(question => <Question key={question.id} question={question} report={report} progress={progress} />)}</ol>
  </section>;
}
