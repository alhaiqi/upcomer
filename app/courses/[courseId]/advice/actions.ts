"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { publishAdvice } from "@/lib/advice";
import type { AdviceError, AdviceFormValues } from "@/lib/advice-rules";

export type AdviceFormState = { status: "idle" | "published" | "error"; error?: AdviceError; values?: AdviceFormValues };

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

// The author is always the session user: any user ID in the form is ignored. On a refusal the typed values come back in the
// state, so the form keeps them without putting them in the URL.
export async function publishAdviceAction(_previous: AdviceFormState, formData: FormData): Promise<AdviceFormState> {
  const courseId = field(formData, "courseId");
  const route = `/courses/${encodeURIComponent(courseId)}/advice`;
  const user = await requireUser(route);
  const values: AdviceFormValues = {
    scopeKind: field(formData, "scopeKind"), scopeValue: field(formData, "scopeValue"), title: field(formData, "title"), body: field(formData, "body"),
    resourceUrl: field(formData, "resourceUrl"), resourceTitle: field(formData, "resourceTitle"), isAnonymous: formData.get("isAnonymous") === "on",
  };
  const result = await publishAdvice(user.id, { courseId, ...values });
  if (!result.ok) return { status: "error", error: result.error, values };
  revalidatePath(route);
  return { status: "published" };
}
