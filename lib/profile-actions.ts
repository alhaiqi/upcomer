"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { saveProfile } from "@/lib/profile";
import type { ProfileError, ProfileValues } from "@/lib/profile-rules";

export type ProfileFormState = { status: "idle" | "saved" | "error"; error?: ProfileError; values?: ProfileValues };

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

// The profile saved is always the session user's: any user ID in the form is ignored. On a refusal the typed values come
// back in the state, so the form keeps them without putting them in the URL.
export async function saveProfileAction(_previous: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await requireUser("/profile");
  const values = { name: field(formData, "name"), facultyId: field(formData, "facultyId"), major: field(formData, "major") };
  const result = await saveProfile(user.id, values);
  if (!result.ok) return { status: "error", error: result.error, values };
  revalidatePath("/profile");
  return { status: "saved", values: result.values };
}
