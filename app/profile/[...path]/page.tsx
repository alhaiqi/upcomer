import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

// /profile/:id and /profile/:id/edit (US-04). A profile is only ever edited at /profile, as the session user, so a URL
// naming the user's own ID goes there, and any other ID is denied with the not-found page, never saying whether it exists.
export default async function ProfileByIdPage({ params }: { params: Promise<{ path: string[] }> }) {
  const user = await requireUser("/profile");
  const [id, ...rest] = (await params).path;
  if (id === user.id && (rest.length === 0 || (rest.length === 1 && rest[0] === "edit"))) redirect("/profile");
  logError("unauthorized_access", { route: "/profile/:id", role: user.role, userId: user.id });
  notFound();
}
