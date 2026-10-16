"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { rebuildQuestionBank } from "@/lib/question-bank";

export async function rebuildQuestionBankAction(formData: FormData) {
  await requireAdmin("/admin/questions");
  const courseId = String(formData.get("courseId") ?? "");
  const result = await rebuildQuestionBank(courseId);
  if (result.ok) redirect(`/admin/questions?${new URLSearchParams({ rebuilt: courseId, groups: String(result.groupCount) })}`);
  redirect(`/admin/questions?error=${result.error}`);
}
