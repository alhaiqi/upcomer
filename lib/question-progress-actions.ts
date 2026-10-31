"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { markQuestion } from "@/lib/question-progress";

// A student marks a question of the Upcomer Exam done or undoes the mark (US-21), and comes back to the same question, in
// the same order (US-28). The student is always the session's: a user ID in the form is never read. Next.js drops the
// #question-N of a redirect after a server action, so "at" tells the page which question to scroll back to; a refusal
// returns to the notice at the top of the page, like a question report's.
export async function markQuestionAction(formData: FormData) {
  const route = `/courses/${encodeURIComponent(String(formData.get("courseId") ?? ""))}/exam`;
  const user = await requireUser(route);
  const result = await markQuestion(user.id, { groupId: String(formData.get("groupId") ?? ""), choice: String(formData.get("choice") ?? "") });
  const position = Number(formData.get("position"));
  const valid = Number.isInteger(position) && position > 0;
  const query = new URLSearchParams();
  if (formData.get("order") === "personal") query.set("order", "personal");
  if (!result.ok) query.set("progress_error", result.error);
  else if (valid) query.set("at", String(position));
  const target = result.ok ? `/courses/${encodeURIComponent(result.courseId)}/exam` : route;
  redirect(`${target}${query.size ? `?${query}` : ""}${valid ? `#question-${position}` : ""}`);
}
