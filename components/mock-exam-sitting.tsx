import { saveMockExamAction } from "@/app/courses/[courseId]/mock-exams/actions";
import type { MockExamView } from "@/lib/mock-exams";
import { MOCK_ANSWER_MAX_LENGTH } from "@/lib/mock-exam-rules";
import styles from "./mock-exam-sitting.module.css";

// The sitting flow: every question with a box for the answer. "Save progress" keeps the answers (they are still there after a
// refresh); "Submit exam" locks them. After submitting the answers are shown read-only.
// A past-paper question shows how often it appeared and in which papers. A generated practice question (US-44) appeared in
// no paper (paperCount 0), so it says which paper it is based on instead.
export function MockExamSitting({ exam }: { exam: MockExamView }) {
  const submitted = exam.status === "SUBMITTED";
  const answered = exam.questions.filter(question => question.answer).length;
  return <form action={saveMockExamAction}>
    <input type="hidden" name="courseId" value={exam.courseId} />
    <input type="hidden" name="mockExamId" value={exam.id} />
    <p className="muted" data-answered>{answered} of {exam.questions.length} {exam.questions.length === 1 ? "answer" : "answers"} saved.</p>
    <ol className="list question-list">{exam.questions.map(question => <li className={`card ${styles.question}`} key={question.id} data-kind={question.paperCount === 0 ? "generated" : "past-paper"}>
      <span className="eyebrow">Question {question.position}{question.topic ? ` · ${question.topic}` : ""}</span>
      <p className={styles.text}>{question.text}</p>
      <p className="muted" data-source>{question.paperCount === 0
        ? `Generated practice question${question.sourcePapers.length ? `, based on ${question.sourcePapers.join(", ")}` : ""}. It did not appear in a past paper.`
        : `Appeared in ${question.paperCount} of ${question.totalPapers} ${question.totalPapers === 1 ? "paper" : "papers"}${question.sourcePapers.length ? `: ${question.sourcePapers.join(", ")}` : ""}`}</p>
      <label className="field"><span>Your answer to question {question.position}</span>
        <textarea name={`answer_${question.id}`} defaultValue={question.answer ?? ""} rows={6} maxLength={MOCK_ANSWER_MAX_LENGTH} readOnly={submitted} />
      </label>
    </li>)}</ol>
    {submitted
      ? <p className="muted">Submitted. Your answers are locked.</p>
      : <div className={styles.actions}>
        <button className="button" type="submit" name="intent" value="save">Save progress</button>
        <button className="button" type="submit" name="intent" value="submit">Submit exam</button>
        <p className="muted">Submitting saves your answers and locks them. You can&apos;t change them afterwards.</p>
      </div>}
  </form>;
}
