import { getAdminUser } from "@/lib/auth";
import { manageFile } from "@/lib/file-management";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-rules";
import { checkRateLimit, limitFromEnv } from "@/lib/rate-limit";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const admin = await getAdminUser("POST /api/admin/files/:fileId");
  if (!admin) return Response.json({ error: "forbidden" }, { status: 403 });
  // Plain multipart forms do not get Next server-action origin validation automatically.
  // Next may expose its internal localhost URL even when the browser used 127.0.0.1 or a reverse-proxy hostname.
  // The request Host is the public authority; use it both for validation and same-site form redirects.
  const internal = new URL(request.url);
  const host = request.headers.get("host") ?? internal.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? internal.protocol.slice(0, -1);
  const publicOrigin = `${protocol}://${host}`;
  const origin = request.headers.get("origin");
  if (origin && origin !== publicOrigin) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!checkRateLimit(`file-management:${admin.id}`, limitFromEnv("FILE_MANAGEMENT_RATE_LIMIT_PER_MINUTE", 20), 60_000).ok) {
    logError("file_management_refused", { userId: admin.id, reason: "rate_limited" });
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }
  const { fileId } = await params;
  const back = `/admin/files/${encodeURIComponent(fileId)}/manage`;
  const failure = (error: string) => {
    logError("file_management_refused", { userId: admin.id, fileId, reason: error });
    return Response.redirect(new URL(`${back}?error=${error}`, publicOrigin), 303);
  };
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES + 1024 * 1024) return failure("invalid_file");
  let form: FormData;
  try { form = await request.formData(); } catch { return failure("invalid_file"); }
  const expectedVersion = String(form.get("version") ?? "");
  const operation = form.get("operation");
  const file = form.get("file");
  const result = operation === "remove"
    ? await manageFile(admin.id, fileId, expectedVersion, { operation, confirmed: form.get("confirm") === "yes" })
    : operation === "replace" && file instanceof File && file.size <= MAX_UPLOAD_BYTES
      ? await manageFile(admin.id, fileId, expectedVersion, { operation, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
      : { ok: false as const, error: "invalid_file" };
  if (!result.ok) return failure(result.error);
  const destination = operation === "remove" ? `/admin/files?courseId=${encodeURIComponent(result.courseId)}&saved=1` : `${back}?saved=1`;
  return Response.redirect(new URL(`${destination}${result.cleanupPending ? "&cleanup=1" : ""}`, publicOrigin), 303);
}
