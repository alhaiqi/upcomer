"use server";

import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getCourseById } from "@/lib/courses";
import { setTopicCovered } from "@/lib/topic-covered";
import { COVERED, NOT_COVERED } from "@/lib/topic-covered-rules";

// A student marks a topic of a course as covered, or undoes it (US-32), and comes back to "Your topics" with the outcome.
// The student is always the session's: a user ID in the form is never read. An unknown course gives the not-found page.
export async function setTopicCoveredAction(formData: FormData) {
  const courseId = String(formData.get("courseId") ?? "");
  const route = `/courses/${encodeURIComponent(courseId)}/topics`;
  const user = await requireUser(route);
  if (!(await getCourseById(courseId))) notFound();
  const result = await setTopicCovered(user.id, courseId, formData.entries());
  redirect(`${route}?${result.ok ? `covered=${result.covered ? COVERED : NOT_COVERED}` : `error=${result.error}`}`);
}
