"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createMockExam, saveMockExam } from "@/lib/mock-exams";
import type { MockExamError, MockExamFormValues } from "@/lib/mock-exam-rules";

export type MockExamFormState = { status: "idle" | "error"; error?: MockExamError; available?: number; values?: MockExamFormValues };

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

// The exam's student is always the session user: any user ID in the form is ignored. On a refusal the typed settings come
// back in the state, so the form keeps them. On success the student goes straight to the exam.
export async function createMockExamAction(_previous: MockExamFormState, formData: FormData): Promise<MockExamFormState> {
  const courseId = field(formData, "courseId");
  const route = `/courses/${encodeURIComponent(courseId)}/mock-exams`;
  const user = await requireUser(route);
  const values: MockExamFormValues = { length: field(formData, "length"), difficulty: field(formData, "difficulty"), topics: formData.getAll("topic").map(String) };
  const result = await createMockExam(user.id, { courseId, ...values });
  if (!result.ok) return { status: "error", error: result.error, available: result.available, values };
  redirect(`${route}/${encodeURIComponent(result.id)}`);
}

// "Save progress" and "Submit exam" are two buttons of one form; the clicked one's value arrives as `intent`.
export async function saveMockExamAction(formData: FormData) {
  const courseId = field(formData, "courseId");
  const mockExamId = field(formData, "mockExamId");
  const route = `/courses/${encodeURIComponent(courseId)}/mock-exams/${encodeURIComponent(mockExamId)}`;
  const user = await requireUser(route);
  const answers: Record<string, string> = {};
  for (const [key, value] of formData.entries()) if (key.startsWith("answer_") && typeof value === "string") answers[key.slice("answer_".length)] = value;
  const submit = field(formData, "intent") === "submit";
  const result = await saveMockExam(user.id, mockExamId, answers, submit);
  redirect(`${route}?${new URLSearchParams(result.ok ? { [submit ? "submitted" : "saved"]: "1" } : { error: result.error })}`);
}
