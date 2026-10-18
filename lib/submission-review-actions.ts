"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { reviewSubmission } from "@/lib/submission-review";

const ROUTE = "/admin/submissions";

// Both actions return to the queue page the admin was on. The rejection reason is never put in the URL.
function back(formData: FormData, outcome: string) {
  const page = Number(formData.get("page"));
  return `${ROUTE}?${outcome}${Number.isInteger(page) && page > 1 ? `&page=${page}` : ""}`;
}

export async function publishSubmissionAction(formData: FormData) {
  const admin = await requireAdmin(ROUTE);
  const result = await reviewSubmission(admin.id, "publish", String(formData.get("id") ?? ""));
  redirect(back(formData, result.ok ? "published=1" : `error=${result.error}`));
}

export async function rejectSubmissionAction(formData: FormData) {
  const admin = await requireAdmin(ROUTE);
  const result = await reviewSubmission(admin.id, "reject", String(formData.get("id") ?? ""), String(formData.get("reason") ?? ""));
  redirect(back(formData, result.ok ? "rejected=1" : `error=${result.error}`));
}
