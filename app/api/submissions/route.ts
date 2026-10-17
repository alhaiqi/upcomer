import { getCurrentUser } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { saveSubmission } from "@/lib/submissions";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-rules";
import { parseUploadForm, UploadError } from "@/lib/uploads";

export const runtime = "nodejs";

const ROUTE = "POST /api/submissions";
// Room for the text fields and multipart boundaries around the file itself.
const FORM_OVERHEAD_BYTES = 1024 * 1024;

// The submit page posts here as a plain form, so every answer is a redirect: to My Submissions, or back to the form
// with the reason. Only IDs and the category go back into the URL, never what the student typed.
const see = (request: Request, location: string) => Response.redirect(new URL(location, request.url), 303);

function backToForm(request: Request, reason: string, courseId?: string, category?: string) {
  const query = new URLSearchParams({ error: reason });
  if (courseId) query.set("courseId", courseId);
  if (category) query.set("category", category);
  return see(request, `/submit?${query}`);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    logError("unauthorized_access", { route: ROUTE, role: "anonymous" });
    return see(request, `/login?next=${encodeURIComponent("/submit")}`);
  }
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES + FORM_OVERHEAD_BYTES) {
    logError("submission_refused", { reason: "file_too_large", userId: user.id });
    return backToForm(request, "file_too_large");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    logError("submission_refused", { reason: "invalid_form", userId: user.id });
    return backToForm(request, "invalid_form");
  }
  const rawCourseId = form.get("courseId");
  const rawCategory = form.get("category");
  const courseId = typeof rawCourseId === "string" && rawCourseId ? rawCourseId.slice(0, 100) : undefined;
  const category = rawCategory === "EXAM" || rawCategory === "MATERIAL" ? rawCategory : undefined;
  const context = { courseId, resourceCategory: category, userId: user.id };
  try {
    const { file, ...fields } = parseUploadForm(form);
    await saveSubmission(user.id, { ...fields, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return see(request, "/my-submissions?submitted=1");
  } catch (error) {
    if (error instanceof UploadError) {
      // Storage and record failures are already logged with their cause by the upload service.
      if (error.status < 500) logError("submission_refused", { ...context, reason: error.reason });
      return backToForm(request, error.reason, courseId, category);
    }
    logError("submission_failed", { ...context, errorType: error instanceof Error ? error.name : "Unknown" });
    return backToForm(request, "submission_failed", courseId, category);
  }
}
