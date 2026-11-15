import { saveMockExamAction } from "@/app/courses/[courseId]/mock-exams/actions";
import type { MockExamView } from "@/lib/mock-exams";
import { MOCK_ANSWER_MAX_LENGTH } from "@/lib/mock-exam-rules";

// The sitting flow: every question with a box for the answer. "Save progress" keeps the answers (they are still there after a
// refresh); "Submit exam" locks them. After submitting the answers are shown read-only.
export function MockExamSitting({ exam }: { exam: MockExamView }) {
  const submitted = exam.status === "SUBMITTED";
  return <form action={saveMockExamAction}>
    <input type="hidden" name="courseId" value={exam.courseId} />
    <input type="hidden" name="mockExamId" value={exam.id} />
    <ol className="list question-list">{exam.questions.map(question => <li className="card" key={question.id}>
      <span className="eyebrow">Question {question.position}{question.topic ? ` · ${question.topic}` : ""}</span>
      <p style={{ whiteSpace: "pre-wrap" }}>{question.text}</p>
      <p className="muted">Appeared in {question.paperCount} of {question.totalPapers} {question.totalPapers === 1 ? "paper" : "papers"}{question.sourcePapers.length ? `: ${question.sourcePapers.join(", ")}` : ""}</p>
      <label>Your answer
        <textarea name={`answer_${question.id}`} defaultValue={question.answer ?? ""} rows={6} maxLength={MOCK_ANSWER_MAX_LENGTH} readOnly={submitted} />
      </label>
    </li>)}</ol>
    {submitted
      ? <p className="muted">Submitted. Your answers are locked.</p>
      : <p>
        <button className="button" type="submit" name="intent" value="save">Save progress</button>{" "}
        <button className="button" type="submit" name="intent" value="submit">Submit exam</button>
      </p>}
  </form>;
}
