import type { ExamPaper, ExamQuestion, ExamSection } from "@/lib/consolidated-exam";
import { examTypeLabel } from "@/lib/file-metadata-rules";
import { TIER_DESCRIPTIONS, TIER_LABELS } from "@/lib/likelihood-tiers";
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

function Question({ question }: { question: ExamQuestion }) {
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
  </li>;
}

export function ConsolidatedExamView({ sections }: { sections: ExamSection[] }) {
  return <>{sections.map(section => {
    const first = section.questions[0].position;
    const headingId = `tier-${section.tier}-${first}`;
    return <section className={styles.section} key={headingId} aria-labelledby={headingId}>
      <h2 id={headingId}>{TIER_LABELS[section.tier]} <span className={styles.count}>· {plural(section.questions.length, "question")}</span></h2>
      <p className="muted">{TIER_DESCRIPTIONS[section.tier]}</p>
      <ol className={`list ${styles.questions}`} start={first}>{section.questions.map(question => <Question key={question.id} question={question} />)}</ol>
    </section>;
  })}</>;
}
