"use client";

import { useActionState } from "react";
import { createMockExamAction, type MockExamFormState } from "@/app/courses/[courseId]/mock-exams/actions";
import {
  DIFFICULTY_HELP, DIFFICULTY_LABELS, MOCK_EXAM_DEFAULT_LENGTH, MOCK_EXAM_DIFFICULTIES, MOCK_EXAM_MAX_LENGTH, MOCK_EXAM_MIN_LENGTH,
  mockExamMessage, type MockExamOptions,
} from "@/lib/mock-exam-rules";

// The typed settings come back in the state after a refusal (the same pattern as the profile form), so the form keeps them.
export function MockExamForm({ courseId, options }: { courseId: string; options: MockExamOptions }) {
  const [state, formAction, pending] = useActionState(createMockExamAction, { status: "idle" } as MockExamFormState);
  const values = state.values;
  const chosen = new Set(values?.topics ?? []);
  return <form action={formAction}>
    <input type="hidden" name="courseId" value={courseId} />
    {state.status === "error" && <p className="notice error" role="alert">{mockExamMessage(state.error ?? "unexpected", state.available)}</p>}
    {options.topics.length > 0 && <fieldset>
      <legend>Topics (leave all unticked to use every topic)</legend>
      {options.topics.map(topic => <label key={topic.key}>
        <input type="checkbox" name="topic" value={topic.key} defaultChecked={chosen.has(topic.key)} /> {topic.label} ({topic.count} {topic.count === 1 ? "question" : "questions"})
      </label>)}
    </fieldset>}
    <label>Number of questions ({MOCK_EXAM_MIN_LENGTH} to {MOCK_EXAM_MAX_LENGTH}; {options.total} available in this course)
      <input type="number" name="length" min={MOCK_EXAM_MIN_LENGTH} max={MOCK_EXAM_MAX_LENGTH} defaultValue={values?.length ?? String(MOCK_EXAM_DEFAULT_LENGTH)} required />
    </label>
    <label>Difficulty
      <select name="difficulty" defaultValue={values?.difficulty ?? "MIXED"}>
        {MOCK_EXAM_DIFFICULTIES.map(item => <option key={item} value={item}>{DIFFICULTY_LABELS[item]}</option>)}
      </select>
    </label>
    <p className="muted">{DIFFICULTY_HELP}</p>
    <button className="button" type="submit" disabled={pending}>{pending ? "Generating…" : "Generate mock exam"}</button>
  </form>;
}
