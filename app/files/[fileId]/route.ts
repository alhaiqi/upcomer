import { FileUnavailableError, getOriginalFile } from "@/lib/files";
import { errorCode, logError } from "@/lib/logger";

export const runtime = "nodejs";

// Errors from getOriginalFile carry the file's courseId once its record has been found.
function courseIdOf(error: unknown) {
  const courseId = typeof error === "object" && error !== null ? (error as { courseId?: unknown }).courseId : undefined;
  return typeof courseId === "string" && courseId ? courseId : undefined;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

// "Open Original File" opens in a new tab, so this page stands alone. It never shows the file ID, path, or error.
function unavailablePage(status: 404 | 500, courseId?: string) {
  const back = courseId
    ? { href: `/courses/${encodeURIComponent(courseId)}`, label: "Back to the course" }
    : { href: "/", label: "Browse courses" };
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>File unavailable · Upcomer</title>
<style>
body { margin: 0; background: #f7f8fb; color: #1a2737; font-family: Arial, Helvetica, sans-serif; }
header { padding: 1rem 2rem; background: #142d4e; color: white; font-weight: 700; font-size: 1.2rem; }
main { max-width: 880px; margin: 0 auto; padding: 2.5rem 1.25rem; }
.card { background: white; border: 1px solid #dce3ec; border-radius: 12px; padding: 1.4rem; }
h1 { margin: 0 0 .6rem; font-size: 1.8rem; }
p { color: #52657a; line-height: 1.5; }
a { display: inline-block; margin-top: .6rem; border-radius: 8px; background: #20599b; color: white; padding: .7rem 1rem; text-decoration: none; font-weight: 700; }
a:hover { background: #174474; }
</style></head>
<body><header>Upcomer</header><main><div class="card">
<h1>File unavailable</h1>
<p>This file isn't available right now. ${status === 404 ? "It may have been moved or removed." : "Something went wrong while opening it. Please try again later."}</p>
<a href="${escapeHtml(back.href)}">${back.label}</a>
</div></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  try {
    const { record, bytes } = await getOriginalFile(fileId);
    const safeName = record.originalFileName.replace(/[^\x20-\x7E]|["\\/;]/g, "_");
    const mimeType = record.mimeType || "application/octet-stream";
    const disposition = mimeType === "application/pdf" ? "inline" : "attachment";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `${disposition}; filename="${safeName}"`,
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof FileUnavailableError) {
      return unavailablePage(404, courseIdOf(error));
    }
    logError("file_open_failed", { fileId, errorType: error instanceof Error ? error.name : "Unknown", errorCode: errorCode(error) });
    return unavailablePage(500, courseIdOf(error));
  }
}
