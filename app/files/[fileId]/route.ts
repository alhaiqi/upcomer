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
<script id="theme-init">try{var t=localStorage.getItem("upcomer-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
<style>
/* A copy of the "Study mint" tokens this page needs; the source of truth is app/globals.css. */
:root { color-scheme: light dark; --bg: light-dark(#F6FAF8, #0F1714); --surface: light-dark(#FFFFFF, #16211D); --border: light-dark(#D1E7DD, #2A3A33);
  --text: light-dark(#022C22, #E6F2EC); --muted: light-dark(#4B6358, #9DB5AA); --brand: light-dark(#064E3B, #6EE7B7); --primary: light-dark(#059669, #34D399);
  --button-bg: light-dark(#047857, #34D399); --button-bg-hover: light-dark(#065F46, #6EE7B7); --button-text: light-dark(#FFFFFF, #022C22); --accent: light-dark(#F97316, #FB923C); }
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; line-height: 1.6; }
header { border-bottom: 1px solid var(--border); background: var(--surface); padding: .85rem 1.25rem; color: var(--brand); font-size: 1.3rem; font-weight: 800; letter-spacing: -0.03em; }
main { max-width: 32rem; margin: 0 auto; padding: 3rem 1rem; }
.card { border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 10px; background: var(--surface); padding: 2rem 1.75rem; }
h1 { margin: 0 0 .5rem; font-size: 1.6rem; font-weight: 800; letter-spacing: -0.02em; }
p { color: var(--muted); }
a { display: inline-block; margin-top: .75rem; border-radius: 8px; background: var(--button-bg); color: var(--button-text); padding: .6rem 1.05rem; font-weight: 600; text-decoration: none; }
a:hover { background: var(--button-bg-hover); }
a:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
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
