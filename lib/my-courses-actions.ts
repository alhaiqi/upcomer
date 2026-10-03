"use server";

import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { addCourseToMyCourses } from "@/lib/my-courses";

export async function addCourseAction(formData: FormData) {
  const courseId = String(formData.get("courseId") ?? "");
  const user = await requireUser(`/courses/${courseId}`);
  const result = await addCourseToMyCourses(user.id, courseId);
  if (result === "not_found") notFound();
  redirect(`/courses/${courseId}?added=${result === "added" ? "1" : "already"}`);
}
