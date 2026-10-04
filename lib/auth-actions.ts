"use server";

import { redirect } from "next/navigation";
import { authenticate, createAccount, endSession, safeNext, startSession } from "@/lib/auth";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");
const nextParam = (next: string) => (next ? `&next=${encodeURIComponent(next)}` : "");

export async function signUpAction(formData: FormData) {
  const next = safeNext(field(formData, "next"), "");
  const result = await createAccount({ name: field(formData, "name"), email: field(formData, "email"), password: field(formData, "password") });
  if (!result.created) redirect(`/signup?error=${result.error}${nextParam(next)}`);
  redirect(`/login?registered=1${nextParam(next)}`);
}

export async function logInAction(formData: FormData) {
  const next = safeNext(field(formData, "next"), "");
  const result = await authenticate(field(formData, "email"), field(formData, "password"));
  if ("error" in result) redirect(`/login?error=${result.error}${nextParam(next)}`);
  await startSession(result.user.id);
  redirect(next || "/my-courses");
}

export async function logOutAction() {
  await endSession();
  redirect("/");
}
