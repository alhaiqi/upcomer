"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { saveFileMetadata } from "@/lib/file-metadata";

// Success returns to the list filtered by the file's (possibly new) course; a failure returns to the edit form with the reason.
export async function saveFileMetadataAction(formData: FormData) {
  await requireAdmin("/admin/files");
  const id = String(formData.get("id") ?? "");
  const result = await saveFileMetadata(id, formData);
  if (result.ok) redirect(`/admin/files?${new URLSearchParams({ courseId: result.courseId, saved: "1" })}`);
  if (result.error === "not_found") redirect("/admin/files?error=not_found");
  redirect(`/admin/files/${encodeURIComponent(id)}?error=${result.error}`);
}
